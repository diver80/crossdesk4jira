import { fetch, storage, webTrigger } from '@forge/api';
import { OAuthStore } from './store';
import { HttpFetch, KeyValueStore, OAuthClientConfig } from './types';

export const CALLBACK_WEBTRIGGER_KEY = 'oauth-callback';

export const OAUTH_SCOPES = ['read:jira-work', 'read:jira-user', 'read:me', 'offline_access'];

export class OAuthNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`OAuth is not configured: set ${missing} with "forge variables set" and redeploy.`);
    this.name = 'OAuthNotConfiguredError';
  }
}

export const forgeHttp: HttpFetch = (url, init) => fetch(url, init as any) as unknown as ReturnType<HttpFetch>;

export const forgeStore = () => new OAuthStore(storage as unknown as KeyValueStore);

export function clientCredentials(): Pick<OAuthClientConfig, 'clientId' | 'clientSecret'> {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!clientId) throw new OAuthNotConfiguredError('ATLASSIAN_CLIENT_ID');
  if (!clientSecret) throw new OAuthNotConfiguredError('ATLASSIAN_CLIENT_SECRET');
  return { clientId, clientSecret };
}

/** The callback URL is the web trigger URL of this installation/environment. */
export function callbackUrl(): Promise<string> {
  return webTrigger.getUrl(CALLBACK_WEBTRIGGER_KEY);
}

/**
 * The redirect URI registered in the Atlassian OAuth Console.
 * Defaults to the environment's web trigger URL, or uses the public
 * GitHub Pages relay if ATLASSIAN_OAUTH_REDIRECT_URI is set.
 */
export async function redirectUri(): Promise<string> {
  const publicRelay = process.env.ATLASSIAN_OAUTH_REDIRECT_URI;
  if (publicRelay) return publicRelay;
  return callbackUrl();
}

export async function oauthConfig(): Promise<OAuthClientConfig> {
  return { ...clientCredentials(), redirectUri: await redirectUri(), scopes: OAUTH_SCOPES };
}
