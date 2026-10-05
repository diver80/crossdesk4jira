import { OAuthStore, STATE_TTL_MS } from '../src/oauth/store';
import { completeAuthorization, renderCallbackPage, startAuthorization } from '../src/oauth/flow';
import { TokenAuthProvider } from '../src/oauth/provider';
import { HttpFetch, HttpResponse, KeyValueStore, OAuthClientConfig } from '../src/oauth/types';
import { aggregateIssuesFromSites } from '../src/resolvers/issues';

class MemoryKV implements KeyValueStore {
  plain = new Map<string, any>();
  secret = new Map<string, any>();
  async get(k: string) { return this.plain.get(k); }
  async set(k: string, v: any) { this.plain.set(k, v); }
  async delete(k: string) { this.plain.delete(k); }
  async getSecret(k: string) { return this.secret.get(k); }
  async setSecret(k: string, v: any) { this.secret.set(k, v); }
  async deleteSecret(k: string) { this.secret.delete(k); }
}

const json = (status: number, body: unknown): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

const CONFIG: OAuthClientConfig = {
  clientId: 'client-123',
  clientSecret: 'secret-xyz',
  redirectUri: 'https://example.hello.atlassian-dev.net/x1/callback',
  scopes: ['read:jira-work', 'read:me', 'offline_access']
};

const NOW = 1_800_000_000_000;

