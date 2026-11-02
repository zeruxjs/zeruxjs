import * as transports from 'zhost/protocols';
import {createExperimentEvaluator} from 'ztrial/experiments';
import {createDevtoolsModuleHost} from 'zforge/modules';
import {createExperimentInspectionModule} from 'zforge/experiments';

// No listener starts on import. All policies and identity bindings are server-owned.
export async function startExperimentInspection({mode, catalog, tenant, tenantSalt,
  resolveContext, authenticate, authorize, verifyCsrf, audit}) {
  const definition = createExperimentInspectionModule({
    mode, createEvaluator: createExperimentEvaluator,
    evaluation: {catalog, tenant, tenantSalt, resolveContext},
    endpoint: {allowedOrigins: ['http://localhost:3000'],
      limits: {maxMessageBytes: 4096, maxConcurrent: 4, timeoutMs: 3000}},
    authorize, verifyCsrf, audit,
    tests: {smoke: async context => {context.signal.throwIfAborted(); return true;}},
  });
  const host = createDevtoolsModuleHost({appId: 'example', generationId: 'generation-one',
    transports, authorize: authenticate});
  try {
    const module = await host.load(definition);
    return {endpoints: module.endpoints(), close: () => host.close()};
  } catch (error) {await host.close(); throw error;}
}
