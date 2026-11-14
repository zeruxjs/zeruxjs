import { ApplicationError } from './exceptions/api-error.js';
import {
  stream,
  validateResponseHeaders,
  type StreamResult,
} from './response.js';
export type RendererFeature =
  | 'staticHtml'
  | 'streaming'
  | 'hydration'
  | 'clientOnly';
export interface RendererCapabilities {
  /** Whether the adapter implements a complete static HTML result. */
  staticHtml: boolean;
  /** Whether the adapter implements the explicit owned stream result protocol. */
  streaming: boolean;
  /** Client protocol flag currently rejected by this registry. */
  hydration: boolean;
  /** Client-only protocol flag currently rejected by this registry. */
  clientOnly: boolean;
}
export interface RendererContext {
  /** Opaque request correlation ID, not a principal identifier. */
  readonly requestId: string;
  /** Request path used for renderer context; not an authorization decision. */
  readonly pathname: string;
  /** Explicit supported rendering mode for this dispatch. */
  readonly feature: RendererFeature;
  /** Cooperative request/render cancellation signal. */
  readonly signal: AbortSignal;
  /** Request-local map cleared after actual render cleanup. */
  readonly locals: Map<unknown, unknown>;
  /** Attach owned cleanup to this request render lease.
   * @param {Function} cleanup - Disposer returning actual asynchronous settlement.
   * @returns {void} Cleanup registration completion.
   */
  onDispose(cleanup: () => void | Promise<void>): void;
}
export interface RendererRequest {
  /** Opaque request correlation ID, not a principal identifier. */
  requestId: string;
  /** Request path used for renderer context; not an authorization decision. */
  pathname: string;
  /** Cooperative request/render cancellation signal. */
  signal: AbortSignal;
}
export type AdapterRenderResult =
  | {
      /** Explicit HTML or stream result discriminator. */
      kind: 'html'; /** Trusted renderer output subject to registry byte limits. */
      html: string; /** Validated end-to-end response headers; private view data must not become headers. */
      headers?: Record<string, string>;
    }
  | {
      /** Explicit HTML or stream result discriminator. */
      kind: 'stream';
      /** Owned asynchronous chunk producer consumed by the response sender. */
      source: AsyncIterable<string | Uint8Array>;
      /** Validated end-to-end response headers; private view data must not become headers. */
      headers?: Record<string, string>;
    };
export interface RendererAdapter<V = unknown> {
  /** Stable authored adapter name, unique within its generation. */
  name: string;
  /** Captured declared adapter capabilities, validated at registration. */
  capabilities: RendererCapabilities;
  /** Render a validated view under explicit request ownership.
   * @param {V} view - Renderer-specific validated view.
   * @param {RendererContext} context - Borrowed cancellation and cleanup authority.
   * @returns {AdapterRenderResult | Promise<AdapterRenderResult>} Explicit HTML or owned stream result.
   */
  render(
    view: V,
    context: RendererContext
  ): AdapterRenderResult | Promise<AdapterRenderResult>;
  /** Release adapter-owned resources after all render leases settle.
   * @returns {void | Promise<void>} Actual adapter cleanup settlement.
   */
  dispose?(): void | Promise<void>;
}
/** Private discriminator for registry-validated HTML results. */
const htmlMarker = Symbol('zerux.renderer.html');
export interface RenderedHtml {
  /** Internal brand applied only after registry result validation. */
  readonly [htmlMarker]: true;
  /** Trusted renderer output subject to registry byte limits. */
  readonly html: string;
  /** Validated end-to-end response headers; private view data must not become headers. */
  readonly headers?: Readonly<Record<string, string>>;
}
export type RendererResult = RenderedHtml | StreamResult;
/** Safe public renderer classification with private build/request causes retained internally. */
export class RendererError extends ApplicationError {
  /** Retain private renderer failure evidence under a safe application error classification.
   * @param {string} code - Fixed renderer error classification.
   * @param {unknown} cause - Optional private internal cause.
   * @param {Readonly<{ renderer: string; feature: string }>} details - Optional fixed renderer/feature labels; never user view data.
   */
  constructor(
    readonly code: string,
    cause?: unknown,
    readonly details?: Readonly<{
      renderer: string; /** Explicit supported rendering mode for this dispatch. */
      feature: string;
    }>
  ) {
    super(500, cause);
    this.name = 'RendererError';
  }
}
export interface RendererRegistration<V> {
  /** Stable authored adapter name, unique within its generation. */
  readonly name: string;
  /** Remove this registration only before the first dispatch.
   * @returns {Promise<void>} Captured adapter cleanup settlement.
   */
  dispose(): Promise<void>;
  /** Type-only registration parameter preserving renderer/view compatibility. */
  readonly viewType?: V;
}
/** Recognize only registry-marked HTML results, not arbitrary handler objects.
 * @param {unknown} value - Candidate handler result.
 * @returns {boolean} Whether the private HTML marker is present.
 */
