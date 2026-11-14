import type { DevtoolsModuleConfig } from 'zforge';
export default {
  id: 'parent-module',
  title: 'Parent Module',
  entry: './src/index.ts',
  assets: {
    script: './src/client.js',
  },
  server: {
    allowChildren: true,
    api: './src/api.ts',
  },
} satisfies DevtoolsModuleConfig;
