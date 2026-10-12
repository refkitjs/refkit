import { describe, expect, it } from 'vitest'
import { defineProvider } from '../provider'
import { selectProviders, SourceSelectionError } from '../select'

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
      .toThrow(/no configured source matches id/)
    expect(() => selectProviders(providers, { modalities: ['video'], text: 'x' }))
      .toThrow(/no configured source supports/)
  })

  describe('SourceSelectionError', () => {
    const miss = (input: Parameters<typeof selectProviders>[1], from = providers): SourceSelectionError => {
      try {
        selectProviders(from, input)
      } catch (e) {
        expect(e).toBeInstanceOf(SourceSelectionError)
        expect(e).toBeInstanceOf(Error)
        return e as SourceSelectionError
      }
      throw new Error('expected selectProviders to throw')
    }

    it('an unknown id: no-matching-source, the id listed as unknown', () => {
      const e = miss({ modalities: ['image'], sources: ['zzz'], text: 'x' })
      expect(e.name).toBe('SourceSelectionError')
      expect(e.code).toBe('no-matching-source')
      expect(e.requested).toEqual(['zzz'])
      expect(e.unknown).toEqual(['zzz'])
      expect(e.modalities).toEqual(['image'])
      expect(e.kind).toBeUndefined()
    })

    it('a known id without the modality: no-matching-source, nothing unknown', () => {
      // `c` is configured, but only for text: it is not unknown.
      const e = miss({ modalities: ['image'], sources: ['c'], text: 'x' })
      expect(e.code).toBe('no-matching-source')
      expect(e.requested).toEqual(['c'])
      expect(e.unknown).toEqual([])
      expect(e.modalities).toEqual(['image'])
      // Mixed with a typo, only the typo is unknown.
      expect(miss({ modalities: ['image'], sources: ['c', 'zzz'], text: 'x' }).unknown).toEqual(['zzz'])
    })

    it('a known id excluded by kind: no-matching-source, carrying the kind', () => {
      const e = miss({ modalities: ['image'], sources: ['a'], kind: 'texture', text: 'x' })
      expect(e.code).toBe('no-matching-source')
      expect(e.requested).toEqual(['a'])
      expect(e.unknown).toEqual([])
      expect(e.kind).toBe('texture')
      expect(e.message).toContain('kind "texture"')
    })

    it('sources: [] is a no-matching-source miss with nothing requested', () => {
      const e = miss({ modalities: ['image'], sources: [], text: 'x' })
      expect(e.code).toBe('no-matching-source')
      expect(e.requested).toEqual([])
      expect(e.unknown).toEqual([])
    })

    it('no source for the query: no-source-for-query, no requested list', () => {
      const e = miss({ modalities: ['video'], text: 'x' })
      expect(e.code).toBe('no-source-for-query')
      expect(e.requested).toBeUndefined()
      expect(e.unknown).toEqual([])
      expect(e.modalities).toEqual(['video'])
      expect(e.kind).toBeUndefined()
    })

    it('a kind miss without sources: no-source-for-query, carrying the kind', () => {
      // Every image source declares a kind other than the one asked for.
      const kinded = [p('a', ['image'], ['photo']), p('d', ['image'], ['vector'])]
      const e = miss({ modalities: ['image'], kind: 'texture', text: 'x' }, kinded)
      expect(e.code).toBe('no-source-for-query')
      expect(e.requested).toBeUndefined()
      expect(e.unknown).toEqual([])
      expect(e.kind).toBe('texture')
      expect(e.message).toContain('kind "texture"')
    })
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
