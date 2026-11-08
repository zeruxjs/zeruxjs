import globals from 'globals';
import { createPackageConfig } from '@zeruxjs/lint/presets';

// Repository configuration is trusted executable code. Build the owning preset
// with `npm run lint:prepare`; lint never starts an application or service.
export default [
  {
    name: 'repository/generated-and-private',
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**',
      '**/.git/**', '**/.cache/**', '**/.next/**', '**/.output/**',
      '**/.zerux/**', '**/.zyro/**', '**/.workspace/**', '**/.dev-container/**',
      '**/vendor/**', '**/third-party-licenses/**', 'notes/**', 'reports/**',
      '**/*.min.js', '**/public/workspace.js', '**/public/workspace-counter.js',
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
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    name: 'repository/commonjs',
    files: ['**/*.{cjs,cts}'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
