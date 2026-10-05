import { aggregateIssuesFromSites } from '../src/resolvers/issues';
import { GadgetConfiguration } from '../src/types';

describe('aggregateIssuesFromSites', () => {
  it('should return NEEDS_CONFIG if selectedSites is empty', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'My Cluster',
      jql: 'assignee = currentUser()',
      selectedSites: [],
      visibleColumns: ['status']
    };
    const mockProvider = {} as any;

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.status).toBe('NEEDS_CONFIG');
    expect(res.results).toEqual([]);
  });

  it('should fetch issues in parallel and normalize responses', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'Cross Team',
      jql: 'assignee = currentUser()',
      selectedSites: [
        {
          accountId: 'acc-1',
          accountEmail: 'dev@company.com',
          siteId: 'site-1',
          siteName: 'Main Jira',
          siteUrl: 'https://main.atlassian.net'
        }
      ],
      visibleColumns: ['status', 'priority']
    };

    const mockIssuesResponse = {
      issues: [
        {
          id: '1001',
          key: 'DEV-101',
          fields: {
            summary: 'Fix OAuth timeout',
            status: {
              name: 'In Progress',
              statusCategory: { key: 'indeterminate' }
            },
            priority: { name: 'High', iconUrl: 'https://icon/high.png' },
            issuetype: { name: 'Bug', iconUrl: 'https://icon/bug.png' },
            project: { key: 'DEV', name: 'Development' },
            updated: '2026-10-01T10:00:00.000Z',
            duedate: '2026-10-15',
            comment: {
              comments: [
                {
                  author: { displayName: 'Alice' },
                  created: '2026-10-02T12:00:00.000Z',
                  body: {
                    type: 'doc',
                    version: 1,
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Working on reproduction.' }]
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      ]
    };

    const mockProvider: any = {
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockIssuesResponse)
        })
      })
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.status).toBe('OK');
    expect(res.results).toHaveLength(1);
    expect(res.results[0].status).toBe('OK');
    expect(res.results[0].issues).toHaveLength(1);
    expect(res.results[0].issues[0].key).toBe('DEV-101');
    expect(res.results[0].issues[0].browseUrl).toBe('https://main.atlassian.net/browse/DEV-101');
    expect(res.results[0].issues[0].status.category).toBe('indeterminate');
    expect(res.results[0].issues[0].lastComment?.plainText).toBe('Working on reproduction.');
  });

  it('should isolate per-site auth errors (401) without failing healthy sites', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'Multi Site',
      jql: 'resolution = Unresolved',
      selectedSites: [
        {
          accountId: 'acc-1',
          accountEmail: 'dev@site1.com',
          siteId: 'site-1',
          siteName: 'Healthy Site',
          siteUrl: 'https://site1.atlassian.net'
        },
        {
          accountId: 'acc-2',
          accountEmail: 'dev@site2.com',
          siteId: 'site-2',
          siteName: 'Expired Site',
          siteUrl: 'https://site2.atlassian.net'
        }
      ],
      visibleColumns: ['status']
    };

    const mockProvider: any = {
      asAccount: jest.fn().mockImplementation((accountId: string) => ({
        fetch: jest.fn().mockImplementation(() => {
          if (accountId === 'acc-1') {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ issues: [] })
            });
          }
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ message: 'Unauthorized' })
          });
        })
      }))
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.status).toBe('OK');
    expect(res.results).toHaveLength(2);

    const healthy = res.results.find(r => r.siteId === 'site-1');
    const expired = res.results.find(r => r.siteId === 'site-2');

    expect(healthy?.status).toBe('OK');
    expect(expired?.status).toBe('AUTH_ERROR');
    expect(expired?.issues).toEqual([]);
  });

  it('should surface Jira 400 error message as JQL_ERROR', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'JQL Error Test',
      jql: 'invalidField = "test"',
      selectedSites: [
        {
          accountId: 'acc-1',
          accountEmail: 'dev@site.com',
          siteId: 'site-1',
          siteName: 'Bad JQL Site',
          siteUrl: 'https://site1.atlassian.net'
        }
      ],
      visibleColumns: ['status']
    };

    const mockProvider: any = {
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: () => Promise.resolve({
            errorMessages: ["Field 'invalidField' does not exist or you do not have permission to view it."]
          })
        })
      })
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.status).toBe('OK');
    expect(res.results[0].status).toBe('JQL_ERROR');
    expect(res.results[0].errorMessage).toContain("Field 'invalidField' does not exist");
  });

  it('should map 429 to RATE_LIMITED status', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'Rate limit test',
      jql: 'resolution = Unresolved',
      selectedSites: [
        {
          accountId: 'acc-1',
          accountEmail: 'dev@site.com',
          siteId: 'site-1',
          siteName: 'Busy Site',
          siteUrl: 'https://site1.atlassian.net'
        }
      ],
      visibleColumns: ['status']
    };

    const mockProvider: any = {
      asAccount: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue({
          ok: false,
          status: 429,
          json: () => Promise.resolve({})
        })
      })
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.results[0].status).toBe('RATE_LIMITED');
  });

  it('should deduplicate same site selected multiple times', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'Dedupe test',
      jql: 'resolution = Unresolved',
      selectedSites: [
        {
          accountId: 'acc-1',
          siteId: 'site-1',
          siteName: 'Site 1 Account A',
          siteUrl: 'https://site1.atlassian.net'
        },
        {
          accountId: 'acc-2',
          siteId: 'site-1',
          siteName: 'Site 1 Account B',
          siteUrl: 'https://site1.atlassian.net'
        }
      ],
      visibleColumns: []
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issues: [] })
    });

    const mockProvider: any = {
      asAccount: jest.fn().mockReturnValue({ fetch: fetchMock })
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should fail with INVALID_CONFIG when siteId or accountId has bad characters', async () => {
    const config: GadgetConfiguration = {
      clusterTitle: 'Validation test',
      jql: 'resolution = Unresolved',
      selectedSites: [
        {
          accountId: 'acc-1',
          siteId: '../../../etc/passwd',
          siteName: 'Evil Site',
          siteUrl: 'https://evil.atlassian.net'
        }
      ],
      visibleColumns: []
    };

    const mockProvider: any = {
      asAccount: jest.fn()
    };

    const res = await aggregateIssuesFromSites(config, mockProvider);
    expect(res.results[0].status).toBe('INVALID_CONFIG');
    expect(mockProvider.asAccount).not.toHaveBeenCalled();
  });
});
