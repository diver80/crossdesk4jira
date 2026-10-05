import {
  GadgetConfiguration,
  GadgetIssuesResponse,
  NormalizedIssue,
  SelectedSite,
  SiteResult
} from '../types';
import { extractAdfText } from '../utils/adf';
import { ForgeAuthProvider } from './sites';

interface RawIssueResponse {
  issues?: Array<{
    id: string;
    key: string;
    fields: {
      summary?: string;
      status?: {
        name?: string;
        statusCategory?: {
          key?: string;
        };
      };
      priority?: {
        name?: string;
        iconUrl?: string;
      };
      issuetype?: {
        name?: string;
        iconUrl?: string;
      };
      project?: {
        key?: string;
        name?: string;
      };
      updated?: string;
      duedate?: string;
      comment?: {
        comments?: Array<{
          author?: { displayName?: string };
          created?: string;
          body?: unknown;
        }>;
      };
    };
  }>;
}

export const DEFAULT_MAX_ITEMS = 25;
/** Jira's search/jql returns at most 100 issues with fields per page. */
export const MAX_ITEMS_LIMIT = 100;

export function normalizeMaxItems(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_MAX_ITEMS;
  return Math.min(MAX_ITEMS_LIMIT, Math.max(1, Math.floor(n)));
}

function mapStatusCategory(catKey?: string): 'new' | 'indeterminate' | 'done' | 'undefined' {
  if (catKey === 'new') return 'new';
  if (catKey === 'indeterminate') return 'indeterminate';
  if (catKey === 'done') return 'done';
  return 'undefined';
}

async function fetchIssuesForSite(
  site: SelectedSite,
  jql: string,
  provider: ForgeAuthProvider,
  limit: number = 25
): Promise<SiteResult> {
  const cleanSiteUrl = site.siteUrl.replace(/\/+$/, '');
  const encodedJql = encodeURIComponent(jql);
  const path = `/ex/jira/${site.siteId}/rest/api/3/search/jql?jql=${encodedJql}&maxResults=${limit}&fields=summary,status,priority,updated,duedate,issuetype,project,comment`;

  try {
    const client = provider.asAccount(site.accountId);
    const res = await client.fetch(path);

    if (res.status === 401) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'AUTH_ERROR',
        errorMessage: 'Authentication expired or revoked for this account.',
        issues: []
      };
    }

    if (res.status === 403) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'FORBIDDEN',
        errorMessage: 'Access forbidden. Verify Jira license and permissions.',
        issues: []
      };
    }

    if (res.status === 400) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'JQL_ERROR',
        errorMessage: 'Invalid JQL syntax or field for this site schema.',
        issues: []
      };
    }

    if (!res.ok) {
      return {
        siteId: site.siteId,
        siteName: site.siteName,
        siteUrl: cleanSiteUrl,
        status: 'NETWORK_ERROR',
        errorMessage: `Jira API returned HTTP ${res.status}.`,
        issues: []
      };
    }

    const data = (await res.json()) as RawIssueResponse;
    const rawIssues = data.issues || [];

    const issues: NormalizedIssue[] = rawIssues.map(raw => {
      const fields = raw.fields || {};
      const comments = fields.comment?.comments || [];
      const lastCommentRaw = comments.length > 0 ? comments[comments.length - 1] : undefined;

      return {
        id: raw.id,
        key: raw.key,
        summary: fields.summary || '(No summary)',
        browseUrl: `${cleanSiteUrl}/browse/${raw.key}`,
        status: {
          name: fields.status?.name || 'Unknown',
          category: mapStatusCategory(fields.status?.statusCategory?.key)
        },
        priority: fields.priority
          ? {
              name: fields.priority.name || 'None',
              iconUrl: fields.priority.iconUrl
            }
          : undefined,
        issueType: {
          name: fields.issuetype?.name || 'Task',
          iconUrl: fields.issuetype?.iconUrl
        },
        project: {
          key: fields.project?.key || '',
          name: fields.project?.name || ''
        },
        updated: fields.updated || '',
        dueDate: fields.duedate,
        lastComment: lastCommentRaw
          ? {
              author: lastCommentRaw.author?.displayName || 'Unknown',
              created: lastCommentRaw.created || '',
              plainText: extractAdfText(lastCommentRaw.body)
            }
          : undefined
      };
    });

    return {
      siteId: site.siteId,
      siteName: site.siteName,
      siteUrl: cleanSiteUrl,
      status: 'OK',
      issues
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown network failure';
    return {
      siteId: site.siteId,
      siteName: site.siteName,
      siteUrl: cleanSiteUrl,
      status: 'NETWORK_ERROR',
      errorMessage: message,
      issues: []
    };
  }
}

const updatedTime = (issue: NormalizedIssue) => new Date(issue.updated).getTime() || 0;

/**
 * Keeps the `maxItems` most recently updated issues across all sites while
 * preserving per-site grouping and order. A site that returned exactly
 * `maxItems` may have more matches, so that also counts as truncated.
 */
function keepMostRecent(results: SiteResult[], maxItems: number): { trimmed: SiteResult[]; truncated: boolean } {
  const all = results.flatMap(r => r.issues);
  const siteHitLimit = results.some(r => r.issues.length >= maxItems);
  if (all.length <= maxItems) {
    return { trimmed: results, truncated: siteHitLimit };
  }
  const keep = new Set(
    [...all].sort((a, b) => updatedTime(b) - updatedTime(a)).slice(0, maxItems)
  );
  return {
    trimmed: results.map(r => ({ ...r, issues: r.issues.filter(i => keep.has(i)) })),
    truncated: true
  };
}

export async function aggregateIssuesFromSites(
  config: GadgetConfiguration | undefined,
  provider: ForgeAuthProvider
): Promise<GadgetIssuesResponse> {
  if (!config || !config.selectedSites || config.selectedSites.length === 0) {
    return {
      status: 'NEEDS_CONFIG',
      results: []
    };
  }

  const jql = config.jql || 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';

  const maxItems = normalizeMaxItems(config.maxItems);

  // Each site may hold all of the most recent items, so fetch up to the total
  // limit per site and trim after merging.
  const promises = config.selectedSites.map(site =>
    fetchIssuesForSite(site, jql, provider, maxItems)
  );

  const settled = await Promise.allSettled(promises);
  const results: SiteResult[] = settled.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    const site = config.selectedSites[idx];
    return {
      siteId: site.siteId,
      siteName: site.siteName,
      siteUrl: site.siteUrl,
      status: 'NETWORK_ERROR',
      errorMessage: 'Unexpected internal error during request.',
      issues: []
    };
  });

  const { trimmed, truncated } = keepMostRecent(results, maxItems);

  return {
    status: 'OK',
    clusterTitle: config.clusterTitle,
    visibleColumns: config.visibleColumns,
    maxItems,
    truncated,
    results: trimmed
  };
}
