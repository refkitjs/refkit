import { describe, expect, it } from 'vitest'
import { defineProvider } from '../provider'
import { selectProviders } from '../select'

const p = (id: string, modalities: Array<'image' | 'text'>, kinds?: string[]) =>
  defineProvider({ id, modalities, ...(kinds ? { kinds } : {}), search: async () => [] })

describe('selectProviders', () => {
  const providers = [p('a', ['image'], ['photo']), p('b', ['image']), p('c', ['text'])]

  it('keeps modality matches and explains every exclusion', () => {
    const s = selectProviders(providers, { modalities: ['image'], text: 'x' })
    expect(s.chosen.map(x => x.id)).toEqual(['a', 'b'])
    expect(s.skipReasons.get('c')).toBe('unsupported-modality')
    expect(s.unknownSources).toEqual([])
  })

  it('applies the sources whitelist and reports unknown ids', () => {
    const s = selectProviders(providers, { modalities: ['image'], sources: ['b', 'zzz'], text: 'x' })
    expect(s.chosen.map(x => x.id)).toEqual(['b'])
    expect(s.skipReasons.get('a')).toBe('not-selected')
    expect(s.unknownSources).toEqual(['zzz'])
  })

  it('kind narrowing skips declared mismatches and keeps undeclared providers', () => {
    const s = selectProviders(providers, { modalities: ['image'], kind: 'texture', text: 'x' })
    expect(s.chosen.map(x => x.id)).toEqual(['b'])
    expect(s.skipReasons.get('a')).toBe('unsupported-kind')
  })

  it('throws when nothing matches', () => {
    expect(() => selectProviders(providers, { modalities: ['image'], sources: ['zzz'], text: 'x' }))
      .toThrow(/no configured provider matches source id/)
    expect(() => selectProviders(providers, { modalities: ['video'], text: 'x' }))
      .toThrow(/no registered provider supports/)
  })

  it('accepts=false skips with reason declined; an explicit sources entry bypasses it', () => {
    const picky = defineProvider({ id: 'picky', modalities: ['image'], accepts: ({ text }) => /nail/i.test(text), search: async () => [] })
    const open = defineProvider({ id: 'open', modalities: ['image'], search: async () => [] })
    const s = selectProviders([picky, open], { modalities: ['image'], text: 'lion' })
    expect(s.chosen.map(x => x.id)).toEqual(['open'])
    expect(s.skipReasons.get('picky')).toBe('declined')
    const forced = selectProviders([picky, open], { modalities: ['image'], text: 'lion', sources: ['picky'] })
    expect(forced.chosen.map(x => x.id)).toEqual(['picky'])
  })

  it('when every candidate declines the selection is empty, not an error', () => {
    const picky = defineProvider({ id: 'picky', modalities: ['image'], accepts: () => false, search: async () => [] })
    const s = selectProviders([picky], { modalities: ['image'], text: 'lion' })
    expect(s.chosen).toEqual([])
    expect(s.skipReasons.get('picky')).toBe('declined')
    expect(s.unknownSources).toEqual([])
  })
})
