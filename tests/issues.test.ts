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

    const mockProvider = {
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

    const mockProvider = {
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
});
