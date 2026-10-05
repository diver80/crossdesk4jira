import Resolver from '@forge/resolver';
import api from '@forge/api';
import { getAllAccessibleSites } from './resolvers/sites.js';
import { getGadgetIssues } from './resolvers/issues.js';

const resolver = new Resolver();

resolver.define('getAllAccessibleSites', async () => {
  return getAllAccessibleSites();
});

resolver.define('getGadgetIssues', async (req) => {
  return getGadgetIssues(req);
});

resolver.define('connectAccount', async () => {
  const provider = api.asUser().withProvider('atlassian-oauth', 'atlassian-apis');
  if (typeof (provider as any).requestCredentials === 'function') {
    await (provider as any).requestCredentials();
  }
  return { status: 'auth_requested' };
});

export const handler = resolver.getDefinitions();
