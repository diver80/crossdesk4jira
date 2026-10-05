import { useEffect, useState, ChangeEvent, FocusEvent } from 'react';
import { invoke, view } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import Textfield from '@atlaskit/textfield';
import { Checkbox } from '@atlaskit/checkbox';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import Badge from '@atlaskit/badge';
import { AccessibleSite, AccountDiscoveryError, GadgetConfiguration, SelectedSite, SiteDiscoveryResult } from '../types';
import { ConnectedAccount, CONNECTED_APPS_URL, openAtlassianSignIn } from '../oauth';

const DEFAULT_JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
const DEFAULT_MAX_ITEMS = 25;
const MAX_ITEMS_LIMIT = 100;

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
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [accountErrors, setAccountErrors] = useState<AccountDiscoveryError[]>([]);

  // Form State
  const [clusterTitle, setClusterTitle] = useState('Cross-Site Work Items');
  const [jql, setJql] = useState(DEFAULT_JQL);
  const [maxItems, setMaxItems] = useState(String(DEFAULT_MAX_ITEMS));
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    'status',
    'priority',
    'dueDate',
    'site',
    'lastComment'
  ]);
  const [selectedSiteKeys, setSelectedSiteKeys] = useState<Set<string>>(new Set());

  // Previously saved sites (to preserve sites not discoverable under current user's tokens)
  const [savedSitesMap, setSavedSitesMap] = useState<Map<string, SelectedSite>>(new Map());

  // Discovered Sites
  const [accessibleSites, setAccessibleSites] = useState<AccessibleSite[]>([]);

  const parsedMaxItems = (() => {
    const n = Number(maxItems);
    return Number.isInteger(n) && n >= 1 && n <= MAX_ITEMS_LIMIT ? n : null;
  })();

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
        if (typeof savedConfig.maxItems === 'number') setMaxItems(String(savedConfig.maxItems));
        if (Array.isArray(savedConfig.visibleColumns)) setVisibleColumns(savedConfig.visibleColumns);
        if (Array.isArray(savedConfig.selectedSites)) {
          const map = new Map<string, SelectedSite>();
          for (const s of savedConfig.selectedSites) {
            if (s && s.accountId && s.siteId) {
              map.set(makeSiteKey(s.accountId, s.siteId), s);
            }
          }
          setSavedSitesMap(map);
          setSelectedSiteKeys(new Set(map.keys()));
        }
      }

      // 2. Discover sites
      await fetchSites();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize gadget configuration.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchSites = async () => {
    try {
      const [accounts, discovery] = await Promise.all([
        invoke('getConnectedAccounts') as Promise<ConnectedAccount[]>,
        invoke('getAllAccessibleSites') as Promise<SiteDiscoveryResult>
      ]);
      setConnectedAccounts(accounts || []);
      setAccessibleSites(discovery?.sites || []);
      setAccountErrors(discovery?.accountErrors || []);
    } catch (err: unknown) {
      console.error('Failed to discover sites:', err);
      const msg = err instanceof Error ? err.message : 'Failed to load connected accounts.';
      setErrorMessage(msg);
      setAccessibleSites([]);
      setAccountErrors([]);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleConnectAccount = async () => {
    try {
      setConnectingAccount(true);
      setErrorMessage(null);
      setSignInUrl(await openAtlassianSignIn());
      setCopied(false);
      setAwaitingSignIn(true);
    } catch (err: unknown) {
      console.error('Failed to link Atlassian account:', err);
      const msg = err instanceof Error ? err.message : 'Please try again.';
      setErrorMessage(`Failed to connect Atlassian account: ${msg}`);
    } finally {
      setConnectingAccount(false);
    }
  };

  const handleCopySignInUrl = async () => {
    if (!signInUrl) return;
    try {
      await navigator.clipboard.writeText(signInUrl);
      setCopied(true);
    } catch {
      // Clipboard may be blocked inside the iframe; the field stays selectable.
      setCopied(false);
    }
  };

  const handleRefreshAccounts = async () => {
    setRefreshingAccounts(true);
    setErrorMessage(null);
    await fetchSites();
    setAwaitingSignIn(false);
    setRefreshingAccounts(false);
  };

  const handleDisconnect = async (accountId: string) => {
    const confirmed = window.confirm(
      'Disconnect this Atlassian account from your Jira user? Target sites using this account will stop showing issues in your gadgets.'
    );
    if (!confirmed) return;

    try {
      setErrorMessage(null);
      await invoke('disconnectAccount', { accountId });
      setSelectedSiteKeys(prev => new Set([...prev].filter(k => !k.startsWith(`${accountId}::`))));
      await fetchSites();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      setErrorMessage(`Failed to disconnect account: ${msg}`);
    }
  };

  const toggleSite = (accountId: string, siteId: string) => {
    const key = makeSiteKey(accountId, siteId);
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
      const accessibleMap = new Map<string, AccessibleSite>();
      for (const site of accessibleSites) {
        accessibleMap.set(makeSiteKey(site.accountId, site.siteId), site);
      }

      for (const key of selectedSiteKeys) {
        const accessible = accessibleMap.get(key);
        if (accessible) {
          selectedSites.push({
            accountId: accessible.accountId,
            siteId: accessible.siteId,
            siteName: accessible.siteName,
            siteUrl: accessible.siteUrl
          });
        } else {
          // Preserve saved sites not currently discoverable under this viewer
          const saved = savedSitesMap.get(key);
          if (saved) {
            selectedSites.push({
              accountId: saved.accountId,
              siteId: saved.siteId,
              siteName: saved.siteName,
              siteUrl: saved.siteUrl
            });
          }
        }
      }

      if (selectedSites.length === 0) {
        setErrorMessage('Please select at least one site to monitor.');
        setSaving(false);
        return;
      }

      const config: GadgetConfiguration = {
        clusterTitle: clusterTitle.trim() || 'Cross-Site Work Items',
        jql: jql.trim() || DEFAULT_JQL,
        selectedSites,
        visibleColumns,
        maxItems: parsedMaxItems ?? DEFAULT_MAX_ITEMS
      };

      await view.submit(config);
    } catch (err: unknown) {
      console.error('Failed to save configuration:', err);
      const msg = err instanceof Error ? err.message : 'Failed to save gadget configuration.';
      setErrorMessage(msg);
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

  // Group discovered sites under each connected account
  const accountsMap = new Map<string, { email: string; sites: AccessibleSite[] }>();
  for (const acc of connectedAccounts) {
    accountsMap.set(acc.id, { email: acc.email, sites: [] });
  }
  for (const site of accessibleSites) {
    if (!accountsMap.has(site.accountId)) {
      accountsMap.set(site.accountId, { email: site.accountEmail, sites: [] });
    }
    accountsMap.get(site.accountId)!.sites.push(site);
  }
  const accounts = Array.from(accountsMap.entries());

  // Find saved sites that were not discovered under the current user's accounts
  const undiscoveredSavedSites: SelectedSite[] = [];
  for (const [key, site] of savedSitesMap.entries()) {
    if (selectedSiteKeys.has(key) && !accessibleSites.some(s => makeSiteKey(s.accountId, s.siteId) === key)) {
      undiscoveredSavedSites.push(site);
    }
  }

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

      {/* Max work items */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '12px', marginBottom: '6px', color: '#6B778C' }}>
          Maximum Work Items
        </label>
        <div style={{ maxWidth: '120px' }}>
          <Textfield
            name="maxItems"
            type="number"
            min={1}
            max={MAX_ITEMS_LIMIT}
            value={maxItems}
            isInvalid={parsedMaxItems === null}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxItems(e.target.value)}
          />
        </div>
        <p style={{ fontSize: '11px', color: parsedMaxItems === null ? '#AE2E24' : '#6B778C', marginTop: '4px' }}>
          {parsedMaxItems === null
            ? `Enter a whole number between 1 and ${MAX_ITEMS_LIMIT}.`
            : 'Total across all selected sites. The most recently updated work items are shown.'}
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
          <div style={{ display: 'flex', gap: '4px' }}>
            <Button appearance="subtle" onClick={handleRefreshAccounts} isDisabled={refreshingAccounts}>
              {refreshingAccounts ? 'Refreshing...' : '↻ Refresh'}
            </Button>
            <Button
              appearance="subtle"
              onClick={handleConnectAccount}
              isDisabled={connectingAccount}
            >
              {connectingAccount ? 'Opening...' : '+ Connect Another Account'}
            </Button>
          </div>
        </div>

        {awaitingSignIn && (
          <div style={{ marginBottom: '12px' }}>
            <SectionMessage appearance="information" title="Finish signing in in the new tab">
              <p style={{ marginBottom: '8px' }}>
                Approve access on the Atlassian consent screen, then come back here and refresh.
              </p>
              {signInUrl && (
                <div style={{ marginBottom: '12px' }}>
                  <p style={{ fontSize: '12px', marginBottom: '4px' }}>
                    <strong>Connecting a different Atlassian account?</strong> Open this link in a private window
                    (or another browser profile) and sign in there. You stay logged in here. The link is valid
                    for 10 minutes and works once.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <Textfield
                        isReadOnly
                        isCompact
                        value={signInUrl}
                        onFocus={(e: FocusEvent<HTMLInputElement>) => e.target.select()}
                      />
                    </div>
                    <Button appearance="default" onClick={handleCopySignInUrl}>
                      {copied ? 'Copied ✓' : 'Copy link'}
                    </Button>
                  </div>
                </div>
              )}
              <Button appearance="primary" onClick={handleRefreshAccounts} isDisabled={refreshingAccounts}>
                {refreshingAccounts ? 'Refreshing...' : "I've signed in, refresh"}
              </Button>
            </SectionMessage>
          </div>
        )}

        {accounts.length === 0 ? (
          <SectionMessage appearance="warning" title="No Atlassian Accounts Connected">
            <p style={{ marginBottom: '12px' }}>
              Sign in with Atlassian to choose which Jira sites this gadget reads from. Access is read-only,
              stored only for you, and can be revoked any time under{' '}
              <a href={CONNECTED_APPS_URL} target="_blank" rel="noreferrer">Connected apps</a>.
            </p>
            <Button
              appearance="primary"
              onClick={handleConnectAccount}
              isDisabled={connectingAccount}
            >
              {connectingAccount ? 'Opening...' : 'Connect Atlassian Account'}
            </Button>
          </SectionMessage>
        ) : (
          <div style={{ border: '1px solid #DFE1E6', borderRadius: '4px', padding: '12px', background: '#FAFBFC' }}>
            {accounts.map(([accId, acc]) => {
              const accErr = accountErrors.find(e => e.accountId === accId);
              return (
                <div key={accId} style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#091E42' }}>👤 {acc.email}</span>
                    <Button appearance="subtle" spacing="compact" onClick={() => handleDisconnect(accId)}>
                      Disconnect
                    </Button>
                  </div>

                  {accErr && (
                    <div style={{ marginBottom: '8px', padding: '8px', backgroundColor: '#FFEBE6', borderRadius: '3px' }}>
                      <p style={{ margin: 0, fontSize: '12px', color: '#BF2600' }}>
                        ⚠️ {accErr.message}
                      </p>
                    </div>
                  )}

                  <div style={{ paddingLeft: '16px' }}>
                    {acc.sites.length === 0 && !accErr ? (
                      <p style={{ fontSize: '12px', color: '#6B778C', fontStyle: 'italic' }}>
                        No accessible Jira sites found for this account.
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
                              onChange={() => toggleSite(site.accountId, site.siteId)}
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
              );
            })}

            {/* Preserved Sites Section */}
            {undiscoveredSavedSites.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed #DFE1E6' }}>
                <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B778C', marginBottom: '4px' }}>
                  Previously Selected Sites (Account Not Currently Connected)
                </p>
                <p style={{ fontSize: '11px', color: '#8993A4', marginBottom: '8px' }}>
                  These sites were configured previously. They will stay configured unless you uncheck them.
                </p>
                {undiscoveredSavedSites.map(site => {
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
                        onChange={() => toggleSite(site.accountId, site.siteId)}
                        label={
                          <span>
                            <strong>{site.siteName}</strong>{' '}
                            <span style={{ color: '#6B778C', fontSize: '12px' }}>({site.siteUrl})</span>
                          </span>
                        }
                        value={key}
                      />
                      <Badge appearance="important">Not Connected</Badge>
                    </div>
                  );
                })}
              </div>
            )}
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
          isDisabled={saving || selectedSiteKeys.size === 0 || parsedMaxItems === null}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}
