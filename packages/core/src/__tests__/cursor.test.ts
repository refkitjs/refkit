import { describe, expect, it } from 'vitest'
import { cursorSeenKey, decodeCursor, encodeCursor } from '../cursor'

const INVALID = /invalid cursor/

describe('cursor v2 encoding', () => {
  it('roundtrips page + seen through an opaque base64url string', () => {
    const state = { page: 7, seen: [0, 1, 0x7fffffff, 0xffffffff, 123456789] }
    const encoded = encodeCursor(state)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(encoded)).toEqual(state)
  })

  it('roundtrips an empty seen list', () => {
    expect(decodeCursor(encodeCursor({ page: 1, seen: [] }))).toEqual({ page: 1, seen: [] })
  })

  it('cursorSeenKey is a deterministic uint32', () => {
    const k = cursorSeenKey('https://a/1')
    expect(Number.isInteger(k)).toBe(true)
    expect(k).toBeGreaterThanOrEqual(0)
    expect(k).toBeLessThan(2 ** 32)
    expect(cursorSeenKey('https://a/1')).toBe(k)
  })

  it('stays under 2.8k chars at the 500-entry seen cap (v1 JSON was ~5k)', () => {
    const seen = Array.from({ length: 500 }, (_, i) => (i * 2654435761) >>> 0)
    const encoded = encodeCursor({ page: 9, seen })
    expect(encoded.length).toBeLessThanOrEqual(2700)
    expect(decodeCursor(encoded).seen).toEqual(seen)
  })

  it('throws "invalid cursor" on strings not produced by encodeCursor', () => {
    for (const bad of [
      '',
      'not a cursor!', // characters outside the base64url alphabet
      '{"v":1,"page":1,"seen":["abc"]}', // legacy v1 JSON cursor — no longer accepted
      'not-a-cursor', // base64url alphabet but not our layout
      'AAAAAAAA', // well-formed base64url, decodes to 6 bytes — shorter than the header
      'abc', // too short to hold a header
    ]) {
      expect(() => decodeCursor(bad), JSON.stringify(bad)).toThrow(INVALID)
    }
  })

  it('throws on wrong magic and wrong version (payload long enough to reach those checks)', () => {
    const v2 = (bytes: number[]) => Buffer.from(bytes).toString('base64url')
    // Sanity: Buffer's base64url of a genuine header matches our encoder.
    expect(v2([0x52, 0x6b, 0x02, 1, 0, 0, 0])).toBe(encodeCursor({ page: 1, seen: [] }))
    expect(() => decodeCursor(v2([0x00, 0x6b, 0x02, 1, 0, 0, 0]))).toThrow(INVALID) // bad magic byte 0
    expect(() => decodeCursor(v2([0x52, 0x00, 0x02, 1, 0, 0, 0]))).toThrow(INVALID) // bad magic byte 1
    expect(() => decodeCursor(v2([0x52, 0x6b, 0x01, 1, 0, 0, 0]))).toThrow(INVALID) // version 1
    expect(() => decodeCursor(v2([0x52, 0x6b, 0x03, 1, 0, 0, 0]))).toThrow(INVALID) // version 3
  })

  it('throws on non-canonical trailing bits (single-char tamper the encoder could never emit)', () => {
    // Both base64url remainder classes: rem-2 (4 unused bits) and rem-3 (2 unused bits).
    for (const state of [{ page: 1, seen: [] }, { page: 3, seen: [42] }]) {
      const encoded = encodeCursor(state)
      expect(encoded.endsWith('A')).toBe(true) // unused trailing bits are zero
      expect(() => decodeCursor(encoded.slice(0, -1) + 'B'), encoded).toThrow(INVALID)
    }
  })

  it('throws on a truncated but otherwise genuine cursor', () => {
    const encoded = encodeCursor({ page: 1, seen: [1, 2, 3] })
    expect(() => decodeCursor(encoded.slice(0, -2))).toThrow(INVALID)
  })

  it('throws on a cursor carrying page 0', () => {
    expect(() => decodeCursor(encodeCursor({ page: 0, seen: [] }))).toThrow(INVALID)
  })

  it('encodes an out-of-uint32-range page as a poison cursor that fails loudly on decode', () => {
    // A bad caller-supplied controls.page must NOT silently wrap to a different
    // page (v1 failed loudly on the next call; v2 must too).
    for (const page of [-1, 2.5, Number.NaN, 2 ** 32, 2 ** 32 + 5]) {
      expect(() => decodeCursor(encodeCursor({ page, seen: [7] })), String(page)).toThrow(INVALID)
    }
  })
})
