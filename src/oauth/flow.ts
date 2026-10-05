import { randomBytes } from 'crypto';
import { buildAuthorizeUrl, exchangeCode, fetchIdentity } from './client';
import { OAuthStore } from './store';
import { HttpFetch, OAuthClientConfig } from './types';

export function newState(): string {
  return randomBytes(32).toString('hex');
}

export async function startAuthorization(
  store: OAuthStore,
  config: OAuthClientConfig,
  userId: string,
  now: number,
  state: string = newState()
): Promise<{ authorizeUrl: string }> {
  await store.createState(state, userId, now);
  return { authorizeUrl: buildAuthorizeUrl(config, state) };
}

export interface CallbackRequest {
  queryParameters?: Record<string, string[] | undefined>;
}

export interface CallbackResult {
  ok: boolean;
  title: string;
  message: string;
}

const first = (q: CallbackRequest['queryParameters'], name: string) => q?.[name]?.[0];

/**
 * Handles the OAuth redirect. The web trigger URL is public, so nothing is
 * trusted until the single-use `state` resolves to a pending authorization.
 */
export async function completeAuthorization(
  store: OAuthStore,
  http: HttpFetch,
  config: OAuthClientConfig,
  request: CallbackRequest,
  now: number
): Promise<CallbackResult> {
  const q = request.queryParameters;
  const state = first(q, 'state');
  const code = first(q, 'code');
  const error = first(q, 'error');

  if (!state) {
    return { ok: false, title: 'Invalid request', message: 'The sign-in response is missing its state parameter.' };
  }

  const pending = await store.consumeState(state, now);
  if (!pending) {
    return {
      ok: false,
      title: 'Sign-in link expired',
      message: 'This sign-in attempt is unknown, already used or older than 10 minutes. Start again from the gadget.'
    };
  }

  if (error) {
    const description = first(q, 'error_description') || error;
    return { ok: false, title: 'Access not granted', message: description };
  }
  if (!code) {
    return { ok: false, title: 'Invalid request', message: 'The sign-in response is missing its authorization code.' };
  }

  const token = await exchangeCode(http, config, code, now);
  const identity = await fetchIdentity(http, token.accessToken);
  await store.saveAccount(
    pending.userId,
    { id: identity.accountId, email: identity.email, name: identity.name, connectedAt: now },
    token
  );

  return {
    ok: true,
    title: 'Account connected',
    message: `Connected ${identity.email}. You can close this tab and click "Refresh" in the gadget.`
  };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderCallbackPage(result: CallbackResult): string {
  const color = result.ok ? '#216E4E' : '#AE2E24';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(result.title)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:80px auto;padding:0 16px;color:#172B4D">
<h1 style="font-size:20px;color:${color}">${escapeHtml(result.title)}</h1>
<p>${escapeHtml(result.message)}</p>
<p style="color:#626F86;font-size:13px">Cross-Site Work Items</p>
</body></html>`;
}
