import * as transports from 'zhost/protocols';
import { createDevtoolsModuleHost, defineTransportDevtoolsModule } from 'zforge/modules';
import { createRequestDiagnostics } from 'zforge/diagnostics';
import { normalizeApiError } from 'zeruxjs';

// Called explicitly by the host. verifySession must authenticate the actual request;
// a loopback address or a forwarded identity header is not authentication.
export async function startDiagnostics(verifySession) {
  const diagnostics = createRequestDiagnostics({
    applications: ['example'], routes: ['home'], normalizeApiError,
  });
  const tracing = diagnostics.adapter('example', 'generation-one');
  const host = createDevtoolsModuleHost({
    appId: 'example', generationId: 'generation-one', transports,
    authorize: async (request, context) => verifySession(request, context),
  });
  try {
    const module = await host.load(defineTransportDevtoolsModule({
      id: 'requests', title: 'Requests',
      endpoints: [{
        id: 'updates', kind: 'sse', allowedOrigins: ['http://localhost:3000'],
        limits: { maxMessageBytes: 4096, maxConcurrent: 4, timeoutMs: 30000 },
        backlog: 4, publicFields: ['count'],
      }],
    }));
    module.publish('updates', { count: 0 });
    // Pass tracing to the framework generation's observability.adapter (or a fresh createAdapter).
    // The endpoint address/path is returned by module.endpoints(); never guess it.
    return { tracing, endpoints: module.endpoints(), async close() {
      await host.close(); diagnostics.close();
    } };
  } catch (error) {
    await host.close(); diagnostics.close(); throw error;
  }
}
