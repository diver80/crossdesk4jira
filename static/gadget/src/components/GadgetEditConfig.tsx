import { useEffect, useState, ChangeEvent } from 'react';
import { invoke, view } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Textfield from '@atlaskit/textfield';
import { Checkbox } from '@atlaskit/checkbox';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import Badge from '@atlaskit/badge';
import { AccessibleSite, GadgetConfiguration, SelectedSite } from '../types';

const DEFAULT_JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';

const AVAILABLE_COLUMNS = [
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'site', label: 'Site Origin' },
  { key: 'lastComment', label: 'Last Comment' }
];

export default function GadgetEditConfig() {
  const [loading, setLoading] = useState(true);
  const [connectingAccount, setConnectingAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State
  const [clusterTitle, setClusterTitle] = useState('Cross-Site Work Items');
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    'status',
    'priority',
    'dueDate',
    'site',
    'lastComment'
  ]);
  const [selectedSiteKeys, setSelectedSiteKeys] = useState<Set<string>>(new Set());

  // Discovered Sites
  const [accessibleSites, setAccessibleSites] = useState<AccessibleSite[]>([]);

  const makeSiteKey = (accountId: string, siteId: string) => `${accountId}::${siteId}`;

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      // 1. Load context configuration
      let savedConfig: GadgetConfiguration | undefined;
      try {
        const ctx: any = await view.getContext();
        savedConfig = ctx?.extension?.gadgetConfiguration;
      } catch (e) {
        console.warn('Context retrieval failed (local dev):', e);
      }

      if (savedConfig) {
        if (savedConfig.clusterTitle !== undefined) setClusterTitle(savedConfig.clusterTitle);
        if (savedConfig.jql !== undefined) setJql(savedConfig.jql);
        if (Array.isArray(savedConfig.visibleColumns)) setVisibleColumns(savedConfig.visibleColumns);
        if (Array.isArray(savedConfig.selectedSites)) {
          const keys = new Set(savedConfig.selectedSites.map(s => makeSiteKey(s.accountId, s.siteId)));
          setSelectedSiteKeys(keys);
        }
      }

      // 2. Discover sites
      await fetchSites();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initialize gadget configuration.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSites = async () => {
    try {
      const sites = (await invoke('getAllAccessibleSites')) as AccessibleSite[];
      setAccessibleSites(sites || []);
    } catch (err: any) {
      console.error('Failed to discover sites:', err);
      setAccessibleSites([]);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleConnectAccount = async () => {
    try {
      setConnectingAccount(true);
      setErrorMessage(null);
      await invoke('connectAccount');
      // After OAuth flow completes, refresh sites
      await fetchSites();
    } catch (err: any) {
      console.error('Failed to link Atlassian account:', err);
      setErrorMessage('Failed to connect Atlassian account. Please try again.');
    } finally {
      setConnectingAccount(false);
    }
  };

  const toggleSite = (site: AccessibleSite) => {
    const key = makeSiteKey(site.accountId, site.siteId);
    setSelectedSiteKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleColumn = (colKey: string) => {
    setVisibleColumns(prev => {
      if (prev.includes(colKey)) {
        return prev.filter(c => c !== colKey);
      } else {
        return [...prev, colKey];
      }
    });
  };

  const handleSave = async () => {
    if (selectedSiteKeys.size === 0) {
      setErrorMessage('Please select at least one site to monitor.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const selectedSites: SelectedSite[] = [];
      for (const site of accessibleSites) {
        const key = makeSiteKey(site.accountId, site.siteId);
        if (selectedSiteKeys.has(key)) {
          selectedSites.push({
            accountId: site.accountId,
            accountEmail: site.accountEmail,
            siteId: site.siteId,
            siteName: site.siteName,
            siteUrl: site.siteUrl
          });
        }
      }

      const config: GadgetConfiguration = {
        clusterTitle: clusterTitle.trim() || 'Cross-Site Work Items',
        jql: jql.trim() || DEFAULT_JQL,
        selectedSites,
        visibleColumns,
        refreshIntervalMinutes: 15
      };

      await view.submit(config);
    } catch (err: any) {
      console.error('Failed to save configuration:', err);
      setErrorMessage(err.message || 'Failed to save gadget configuration.');
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    try {
      await view.close();
    } catch (err) {
      console.warn('Failed to close view:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <Spinner size="large" />
        <p style={{ marginTop: '16px', color: '#6B778C' }}>Loading available accounts and sites...</p>
      </div>
    );
  }

  // Group sites by account
  const accountsMap = new Map<string, { email: string; sites: AccessibleSite[] }>();
  for (const site of accessibleSites) {
    if (!accountsMap.has(site.accountId)) {
      accountsMap.set(site.accountId, { email: site.accountEmail, sites: [] });
    }
    accountsMap.get(site.accountId)!.sites.push(site);
  }
  const accounts = Array.from(accountsMap.entries());

  return (
    <div style={{ padding: '16px', maxWidth: '720px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: '#172B4D' }}>
        Configure Cross-Site Work Items Gadget
      </h2>

      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <SectionMessage appearance="error" title="Error">
            <p>{errorMessage}</p>
          </SectionMessage>
        </div>
      )}

      {/* Cluster Title */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '12px', marginBottom: '6px', color: '#6B778C' }}>
          Cluster Title
        </label>
        <Textfield
          name="clusterTitle"
          value={clusterTitle}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setClusterTitle(e.target.value)}
          placeholder="e.g. EMEA Staging & Production"
        />
        <p style={{ fontSize: '11px', color: '#6B778C', marginTop: '4px' }}>
          Heading displayed at the top of this dashboard gadget instance.
        </p>
      </div>

      {/* JQL Query */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '12px', marginBottom: '6px', color: '#6B778C' }}>
          JQL Filter Query
        </label>
        <Textfield
          name="jql"
          value={jql}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setJql(e.target.value)}
          placeholder={DEFAULT_JQL}
        />
        <p style={{ fontSize: '11px', color: '#6B778C', marginTop: '4px' }}>
          Filter executed across all selected sites. Ensure field names exist across target instances.
        </p>
      </div>

      {/* Column Toggles */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '12px', marginBottom: '6px', color: '#6B778C' }}>
          Visible Columns (Key & Summary are fixed)
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '6px' }}>
          {AVAILABLE_COLUMNS.map(col => (
            <Checkbox
              key={col.key}
              isChecked={visibleColumns.includes(col.key)}
              onChange={() => toggleColumn(col.key)}
              label={col.label}
              value={col.key}
            />
          ))}
        </div>
      </div>

      {/* Connected Accounts & Site Selection */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <label style={{ fontWeight: 600, fontSize: '12px', color: '#6B778C' }}>
            Connected Atlassian Accounts & Target Sites
          </label>
          <Button
            appearance="subtle"
            onClick={handleConnectAccount}
            isDisabled={connectingAccount}
          >
            {connectingAccount ? 'Connecting...' : '+ Connect Another Account'}
          </Button>
        </div>

        {accounts.length === 0 ? (
          <SectionMessage appearance="warning" title="No Atlassian Accounts Connected">
            <p style={{ marginBottom: '12px' }}>
              Connect your Atlassian account via OAuth 2.0 to discover and monitor Jira sites.
            </p>
            <Button
              appearance="primary"
              onClick={handleConnectAccount}
              isDisabled={connectingAccount}
            >
              {connectingAccount ? 'Connecting...' : 'Connect Atlassian Account'}
            </Button>
          </SectionMessage>
        ) : (
          <div style={{ border: '1px solid #DFE1E6', borderRadius: '4px', padding: '12px', background: '#FAFBFC' }}>
            {accounts.map(([accId, acc]) => (
              <div key={accId} style={{ marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#091E42', marginBottom: '8px' }}>
                  👤 {acc.email}
                </div>
                <div style={{ paddingLeft: '16px' }}>
                  {acc.sites.length === 0 ? (
                    <p style={{ fontSize: '12px', color: '#6B778C', fontStyle: 'italic' }}>
                      No accessible Jira Cloud sites found for this identity.
                    </p>
                  ) : (
                    acc.sites.map(site => {
                      const key = makeSiteKey(site.accountId, site.siteId);
                      const isSelected = selectedSiteKeys.has(key);
                      return (
                        <div
                          key={key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '6px'
                          }}
                        >
                          <Checkbox
                            isChecked={isSelected}
                            isDisabled={!site.hasJiraAccess}
                            onChange={() => toggleSite(site)}
                            label={
                              <span>
                                <strong>{site.siteName}</strong>{' '}
                                <span style={{ color: '#6B778C', fontSize: '12px' }}>({site.siteUrl})</span>
                              </span>
                            }
                            value={key}
                          />
                          {!site.hasJiraAccess && (
                            <Badge appearance="removed">No Jira Access</Badge>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '16px', borderTop: '1px solid #EBECF0' }}>
        <Button appearance="subtle" onClick={handleCancel} isDisabled={saving}>
          Cancel
        </Button>
        <Button
          appearance="primary"
          onClick={handleSave}
          isDisabled={saving || selectedSiteKeys.size === 0}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}
