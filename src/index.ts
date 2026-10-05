import Resolver from '@forge/resolver';
import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';
import { fetchSitesForAccounts } from './resolvers/sites';
import { aggregateIssuesFromSites } from './resolvers/issues';
import { GadgetConfiguration } from './types';
import { TokenAuthProvider } from './oauth/provider';
import { completeAuthorization, renderCallbackPage, startAuthorization } from './oauth/flow';
import { callbackUrl, clientCredentials, forgeHttp, forgeStore, oauthConfig } from './oauth/runtime';

const resolver = new Resolver();

function requireUser(req: { context: { accountId?: string } }): string {
  const userId = req.context.accountId;
  if (!userId) {
    throw new Error('No Jira user in context; connected accounts are stored per user.');
  }
  return userId;
}

const providerFor = (userId: string) =>
  new TokenAuthProvider(userId, forgeStore(), forgeHttp, clientCredentials());

resolver.define('getConnectedAccounts', async req => {
  const accounts = await forgeStore().listAccounts(requireUser(req));
  return accounts.map(({ id, email, name }) => ({ id, email, name }));
});

resolver.define('getAllAccessibleSites', async req => {
  return fetchSitesForAccounts(providerFor(requireUser(req)));
});

resolver.define('getGadgetIssues', async req => {
  const config = (req.context as any)?.extension?.gadgetConfiguration as GadgetConfiguration | undefined;
  return aggregateIssuesFromSites(config, providerFor(requireUser(req)));
});

resolver.define('startOAuth', async req => {
  return startAuthorization(forgeStore(), await oauthConfig(), requireUser(req), Date.now());
});

resolver.define('disconnectAccount', async req => {
  const accountId = (req.payload as { accountId?: string })?.accountId;
  if (!accountId) throw new Error('accountId is required');
  await forgeStore().removeAccount(requireUser(req), accountId);
  return { ok: true };
});

resolver.define('getOAuthCallbackUrl', async () => ({ callbackUrl: await callbackUrl() }));

export const handler = resolver.getDefinitions();

/** Web trigger: OAuth redirect target. */
export const oauthCallback = async (request: WebTriggerRequest): Promise<WebTriggerResponse> => {
  let result;
  try {
    result = await completeAuthorization(forgeStore(), forgeHttp, await oauthConfig(), request, Date.now());
  } catch (err) {
    console.error('OAuth callback failed:', err);
    result = {
      ok: false,
      title: 'Connection failed',
      message: err instanceof Error ? err.message : 'Unexpected error while completing sign-in.'
    };
  }
  return {
    statusCode: result.ok ? 200 : 400,
    headers: { 'Content-Type': ['text/html; charset=utf-8'] },
    body: renderCallbackPage(result)
  };
};
