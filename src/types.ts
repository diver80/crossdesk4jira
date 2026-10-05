export interface SelectedSite {
  accountId: string;
  accountEmail: string;
  siteId: string;
  siteName: string;
  siteUrl: string;
}

export interface GadgetConfiguration {
  clusterTitle: string;
  jql: string;
  selectedSites: SelectedSite[];
  visibleColumns: string[];
  refreshIntervalMinutes?: number;
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

export type SiteFetchStatus = 'OK' | 'AUTH_ERROR' | 'FORBIDDEN' | 'JQL_ERROR' | 'NETWORK_ERROR';

export interface CommentPreview {
  author: string;
  created: string;
  plainText: string;
}

export interface NormalizedIssue {
  id: string;
  key: string;
  summary: string;
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
}

export interface GadgetIssuesResponse {
  status: 'OK' | 'NEEDS_CONFIG' | 'ERROR';
  message?: string;
  clusterTitle?: string;
  visibleColumns?: string[];
  results: SiteResult[];
}
