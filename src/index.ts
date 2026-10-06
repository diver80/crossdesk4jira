import Resolver from '@forge/resolver';
import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';
import { fetchSitesForAccounts } from './resolvers/sites';
import { aggregateIssuesFromSites } from './resolvers/issues';
import { GadgetConfiguration, GadgetIssuesResponse } from './types';
import { TokenAuthProvider } from './oauth/provider';
import { buildCallbackResponse, completeAuthorization, startAuthorization } from './oauth/flow';
import { callbackUrl, clientCredentials, forgeHttp, forgeStore, oauthConfig } from './oauth/runtime';
import { isSafeAccountId } from './utils/validation';

/** The parts of the Forge resolver context this app reads. */
interface GadgetContext {
  accountId?: string;
  extension?: { gadgetConfiguration?: GadgetConfiguration };
}

const resolver = new Resolver();

const contextOf = (req: { context: unknown }) => (req.context || {}) as GadgetContext;

/** Connected accounts are stored per Jira user, so every call needs one. */
function requireUser(req: { context: unknown }): string {
  const userId = contextOf(req).accountId;
  if (!userId) {
    throw new Error('Please log in to Jira to use this gadget.');
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

resolver.define('getGadgetIssues', async (req): Promise<GadgetIssuesResponse> => {
  const ctx = contextOf(req);
  if (!ctx.accountId) {
    // Anonymous viewer, e.g. on a public dashboard.
    return { status: 'NO_USER', results: [] };
  }
  return aggregateIssuesFromSites(ctx.extension?.gadgetConfiguration, providerFor(ctx.accountId));
});

resolver.define('startOAuth', async req => {
  const [cfg, webtrigger] = await Promise.all([oauthConfig(), callbackUrl()]);
  return startAuthorization(forgeStore(), cfg, requireUser(req), Date.now(), undefined, webtrigger);
});

resolver.define('disconnectAccount', async req => {
  const accountId = (req.payload as { accountId?: unknown })?.accountId;
  if (!isSafeAccountId(accountId)) throw new Error('A valid accountId is required');
  await forgeStore().removeAccount(requireUser(req), accountId);
  return { ok: true };
});

export const handler = resolver.getDefinitions();

/** Web trigger: OAuth redirect target. */
export const oauthCallback = async (request: WebTriggerRequest): Promise<WebTriggerResponse> =>
  buildCallbackResponse(async () =>
    completeAuthorization(forgeStore(), forgeHttp, await oauthConfig(), request, Date.now())
  );
