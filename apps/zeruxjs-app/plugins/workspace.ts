import { registerFetchRoutes, type ZeruxPluginApi } from 'zeruxjs';
import { createWorkspace, workspaceUnavailable } from '../lib/workspace/application.js';
import { workspaceOptions } from '../lib/workspace/config.js';

export default async function workspace(api: ZeruxPluginApi) {
  if (process.env.WORKSPACE_ENABLED !== 'true') {
    registerFetchRoutes(api, ['/workspace', '/workspace/login'].map(path => ({
      path, handler: () => workspaceUnavailable()
    })));
    return;
  }
  const application = await createWorkspace(workspaceOptions(api.getStructure().rootDir, process.env));
  api.onDispose(() => application.close());
  application.observeLifecycle(api.lifecycleHooks?.());
  application.install(api);
}
