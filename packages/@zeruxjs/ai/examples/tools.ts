import { object, string } from '@zeruxjs/validator';
import { createToolExecutor } from '@zeruxjs/ai/tools';
// Host callbacks verify shared sessions and current tenant permissions, never model fields.
/**
 * Register a tenant-bound read-only lookup with host-owned authentication and authorization.
 * @param {object} options - Trusted callbacks; tool schemas never replace these permission checks.
 * @param {import('@zeruxjs/ai/tools').ToolExecutorOptions['authenticate']} options.authenticate - Verify the initiating host context.
 * @param {Function} options.authorizeLookup - Check current verified principal permission for the record ID.
 * @param {Function} options.loadRecord - Read only within the supplied verified tenant using cancellation.
 * @param {import('@zeruxjs/ai/tools').ToolExecutorOptions['audit']} [options.audit] - Optional redacted best-effort observer.
 * @returns {ReturnType<import('@zeruxjs/ai/tools').createToolExecutor>} Owned executor; close sessions before generation shutdown.
 */
export function configureTools({
  authenticate,
  authorizeLookup,
  loadRecord,
  audit,
}) {
  /** Application-owned explicit tool executor; caller owns session close and generation shutdown. */
  const executor = createToolExecutor({
    authenticate,
    audit,
    maxConcurrent: 4,
    timeoutMs: 3000,
  });
  executor.register('lookup-record', {
    description: 'Read a record in the authenticated tenant',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    schema: object({ id: string() }),
    sideEffect: false,
    authorize: (context, args) => authorizeLookup(context.principal, args.id),
    execute: (args, context) =>
      loadRecord({
        tenant: context.principal.tenant,
        id: args.id,
        signal: context.signal,
      }),
  });
  return executor;
}
// const session=await executor.session(hostVerifiedRequest,requestSignal);
// try { const outcome=await session.execute('lookup-record',{id:'public-id'}); }
// finally {await session.close();} // drain actual handlers, then close executor with generation
