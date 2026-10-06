import { randomBytes } from 'crypto';
import { buildAuthorizeUrl, exchangeCode, fetchIdentity } from './client';
import { OAuthStore } from './store';
import { HttpFetch, OAuthClientConfig } from './types';
import { isWellFormedState } from '../utils/validation';

export function newState(): string {
  return randomBytes(32).toString('hex');
}

/** Encodes customer webtrigger destination and state secret for the public relay. */
export function encodeRelayState(targetWebtriggerUrl: string, stateSecret: string): string {
  const payload = JSON.stringify({ t: targetWebtriggerUrl, s: stateSecret });
  return Buffer.from(payload, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decodes a relay-encoded state parameter if present. */
export function tryDecodeRelayState(state: string): { target: string; secret: string } | undefined {
  try {
    const raw = state.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (typeof json.t === 'string' && typeof json.s === 'string' && isWellFormedState(json.s)) {
      return { target: json.t, secret: json.s };
    }
  } catch {
    // not a relay state
  }
  return undefined;
}

export async function startAuthorization(
  store: OAuthStore,
  config: OAuthClientConfig,
  userId: string,
  now: number,
  state: string = newState(),
  webtriggerUrl?: string
): Promise<{ authorizeUrl: string }> {
  await store.createState(state, userId, now);
  const outgoingState =
    webtriggerUrl && config.redirectUri !== webtriggerUrl
      ? encodeRelayState(webtriggerUrl, state)
      : state;
  return { authorizeUrl: buildAuthorizeUrl(config, outgoingState) };
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
  let state = first(q, 'state');
  const code = first(q, 'code');
  const error = first(q, 'error');

  if (!state) {
    return { ok: false, title: 'Invalid request', message: 'The sign-in response is missing its state parameter.' };
  }

  // Handle direct relay state fallback if browser landed directly without relay unwrapping
  if (!isWellFormedState(state)) {
    const decoded = tryDecodeRelayState(state);
    if (decoded) state = decoded.secret;
  }

  const pending = isWellFormedState(state) ? await store.consumeState(state, now) : undefined;
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
<p style="color:#626F86;font-size:13px">crossdesk4jira</p>
</body></html>`;
}

export interface CallbackHttpResponse {
  statusCode: number;
  headers: Record<string, string[]>;
  body: string;
}

const CALLBACK_HEADERS: Record<string, string[]> = {
  'Content-Type': ['text/html; charset=utf-8'],
  'Cache-Control': ['no-store'],
  'Referrer-Policy': ['no-referrer'],
  'X-Content-Type-Options': ['nosniff'],
  'X-Frame-Options': ['DENY'],
  'Content-Security-Policy': ["default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"]
};

/**
 * Runs the callback and renders the result. The web trigger is public, so
 * unexpected errors are logged but shown only as a generic message.
 */
export async function buildCallbackResponse(run: () => Promise<CallbackResult>): Promise<CallbackHttpResponse> {
  let result: CallbackResult;
  try {
    result = await run();
  } catch (err) {
    console.error('OAuth callback failed:', err);
    result = {
      ok: false,
      title: 'Connection failed',
      message: 'Something went wrong while completing sign-in. Close this tab and try again from the gadget.'
    };
  }
  return {
    statusCode: result.ok ? 200 : 400,
    headers: CALLBACK_HEADERS,
    body: renderCallbackPage(result)
  };
}
