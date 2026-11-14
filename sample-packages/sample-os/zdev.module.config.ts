import type { DevtoolsModuleConfig } from 'zforge';
export default {
  id: 'sample-os',
  title: 'Sample OS',
  version: '1.0.0',
  description: 'Example external devtools package',
  entry: './index.ts',
  assets: {
    style: './assets/style.css',
    script: './assets/client.js',
  },
  server: {
    api: './server/api.ts',
  },
} satisfies DevtoolsModuleConfig;
