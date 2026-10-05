import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@forge/bridge';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import DynamicTable from '@atlaskit/dynamic-table';
import Tooltip from '@atlaskit/tooltip';
import Badge from '@atlaskit/badge';
import { GadgetIssuesResponse, NormalizedIssue, SiteResult } from '../types';
import { openAtlassianSignIn } from '../oauth';

export default function GadgetView() {
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [data, setData] = useState<GadgetIssuesResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reauthorizing, setReauthorizing] = useState(false);
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);

  const fetchIssues = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setReloading(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const response = (await invoke('getGadgetIssues')) as GadgetIssuesResponse;
      setData(response);
    } catch (err: any) {
      console.error('Failed to load issues:', err);
      setErrorMessage(err.message || 'An error occurred while fetching cross-site issues.');
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const handleReauth = async () => {
    try {
      setReauthorizing(true);
      await openAtlassianSignIn();
      setAwaitingSignIn(true);
    } catch (err: any) {
      console.error('Re-authentication failed:', err);
      setErrorMessage(`Could not start sign-in: ${err?.message || 'unknown error'}`);
    } finally {
      setReauthorizing(false);
    }
  };

  // Status Lozenge appearance mapping
  const getLozengeAppearance = (category?: string) => {
    switch (category) {
      case 'new':
        return 'new'; // blue
      case 'indeterminate':
        return 'inprogress'; // yellow
      case 'done':
        return 'success'; // green
      default:
        return 'default';
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '180px', padding: '24px' }}>
        <Spinner size="large" />
        <p style={{ marginTop: '12px', color: '#6B778C', fontSize: '13px' }}>Loading cross-site issues...</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div style={{ padding: '16px' }}>
        <SectionMessage appearance="error" title="Failed to Load Gadget">
          <p>{errorMessage}</p>
          <div style={{ marginTop: '12px' }}>
            <Button appearance="default" onClick={() => fetchIssues(true)}>
              Retry
            </Button>
          </div>
        </SectionMessage>
      </div>
    );
  }

  // State: Needs Configuration
  if (!data || data.status === 'NEEDS_CONFIG') {
    return (
      <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#FAFBFC', border: '1px dashed #DFE1E6', borderRadius: '4px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#172B4D', marginBottom: '8px' }}>
          Gadget Not Configured
        </h3>
        <p style={{ fontSize: '13px', color: '#6B778C', marginBottom: '16px' }}>
          Please configure target Atlassian Cloud sites and an optional JQL filter to start aggregating work items.
        </p>
        <p style={{ fontSize: '12px', color: '#8993A4', fontStyle: 'italic' }}>
          Click the gadget menu (•••) at the top right of this gadget and select <strong>Configure</strong>.
        </p>
      </div>
    );
  }

  const results: SiteResult[] = data.results || [];
  const clusterTitle = data.clusterTitle || 'Cross-Site Work Items';
  const visibleColumns = new Set(data.visibleColumns || ['status', 'priority', 'dueDate', 'site', 'lastComment']);

  // Collect all issues across all sites and any site-level errors
  const allIssues: Array<{ issue: NormalizedIssue; siteName: string; siteUrl: string }> = [];
  const siteErrors: SiteResult[] = [];

  for (const site of results) {
    if (site.status !== 'OK') {
      siteErrors.push(site);
    }
    if (Array.isArray(site.issues)) {
      for (const issue of site.issues) {
        allIssues.push({ issue, siteName: site.siteName, siteUrl: site.siteUrl });
      }
    }
  }

  // Sort issues by updated date descending
  allIssues.sort((a, b) => {
    const timeA = new Date(a.issue.updated).getTime() || 0;
    const timeB = new Date(b.issue.updated).getTime() || 0;
    return timeB - timeA;
  });

  // Build Dynamic Table Headings
  const headCells: any[] = [
    { key: 'key', content: 'Key', width: 12 },
    { key: 'summary', content: 'Summary', isSortable: true }
  ];

  if (visibleColumns.has('status')) {
    headCells.push({ key: 'status', content: 'Status', width: 12 });
  }
  if (visibleColumns.has('priority')) {
    headCells.push({ key: 'priority', content: 'Priority', width: 10 });
  }
  if (visibleColumns.has('dueDate')) {
    headCells.push({ key: 'dueDate', content: 'Due Date', width: 12 });
  }
  if (visibleColumns.has('site')) {
    headCells.push({ key: 'site', content: 'Site', width: 14 });
  }
  if (visibleColumns.has('lastComment')) {
    headCells.push({ key: 'lastComment', content: 'Last Comment', width: 12 });
  }

  // Build Dynamic Table Rows
  const rows = allIssues.map(({ issue, siteName }) => {
    const cells: any[] = [
      {
        key: 'key',
        content: (
          <a
            href={issue.browseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontWeight: 600, color: '#0052CC', textDecoration: 'none' }}
          >
            {issue.key}
          </a>
        )
      },
      {
        key: 'summary',
        content: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {issue.issueType?.iconUrl && (
              <img
                src={issue.issueType.iconUrl}
                alt={issue.issueType.name}
                style={{ width: '16px', height: '16px', flexShrink: 0 }}
              />
            )}
            <span style={{ color: '#172B4D' }}>{issue.summary}</span>
          </div>
        )
      }
    ];

    if (visibleColumns.has('status')) {
      cells.push({
        key: 'status',
        content: (
          <Lozenge appearance={getLozengeAppearance(issue.status?.category)}>
            {issue.status?.name || 'Unknown'}
          </Lozenge>
        )
      });
    }

    if (visibleColumns.has('priority')) {
      cells.push({
        key: 'priority',
        content: issue.priority ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {issue.priority.iconUrl && (
              <img
                src={issue.priority.iconUrl}
                alt={issue.priority.name}
                style={{ width: '14px', height: '14px' }}
              />
            )}
            <span style={{ fontSize: '12px', color: '#42526E' }}>{issue.priority.name}</span>
          </div>
        ) : (
          <span style={{ color: '#8993A4', fontSize: '12px' }}>—</span>
        )
      });
    }

    if (visibleColumns.has('dueDate')) {
      cells.push({
        key: 'dueDate',
        content: issue.dueDate ? (
          <span style={{ fontSize: '12px', color: '#42526E' }}>{issue.dueDate}</span>
        ) : (
          <span style={{ color: '#8993A4', fontSize: '12px' }}>—</span>
        )
      });
    }

    if (visibleColumns.has('site')) {
      cells.push({
        key: 'site',
        content: (
          <Badge appearance="primary">{siteName}</Badge>
        )
      });
    }

    if (visibleColumns.has('lastComment')) {
      cells.push({
        key: 'lastComment',
        content: issue.lastComment?.plainText ? (
          <Tooltip
            content={
              <div style={{ maxWidth: '280px', padding: '4px' }}>
                <div style={{ fontWeight: 600, fontSize: '11px', marginBottom: '2px' }}>
                  {issue.lastComment.author}
                </div>
                <div style={{ fontSize: '11px' }}>{issue.lastComment.plainText}</div>
              </div>
            }
          >
            {(tooltipProps) => (
              <span
                {...tooltipProps}
                style={{
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: '#EBECF0',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '11px',
                  color: '#42526E'
                }}
              >
                💬 {issue.lastComment!.author.split(' ')[0]}
              </span>
            )}
          </Tooltip>
        ) : (
          <span style={{ color: '#8993A4', fontSize: '12px' }}>—</span>
        )
      });
    }

    return {
      key: `${issue.id || issue.key}`,
      cells
    };
  });

  return (
    <div style={{ padding: '12px', fontFamily: 'sans-serif' }}>
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          paddingBottom: '8px',
          borderBottom: '1px solid #EBECF0'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#172B4D' }}>
            {clusterTitle}
          </h3>
          <Badge appearance="added">{allIssues.length} issues</Badge>
          {reloading && <Spinner size="small" />}
        </div>
        <div>
          <Button
            appearance="subtle"
            spacing="compact"
            onClick={() => fetchIssues(true)}
            isDisabled={reloading}
          >
            ↻ Refresh
          </Button>
        </div>
      </div>

      {/* Partial Site Error Banners */}
      {awaitingSignIn && (
        <div style={{ marginBottom: '12px' }}>
          <SectionMessage appearance="information" title="Finish signing in in the new tab">
            <p style={{ margin: '0 0 8px', fontSize: '12px' }}>
              Approve access on the Atlassian consent screen, then refresh this gadget.
            </p>
            <Button
              appearance="primary"
              spacing="compact"
              onClick={() => {
                setAwaitingSignIn(false);
                fetchIssues(true);
              }}
            >
              I've signed in, refresh
            </Button>
          </SectionMessage>
        </div>
      )}

      {siteErrors.length > 0 && (
        <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {siteErrors.map(errSite => (
            <SectionMessage
              key={errSite.siteId}
              appearance="warning"
              title={`Warning: Unable to query ${errSite.siteName}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: '12px' }}>
                  {errSite.errorMessage || 'Failed to fetch issues from this instance.'}
                </p>
                {errSite.status === 'AUTH_ERROR' && (
                  <Button
                    appearance="primary"
                    spacing="compact"
                    onClick={handleReauth}
                    isDisabled={reauthorizing}
                  >
                    {reauthorizing ? 'Re-authorizing...' : 'Re-authenticate'}
                  </Button>
                )}
              </div>
            </SectionMessage>
          ))}
        </div>
      )}

      {/* Issues Table */}
      <DynamicTable
        head={{ cells: headCells }}
        rows={rows}
        emptyView={
          <div style={{ textAlign: 'center', padding: '24px', color: '#6B778C' }}>
            No issues found matching query across selected sites.
          </div>
        }
      />
    </div>
  );
}
