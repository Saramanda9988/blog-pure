/**
 * Canonical Waline key for a page: URI-decoded, without trailing slash.
 * Used for comments, reactions, pageviews and the `data-path` of counters, so they all
 * hit the same database row regardless of `/post` vs `/post/` or `%E4%B8%AD` vs `中`.
 * Keep in sync with the inline copy in Pageview.astro.
 */
export function normalizeWalinePath(pathname: string): string {
  let path = pathname
  try {
    path = decodeURI(pathname)
  } catch {
    // keep the raw value on malformed sequences
  }
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path
}
