import { describe, expect, it } from 'vitest'
import { CONTROL_PATHS, SEARCH_CONTROL_KEYS, buildSearchControlsSchema, getControl, hasControl, setControl, type SearchControls } from '../controls'

describe('control registry', () => {
  it('lists every key exactly once and in registry order', () => {
    expect(SEARCH_CONTROL_KEYS).toEqual(Object.keys(CONTROL_PATHS))
    expect(new Set(SEARCH_CONTROL_KEYS).size).toBe(SEARCH_CONTROL_KEYS.length)
    expect(SEARCH_CONTROL_KEYS).toContain('license.commercial')
    expect(SEARCH_CONTROL_KEYS).toContain('page')
  })
  it('get/set/has walk nested paths', () => {
    const c: SearchControls = { license: { commercial: true }, page: 2 }
    expect(getControl(c, 'license.commercial')).toBe(true)
    expect(getControl(c, 'media.kind')).toBeUndefined()
    expect(hasControl(c, 'page')).toBe(true)
    const out: SearchControls = {}
    setControl(out, 'media.kind', 'photo')
    setControl(out, 'media.minWidth', 100)
    setControl(out, 'sort', 'latest')
    expect(out).toEqual({ media: { kind: 'photo', minWidth: 100 }, sort: 'latest' })
  })
  it('schema accepts any kind by default and only the given kinds when restricted', () => {
    expect(buildSearchControlsSchema().safeParse({ media: { kind: 'anything' } }).success).toBe(true)
    expect(buildSearchControlsSchema(['photo']).safeParse({ media: { kind: 'texture' } }).success).toBe(false)
    expect(buildSearchControlsSchema(['photo']).safeParse({ media: { kind: 'photo' }, page: 1 }).success).toBe(true)
  })
})
