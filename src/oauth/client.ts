import { HttpFetch, OAuthClientConfig, StoredToken } from './types';
import { isSafeAccountId } from '../utils/validation';

export const AUTH_BASE = 'https://auth.atlassian.com';
export const API_BASE = 'https://api.atlassian.com';

/** Refresh slightly early so tokens don't expire mid-request. */
const EXPIRY_SKEW_MS = 60 * 1000;

export class OAuthError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'OAuthError';
  }
}

export function buildAuthorizeUrl(config: OAuthClientConfig, state: string): string {
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: config.clientId,
    scope: config.scopes.join(' '),
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent'
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

async function postToken(
  http: HttpFetch,
  body: Record<string, string>,
  now: number,
  previousRefreshToken?: string
): Promise<StoredToken> {
  const res = await http(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let code: string | undefined;
    let description = `Token endpoint returned HTTP ${res.status}`;
    try {
      const err = await res.json();
      code = err?.error;
      if (err?.error_description) description = err.error_description;
    } catch {
      // non-JSON error body
    }
    throw new OAuthError(description, code, res.status);
  }

  const data = await res.json();
  if (typeof data?.access_token !== 'string' || !data.access_token) {
    throw new OAuthError('Token endpoint returned no access token', 'invalid_response', res.status);
  }
  return {
    accessToken: data.access_token,
    // Atlassian rotates refresh tokens; keep the old one only if none was returned.
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : previousRefreshToken,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
    scope: typeof data.scope === 'string' ? data.scope : undefined
  };
}

export function exchangeCode(
  http: HttpFetch,
  config: OAuthClientConfig,
  code: string,
  now: number
): Promise<StoredToken> {
  return postToken(
    http,
    {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri
    },
    now
  );
}

export function refreshToken(
  http: HttpFetch,
  config: Pick<OAuthClientConfig, 'clientId' | 'clientSecret'>,
  refresh: string,
  now: number
): Promise<StoredToken> {
  return postToken(
    http,
    {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refresh
    },
    now,
    refresh
  );
}

export function isExpired(token: StoredToken, now: number): boolean {
  return token.expiresAt - EXPIRY_SKEW_MS <= now;
}

export interface AtlassianIdentity {
  accountId: string;
  email: string;
  name?: string;
}

export async function fetchIdentity(http: HttpFetch, accessToken: string): Promise<AtlassianIdentity> {
  const res = await http(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  if (!res.ok) {
    throw new OAuthError(`Could not read Atlassian profile (HTTP ${res.status})`, undefined, res.status);
  }
  const me = await res.json();
  if (!isSafeAccountId(me?.account_id)) {
    throw new OAuthError('Atlassian profile has no valid account id', 'invalid_response', res.status);
  }
  const email = typeof me.email === 'string' && me.email ? me.email : me.account_id;
  return { accountId: me.account_id, email, name: typeof me.name === 'string' ? me.name : undefined };
}
