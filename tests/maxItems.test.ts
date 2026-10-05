import { aggregateIssuesFromSites, DEFAULT_MAX_ITEMS, MAX_ITEMS_LIMIT, normalizeMaxItems } from '../src/resolvers/issues';
import { GadgetConfiguration, SelectedSite } from '../src/types';

const site = (id: string): SelectedSite => ({
  accountId: 'acc-1',
  accountEmail: 'dev@company.com',
  siteId: id,
  siteName: id.toUpperCase(),
  siteUrl: `https://${id}.atlassian.net`
});

/** Fake provider whose sites return issues with the given `updated` days (2026-01-DD). */
function providerWith(issuesBySite: Record<string, number[]>) {
  const requestedPaths: string[] = [];
  const provider = {
    listAccounts: async () => [],
    asAccount: () => ({
      fetch: async (path: string) => {
        requestedPaths.push(path);
        const siteId = path.split('/')[3];
        const days = issuesBySite[siteId] || [];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            issues: days.map(d => ({
              id: `${siteId}-${d}`,
              key: `${siteId.toUpperCase()}-${d}`,
              fields: { summary: 's', updated: `2026-01-${String(d).padStart(2, '0')}T00:00:00.000+0000` }
            }))
          }),
          text: async () => ''
        };
      }
    })
  };
  return { provider, requestedPaths };
}

const config = (sites: SelectedSite[], maxItems?: number): GadgetConfiguration => ({
  clusterTitle: 'C',
  jql: 'order by updated desc',
  visibleColumns: [],
  selectedSites: sites,
  maxItems
});

describe('normalizeMaxItems', () => {
  it('defaults missing or invalid values and clamps to the supported range', () => {
    expect(normalizeMaxItems(undefined)).toBe(DEFAULT_MAX_ITEMS);
    expect(normalizeMaxItems(Number.NaN)).toBe(DEFAULT_MAX_ITEMS);
    expect(normalizeMaxItems('abc' as unknown as number)).toBe(DEFAULT_MAX_ITEMS);
    expect(normalizeMaxItems(0)).toBe(1);
    expect(normalizeMaxItems(-5)).toBe(1);
    expect(normalizeMaxItems(7.9)).toBe(7);
    expect(normalizeMaxItems(1000)).toBe(MAX_ITEMS_LIMIT);
    expect(normalizeMaxItems('40' as unknown as number)).toBe(40);
  });
});

describe('aggregateIssuesFromSites max items', () => {
  it('requests at most maxItems per site and keeps the most recently updated maxItems in total', async () => {
    const { provider, requestedPaths } = providerWith({ a: [1, 5, 9], b: [2, 7, 8] });

    const res = await aggregateIssuesFromSites(config([site('a'), site('b')], 3), provider);

    expect(requestedPaths.every(p => p.includes('maxResults=3'))).toBe(true);
    const kept = res.results.flatMap(r => r.issues.map(i => i.key)).sort();
    expect(kept).toEqual(['A-9', 'B-7', 'B-8']);
    expect(res.results.map(r => r.siteId)).toEqual(['a', 'b']);
    expect(res.maxItems).toBe(3);
    expect(res.truncated).toBe(true);
  });

  it('does not report truncation when everything fits', async () => {
    const { provider } = providerWith({ a: [1], b: [2] });
    const res = await aggregateIssuesFromSites(config([site('a'), site('b')], 10), provider);
    expect(res.results.flatMap(r => r.issues)).toHaveLength(2);
    expect(res.truncated).toBe(false);
  });

  it('reports truncation when a single site hit the per-site limit', async () => {
    const { provider } = providerWith({ a: [1, 2] });
    const res = await aggregateIssuesFromSites(config([site('a')], 2), provider);
    expect(res.truncated).toBe(true);
  });

  it('uses the default limit for configurations saved before the setting existed', async () => {
    const { provider, requestedPaths } = providerWith({ a: [1] });
    await aggregateIssuesFromSites(config([site('a')]), provider);
    expect(requestedPaths[0]).toContain(`maxResults=${DEFAULT_MAX_ITEMS}`);
  });
});
