// Bounds for values that arrive in query strings and request bodies and end
// up in Mongo queries. Every signed-in user can call these routes, so an
// unbounded `limit`, an unescaped regex or a slow query is a way to make the
// database do arbitrary work (or return a whole collection) on demand.

/** Abort any single corpus query that runs longer than this. */
export const QUERY_MAX_TIME_MS = 5000;

/** Longest free-text search term accepted. */
export const MAX_SEARCH_LENGTH = 100;

/** Parse an integer and clamp it to [min, max]; fall back on anything unparseable. */
export function clampInt(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Escape a string so it matches literally inside a regular expression. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
