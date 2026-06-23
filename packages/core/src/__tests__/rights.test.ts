import { describe, expect, it } from 'vitest'
import { rightsRecordSchema, type RightsRecord } from '../rights'

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
    const { raw, ...withoutRaw } = valid
    expect(() => rightsRecordSchema.parse(withoutRaw)).toThrow()
  })
})
