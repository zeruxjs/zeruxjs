import globals from 'globals';
import { createPackageConfig } from '@zeruxjs/lint/presets';

// Repository configuration is trusted executable code. Build the owning preset
// with `npm run lint:prepare`; lint never starts an application or service.
export default [
  {
    name: 'repository/generated-and-private',
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**',
      '**/.git/**', '**/.cache/**', '**/.next/**', '**/.output/**', '.site-build/**',
      '**/.zerux/**', '**/.zyro/**', '**/.workspace/**', '**/.dev-container/**',
      '**/vendor/**', '**/third-party-licenses/**', 'notes/**', 'reports/**',
      '**/*.min.js', '**/public/workspace.js', '**/public/workspace-counter.js',
      'apps/zeruxjs-app/public/workspace-client.js', 'apps/zeruxjs-app/public/counter-client.js',
    ],
  },
  ...createPackageConfig({ environment: 'node' }),
  {
    // Shared packages contain both browser and server entry points. This ambient
    // union is authoring support, not proof that a bundle is browser-safe.
    name: 'repository/browser-and-shared',
    files: [
      'packages/**/src/**/*.{js,mjs,jsx,ts,mts,tsx}',
      'apps/**/client/**/*.{js,mjs,jsx,ts,mts,tsx}',
      'apps/**/public/**/*.{js,mjs}',
      '**/*.client.{js,mjs,jsx,ts,mts,tsx}',
      'apps/zyro-single/src/**/*.js', 'packages/zforge/assets/**/*.js',
      'sample-packages/*/src/client.js', 'pages/app.js', 'scripts/site-theme.mjs',
      'packages/**/test/*browser.test.mjs', 'packages/**/test/*-dom.test.mjs',
    ],
    languageOptions: { globals: globals.browser },
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
