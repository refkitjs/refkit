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
})
