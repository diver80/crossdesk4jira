// Shared between backend (src/types.ts) and frontend (static/gadget/src/types.ts).
// Keep both files identical; tests/types.test.ts enforces this.

export interface SelectedSite {
  accountId: string;
  /** Legacy: no longer saved (gadget configs are visible to every viewer). */
  accountEmail?: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
}

export interface GadgetConfiguration {
  clusterTitle: string;
  jql: string;
  selectedSites: SelectedSite[];
  visibleColumns: string[];
  /** Maximum work items shown in total across all sites (1-100, default 25). */
  maxItems?: number;
}

export interface AccessibleSite {
  accountId: string;
  accountEmail: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
  avatarUrl?: string;
  hasJiraAccess: boolean;
}

export interface AccountDiscoveryError {
  accountId: string;
  status: 'AUTH_ERROR' | 'NETWORK_ERROR';
  message: string;
}

export interface SiteDiscoveryResult {
  sites: AccessibleSite[];
  accountErrors: AccountDiscoveryError[];
}

export type SiteFetchStatus =
  | 'OK'
  /** The viewer has no connection for the configured Atlassian account. */
  | 'NOT_CONNECTED'
  /** The viewer's connection exists but was revoked or expired. */
  | 'AUTH_ERROR'
  | 'FORBIDDEN'
  | 'JQL_ERROR'
  | 'RATE_LIMITED'
  | 'INVALID_CONFIG'
  | 'NETWORK_ERROR';

export interface CommentPreview {
  author: string;
  created: string;
  plainText: string;
}

export interface NormalizedIssue {
  id: string;
  key: string;
  summary: string;
  /** Empty when the configured site URL is not a valid https URL. */
  browseUrl: string;
  status: {
    name: string;
    category: 'new' | 'indeterminate' | 'done' | 'undefined';
  };
  priority?: {
    name: string;
    iconUrl?: string;
  };
  issueType: {
    name: string;
    iconUrl?: string;
  };
  project: {
    key: string;
    name: string;
  };
  updated: string;
  dueDate?: string;
  lastComment?: CommentPreview;
}

export interface SiteResult {
  siteId: string;
  siteName: string;
  siteUrl: string;
  status: SiteFetchStatus;
  errorMessage?: string;
  issues: NormalizedIssue[];
  /** True if Jira reported more matches than were fetched for this site. */
  hasMore?: boolean;
}

export interface GadgetIssuesResponse {
  /** NO_USER: anonymous viewer (e.g. public dashboard); nothing can be shown. */
  status: 'OK' | 'NEEDS_CONFIG' | 'NO_USER';
  message?: string;
  clusterTitle?: string;
  visibleColumns?: string[];
  /** Effective limit after defaulting/clamping. */
  maxItems?: number;
  /** True if more matching work items exist than are shown. */
  truncated?: boolean;
  results: SiteResult[];
}
