import type { Reference } from './reference'
import { canonicalizeUrl } from './dedup-key'

const HEX_BITS: Record<string, number> = {
  '0': 0, '1': 1, '2': 1, '3': 2, '4': 1, '5': 2, '6': 2, '7': 3,
  '8': 1, '9': 2, a: 2, b: 3, c: 2, d: 3, e: 3, f: 4,
}

/** Bitwise hamming distance between two equal-length lowercase hex strings. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    const xor = (parseInt(a[i], 16) ^ parseInt(b[i], 16)).toString(16)
    d += HEX_BITS[xor] ?? 4
  }
  return d
}

export interface DedupeOptions {
  /** Max hamming distance between perceptual hashes to treat as duplicates. Default 0 (off). */
  hashThreshold?: number
  /** Host-supplied duplicate predicate for precomputed fingerprints/embeddings.
   *  Core never fetches or decodes media; the hook compares existing Reference data. */
  isDuplicate?: (candidate: Reference, existing: Reference) => boolean
}

// Collapse duplicates, keeping the highest-relevance representative. Two passes:
// 1) exact canonical-URL match; 2) perceptual-hash within threshold (if both present).
// Pure: never decodes bytes — operates only on caller-supplied perceptualHash strings.
export function dedupeReferences(refs: Reference[], opts: DedupeOptions = {}): Reference[] {
  const threshold = opts.hashThreshold ?? 0
  const kept: Reference[] = []
  const byUrl = new Map<string, number>() // canonicalUrl -> index in kept

  for (const ref of refs) {
    const url = canonicalizeUrl(ref.canonicalUrl)
    const urlHit = byUrl.get(url)
    if (urlHit !== undefined) {
      if (ref.relevance > kept[urlHit].relevance) kept[urlHit] = ref
      continue
    }

    let merged = false
    if (threshold > 0 && ref.perceptualHash) {
      // NOTE (P1): perceptual hashes must be equal-length across providers or they silently
      // won't hash-dedupe — hammingDistance returns Infinity for unequal lengths.
      for (let i = 0; i < kept.length; i++) {
        const k = kept[i]
        if (k.perceptualHash && hammingDistance(ref.perceptualHash, k.perceptualHash) <= threshold) {
          if (ref.relevance > k.relevance) {
            byUrl.delete(canonicalizeUrl(k.canonicalUrl))
            byUrl.set(canonicalizeUrl(ref.canonicalUrl), i)
            kept[i] = ref
          }
          merged = true
          break
        }
      }
    }
    if (merged) continue

    if (opts.isDuplicate) {
      for (let i = 0; i < kept.length; i++) {
        const k = kept[i]
        if (opts.isDuplicate(ref, k)) {
          if (ref.relevance > k.relevance) {
            byUrl.delete(canonicalizeUrl(k.canonicalUrl))
            byUrl.set(canonicalizeUrl(ref.canonicalUrl), i)
            kept[i] = ref
          }
          merged = true
          break
        }
      }
    }
    if (merged) continue

    byUrl.set(url, kept.length)
    kept.push(ref)
  }
  return kept
}
