/**
 * Gadget configuration is written by any dashboard editor (and can be crafted
 * via devtools), so values used in request paths, storage keys or links are
 * validated before use.
 */

/** Atlassian cloud IDs are UUIDs; allow only path-safe characters. */
export function isSafeSiteId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value);
}

/** Atlassian account IDs look like "557058:uuid" or 24 hex chars. */
export function isSafeAccountId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

/**
 * Returns the origin of an https URL (no path, query or credentials), or
 * undefined. Prevents javascript:/data: links and odd paths in browse URLs.
 * Any https host is accepted because Jira Cloud supports custom domains.
 */
export function httpsOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** OAuth state values are 32 random bytes, hex encoded. */
export function isWellFormedState(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
