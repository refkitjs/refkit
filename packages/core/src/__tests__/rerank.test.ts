import { describe, expect, it } from 'vitest'
import { tokenize } from '../rerank'

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops stopwords and 1-char tokens', () => {
    expect(tokenize('A Cyberpunk Neon-City at Night!')).toEqual(['cyberpunk', 'neon', 'city', 'night'])
  })

  it('returns [] for empty / stopword-only input', () => {
    expect(tokenize('   the of a   ')).toEqual([])
    expect(tokenize('')).toEqual([])
  })
})
