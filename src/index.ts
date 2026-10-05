import Resolver from '@forge/resolver';
import { getAllAccessibleSites } from './resolvers/sites.js';
import { getGadgetIssues } from './resolvers/issues.js';

const resolver = new Resolver();

resolver.define('getAllAccessibleSites', async () => {
  return getAllAccessibleSites();
});

resolver.define('getGadgetIssues', async (req) => {
  return getGadgetIssues(req);
});

export const handler = resolver.getDefinitions();