export const isRenderedHtml = (value: unknown): value is RenderedHtml =>
  !!value && typeof value === 'object' && htmlMarker in value;
/** Injected server renderers are static HTML only. No browser runtime is registered implicitly. */
export const rendererCapabilityMatrix = Object.freeze({
  zyro: Object.freeze({
    staticHtml: true,
    streaming: false,
    hydration: false,
    clientOnly: false,
  }),
  react: Object.freeze({
    staticHtml: true,
    streaming: false,
    hydration: false,
    clientOnly: false,
  }),
  vue: Object.freeze({
    staticHtml: true,
    streaming: false,
    hydration: false,
    clientOnly: false,
  }),
  'zyro-document': Object.freeze({
    staticHtml: true,
    streaming: true,
    hydration: false,
    clientOnly: false,
  }),
});
/** Wrap one explicit trusted string renderer with static-only capabilities and cancellation fences.
 * @param {keyof typeof rendererCapabilityMatrix} name - Authored renderer matrix name.
 * @param {(view: V) => string | Promise<string>} renderToString - Injected renderer implementation; no optional runtime is imported.
 * @returns {RendererAdapter<V>} Static-only adapter ready for explicit registration.
 */
function staticAdapter<V>(
  name: keyof typeof rendererCapabilityMatrix,
  renderToString: (view: V) => string | Promise<string>
): RendererAdapter<V> {
  if (typeof renderToString !== 'function') {
    throw new RendererError('RENDERER_DEPENDENCY_REQUIRED');
  }
  return {
    name,
    capabilities: { ...rendererCapabilityMatrix[name] },
    /** Run the injected static renderer with cancellation checks around actual settlement.
     * @param {V} view - Renderer-specific validated view.
     * @param {RendererContext} context - Borrowed render request context.
     * @returns {Promise<AdapterRenderResult>} Static HTML result.
     */
    async render(view, context) {
      context.signal.throwIfAborted();
      /** Renderer-produced HTML checked after actual adapter settlement and cancellation. */
      const html = await renderToString(view);
      context.signal.throwIfAborted();
      return { kind: 'html', html };
    },
  };
}
/** Wrap an explicitly injected Zyro string renderer without importing a UI runtime.
 * @param {Function} renderToString - Trusted static rendering callback.
 * @returns {RendererAdapter<V>} Static-only adapter; generation registration owns lifecycle.
 */
export const createZyroRenderer = <V>(
  renderToString: (view: V) => string | Promise<string>
) => staticAdapter('zyro', renderToString);
/** Wrap an explicitly injected React string renderer without importing React.
 * @param {Function} renderToString - Trusted static rendering callback.
 * @returns {RendererAdapter<V>} Static-only adapter; no implicit client protocol.
 */
export const createReactRenderer = <V>(
  renderToString: (view: V) => string | Promise<string>
) => staticAdapter('react', renderToString);
/** Wrap an explicitly injected Vue string renderer without importing Vue.
 * @param {Function} renderToString - Trusted static rendering callback.
 * @returns {RendererAdapter<V>} Static-only adapter; no implicit client protocol.
 */
export const createVueRenderer = <V>(
  renderToString: (view: V) => string | Promise<string>
) => staticAdapter('vue', renderToString);
/** Create the sole generation-owned renderer registration authority with bounded render leases.
 * @param {object} options - Optional byte, active-work and deadline ceilings.
 * @param {number} options.maxBytes - Optional representation byte ceiling.
 * @param {number} options.maxActive - Optional unsettled render ceiling.
 * @param {number} options.timeoutMs - Optional cooperative render deadline.
 * @returns {object} Owned registry; close drains actual work before adapter cleanup.
 */
