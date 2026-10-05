import { AccessibleSite } from '../types';
import { HttpResponse } from '../oauth/types';

interface ProviderAccount {
  id: string;
  displayName?: string;
}

interface RawAccessibleResource {
  id: string;
  name: string;
  url: string;
  avatarUrl?: string;
  scopes?: string[];
}

export interface ForgeAuthProvider {
  listAccounts(): Promise<ProviderAccount[]>;
  asAccount(accountId: string): {
    fetch(path: string): Promise<HttpResponse>;
  };
}

export async function fetchSitesForAccounts(provider: ForgeAuthProvider): Promise<AccessibleSite[]> {
  const accounts = await provider.listAccounts();
  if (!accounts || accounts.length === 0) {
    return [];
  }

  const results: AccessibleSite[] = [];

  for (const account of accounts) {
    try {
      const client = provider.asAccount(account.id);
      const res = await client.fetch('/oauth/token/accessible-resources');

      if (!res.ok) {
        continue;
      }

      const sites = (await res.json()) as RawAccessibleResource[];
      for (const site of sites) {
        let hasJiraAccess = false;
        try {
          const probe = await client.fetch(`/ex/jira/${site.id}/rest/api/3/myself`);
          if (probe.ok) {
            hasJiraAccess = true;
          }
        } catch {
          hasJiraAccess = false;
        }

        results.push({
          accountId: account.id,
          accountEmail: account.displayName || account.id,
          siteId: site.id,
          siteName: site.name,
          siteUrl: site.url,
          avatarUrl: site.avatarUrl,
          hasJiraAccess
        });
      }
    } catch {
      // Continue to next account if one fails
    }
  }

  return results;
}
