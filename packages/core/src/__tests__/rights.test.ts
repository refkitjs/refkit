import { describe, expect, it } from 'vitest'
import { factsOf, rightsRecordSchema, type RightsRecord } from '../rights'

const valid: RightsRecord = {
  license: 'CC-BY',
  licenseVersion: '4.0',
  author: 'Jane Doe',
  rehostPolicy: 'cache-allowed',
  raw: { sourceTerms: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://example.org/photo/1' },
}

describe('rightsRecordSchema', () => {
  it('accepts a well-formed record', () => {
    expect(rightsRecordSchema.parse(valid)).toEqual(valid)
  })

  it('rejects an unknown rehostPolicy', () => {
    expect(() => rightsRecordSchema.parse({ ...valid, rehostPolicy: 'whatever' })).toThrow()
  })

  it('requires the auditable raw anchor', () => {
    const { raw: _raw, ...withoutRaw } = valid
    expect(() => rightsRecordSchema.parse(withoutRaw)).toThrow()
  })

  it('accepts the NC/ND family ids with a licenseVersion', () => {
    const r = rightsRecordSchema.parse({
      license: 'CC-BY-NC-ND',
      licenseVersion: '3.0',
      rehostPolicy: 'cache-allowed',
      raw: { sourceTerms: 't', sourceUrl: 'u' },
    })
    expect(r.license).toBe('CC-BY-NC-ND')
  })
})

describe('RightsRecord facts', () => {
  const base = { rehostPolicy: 'cache-allowed', raw: { sourceTerms: 't', sourceUrl: 'u' } } as const

  it('accepts a custom license id when facts are supplied', () => {
    const r = rightsRecordSchema.parse({ ...base, license: 'acme-stock', facts: { commercialUse: true, derivatives: false, redistribution: false, attributionRequired: true, shareAlike: false } })
    expect(factsOf(r).derivatives).toBe(false)
  })

  it('a custom id without facts resolves to the unknown row', () => {
    const r = rightsRecordSchema.parse({ ...base, license: 'acme-stock' })
    expect(factsOf(r).commercialUse).toBe('unknown')
  })

  it('facts override the table for a known id', () => {
    const r = rightsRecordSchema.parse({ ...base, license: 'CC-BY', facts: { commercialUse: false, derivatives: true, redistribution: true, attributionRequired: true, shareAlike: false } })
    expect(factsOf(r).commercialUse).toBe(false)
  })

  it('rejects licenseVersion on a non-CC-family license', () => {
    expect(() => rightsRecordSchema.parse({ ...base, license: 'unsplash', licenseVersion: '4.0' })).toThrow()
    expect(() => rightsRecordSchema.parse({ ...base, license: 'CC-BY', licenseVersion: '4.0' })).not.toThrow()
  })
})