describe('OAuth authorization flow', () => {
  let kv: MemoryKV;
  let store: OAuthStore;

  beforeEach(() => {
    kv = new MemoryKV();
    store = new OAuthStore(kv);
  });

  it('builds the Atlassian authorize URL and stores a pending state as a secret', async () => {
    const { authorizeUrl } = await startAuthorization(store, CONFIG, 'jira-user-1', NOW, 'state-abc');
    const url = new URL(authorizeUrl);

    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('scope')).toBe('read:jira-work read:me offline_access');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(kv.secret.get('oauth-state:state-abc')).toEqual({ userId: 'jira-user-1', createdAt: NOW });
    expect(kv.plain.size).toBe(0);
  });

  it('exchanges the code, stores tokens for the initiating user and consumes the state', async () => {
    await startAuthorization(store, CONFIG, 'jira-user-1', NOW, 'state-abc');
    const http = jest.fn<ReturnType<HttpFetch>, Parameters<HttpFetch>>(async (url, init) => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        expect(JSON.parse(init!.body!)).toEqual({
          grant_type: 'authorization_code',
          client_id: 'client-123',
          client_secret: 'secret-xyz',
          code: 'code-1',
          redirect_uri: CONFIG.redirectUri
        });
        return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'read:jira-work' });
      }
      if (url === 'https://api.atlassian.com/me') {
        expect(init!.headers!.Authorization).toBe('Bearer at-1');
        return json(200, { account_id: 'atl-acc-9', email: 'dev@partner.com', name: 'Dev' });
      }
      return json(404, {});
    });

    const result = await completeAuthorization(
      store, http, CONFIG, { queryParameters: { state: ['state-abc'], code: ['code-1'] } }, NOW + 1000
    );

    expect(result.ok).toBe(true);
    expect(result.message).toContain('dev@partner.com');
    expect(await store.listAccounts('jira-user-1')).toEqual([
      { id: 'atl-acc-9', email: 'dev@partner.com', name: 'Dev', connectedAt: NOW + 1000 }
    ]);
    expect(await store.getToken('jira-user-1', 'atl-acc-9')).toEqual({
      accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW + 1000 + 3600_000, scope: 'read:jira-work'
    });
    // Other Jira users never see this connection.
    expect(await store.listAccounts('jira-user-2')).toEqual([]);

    // Replay of the same state is rejected.
    const replay = await completeAuthorization(
      store, http, CONFIG, { queryParameters: { state: ['state-abc'], code: ['code-1'] } }, NOW + 2000
    );
    expect(replay.ok).toBe(false);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown and expired states without calling Atlassian', async () => {
    const http = jest.fn();
    const unknown = await completeAuthorization(
      store, http, CONFIG, { queryParameters: { state: ['nope'], code: ['c'] } }, NOW
    );
    expect(unknown.ok).toBe(false);

    await startAuthorization(store, CONFIG, 'jira-user-1', NOW, 'old-state');
    const expired = await completeAuthorization(
      store, http, CONFIG, { queryParameters: { state: ['old-state'], code: ['c'] } }, NOW + STATE_TTL_MS + 1
    );
    expect(expired.ok).toBe(false);
    expect(expired.title).toMatch(/expired/i);
    expect(kv.secret.has('oauth-state:old-state')).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it('reports a denied consent and still consumes the state', async () => {
    await startAuthorization(store, CONFIG, 'jira-user-1', NOW, 's1');
    const http = jest.fn();
    const res = await completeAuthorization(
      store, http, CONFIG,
      { queryParameters: { state: ['s1'], error: ['access_denied'], error_description: ['User denied'] } },
      NOW
    );
    expect(res).toMatchObject({ ok: false, message: 'User denied' });
    expect(kv.secret.has('oauth-state:s1')).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it('escapes HTML in the callback page', () => {
    const html = renderCallbackPage({ ok: false, title: '<script>x</script>', message: '"a" & b' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;a&quot; &amp; b');
  });
});

describe('TokenAuthProvider', () => {
  let store: OAuthStore;

  beforeEach(async () => {
    store = new OAuthStore(new MemoryKV());
  });

  const seed = (expiresAt: number, refreshToken: string | undefined = 'rt-old') =>
    store.saveAccount(
      'jira-user-1',
      { id: 'atl-1', email: 'me@a.com', connectedAt: NOW },
      { accessToken: 'at-old', refreshToken, expiresAt }
    );

  it('lists only the current user\'s accounts and calls api.atlassian.com with a bearer token', async () => {
    await seed(NOW + 3600_000);
    const http = jest.fn<ReturnType<HttpFetch>, Parameters<HttpFetch>>(async () => json(200, []));
    const provider = new TokenAuthProvider('jira-user-1', store, http, CONFIG, () => NOW);

    expect(await provider.listAccounts()).toEqual([{ id: 'atl-1', displayName: 'me@a.com' }]);
    await provider.asAccount('atl-1').fetch('/oauth/token/accessible-resources');

    expect(http).toHaveBeenCalledWith(
      'https://api.atlassian.com/oauth/token/accessible-resources',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer at-old' }) })
    );
    expect(await new TokenAuthProvider('jira-user-2', store, http, CONFIG).listAccounts()).toEqual([]);
  });

  it('refreshes an expired token once for parallel requests and stores the rotated refresh token', async () => {
    await seed(NOW - 1);
    const http = jest.fn<ReturnType<HttpFetch>, Parameters<HttpFetch>>(async (url, init) => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        expect(JSON.parse(init!.body!)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-old' });
        return json(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 });
      }
      return json(200, { ok: true });
    });
    const provider = new TokenAuthProvider('jira-user-1', store, http, CONFIG, () => NOW);
    const client = provider.asAccount('atl-1');

    await Promise.all([client.fetch('/ex/jira/s1/x'), client.fetch('/ex/jira/s2/x'), client.fetch('/ex/jira/s3/x')]);

    const tokenCalls = http.mock.calls.filter(([u]) => u.startsWith('https://auth.atlassian.com'));
    expect(tokenCalls).toHaveLength(1);
    const apiCalls = http.mock.calls.filter(([u]) => u.startsWith('https://api.atlassian.com'));
    expect(apiCalls.every(([, init]) => init!.headers!.Authorization === 'Bearer at-new')).toBe(true);
    expect(await store.getToken('jira-user-1', 'atl-1')).toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new' });
  });

  it('returns 401 when the refresh token was revoked, which surfaces as AUTH_ERROR per site', async () => {
    await seed(NOW - 1);
    const http = jest.fn<ReturnType<HttpFetch>, Parameters<HttpFetch>>(async url =>
      url.startsWith('https://auth.atlassian.com')
        ? json(403, { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' })
        : json(200, {})
    );
    const provider = new TokenAuthProvider('jira-user-1', store, http, CONFIG, () => NOW);

    const res = await aggregateIssuesFromSites(
      {
        clusterTitle: 'C',
        jql: 'order by updated',
        visibleColumns: [],
        selectedSites: [{ accountId: 'atl-1', accountEmail: 'me@a.com', siteId: 's1', siteName: 'S1', siteUrl: 'https://s1.atlassian.net' }]
      },
      provider
    );

    expect(res.results[0].status).toBe('AUTH_ERROR');
    expect(http.mock.calls.some(([u]) => u.startsWith('https://api.atlassian.com'))).toBe(false);
  });

  it('returns 401 for an account without stored tokens', async () => {
    const provider = new TokenAuthProvider('jira-user-1', store, jest.fn(), CONFIG, () => NOW);
    const res = await provider.asAccount('missing').fetch('/me');
    expect(res.status).toBe(401);
  });
});
