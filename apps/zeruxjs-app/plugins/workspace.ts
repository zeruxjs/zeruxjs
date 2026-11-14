import { registerFetchRoutes, type ZeruxPluginApi } from 'zeruxjs';
import {
  createWorkspace,
  workspaceUnavailable,
} from '../lib/workspace/application.js';
import { workspaceOptions } from '../lib/workspace/config.js';

/** Register the explicit local workspace profile under this plugin generation.
 * @param {ZeruxPluginApi} api - Generation-owned route, lifecycle and disposal registration contract.
 * @returns {Promise<void>} Registers unavailable routes while disabled; enabled startup acquires one owned application.
 */
export default async function workspace(api: ZeruxPluginApi) {
  if (process.env.WORKSPACE_ENABLED !== 'true') {
    registerFetchRoutes(
      api,
      ['/workspace', '/workspace/login'].map((path) => ({
        path,
        handler: () => workspaceUnavailable(),
      }))
    );
    return;
  }
  /** One generation owns service teardown; imports and disabled registration acquire no workspace resources. */
  const application = await createWorkspace(
    workspaceOptions(api.getStructure().rootDir, process.env)
  );
  api.onDispose(() => application.close());
  application.observeLifecycle(api.lifecycleHooks?.());
  application.install(api);
}
