import { MAX_PENDING_STATES, OAuthStore, STATE_TTL_MS } from '../src/oauth/store';
import {
  buildCallbackResponse,
  completeAuthorization,
  encodeRelayState,
  renderCallbackPage,
  startAuthorization,
  tryDecodeRelayState
} from '../src/oauth/flow';
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

/** Well-formed states (64 hex chars), like newState() produces. */
const state = (n: number) => n.toString(16).padStart(64, '0');
const S1 = state(1);
const S2 = state(2);

describe('OAuth authorization flow', () => {
  let kv: MemoryKV;
  let store: OAuthStore;

  beforeEach(() => {
    kv = new MemoryKV();
    store = new OAuthStore(kv);
  });

  it('builds the Atlassian authorize URL and stores a pending state as a secret', async () => {
    const { authorizeUrl } = await startAuthorization(store, CONFIG, 'jira-user-1', NOW, S1);
    const url = new URL(authorizeUrl);

    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('state')).toBe(S1);
    expect(url.searchParams.get('scope')).toBe('read:jira-work read:me offline_access');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(kv.secret.get(`oauth-state:${S1}`)).toEqual({ userId: 'jira-user-1', createdAt: NOW });
    expect(kv.plain.size).toBe(0);
  });

  it('encodes and decodes relay state correctly', () => {
    const webtrigger = 'https://install-123.hello.atlassian.net/x1/token';
    const encoded = encodeRelayState(webtrigger, S1);
    const decoded = tryDecodeRelayState(encoded);
    expect(decoded).toEqual({ target: webtrigger, secret: S1 });
  });

  it('packs webtrigger target into state when redirectUri is a public relay', async () => {
    const relayConfig = { ...CONFIG, redirectUri: 'https://diver80.github.io/crossdesk4jira/' };
    const localWebtrigger = 'https://install-123.hello.atlassian.net/x1/token';
    const { authorizeUrl } = await startAuthorization(store, relayConfig, 'jira-user-1', NOW, S1, localWebtrigger);
    const url = new URL(authorizeUrl);

    expect(url.searchParams.get('redirect_uri')).toBe('https://diver80.github.io/crossdesk4jira/');
    const outgoingState = url.searchParams.get('state')!;
    expect(outgoingState).not.toBe(S1);
    expect(tryDecodeRelayState(outgoingState)).toEqual({ target: localWebtrigger, secret: S1 });
    expect(kv.secret.get(`oauth-state:${S1}`)).toEqual({ userId: 'jira-user-1', createdAt: NOW });
  });

  it('exchanges the code, stores tokens for the initiating user and consumes the state', async () => {
    await startAuthorization(store, CONFIG, 'jira-user-1', NOW, S1);
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
      store, http, CONFIG, { queryParameters: { state: [S1], code: ['code-1'] } }, NOW + 1000
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
      store, http, CONFIG, { queryParameters: { state: [S1], code: ['code-1'] } }, NOW + 2000
    );
    expect(replay.ok).toBe(false);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown and expired states without calling Atlassian', async () => {
    const http = jest.fn();
    const unknown = await completeAuthorization(
      store, http, CONFIG, { queryParameters: { state: [S2], code: ['c'] } }, NOW
    );
    expect(unknown.ok).toBe(false);

    await startAuthorization(store, CONFIG, 'jira-user-1', NOW, S1);
    const expired = await completeAuthorization(
      store, http, CONFIG, { queryParameters: { state: [S1], code: ['c'] } }, NOW + STATE_TTL_MS + 1
    );
    expect(expired.ok).toBe(false);
    expect(expired.title).toMatch(/expired/i);
    expect(kv.secret.has(`oauth-state:${S1}`)).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it('rejects malformed or oversized states without touching storage', async () => {
    const getSecret = jest.spyOn(kv, 'getSecret');
    const http = jest.fn();
    for (const bad of ['nope', '../x', 'a'.repeat(1000), `${S1}?x`]) {
      const res = await completeAuthorization(store, http, CONFIG, { queryParameters: { state: [bad], code: ['c'] } }, NOW);
      expect(res.ok).toBe(false);
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });

  it('reports a denied consent and still consumes the state', async () => {
    await startAuthorization(store, CONFIG, 'jira-user-1', NOW, S1);
    const http = jest.fn();
    const res = await completeAuthorization(
      store, http, CONFIG,
      { queryParameters: { state: [S1], error: ['access_denied'], error_description: ['User denied'] } },
      NOW
    );
    expect(res).toMatchObject({ ok: false, message: 'User denied' });
    expect(kv.secret.has(`oauth-state:${S1}`)).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it(`keeps only the newest ${MAX_PENDING_STATES} pending states per user`, async () => {
    for (let i = 1; i <= MAX_PENDING_STATES + 2; i++) {
      await startAuthorization(store, CONFIG, 'jira-user-1', NOW, state(i));
    }
    await startAuthorization(store, CONFIG, 'jira-user-2', NOW, state(99));

    const live = [...kv.secret.keys()].filter(k => k.startsWith('oauth-state:'));
    expect(live.sort()).toEqual(
      [3, 4, 5, 99].map(i => `oauth-state:${state(i)}`).sort()
    );
  });

  it('does not store anything when the token response has no access token', async () => {
    await startAuthorization(store, CONFIG, 'jira-user-1', NOW, S1);
    const http = jest.fn<ReturnType<HttpFetch>, Parameters<HttpFetch>>(async () => json(200, { token_type: 'Bearer' }));
    await expect(
      completeAuthorization(store, http, CONFIG, { queryParameters: { state: [S1], code: ['c'] } }, NOW)
    ).rejects.toThrow(/no access token/);
    expect(await store.listAccounts('jira-user-1')).toEqual([]);
  });

  it('escapes HTML in the callback page', () => {
    const html = renderCallbackPage({ ok: false, title: '<script>x</script>', message: '"a" & b' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;a&quot; &amp; b');
  });
});

describe('buildCallbackResponse', () => {
  it('renders results with hardening headers', async () => {
    const res = await buildCallbackResponse(async () => ({ ok: true, title: 'Account connected', message: 'ok' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toEqual(['no-store']);
    expect(res.headers['Referrer-Policy']).toEqual(['no-referrer']);
    expect(res.headers['Content-Security-Policy'][0]).toContain("frame-ancestors 'none'");
    expect(res.body).toContain('Account connected');
  });

  it('shows a generic message for unexpected errors, never the error text', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await buildCallbackResponse(async () => {
      throw new Error('OAuth is not configured: set ATLASSIAN_CLIENT_SECRET');
    });
    spy.mockRestore();
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Connection failed');
    expect(res.body).not.toContain('ATLASSIAN_CLIENT_SECRET');
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

  const site = { accountId: 'atl-1', siteId: 's1', siteName: 'S1', siteUrl: 'https://s1.atlassian.net' };
  const configFor = (sites = [site]) => ({ clusterTitle: 'C', jql: 'order by updated', visibleColumns: [], selectedSites: sites });

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

  it('uses the token another invocation just refreshed instead of failing (rotation race)', async () => {
    await seed(NOW - 1);
    // Two invocations (e.g. two gadgets) share storage. The first refresh wins;
    // the second is rejected because the refresh token was already rotated.
    let refreshes = 0;
    let notifyFirstDone!: () => void;
    const firstDone = new Promise<void>(r => { notifyFirstDone = r; });
    const http = jest.fn<ReturnType<HttpFetch>, Parameters<HttpFetch>>(async url => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        refreshes++;
        if (refreshes === 1) {
          const res = json(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 });
          notifyFirstDone();
          return res;
        }
        await firstDone;
        return json(403, { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' });
      }
      return json(200, { issues: [] });
    });
    const a = new TokenAuthProvider('jira-user-1', store, http, CONFIG, () => NOW);
    const b = new TokenAuthProvider('jira-user-1', store, http, CONFIG, () => NOW);

    const [resA, resB] = await Promise.all([
      aggregateIssuesFromSites(configFor(), a),
      aggregateIssuesFromSites(configFor(), b)
    ]);

    expect(resA.results[0].status).toBe('OK');
    expect(resB.results[0].status).toBe('OK');
    const bearer = http.mock.calls
      .filter(([u]) => u.startsWith('https://api.atlassian.com'))
      .map(([, init]) => init!.headers!.Authorization);
    expect(bearer).toEqual(['Bearer at-new', 'Bearer at-new']);
  });

  it('returns AUTH_ERROR when the refresh token was revoked', async () => {
    await seed(NOW - 1);
    const http = jest.fn<ReturnType<HttpFetch>, Parameters<HttpFetch>>(async url =>
      url.startsWith('https://auth.atlassian.com')
        ? json(403, { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' })
        : json(200, {})
    );
    const provider = new TokenAuthProvider('jira-user-1', store, http, CONFIG, () => NOW);

    const res = await aggregateIssuesFromSites(configFor(), provider);

    expect(res.results[0].status).toBe('AUTH_ERROR');
    expect(http.mock.calls.some(([u]) => u.startsWith('https://api.atlassian.com'))).toBe(false);
  });

  it('returns NOT_CONNECTED when the viewer has no connection for the configured account', async () => {
    await seed(NOW + 3600_000);
    const http = jest.fn();
    // Another Jira user views a dashboard configured with jira-user-1's account.
    const viewer = new TokenAuthProvider('jira-user-2', store, http, CONFIG, () => NOW);

    const res = await aggregateIssuesFromSites(configFor(), viewer);

    expect(res.results[0].status).toBe('NOT_CONNECTED');
    expect(http).not.toHaveBeenCalled();
  });
});
