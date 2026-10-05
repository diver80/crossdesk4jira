import { API_BASE, isExpired, OAuthError, refreshToken } from './client';
import { OAuthStore } from './store';
import { HttpFetch, HttpResponse, OAuthClientConfig, StoredToken } from './types';
import { ForgeAuthProvider } from '../resolvers/sites';

/** Error codes in the body of synthetic 401 responses. */
export const NOT_CONNECTED = 'not_connected';
export const RECONNECT_REQUIRED = 'reconnect_required';

/** Synthetic 401 so callers map a dead connection to an auth status like a real one. */
function unauthorized(error: string, message: string): HttpResponse {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error, message }),
    text: async () => message
  };
}

type TokenLookup =
  | { kind: 'ok'; token: StoredToken }
  | { kind: 'missing' }
  | { kind: 'revoked' };

/**
 * ForgeAuthProvider backed by tokens stored per Jira user.
 * One instance per resolver invocation: concurrent requests for the same
 * account share a single refresh, which matters because Atlassian rotates
 * refresh tokens on every use. Refreshes racing across invocations (e.g. two
 * gadgets on one dashboard) are resolved by re-reading storage on failure.
 */
export class TokenAuthProvider implements ForgeAuthProvider {
  private readonly inflight = new Map<string, Promise<TokenLookup>>();

  constructor(
    private readonly userId: string,
    private readonly store: OAuthStore,
    private readonly http: HttpFetch,
    private readonly client: Pick<OAuthClientConfig, 'clientId' | 'clientSecret'>,
    private readonly now: () => number = Date.now
  ) {}

  async listAccounts() {
    const accounts = await this.store.listAccounts(this.userId);
    return accounts.map(a => ({ id: a.id, displayName: a.email }));
  }

  asAccount(accountId: string) {
    return {
      fetch: async (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const lookup = await this.validToken(accountId);
        if (lookup.kind === 'missing') {
          return unauthorized(NOT_CONNECTED, 'This Atlassian account is not connected for you.');
        }
        if (lookup.kind === 'revoked') {
          return unauthorized(RECONNECT_REQUIRED, 'This Atlassian account needs to be reconnected.');
        }
        return this.http(`${API_BASE}${path}`, {
          ...init,
          headers: {
            Accept: 'application/json',
            ...(init?.headers || {}),
            Authorization: `Bearer ${lookup.token.accessToken}`
          }
        });
      }
    };
  }

  private validToken(accountId: string): Promise<TokenLookup> {
    let pending = this.inflight.get(accountId);
    if (!pending) {
      pending = this.loadOrRefresh(accountId);
      this.inflight.set(accountId, pending);
    }
    return pending;
  }

  private async loadOrRefresh(accountId: string): Promise<TokenLookup> {
    const token = await this.store.getToken(this.userId, accountId);
    if (!token) return { kind: 'missing' };
    if (!isExpired(token, this.now())) return { kind: 'ok', token };
    if (!token.refreshToken) return { kind: 'revoked' };

    try {
      const refreshed = await refreshToken(this.http, this.client, token.refreshToken, this.now());
      await this.store.setToken(this.userId, accountId, refreshed);
      return { kind: 'ok', token: refreshed };
    } catch (err) {
      if (err instanceof OAuthError && (err.code === 'invalid_grant' || err.status === 401 || err.status === 403)) {
        // Another invocation may have rotated the refresh token first and
        // stored a fresh token; use it instead of forcing a reconnect.
        const latest = await this.store.getToken(this.userId, accountId);
        if (latest && latest.refreshToken !== token.refreshToken && !isExpired(latest, this.now())) {
          return { kind: 'ok', token: latest };
        }
        return { kind: 'revoked' };
      }
      throw err;
    }
  }
}
