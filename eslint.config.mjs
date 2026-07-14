// Deliberately lean: typescript-eslint's syntactic recommended set (no
// type-checked rules — they'd re-do tsc's job slowly in CI). tsc --noEmit
// remains the type gate; lint catches the bug-shaped patterns tsc allows.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // `catch { /* fall through */ }` and `_`-prefixed placeholders are idioms here.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // Providers cast `q.providerOptions as XSearchOptions` by design (typed whitelists).
      '@typescript-eslint/consistent-type-assertions': 'off',
      // zod schemas + Reference contracts legitimately use interface & type interchangeably.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts'],
    rules: {
      // tests stub partial shapes and poke internals
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