export function createRendererRegistry(
  options: {
    /** Maximum representation bytes for HTML or stream sending. */
    maxBytes?: number; /** Maximum unsettled render leases retained at once. */
    maxActive?: number; /** Cooperative render deadline, not forced JavaScript cancellation. */
    timeoutMs?: number;
  } = {}
) {
  /** Validated maximum HTML/stream representation bytes. */
  const maxBytes = options.maxBytes ?? 1048576;
  /** Validated maximum unsettled render leases. */
  const maxActive = options.maxActive ?? 32;
  /** Validated cooperative rendering deadline in milliseconds. */
  const timeout = options.timeoutMs ?? 30000;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 16777216 ||
    !Number.isSafeInteger(maxActive) ||
    maxActive < 1 ||
    maxActive > 1024 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000
  ) {
    throw new RendererError('RENDERER_LIMIT_INVALID');
  }
  type Entry = {
    /** Captured trusted adapter with bound callbacks. */
    adapter: RendererAdapter<any>;
    /** Registry-local dispatch authority checked by identity. */
    token: RendererRegistration<any>;
  };
  /** Bounded retained cleanup failures reported again at registry close. */
  const failures: unknown[] = [];
  /** Generation-local adapter/token identities; foreign tokens never dispatch. */
  const entries = new Map<string, Entry>();
  /** Render leases retained through actual adapter, iterator and cleanup settlement. */
  const active = new Set<{
    cancel(): void; /** Actual render lease cleanup completion. */
    done: Promise<void>;
  }>();
  let sealed = false,
    closed = false,
    closing: Promise<void> | undefined;
  return {
    /** Capture an explicitly trusted adapter before the first dispatch; reject unsupported client protocol claims.
     * @param {RendererAdapter<V>} adapter - Host-authored adapter and declared capabilities.
     * @returns {RendererRegistration<V>} Registry-local immutable dispatch token.
     */
    register<V>(adapter: RendererAdapter<V>): RendererRegistration<V> {
      if (sealed || closed) {
        throw new RendererError('RENDERER_REGISTRATION_CLOSED');
      }
      if (
        !adapter ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(adapter.name) ||
        typeof adapter.render !== 'function' ||
        (adapter.dispose !== undefined &&
          typeof adapter.dispose !== 'function') ||
        !adapter.capabilities ||
        Object.keys(adapter.capabilities).some(
          (key) => !Object.hasOwn(rendererCapabilityMatrix.zyro, key)
        ) ||
        Object.keys(rendererCapabilityMatrix.zyro).some(
          (key) =>
            typeof adapter.capabilities[key as RendererFeature] !== 'boolean'
        ) ||
        entries.has(adapter.name) ||
        entries.size >= 16
      ) {
        throw new RendererError('RENDERER_REGISTRATION_INVALID');
      }
      // No implemented client runtime protocol exists; adapters cannot advertise a fictitious one.
      if (adapter.capabilities.hydration || adapter.capabilities.clientOnly) {
        throw new RendererError('RENDERER_CLIENT_PROTOCOL_UNSUPPORTED');
      }
      /** Snapshot of authored capabilities and bound trusted adapter methods. */
      const captured = {
        ...adapter,
        capabilities: Object.freeze({ ...adapter.capabilities }),
        render: adapter.render.bind(adapter),
        dispose: adapter.dispose?.bind(adapter),
      };
      /** Immutable registration authority accepted only by this registry. */
      const token = Object.freeze({
        name: adapter.name,
        /** Remove this still-unsealed token and release its captured adapter.
         * @returns {Promise<void>} Registration cleanup settlement.
         */
        async dispose() {
          if (sealed || closed) {
            throw new RendererError('RENDERER_REGISTRATION_CLOSED');
          }
          /** Generation-local registration looked up by its name and checked against token identity. */
          const entry = entries.get(token.name);
          if (entry?.token === token) {
            entries.delete(token.name);
            await captured.dispose?.();
          }
        },
      });
      entries.set(adapter.name, { adapter: captured, token });
      return token;
    },
    /** Look up an existing live registration without constructing a renderer.
     * @param {string} name - Exact authored renderer name.
     * @returns {RendererRegistration<unknown>} Borrowed registry-local token; absent or closed registrations reject.
     */
    get(name: string): RendererRegistration<unknown> {
      /** Generation-local registration looked up by its name and checked against token identity. */
      const entry = entries.get(name);
      if (!entry || closed) {
        throw new RendererError('RENDERER_UNKNOWN');
      }
      return entry.token;
    },
    /** Project captured capabilities without exposing adapter callbacks.
     * @returns {object[]} Fresh name/capability descriptors for registered adapters.
     */
    capabilities() {
      return [...entries.values()].map(({ adapter }) => ({
        name: adapter.name,
        ...adapter.capabilities,
      }));
    },
    /** Dispatch only this registry’s token, retaining capacity until actual cleanup settles.
     * @param {RendererRegistration<V>} token - Registry-local registration authority.
     * @param {NoInfer<V>} view - Renderer-specific validated view.
     * @param {RendererRequest} request - Explicit correlation, path and cancellation context.
     * @param {RendererFeature} feature - Supported requested result protocol.
     * @returns {Promise<RendererResult>} Validated HTML or owned response stream result.
     */
    async render<V>(
      token: RendererRegistration<V>,
      view: NoInfer<V>,
      request: RendererRequest,
      feature: RendererFeature = 'staticHtml'
    ): Promise<RendererResult> {
      /** Generation-local registration looked up by its name and checked against token identity. */
      const entry = entries.get(token?.name);
      if (closed || !entry || entry.token !== token) {
        throw new RendererError('RENDERER_UNKNOWN_OR_FOREIGN');
      }
      if (
        !Object.hasOwn(rendererCapabilityMatrix.zyro, feature) ||
        !entry.adapter.capabilities[feature]
      ) {
        throw new RendererError(
          'RENDERER_FEATURE_UNSUPPORTED',
          undefined,
          Object.freeze({
            renderer: entry.adapter.name,
            feature: Object.hasOwn(rendererCapabilityMatrix.zyro, feature)
              ? feature
              : 'unknown',
          })
        );
      }
      if (
        !request ||
        !(request.signal instanceof AbortSignal) ||
        typeof request.requestId !== 'string' ||
        request.requestId.length > 128 ||
        typeof request.pathname !== 'string' ||
        request.pathname.length > 4096
      ) {
        throw new RendererError('RENDERER_CONTEXT_INVALID');
      }
      if (request.signal.aborted) {
        throw new RendererError('RENDERER_CANCELLED');
      }
      if (active.size >= maxActive) {
        throw new RendererError('RENDERER_OVERLOAD');
      }
      sealed = true;
      /** Render-local cancellation owner combined with request lifecycle observation. */
      const controller = new AbortController();
      /** Bounded render-local disposers executed in reverse order. */
      const cleanups: (() => void | Promise<void>)[] = [];
      /** Render-local mutable map cleared after actual work and cleanup settle. */
      const locals = new Map();
      let finish!: () => void, settled!: () => void;
      /** Lease completion used by registry shutdown to await actual release. */
      const done = new Promise<void>((resolve) => (finish = resolve));
      /** Actual adapter/iterator work fence preventing early disposer execution. */
      const workDone = new Promise<void>((resolve) => (settled = resolve));
      let release: Promise<void> | undefined,
        stopStream: (() => Promise<unknown>) | undefined;
      /** Abort observation and release actual settled work and disposers once.
       * @returns {Promise<void>} Idempotent render cleanup settlement; failures remain explicit.
       */
      const cleanup = () =>
        (release ??= (async () => {
          controller.abort();
          await workDone;
          /** Cleanup failures accumulated without skipping remaining owned releases. */
          const errors: unknown[] = [];
          for (const dispose of cleanups.reverse()) {
            try {
              await dispose();
            } catch (error) {
              errors.push(error);
            }
          }
          locals.clear();
          request.signal.removeEventListener('abort', cancel);
          active.delete(lease);
          finish();
          if (errors.length) {
            failures.push(
              ...errors.slice(0, Math.max(0, 1024 - failures.length))
            );
            throw new AggregateError(errors, 'Renderer cleanup failed');
          }
        })());
      /** Abort render work and request iterator return without pretending JavaScript is force-stopped.
       * @returns {void} Cancellation and cleanup scheduling completion.
       */
      const cancel = () => {
        controller.abort();
        if (stopStream) {
          void stopStream()
            .catch(() => {})
            .finally(settled);
        }
        void cleanup().catch(() => {});
      };
      /** Explicit cancellation and completion pair retained by the registry. */
      const lease = { cancel, done };
      active.add(lease);
      request.signal.addEventListener('abort', cancel, { once: true });
      /** Wall-clock deadline rechecked after adapter settlement. */
      const deadline = Date.now() + timeout;
      /** Owned cooperative deadline timer removed when adapter dispatch exits. */
      const timer = setTimeout(() => controller.abort(), timeout);
      /** Immutable request render authority with private locals and bounded cleanup registration. */
      const context: RendererContext = Object.freeze({
        requestId: request.requestId,
        pathname: request.pathname,
        feature,
        signal: controller.signal,
        locals,
        /** Attach bounded render cleanup before release starts.
         * @param {Function} dispose - Trusted disposer returning actual settlement.
         * @returns {void} Cleanup registration completion.
         */
        onDispose(dispose: () => void | Promise<void>) {
          if (
            release ||
            typeof dispose !== 'function' ||
            cleanups.length >= 32
          ) {
            throw new RendererError('RENDERER_CLEANUP_INVALID');
          }
          cleanups.push(dispose);
        },
      });
      try {
        /** Untrusted adapter result validated for feature, headers, type and byte limits. */
        const result = await entry.adapter.render(view, context);
        if (Date.now() >= deadline) {
          controller.abort();
        }
        controller.signal.throwIfAborted();
        if (result?.headers) {
          validateResponseHeaders(result.headers);
        }
        if (result?.kind === 'html' && feature === 'staticHtml') {
          if (
            typeof result.html !== 'string' ||
            Buffer.byteLength(result.html) > maxBytes
          ) {
            throw new RendererError('RENDERER_RESULT_INVALID');
          }
          settled();
          return Object.freeze({
            [htmlMarker]: true as const,
            html: result.html,
            headers: result.headers
              ? Object.freeze({ ...result.headers })
              : undefined,
          });
        }
        if (
          result?.kind === 'stream' &&
          feature === 'streaming' &&
          result.source &&
          typeof result.source[Symbol.asyncIterator] === 'function'
        ) {
          // The existing response stream owns backpressure and byte limits; iteration owns teardown.
          /** Owned adapter stream iterator; response iteration and cancellation control its release. */
          const iterator = result.source[Symbol.asyncIterator]();
          let returned: Promise<unknown> | undefined,
            pendingNext:
              | Promise<IteratorResult<string | Uint8Array>>
              | undefined;
          stopStream = () =>
            (returned ??= (async () => {
              try {
                return await iterator.return?.();
              } finally {
                await pendingNext?.catch(() => {});
              }
            })());
          return stream(
            (async function* () {
              try {
                while (true) {
                  controller.signal.throwIfAborted();
                  pendingNext = Promise.resolve(iterator.next());
                  /** One actual iterator result checked after cancellation observation. */
                  const item = await pendingNext;
                  pendingNext = undefined;
                  controller.signal.throwIfAborted();
                  if (item.done) {
                    break;
                  }
                  yield item.value;
                }
              } finally {
                await stopStream!();
                settled();
                await cleanup();
              }
            })(),
            {
              contentType: 'text/html; charset=utf-8',
              maxBytes,
              headers: result.headers,
            }
          );
        }
        throw new RendererError('RENDERER_RESULT_INVALID');
      } catch (cause) {
        settled();
        try {
          await cleanup();
        } catch (cleanupError) {
          throw new RendererError(
            'RENDERER_FAILED',
            new AggregateError([cause, cleanupError])
          );
        }
        throw cause instanceof RendererError
          ? cause
          : new RendererError(
              controller.signal.aborted
                ? 'RENDERER_CANCELLED'
                : 'RENDERER_FAILED',
              cause
            );
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', cancel);
        if (!controller.signal.aborted) {
          request.signal.addEventListener('abort', cancel, { once: true });
          if (request.signal.aborted) {
            cancel();
          }
        }
      }
    },
    /** Cancel active leases, await their actual cleanup and dispose captured adapters in reverse order.
     * @returns {Promise<void>} Idempotent registry shutdown; aggregated cleanup failures reject.
     */
    close() {
      return (closing ??= (async () => {
        closed = true;
        for (const item of active) {
          item.cancel();
        }
        await Promise.allSettled([...active].map((item) => item.done));
        /** Cleanup failures accumulated without skipping remaining owned releases. */
        const errors: unknown[] = failures.splice(0);
        for (const { adapter } of [...entries.values()].reverse()) {
          try {
            await adapter.dispose?.();
          } catch (error) {
            errors.push(error);
          }
        }
        entries.clear();
        if (errors.length) {
          throw new AggregateError(errors, 'Renderer registry close failed');
        }
      })());
    },
    /** Count retained unsettled render leases without request labels.
     * @returns {number} Current actual-work lease count.
     */
    get activeRenders() {
      return active.size;
    },
  };
}
export type RendererRegistry = ReturnType<typeof createRendererRegistry>;

export * from './render-document.js';
