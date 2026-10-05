import { API_BASE, isExpired, OAuthError, refreshToken } from './client';
import { OAuthStore } from './store';
import { HttpFetch, HttpResponse, OAuthClientConfig, StoredToken } from './types';
import { ForgeAuthProvider } from '../resolvers/sites';

/** Synthetic 401 so callers map a dead connection to AUTH_ERROR like a real one. */
function unauthorized(message: string): HttpResponse {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: 'unauthorized', message }),
    text: async () => message
  };
}

/**
 * ForgeAuthProvider backed by tokens stored per Jira user.
 * One instance per resolver invocation: concurrent requests for the same
 * account share a single refresh, which matters because Atlassian rotates
 * refresh tokens on every use.
 */
export class TokenAuthProvider implements ForgeAuthProvider {
  private readonly inflight = new Map<string, Promise<StoredToken | undefined>>();

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
        const token = await this.validToken(accountId);
        if (!token) {
          return unauthorized('This Atlassian account needs to be reconnected.');
        }
        return this.http(`${API_BASE}${path}`, {
          ...init,
          headers: {
            Accept: 'application/json',
            ...(init?.headers || {}),
            Authorization: `Bearer ${token.accessToken}`
          }
        });
      }
    };
  }

  private validToken(accountId: string): Promise<StoredToken | undefined> {
    let pending = this.inflight.get(accountId);
    if (!pending) {
      pending = this.loadOrRefresh(accountId);
      this.inflight.set(accountId, pending);
    }
    return pending;
  }

  private async loadOrRefresh(accountId: string): Promise<StoredToken | undefined> {
    const token = await this.store.getToken(this.userId, accountId);
    if (!token) return undefined;
    if (!isExpired(token, this.now())) return token;
    if (!token.refreshToken) return undefined;

    try {
      const refreshed = await refreshToken(this.http, this.client, token.refreshToken, this.now());
      await this.store.setToken(this.userId, accountId, refreshed);
      return refreshed;
    } catch (err) {
      if (err instanceof OAuthError && (err.code === 'invalid_grant' || err.status === 401 || err.status === 403)) {
        // Revoked or expired refresh token: the user must reconnect.
        return undefined;
      }
      throw err;
    }
  }
}
