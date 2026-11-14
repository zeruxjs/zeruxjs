import * as transports from 'zhost/protocols';
import {
  createDevtoolsModuleHost,
  defineTransportDevtoolsModule,
} from 'zforge/modules';
import { createRequestDiagnostics } from 'zforge/diagnostics';
import { normalizeApiError } from 'zeruxjs';

// Called explicitly by the host. verifySession must authenticate the actual request;
// a loopback address or a forwarded identity header is not authentication.
/** Explicitly start one authorized diagnostics module and return its combined cleanup owner.
 * @param {Function} verifySession - Host callback verifying the actual request and returning an expiring operator principal or null.
 * @returns {Promise<object>} Tracing adapter, actual bound endpoints and awaited close; importing this file starts nothing.
 */
export async function startDiagnostics(verifySession) {
  /** Scoped bounded diagnostic record owner closed independently from native module listeners. */
  const diagnostics = createRequestDiagnostics({
    applications: ['example'],
    routes: ['home'],
    normalizeApiError,
  });
  /** Generation-pinned adapter passed explicitly to the framework observability owner. */
  const tracing = diagnostics.adapter('example', 'generation-one');
  /** Scoped native module owner requiring host-authenticated sessions for every endpoint. */
  const host = createDevtoolsModuleHost({
    appId: 'example',
    generationId: 'generation-one',
    transports,
    authorize: async (request, context) => verifySession(request, context),
  });
  try {
    /** Loaded generation-fenced SSE module; callers use returned actual endpoints rather than guessing URLs. */
    const module = await host.load(
      defineTransportDevtoolsModule({
        id: 'requests',
        title: 'Requests',
        endpoints: [
          {
            id: 'updates',
            kind: 'sse',
            allowedOrigins: ['http://localhost:3000'],
            limits: {
              maxMessageBytes: 4096,
              maxConcurrent: 4,
              timeoutMs: 30000,
            },
            backlog: 4,
            publicFields: ['count'],
          },
        ],
      })
    );
    module.publish('updates', { count: 0 });
    // Pass tracing to the framework generation's observability.adapter (or a fresh createAdapter).
    // The endpoint address/path is returned by module.endpoints(); never guess it.
    return {
      tracing,
      endpoints: module.endpoints(),
      /** Drain native module work before clearing the independent diagnostics store.
       * @returns {Promise<void>} Both explicit example owners are released; borrowed framework resources remain host-owned.
       */
      async close() {
        await host.close();
        diagnostics.close();
      },
    };
  } catch (error) {
    await host.close();
    diagnostics.close();
    throw error;
  }
}
