import { describe, expect, it } from 'vitest'
import { buildAttribution } from '../attribution'

describe('buildAttribution', () => {
  it('CC-BY requires attribution and builds a standard credit line', () => {
    const a = buildAttribution({
      license: 'CC-BY',
      licenseVersion: '4.0',
      author: 'Jane Doe',
      title: 'Sunset',
      canonicalUrl: 'https://example.org/photo/1',
    })
    expect(a.required).toBe(true)
    expect(a.text).toBe('"Sunset" by Jane Doe is licensed under CC-BY 4.0. Source: https://example.org/photo/1')
    expect(a.html).toContain('href="https://example.org/photo/1"')
    expect(a.html).toContain('CC-BY 4.0')
  })

  it('CC0 does not require attribution', () => {
    const a = buildAttribution({ license: 'CC0-1.0', canonicalUrl: 'https://example.org/x' })
    expect(a.required).toBe(false)
    expect(a.text).toBeUndefined()
  })

  it('falls back to "Unknown author" when author missing but attribution required', () => {
    const a = buildAttribution({ license: 'CC-BY-SA', title: 'Untitled', canonicalUrl: 'https://example.org/y' })
    expect(a.text).toContain('by Unknown author')
    // no licenseVersion → bare family name, no trailing version
    expect(a.text).toContain('licensed under CC-BY-SA.')
  })
})
