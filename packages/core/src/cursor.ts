// Unified "load more" cursor (v2, binary). Providers fetch an overfetched pool
// per page (fetchLimit ≥ limit) while each call returns only `limit`, and RRF
// fusion makes raw provider pages overlap — so the cursor carries the CURRENT
// provider-local page plus compact hashes of every already-returned result. The
// client filters repeats out and advances the page internally only once a
// page's pool is exhausted. The string is an implementation detail — treat it
// as opaque; only `meta.nextCursor` from a previous search is a valid input.
//
// Wire format: base64url of [magic 'R' 'k', version 0x02][page uint32 LE]
// [seen uint32 LE × N]. Packing the raw fnv1a words (instead of the v1 JSON
// array of base36 strings) keeps a full 500-entry cursor at ~2.7k chars vs ~5k
// — cursors ride inside LLM tool outputs downstream, where every char counts.
import { fnv1a32 } from './hash'
import { canonicalizeUrl } from './dedup-key'

export interface SearchCursorState {
  /** Provider-local page the current pool comes from (routed as controls.page;
   *  1-based). Advanced by the client, not per call. */
  page: number
  /** {@link cursorSeenKey} hashes of results returned on previous calls. Capped
   *  by the client (most recent kept) so cursor size stays bounded; a 32-bit
   *  hash keeps entries compact — the worst case of a collision or an evicted
   *  entry is one result suppressed or repeated. */
  seen: number[]
}

const MAGIC_0 = 0x52 // 'R'
const MAGIC_1 = 0x6b // 'k'
const VERSION = 0x02
const HEADER_BYTES = 7 // magic (2) + version (1) + page uint32 (4)

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64URL_INDEX: Record<string, number> = Object.fromEntries([...B64URL].map((c, i) => [c, i]))

function toBase64url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64URL[n >> 18] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    out += B64URL[bytes[i] >> 2] + B64URL[(bytes[i] & 3) << 4]
  } else if (rest === 2) {
    const n = (bytes[i] << 8) | bytes[i + 1]
    out += B64URL[n >> 10] + B64URL[(n >> 4) & 63] + B64URL[(n & 15) << 2]
  }
  return out
}

/** Decode unpadded base64url; returns undefined on any string a
 *  {@link toBase64url} call could not have produced — including non-canonical
 *  encodings whose unused trailing bits are non-zero. */
function fromBase64url(s: string): Uint8Array | undefined {
  const rem = s.length % 4
  if (rem === 1) return undefined
  const bytes = new Uint8Array((s.length >> 2) * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0))
  let bi = 0
  let acc = 0
  let accBits = 0
  for (const c of s) {
    const v = B64URL_INDEX[c]
    if (v === undefined) return undefined
    acc = (acc << 6) | v
    accBits += 6
    if (accBits >= 8) {
      accBits -= 8
      bytes[bi++] = (acc >> accBits) & 0xff
    }
  }
  // Unused trailing bits must be zero, or up to 16 tampered strings would
  // silently alias one cursor.
  if ((acc & ((1 << accBits) - 1)) !== 0) return undefined
  return bytes
}

/** Compact already-seen key for a result (raw fnv1a uint32) — same URL
 *  canonicalization as merge/dedup. */
export function cursorSeenKey(canonicalUrl: string): number {
  return fnv1a32(canonicalizeUrl(canonicalUrl))
}

export function encodeCursor(state: SearchCursorState): string {
  const bytes = new Uint8Array(HEADER_BYTES + state.seen.length * 4)
  const view = new DataView(bytes.buffer)
  bytes[0] = MAGIC_0
  bytes[1] = MAGIC_1
  bytes[2] = VERSION
  // A page uint32 can't represent (bad caller-supplied controls.page: negative,
  // fractional, NaN, ≥ 2^32) encodes as 0 — a poison value decodeCursor rejects
  // — so it fails loudly on the next call like v1's schema did, instead of
  // silently wrapping to some other page.
  const page = Number.isInteger(state.page) && state.page >= 1 && state.page <= 0xffffffff ? state.page : 0
  view.setUint32(3, page, true)
  state.seen.forEach((key, i) => view.setUint32(HEADER_BYTES + i * 4, key, true))
  return toBase64url(bytes)
}

const invalidCursor = () => new Error('refkit.search: invalid cursor (not produced by meta.nextCursor)')

/** Parse and validate a cursor string. Throws on anything that is not a cursor
 *  this library produced — a corrupted cursor must fail loudly, not quietly
 *  restart from page 1. */
export function decodeCursor(cursor: string): SearchCursorState {
  const bytes = fromBase64url(cursor)
  if (
    bytes === undefined ||
    bytes.length < HEADER_BYTES ||
    (bytes.length - HEADER_BYTES) % 4 !== 0 ||
    bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1 || bytes[2] !== VERSION
  ) {
    throw invalidCursor()
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const page = view.getUint32(3, true)
  if (page < 1) throw invalidCursor()
  const seen: number[] = []
  for (let offset = HEADER_BYTES; offset < bytes.length; offset += 4) {
    seen.push(view.getUint32(offset, true))
  }
  return { page, seen }
}
