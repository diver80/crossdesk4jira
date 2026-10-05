import {
  GadgetConfiguration,
  GadgetIssuesResponse,
  NormalizedIssue,
  SelectedSite,
  SiteFetchStatus,
  SiteResult
} from '../types';
import { extractAdfText } from '../utils/adf';
import { TimeoutError, withTimeout } from '../utils/async';
import { withUpdatedOrder } from '../utils/jql';
import { httpsOrigin, isSafeAccountId, isSafeSiteId } from '../utils/validation';
import { HttpResponse } from '../oauth/types';
import { NOT_CONNECTED } from '../oauth/provider';
import { ForgeAuthProvider } from './sites';

interface RawIssueResponse {
  isLast?: boolean;
  nextPageToken?: string;
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

export const DEFAULT_JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
export const DEFAULT_MAX_ITEMS = 25;
/** Jira's search/jql returns at most 100 issues with fields per page. */
export const MAX_ITEMS_LIMIT = 100;
/** Per-site budget; keeps the whole invocation well under Forge's 25 s limit. */
export const SITE_TIMEOUT_MS = 10_000;

export function normalizeMaxItems(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_MAX_ITEMS;
  return Math.min(MAX_ITEMS_LIMIT, Math.max(1, Math.floor(n)));
}

/**
 * Configs saved before the setting existed fetched 25 items per site; keep
 * roughly that behaviour instead of silently cutting to 25 in total.
 */
export function effectiveMaxItems(config: GadgetConfiguration, siteCount: number): number {
  if (config.maxItems === undefined || config.maxItems === null) {
    return Math.min(MAX_ITEMS_LIMIT, DEFAULT_MAX_ITEMS * Math.max(1, siteCount));
  }
  return normalizeMaxItems(config.maxItems);
}

function mapStatusCategory(catKey?: string): 'new' | 'indeterminate' | 'done' | 'undefined' {
  if (catKey === 'new') return 'new';
  if (catKey === 'indeterminate') return 'indeterminate';
  if (catKey === 'done') return 'done';
  return 'undefined';
}

async function readJson(res: HttpResponse): Promise<any> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function jiraErrorMessage(res: HttpResponse): Promise<string | undefined> {
  const body = await readJson(res);
  const messages: unknown[] = [
    ...(Array.isArray(body?.errorMessages) ? body.errorMessages : []),
    ...(body?.errors && typeof body.errors === 'object' ? Object.values(body.errors) : [])
  ];
  const first = messages.find((m): m is string => typeof m === 'string' && m.length > 0);
  return first ? first.slice(0, 300) : undefined;
}

function normalizeIssue(raw: NonNullable<RawIssueResponse['issues']>[number], origin: string | undefined): NormalizedIssue {
  const fields = raw.fields || {};
  const comments = fields.comment?.comments || [];
  const lastCommentRaw = comments.length > 0 ? comments[comments.length - 1] : undefined;
  return {
    id: String(raw.id),
    key: raw.key,
    summary: fields.summary || '(No summary)',
    browseUrl: origin && raw.key ? `${origin}/browse/${encodeURIComponent(raw.key)}` : '',
    status: {
      name: fields.status?.name || 'Unknown',
      category: mapStatusCategory(fields.status?.statusCategory?.key)
    },
    priority: fields.priority
      ? {
          name: fields.priority.name || 'None',
          iconUrl: httpsOrigin(fields.priority.iconUrl) ? fields.priority.iconUrl : undefined
        }
      : undefined,
    issueType: {
      name: fields.issuetype?.name || 'Task',
      iconUrl: httpsOrigin(fields.issuetype?.iconUrl) ? fields.issuetype?.iconUrl : undefined
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
}

async function fetchIssuesForSite(
  site: SelectedSite,
  jql: string,
  provider: ForgeAuthProvider,
  limit: number
): Promise<SiteResult> {
  const origin = httpsOrigin(site.siteUrl);
  const base = { siteId: String(site.siteId), siteName: site.siteName || 'Unknown site', siteUrl: origin || '' };
  const fail = (status: SiteFetchStatus, errorMessage: string): SiteResult => ({ ...base, status, errorMessage, issues: [] });

  if (!isSafeSiteId(site.siteId) || !isSafeAccountId(site.accountId)) {
    return fail('INVALID_CONFIG', 'This site entry is invalid. Open the gadget settings and select the site again.');
  }

  const path =
    `/ex/jira/${site.siteId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}` +
    `&maxResults=${limit}&fields=summary,status,priority,updated,duedate,issuetype,project,comment`;

  try {
    const res = await withTimeout(provider.asAccount(site.accountId).fetch(path), SITE_TIMEOUT_MS);

    if (res.status === 401) {
      const body = await readJson(res);
      if (body?.error === NOT_CONNECTED) {
        return fail('NOT_CONNECTED', 'This gadget uses an Atlassian account that is not connected for you.');
      }
      return fail('AUTH_ERROR', 'Authentication expired or revoked for this account.');
    }
    if (res.status === 403) {
      return fail('FORBIDDEN', 'Access forbidden. Verify Jira license and permissions.');
    }
    if (res.status === 400) {
      const detail = await jiraErrorMessage(res);
      return fail('JQL_ERROR', detail ? `JQL error: ${detail}` : 'Invalid JQL syntax or field for this site.');
    }
    if (res.status === 429) {
      return fail('RATE_LIMITED', 'Jira rate limit reached for this site. Try again in a minute.');
    }
    if (!res.ok) {
      return fail('NETWORK_ERROR', `Jira API returned HTTP ${res.status}.`);
    }

    const data = ((await readJson(res)) || {}) as RawIssueResponse;
    const rawIssues = Array.isArray(data.issues) ? data.issues : [];
    const hasMore =
      data.isLast === false || (data.isLast === undefined && (Boolean(data.nextPageToken) || rawIssues.length >= limit));

    return {
      ...base,
      status: 'OK',
      issues: rawIssues.map(raw => normalizeIssue(raw, origin)),
      hasMore
    };
  } catch (err: unknown) {
    if (err instanceof TimeoutError) {
      return fail('NETWORK_ERROR', `${base.siteName} did not respond in time.`);
    }
    console.error(`Fetching issues for site ${base.siteId} failed:`, err);
    return fail('NETWORK_ERROR', 'Could not reach this site.');
  }
}

const updatedTime = (issue: NormalizedIssue) => new Date(issue.updated).getTime() || 0;

/**
 * Keeps the `maxItems` most recently updated issues across all sites while
 * preserving per-site grouping and order.
 */
function keepMostRecent(results: SiteResult[], maxItems: number): { trimmed: SiteResult[]; truncated: boolean } {
  const all = results.flatMap(r => r.issues);
  const siteHasMore = results.some(r => r.hasMore);
  if (all.length <= maxItems) {
    return { trimmed: results, truncated: siteHasMore };
  }
  const keep = new Set([...all].sort((a, b) => updatedTime(b) - updatedTime(a)).slice(0, maxItems));
  return {
    trimmed: results.map(r => ({ ...r, issues: r.issues.filter(i => keep.has(i)) })),
    truncated: true
  };
}

/** The same site selected via two accounts would show every issue twice. */
function uniqueBySite(sites: SelectedSite[]): SelectedSite[] {
  const seen = new Set<string>();
  return sites.filter(site => {
    const id = String(site?.siteId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function aggregateIssuesFromSites(
  config: GadgetConfiguration | undefined,
  provider: ForgeAuthProvider
): Promise<GadgetIssuesResponse> {
  const sites = Array.isArray(config?.selectedSites) ? uniqueBySite(config!.selectedSites.filter(Boolean)) : [];
  if (!config || sites.length === 0) {
    return { status: 'NEEDS_CONFIG', results: [] };
  }

  const jql = withUpdatedOrder(typeof config.jql === 'string' && config.jql.trim() ? config.jql : DEFAULT_JQL);
  const maxItems = effectiveMaxItems(config, sites.length);

  // Each site may hold all of the most recent items, so fetch up to the total
  // limit per site and trim after merging.
  const settled = await Promise.allSettled(sites.map(site => fetchIssuesForSite(site, jql, provider, maxItems)));
  const results: SiteResult[] = settled.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    const site = sites[idx];
    return {
      siteId: String(site.siteId),
      siteName: site.siteName,
      siteUrl: httpsOrigin(site.siteUrl) || '',
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
