import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Release checks cover correctness. Existing unused bindings remain visible as
// warnings; the TypeScript compiler handles undefined names in typed sources.
export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/sample*/**'] },
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser }
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'warn' }
  },
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      '@typescript-eslint/no-unused-vars': 'warn'
    }
  }
];
