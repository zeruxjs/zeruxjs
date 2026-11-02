import { createRequestHookScope, type ServerLifecycleHooks, type RequestHookContext, type AfterRequestHookContext } from '@zeruxjs/hooks';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestCorrelation } from '../observability.js';
import { normalizeApiError } from '../exceptions/api-error.js';

type Control = { context: RequestHookContext; route(pattern: string | null): void; error(kind: 'handler' | 'disconnect' | 'hook'): void };
const requests = new WeakMap<IncomingMessage, Control>();
export const getServerRequestLifecycle = (req: IncomingMessage) => requests.get(req);
/** Generation owns this bridge; response termination, not handler promise completion, owns scope disposal. */
export function createServerLifecycleBridge(generationId: string, hooks: ServerLifecycleHooks | undefined, report: (error: unknown) => void) {
  const active = new Set<() => void>(); let closed = false;
  return {
    close() { closed = true; for (const close of [...active]) close(); },
    wrap(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
      return async (req: IncomingMessage, res: ServerResponse) => {
        if (closed) { if (!res.headersSent) res.statusCode = 503; res.end(); return; }
        const scope = createRequestHookScope(), controller = new AbortController(), callbacks: (() => unknown)[] = [];
        const context: RequestHookContext = Object.freeze({ generationId, requestId: getRequestCorrelation()?.requestId ?? randomBytes(16).toString('hex'), method: /^[A-Z]{1,16}$/.test(req.method ?? '') ? req.method! : 'OTHER', signal: controller.signal });
        let finished = false, routed = false, errored = false, committed = false;
        const control: Control = {
          context,
          route(pattern) { if (routed || finished) return; routed = true; hooks?.dispatch('route:resolved', Object.freeze({ ...context, pattern })); },
          error(kind) { if (errored || finished) return; try { control.route(null); } catch (error) { report(error); } errored = true; try { hooks?.dispatch('request:error', Object.freeze({ ...context, kind })); } catch (error) { report(error); } }
        };
        requests.set(req, control);
        const originalWriteHead = res.writeHead;
        res.writeHead = function (this: ServerResponse, ...args: any[]) {
          if (!committed && !finished) {
            committed = true; let mutable = true; const headers = new Map<string, string>();
            const check = () => { if (!mutable || finished || res.headersSent) throw new Error('Response hook mutation phase ended'); };
            try {
              scope.run(() => control.route(null));
              scope.run(() => hooks?.dispatch('response:before', Object.freeze({ ...context, response: Object.freeze({
                setStatus(status: number) { check(); if (!Number.isSafeInteger(status) || status < 200 || status > 599) throw new TypeError('Invalid lifecycle response status'); args[0] = status; res.statusCode = status; },
                setHeader(name: string, value: string) { check(); if (typeof name !== 'string' || !/^[a-zA-Z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(name) || ['connection','transfer-encoding','content-length','upgrade','trailer'].includes(name.toLowerCase()) || typeof value !== 'string' || value.length > 8192 || Buffer.byteLength(value) > 8192 || /[^\x20-\x7e\x80-\xff]/.test(value)) throw new TypeError('Invalid lifecycle response header'); headers.set(name.toLowerCase(), value); if (headers.size > 32) throw new RangeError('Lifecycle response header limit'); }
              }) })));
              const index = typeof args[1] === 'string' ? 2 : 1;
              if (args[index] && headers.size) {
                if (Array.isArray(args[index])) {
                  const original = args[index] as string[], next: string[] = [];
                  for (let i = 0; i < original.length; i += 2) if (!headers.has(original[i].toLowerCase())) next.push(original[i], original[i + 1]);
                  for (const [name, value] of headers) next.push(name, value); args[index] = next;
                } else {
                  const next = { ...args[index] }; for (const name of Object.keys(next)) if (headers.has(name.toLowerCase())) delete next[name];
                  for (const [name, value] of headers) next[name] = value; args[index] = next;
                }
              } else for (const [name, value] of headers) res.setHeader(name, value);
            } catch (error) { control.error('hook'); throw error; }
            finally { mutable = false; }
          }
          return Reflect.apply(originalWriteHead, this, args);
        } as ServerResponse['writeHead'];
        const finish = () => {
          if (finished) return;
          // Complete outstanding phases before invalidating the request context, exactly once.
          try { scope.run(() => {
            try { control.route(null); } catch (error) { report(error); }
            if (!res.writableFinished) control.error('disconnect');
            finished = true; controller.abort();
            const result: AfterRequestHookContext = Object.freeze({ ...context, status: res.writableFinished ? res.statusCode : 499, outcome: res.writableFinished ? 'completed' : 'disconnected' });
            for (const phase of ['response:after', 'request:after'] as const) try { hooks?.dispatch(phase, result); } catch (error) { report(error); }
          }); } finally {
            finished = true; controller.abort(); requests.delete(req); active.delete(shutdown);
            req.off('aborted', finish); res.off('finish', finish); res.off('close', finish); res.writeHead = originalWriteHead;
            try { scope.dispose(); } catch (error) { report(error); }
            for (const cleanup of callbacks.reverse()) try {
              const result = cleanup(); if (result && typeof (result as any).then === 'function') { void Promise.resolve(result).catch(report); report(new Error('Request cleanup must be synchronous')); }
            } catch (error) { report(error); }
            callbacks.length = 0;
          }
        };
        const shutdown = () => { if (!res.destroyed && !res.writableFinished) res.destroy(); finish(); };
        active.add(shutdown); req.once('aborted', finish); res.once('finish', finish); res.once('close', finish);
        try {
          await scope.run(async () => {
            hooks?.dispatch('request:before', Object.freeze({ ...context, onDispose(cleanup: () => void) {
              if (finished || typeof cleanup !== 'function' || callbacks.length >= 128 || cleanup.constructor.name === 'AsyncFunction') throw new Error('Invalid request disposer'); callbacks.push(cleanup);
            } }));
            if (req.aborted || res.destroyed) { finish(); return; }
            await handler(req, res);
          });
        } catch (error) {
          if (finished) { report(error); return; }
          scope.run(() => control.error('hook')); report(error);
          if (!res.destroyed && !res.writableEnded) {
            if (res.headersSent) res.destroy();
            else { const normalized = normalizeApiError(error); res.statusCode = normalized.status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(normalized.body)); }
          }
          if (res.destroyed) finish();
        }
      };
    }
  };
}
