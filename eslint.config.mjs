import { readFileSync } from 'node:fs';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import { createPackageConfig } from '@zeruxjs/lint/presets';

// Repository configuration is trusted executable code. Build the owning preset
// with `npm run lint:prepare`; lint never starts an application or service.
// Migration is explicit: security rules remain global; readability errors
// become mandatory only after a scope has been reviewed in notes/sprint.md.
const {
  completed,
  deferred = [],
  repositoryCompleted = [],
} = JSON.parse(
  readFileSync(new URL('./quality-scopes.json', import.meta.url), 'utf8')
);

export default [
  {
    name: 'repository/generated-and-private',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.git/**',
      '**/.cache/**',
      '**/.next/**',
      '**/.output/**',
      '.site-build/**',
      '**/.zerux/**',
      '**/.zyro/**',
      '**/.workspace/**',
      '**/.dev-container/**',
      '**/vendor/**',
      '**/third-party-licenses/**',
      'notes/**',
      'reports/**',
      '**/*.min.js',
      '**/public/workspace.js',
      '**/public/workspace-counter.js',
      'apps/zeruxjs-app/public/workspace-client.js',
      'apps/zeruxjs-app/public/counter-client.js',
      // Historical generated bundle; authored counters now use client/counter.ts and the installed runtime.
      'apps/zeruxjs-app/public/src/zyro.js',
      'apps/zyro-single/src/zyro.js',
    ],
  },
  ...([...completed, ...repositoryCompleted].length
    ? [
        {
          name: 'repository/reviewed-readability',
          files: [...completed, ...repositoryCompleted].map(
            (scope) => `${scope}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}`
          ),
          ignores: deferred.map((scope) => `${scope}/**`),
          plugins: { jsdoc },
          settings: { jsdoc: { mode: 'typescript' } },
          rules: {
            'jsdoc/require-jsdoc': [
              'error',
              {
                enableFixer: false,
                contexts: [
                  'VariableDeclaration[kind="const"]:not(ForOfStatement > VariableDeclaration):not(ForInStatement > VariableDeclaration):not(ExportNamedDeclaration > VariableDeclaration)',
                  'ExportNamedDeclaration[declaration.type="VariableDeclaration"][declaration.kind="const"]',
                  'TSInterfaceBody > TSPropertySignature',
                ],
                require: {
                  FunctionDeclaration: true,
                  ClassDeclaration: true,
                  MethodDefinition: true,
                },
              },
            ],
            'jsdoc/require-param': 'error',
            'jsdoc/check-param-names': 'error',
            'jsdoc/require-param-description': 'error',
            'jsdoc/require-param-type': 'error',
            'jsdoc/require-returns': [
              'error',
              { forceRequireReturn: true, enableFixer: false },
            ],
            'jsdoc/require-returns-description': 'error',
            'jsdoc/require-returns-type': 'error',
            'jsdoc/require-description': ['error', { contexts: ['any'] }],
            'jsdoc/check-types': 'error',
            'jsdoc/check-tag-names': 'error',
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-sequences': 'error',
            'no-labels': 'error',
            'no-with': 'error',
            'no-proto': 'error',
            'no-iterator': 'error',
            'no-extend-native': 'error',
            'no-new-wrappers': 'error',
            radix: ['error', 'always'],
            complexity: ['warn', 25],
            'max-depth': ['warn', 4],
            curly: ['error', 'all'],
            'max-statements-per-line': ['error', { max: 1 }],
            'no-nested-ternary': 'error',
          },
        },
      ]
    : []),
  ...createPackageConfig({ environment: 'node' }),
  {
    // Shared packages contain both browser and server entry points. This ambient
    // union is authoring support, not proof that a bundle is browser-safe.
    name: 'repository/browser-and-shared',
    files: [
      'packages/**/src/**/*.{js,mjs,jsx,ts,mts,tsx}',
      'apps/**/client/**/*.{js,mjs,jsx,ts,mts,tsx}',
      'apps/**/src/browser/**/*.{js,mjs,ts,tsx}',
      'apps/**/public/**/*.{js,mjs}',
      '**/*.client.{js,mjs,jsx,ts,mts,tsx}',
      'apps/zyro-single/src/**/*.{js,ts}',
      'packages/zforge/assets/**/*.js',
      'sample-packages/*/src/client.js',
      'pages/app.ts',
      'scripts/site-theme.ts',
      'packages/**/test/*browser.test.ts',
      'packages/**/test/*-dom.test.ts',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    // Migrated CommonJS-compatible tests retain require-based fixture loading so
    // Node's native TypeScript stripping does not transpile module semantics.
    name: 'repository/typescript-test-interop',
    files: ['packages/**/test/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    name: 'repository/generator-template',
    files: ['packages/create/create-zyro-app/assets/build.mjs'],
    languageOptions: { globals: { __MODE_JSON__: 'readonly' } },
  },
  {
    name: 'repository/commonjs',
    files: ['**/*.{cjs,cts}', 'scripts/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
