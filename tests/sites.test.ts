import { fetchSitesForAccounts } from '../src/resolvers/sites';

describe('fetchSitesForAccounts', () => {
  it('should return empty list when no accounts are connected', async () => {
    const mockProvider = {
      listAccounts: jest.fn().mockResolvedValue([]),
      asAccount: jest.fn()
    };

    const res = await fetchSitesForAccounts(mockProvider as any);
    expect(res.sites).toEqual([]);
    expect(res.accountErrors).toEqual([]);
    expect(mockProvider.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('should discover accessible resources and test Jira access for each site', async () => {
    const mockProvider = {
      listAccounts: jest.fn().mockResolvedValue([
        { id: 'acc-1', displayName: 'dev@company.com' }
      ]),
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockImplementation((path: string) => {
          if (path === '/oauth/token/accessible-resources') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve([
                {
                  id: 'site-1',
                  name: 'Company Production',
                  url: 'https://company.atlassian.net',
                  avatarUrl: 'https://avatar.url/1.png'
                }
              ])
            });
          }
          if (path.includes('/rest/api/3/myself')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ accountId: 'acc-1', active: true })
            });
          }
          return Promise.resolve({ ok: false, status: 404 });
        })
      })
    };

    const res = await fetchSitesForAccounts(mockProvider as any);
    expect(res.sites).toHaveLength(1);
    expect(res.accountErrors).toEqual([]);
    expect(res.sites[0]).toEqual({
      accountId: 'acc-1',
      accountEmail: 'dev@company.com',
      siteId: 'site-1',
      siteName: 'Company Production',
      siteUrl: 'https://company.atlassian.net',
      avatarUrl: 'https://avatar.url/1.png',
      hasJiraAccess: true
    });
  });

  it('should mark hasJiraAccess as false if myself probe fails', async () => {
    const mockProvider = {
      listAccounts: jest.fn().mockResolvedValue([
        { id: 'acc-2', displayName: 'external@partner.com' }
      ]),
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockImplementation((path: string) => {
          if (path === '/oauth/token/accessible-resources') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve([
                { id: 'site-2', name: 'Partner Site', url: 'https://partner.atlassian.net' }
              ])
            });
          }
          return Promise.resolve({ ok: false, status: 403 });
        })
      })
    };

    const res = await fetchSitesForAccounts(mockProvider as any);
    expect(res.sites).toHaveLength(1);
    expect(res.accountErrors).toEqual([]);
    expect(res.sites[0].hasJiraAccess).toBe(false);
  });

  it('should record account error when accessible-resources returns 401/403', async () => {
    const mockProvider = {
      listAccounts: jest.fn().mockResolvedValue([
        { id: 'acc-expired', displayName: 'expired@partner.com' }
      ]),
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'unauthorized' })
        })
      })
    };

    const res = await fetchSitesForAccounts(mockProvider as any);
    expect(res.sites).toEqual([]);
    expect(res.accountErrors).toHaveLength(1);
    expect(res.accountErrors[0]).toMatchObject({
      accountId: 'acc-expired',
      status: 'AUTH_ERROR'
    });
  });
});
