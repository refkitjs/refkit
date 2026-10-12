import { fnv1a } from './hash'

// Conservative URL canonicalization: lowercase scheme+host, drop fragment + a single
// trailing slash. Path case and query are preserved (some sources are case-sensitive).
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase()
    let out = u.toString()
    if (out.endsWith('/') && !out.endsWith('://')) out = out.slice(0, -1)
    return out
  } catch {
    return url
  }
}

/** Content-addressed id: stable within a result set, not promised across calls. */
export function referenceId(sourceId: string, sourceUrl: string): string {
  return `${sourceId}:${fnv1a(canonicalizeUrl(sourceUrl))}`
}
