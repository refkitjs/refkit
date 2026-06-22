import { describe, expect, it } from 'vitest'
import type { ProviderContext } from '@refkit/core'
import { poetrydb } from '../index'

const FIXTURE = [
  {
    title: 'Ozymandias', author: 'Percy Bysshe Shelley',
    lines: [
      'I met a traveller from an antique land',
      'Who said: Two vast and trunkless legs of stone',
      'Stand in the desert...Near them, on the sand,',
      'Half sunk, a shattered visage lies, whose frown,',
      'And wrinkled lip, and sneer of cold command,',
      'Tell that its sculptor well those passions read',
      'Which yet survive, stamped on these lifeless things,',
      'The hand that mocked them, and the heart that fed:',
      'And on the pedestal these words appear:',
      "'My name is Ozymandias, king of kings:'",
    ],
    linecount: '14',
  },
]
const ctxWith = (body: unknown): ProviderContext => ({ fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })

describe('poetrydb provider', () => {
  it('maps a poem to a full-text passage Reference (PD inferred)', async () => {
    const refs = await poetrydb().search({ text: 'Ozymandias', modalities: ['text'] }, ctxWith(FIXTURE))
    expect(refs).toHaveLength(1)
    const r = refs[0]
    expect(r.modality).toBe('text')
    expect(r.rights.license).toBe('PD')
    expect(r.title).toBe('Ozymandias')
    expect(r.rights.author).toBe('Percy Bysshe Shelley')
    expect(r.id).toMatch(/^poetrydb:/)
    expect(r.text?.excerptKind).toBe('passage')
    expect(r.text?.excerpt.split('\n').length).toBe(8) // first 8 lines
    expect(r.text?.excerpt).toContain('I met a traveller')
    expect(r.canonicalUrl).toContain('poetrydb.org')
  })

  it('returns [] on a no-match {status:404} response (bare-array contract)', async () => {
    const refs = await poetrydb().search({ text: 'zzzznomatch', modalities: ['text'] }, ctxWith({ status: 404, reason: 'Not found' }))
    expect(refs).toEqual([])
  })
})
