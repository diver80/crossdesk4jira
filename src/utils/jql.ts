/**
 * Replaces any top-level ORDER BY clause with `ORDER BY updated DESC`.
 *
 * The gadget fetches the N newest items per site and keeps the N newest
 * overall, so every site must be queried in that order for the result to be
 * correct. "order by" inside quoted strings is left alone.
 */
export function withUpdatedOrder(jql: string): string {
  const orderAt = findTopLevelOrderBy(jql);
  const filter = (orderAt === -1 ? jql : jql.slice(0, orderAt)).trim();
  return filter ? `${filter} ORDER BY updated DESC` : 'ORDER BY updated DESC';
}

function findTopLevelOrderBy(jql: string): number {
  let quote: string | null = null;
  for (let i = 0; i < jql.length; i++) {
    const c = jql[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    const atWordStart = i === 0 || /\s|\)/.test(jql[i - 1]);
    if (atWordStart && /^order\s+by\b/i.test(jql.slice(i, i + 20))) {
      return i;
    }
  }
  return -1;
}
