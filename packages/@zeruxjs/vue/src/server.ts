import { createRequire } from 'node:module';
import {
  VueAdapterError,
  validateVueView,
  validateVueOptions,
  checkVueAbort,
  vueVersion,
  unwrapModule,
  createVueLease,
  VUE_RENDER_CONTEXT,
  type VueRenderView,
  type VueRenderOptions,
} from './render-policy.js';
export { VueAdapterError } from './render-policy.js';
/** Explicit per-render policy; the HTML byte ceiling is checked after native rendering. */
export interface VueServerOptions extends VueRenderOptions {
  /** Maximum UTF-8 result bytes, from 1 to 16 MiB; defaults to 1 MiB. */
  maxBytes?: number;
}
/** Load matching compiler-free peers only for explicit server calls.
 * @returns {Promise<object>} Verified runtime and server renderer; dependency causes remain private.
 */
async function peers() {
  try {
    /** Resolve installed peer metadata without invoking a request-time compiler. */
    const require = createRequire(__filename),
      version = require('@vue/server-renderer/package.json').version,
      vue = require('vue/package.json').version;
    /** Runtime-only entry shares the same native version as both server peers. */
    const runtime = unwrapModule(await import('@vue/runtime-dom'));
    vueVersion(runtime.version);
    if (!runtime.isRuntimeOnly()) {
      throw new VueAdapterError('RUNTIME_ONLY_BUILD_REQUIRED');
    }
    if (version !== runtime.version || vue !== runtime.version) {
      throw new VueAdapterError('VUE_PEER_VERSION_MISMATCH');
    }
    // Publicly exported compiler-free build. Its template compiler is a throwing stub, never eval.
    /** Fixed public entry; callers cannot select arbitrary module paths. */
    const entry = '@vue/server-renderer/dist/server-renderer.esm-bundler.js';
    /** Compiler-free renderer borrowed from the installed matching peer. */
    const renderer = (await import(
      entry
    )) as typeof import('@vue/server-renderer');
    if (
      typeof renderer.renderToString !== 'function' ||
      typeof runtime.createSSRApp !== 'function'
    ) {
      throw new VueAdapterError('VUE_CAPABILITY_UNAVAILABLE');
    }
    return { runtime, renderer };
  } catch (cause) {
    throw cause instanceof VueAdapterError
      ? cause
      : new VueAdapterError('VUE_DEPENDENCY_UNAVAILABLE', cause);
  }
}
/** Native async SSR using Vue's compiler-free server build. Every call creates a fresh application/context.
 * @param {VueRenderView} input - Trusted authored component with validated shallow props.
 * @param {VueServerOptions} options - Explicit byte ceiling, cancellation and request-owned cleanup callbacks.
 * @returns {Promise<string>} Complete HTML only after rendering and cleanup succeed; cancellation waits for cooperative native settlement.
 */
export async function renderVueToString(
  input: VueRenderView,
  options: VueServerOptions = {}
): Promise<string> {
  /** Validate input and byte policy before creating request-owned resources. */
  const view = validateVueView(input),
    settings = validateVueOptions(options),
    max = options.maxBytes ?? 1048576;
  if (!Number.isSafeInteger(max) || max < 1 || max > 16777216) {
    throw new VueAdapterError('INVALID_BYTE_LIMIT');
  }
  checkVueAbort(settings.signal);
  /** This request owns its signal, error records and reverse-order cleanup stack. */
  const lease = createVueLease(true, settings);
  let result: string | undefined, failure: unknown;
  try {
    /** Lazy peers do not share application context between requests. */
    const { runtime, renderer } = await peers();
    checkVueAbort(lease.context.signal);
    /** Fresh native app prevents request state from leaking through adapter-owned globals. */
    const app = runtime.createSSRApp({
      name: 'ZeruxVueRoot',
      render: () =>
        runtime.h(view.component, view.props ? { ...view.props } : undefined),
    });
    app.config.idPrefix = settings.idPrefix ?? '';
    app.provide(VUE_RENDER_CONTEXT, lease.context);
    app.config.errorHandler = (error) =>
      lease.report('VUE_RENDER_ERROR', error);
    app.config.warnHandler = (message) =>
      lease.report('VUE_RENDER_WARNING', new Error(message));
    /** Native output metadata is inspected rather than silently dropping teleport targets. */
    const ssrContext: import('@vue/server-renderer').SSRContext = {};
    result = await renderer.renderToString(app, ssrContext);
    checkVueAbort(lease.context.signal);
    if (ssrContext.teleports && Object.keys(ssrContext.teleports).length) {
      throw new VueAdapterError('SSR_TELEPORTS_UNSUPPORTED');
    }
    if (lease.errors.length) {
      throw new VueAdapterError(
        'VUE_RENDER_FAILED',
        new AggregateError(lease.errors, 'Vue SSR reported errors')
      );
    }
    // Native rendering already allocated this result; this is an output ceiling, not a memory quota.
    if (new TextEncoder().encode(result).length > max) {
      throw new VueAdapterError('HTML_BYTE_LIMIT');
    }
  } catch (cause) {
    if (lease.context.signal.aborted) {
      failure = new VueAdapterError('RENDER_ABORTED', cause);
    } else if (cause instanceof VueAdapterError) {
      failure = cause;
    } else {
      failure = new VueAdapterError('VUE_RENDER_FAILED', cause);
    }
  }
  try {
    await lease.close();
  } catch (cleanup) {
    failure = failure
      ? new VueAdapterError(
          'VUE_RENDER_FAILED',
          new AggregateError([failure, cleanup], 'Vue SSR and cleanup failed')
        )
      : cleanup;
  }
  if (failure) {
    throw failure;
  }
  return result!;
}
/** Verify installed peers and describe the adapter's deliberately limited rendering contract.
 * @returns {Promise<object>} Frozen version/capability record; this does not certify browser hydration or template compilation.
 */
export async function getVueServerCapabilities() {
  /** Verification is lazy and creates no app or subscription owner. */
  const { runtime } = await peers();
  return Object.freeze({
    version: runtime.version,
    ssr: true,
    hydration: true,
    streaming: false,
    templates: 'precompiled-only',
  });
}
