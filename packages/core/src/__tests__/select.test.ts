import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineProvider } from '../provider'
import { selectProviders, SourceSelectionError } from '../select'
import {
  isSourceSelectionError, SOURCE_SELECTION_ERROR_CODES,
  SourceSelectionError as ExportedSourceSelectionError, type SourceSelectionErrorCode,
} from '../index'

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

  describe('isSourceSelectionError (exported from the package)', () => {
    // What "another copy of @refkit/core" throws: the same fields on an Error
    // whose class is not this copy's, so `instanceof` cannot see it.
    const lookAlike = (fields: Record<string, unknown> = {}) => Object.assign(
      new Error('refkit.search: no configured source matches id(s) [zzz] for modalities [image]'),
      { name: 'SourceSelectionError', code: 'no-matching-source', requested: ['zzz'], unknown: ['zzz'], modalities: ['image'], ...fields },
    )

    it('lists the codes, and the class field is typed by them', () => {
      expect(SOURCE_SELECTION_ERROR_CODES).toEqual(['no-matching-source', 'no-source-for-query'])
      expectTypeOf<SourceSelectionErrorCode>().toEqualTypeOf<'no-matching-source' | 'no-source-for-query'>()
      expectTypeOf<SourceSelectionError['code']>().toEqualTypeOf<SourceSelectionErrorCode>()
      expect(ExportedSourceSelectionError).toBe(SourceSelectionError)
    })

    it('is true for a thrown instance (the instanceof path), with either code', () => {
      let thrown: unknown
      try {
        selectProviders(providers, { modalities: ['image'], sources: ['zzz'], text: 'x' })
      } catch (e) {
        thrown = e
      }
      expect(isSourceSelectionError(thrown)).toBe(true)
      expect(isSourceSelectionError(new SourceSelectionError({ code: 'no-source-for-query', unknown: [], modalities: ['video'] }))).toBe(true)
      // instanceof alone decides for this copy's class: a host subclass that
      // renames itself is still recognised.
      class HostSelectionError extends SourceSelectionError {
        override name = 'HostSelectionError'
      }
      expect(isSourceSelectionError(new HostSelectionError({ code: 'no-matching-source', unknown: [], modalities: ['image'] }))).toBe(true)
    })

    it('is true for a structural clone thrown by another copy of core, and narrows the type', () => {
      const e: unknown = lookAlike()
      expect(e).not.toBeInstanceOf(SourceSelectionError)
      expect(isSourceSelectionError(e)).toBe(true)
      expect(isSourceSelectionError(lookAlike({ code: 'no-source-for-query', requested: undefined, unknown: [] }))).toBe(true)
      // A subclass in the other copy, the shape a real second copy produces.
      class OtherCopySourceSelectionError extends Error {
        override readonly name = 'SourceSelectionError'
        readonly code = 'no-matching-source'
        readonly unknown: string[] = []
        readonly modalities = ['audio']
      }
      expect(isSourceSelectionError(new OtherCopySourceSelectionError('m'))).toBe(true)
      if (isSourceSelectionError(e)) {
        expectTypeOf(e).toEqualTypeOf<SourceSelectionError>()
        expectTypeOf(e.code).toEqualTypeOf<SourceSelectionErrorCode>()
        expect(e.unknown).toEqual(['zzz'])
      }
    })

    it('is false for any other shape', () => {
      expect(isSourceSelectionError(lookAlike({ name: 'Error' }))).toBe(false)
      expect(isSourceSelectionError(lookAlike({ code: 'other' }))).toBe(false)
      expect(isSourceSelectionError(lookAlike({ code: undefined }))).toBe(false)
      expect(isSourceSelectionError(lookAlike({ unknown: undefined }))).toBe(false)
      expect(isSourceSelectionError(lookAlike({ unknown: 'zzz' }))).toBe(false)
      expect(isSourceSelectionError(lookAlike({ modalities: undefined }))).toBe(false)
      expect(isSourceSelectionError(lookAlike({ modalities: 'image' }))).toBe(false)
      expect(isSourceSelectionError({ name: 'SourceSelectionError' })).toBe(false)
      // every field but the message: callers interpolate e.message, so it must be a string
      expect(isSourceSelectionError({ name: 'SourceSelectionError', code: 'no-matching-source', unknown: [], modalities: [] })).toBe(false)
      expect(isSourceSelectionError(new Error('refkit.search: no configured source matches id(s) [zzz] for modalities [image]'))).toBe(false)
      expect(isSourceSelectionError(new AggregateError([], 'all sources failed'))).toBe(false)
      for (const v of [null, undefined, 'SourceSelectionError', 0, true]) expect(isSourceSelectionError(v)).toBe(false)
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
