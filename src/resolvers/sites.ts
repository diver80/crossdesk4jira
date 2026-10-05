import { AccessibleSite, AccountDiscoveryError, SiteDiscoveryResult } from '../types';
import { HttpResponse } from '../oauth/types';
import { mapWithConcurrency, withTimeout } from '../utils/async';
import { httpsOrigin, isSafeSiteId } from '../utils/validation';

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

/** Requests in flight at once across all accounts and probes. */
export const DISCOVERY_CONCURRENCY = 6;
export const DISCOVERY_TIMEOUT_MS = 8_000;

/**
 * Lists every Jira site reachable through the user's connected accounts and
 * probes /myself on each to see whether the account has Jira access there.
 * Runs in parallel with a concurrency cap so many sites stay within Forge's
 * 25 s invocation limit; failures are reported per account.
 */
export async function fetchSitesForAccounts(provider: ForgeAuthProvider): Promise<SiteDiscoveryResult> {
  const accounts = await provider.listAccounts();
  if (!accounts || accounts.length === 0) {
    return { sites: [], accountErrors: [] };
  }

  // Phase 1: accessible-resources per account.
  const listed = await mapWithConcurrency(accounts, DISCOVERY_CONCURRENCY, async account => {
    try {
      const res = await withTimeout(
        provider.asAccount(account.id).fetch('/oauth/token/accessible-resources'),
        DISCOVERY_TIMEOUT_MS
      );
      if (!res.ok) {
        const status = res.status === 401 || res.status === 403 ? 'AUTH_ERROR' : 'NETWORK_ERROR';
        return {
          account,
          resources: [] as RawAccessibleResource[],
          error: {
            accountId: account.id,
            status,
            message:
              status === 'AUTH_ERROR'
                ? 'Access expired or was revoked. Disconnect this account and connect it again.'
                : `Atlassian returned HTTP ${res.status} while listing sites.`
          } as AccountDiscoveryError
        };
      }
      const body = await res.json();
      return { account, resources: Array.isArray(body) ? (body as RawAccessibleResource[]) : [] };
    } catch (err) {
      console.error(`Listing sites for account ${account.id} failed:`, err);
      return {
        account,
        resources: [] as RawAccessibleResource[],
        error: { accountId: account.id, status: 'NETWORK_ERROR', message: 'Could not list sites for this account.' } as AccountDiscoveryError
      };
    }
  });

  // Phase 2: one /myself probe per (account, site), all sharing the concurrency cap.
  const probes = listed.flatMap(({ account, resources }) =>
    resources.filter(r => isSafeSiteId(r?.id)).map(resource => ({ account, resource }))
  );
  const probed = await mapWithConcurrency(probes, DISCOVERY_CONCURRENCY, async ({ account, resource }) => {
    let hasJiraAccess = false;
    try {
      const probe = await withTimeout(
        provider.asAccount(account.id).fetch(`/ex/jira/${resource.id}/rest/api/3/myself`),
        DISCOVERY_TIMEOUT_MS
      );
      hasJiraAccess = probe.ok;
    } catch {
      hasJiraAccess = false;
    }
    const site: AccessibleSite = {
      accountId: account.id,
      accountEmail: account.displayName || account.id,
      siteId: resource.id,
      siteName: resource.name,
      siteUrl: httpsOrigin(resource.url) || '',
      avatarUrl: resource.avatarUrl,
      hasJiraAccess
    };
    return site;
  });

  return {
    sites: probed,
    accountErrors: listed.flatMap(l => (l.error ? [l.error] : []))
  };
}
