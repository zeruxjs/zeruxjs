import * as transports from 'zhost/protocols';
import { createExperimentEvaluator } from 'ztrial/experiments';
import { createDevtoolsModuleHost } from 'zforge/modules';
import { createExperimentInspectionModule } from 'zforge/experiments';

// No listener starts on import. All policies and identity bindings are server-owned.
/** Explicitly mount development inspection with real shared evaluation and host policies.
 * @param {object} options - Trusted application-owned inspection configuration.
 * @param {string} options.mode - Development is required; production rejects.
 * @param {object} options.catalog - Shared deterministic experiment catalog.
 * @param {string} options.tenant - Verified host tenant scope.
 * @param {Uint8Array} options.tenantSalt - Private host salt kept out of public outputs.
 * @param {Function} options.resolveContext - Host-verified evaluation subject/consent resolver.
 * @param {Function} options.authenticate - Actual native-request authentication returning an expiring principal.
 * @param {Function} options.authorize - Fresh per-action operator policy.
 * @param {Function} options.verifyCsrf - Real session-bound CSRF policy for preview/test writes.
 * @param {Function} options.audit - Required private identifier-only audit sink.
 * @returns {Promise<object>} Actual endpoint addresses and close owner; no production assignments are changed.
 */
export async function startExperimentInspection({
  mode,
  catalog,
  tenant,
  tenantSalt,
  resolveContext,
  authenticate,
  authorize,
  verifyCsrf,
  audit,
}) {
  /** Inert development-only module definition; policies and evaluation identity remain host-owned. */
  const definition = createExperimentInspectionModule({
    mode,
    createEvaluator: createExperimentEvaluator,
    evaluation: { catalog, tenant, tenantSalt, resolveContext },
    endpoint: {
      allowedOrigins: ['http://localhost:3000'],
      limits: { maxMessageBytes: 4096, maxConcurrent: 4, timeoutMs: 3000 },
    },
    authorize,
    verifyCsrf,
    audit,
    tests: {
      smoke: async (context) => {
        context.signal.throwIfAborted();
        return true;
      },
    },
  });
  /** Scoped endpoint owner using explicitly supplied actual-request authentication. */
  const host = createDevtoolsModuleHost({
    appId: 'example',
    generationId: 'generation-one',
    transports,
    authorize: authenticate,
  });
  try {
    /** Loaded experiment generation whose returned endpoints expose actual native addresses. */
    const module = await host.load(definition);
    return { endpoints: module.endpoints(), close: () => host.close() };
  } catch (error) {
    await host.close();
    throw error;
  }
}
