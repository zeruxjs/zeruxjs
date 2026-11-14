import type { DevtoolsModuleConfig } from 'zforge';
export default {
  id: 'sample-module',
  title: 'Sample Module',
  description: 'Example external devtools package',
  entry: './index.ts',
  assets: {
    style: './assets/style.css',
    script: './assets/client.js',
  },
  server: {
    api: './server/api.ts',
    websocket: './server/websocket.ts',
  },
} satisfies DevtoolsModuleConfig;
