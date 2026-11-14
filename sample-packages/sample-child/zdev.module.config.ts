import type { DevtoolsModuleConfig } from 'zforge';
export default {
  id: 'child-module',
  title: 'Child Module',
  meta: { parent: 'parent-module' },
  entry: './src/index.ts',
  dependencies: ['parent-module'],
  assets: {
    script: './src/client.js',
  },
  server: {
    api: './src/api.ts',
  },
} satisfies DevtoolsModuleConfig;
