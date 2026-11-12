import type { ReactElement } from 'react';
import {
  ReactAdapterError,
  checkReactAbort,
  reactPrefix,
  reactByteLimit,
  validateReactVersions,
  importedDefault,
} from './render-errors.js';
export { ReactAdapterError } from './render-errors.js';
export interface ReactServerOptions {
  /** Default empty, otherwise bounded 48-character HTML-safe identifier; hydration must reuse the exact prefix. */
  identifierPrefix?: string;
  /** Optional cooperative signal checked before/after peer loading and synchronous rendering. */
  signal?: AbortSignal;
  /** Post-render UTF-8 ceiling, default1 MiB and maximum16 MiB; not a bound on trusted component allocations/time. */
  maxBytes?: number;
}
/** Lazily load only the fixed React/server peers and validate their matching versions/APIs. Missing native dependencies produce fixed diagnostics with private causes.
 * @returns {Promise<object>} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
async function peers() {
  try {
    /** Fixed lazy host peer imports; no caller-directed module loading. */
    const [reactModule, serverModule] = await Promise.all([
      import('react'),
      import('react-dom/server'),
    ]);
    /** Installed trusted React peer, borrowed rather than bundled/owned. */
    const React = importedDefault(reactModule);
    /** Matching trusted native server renderer peer; no runtime server is started. */
    const server = importedDefault(serverModule);
    validateReactVersions(React.version, server.version);
    if (
      typeof React.isValidElement !== 'function' ||
      typeof server.renderToString !== 'function' ||
      typeof server.renderToStaticMarkup !== 'function'
    ) {
      throw new ReactAdapterError('REACT_CAPABILITY_UNAVAILABLE');
    }
    return { React, server };
  } catch (cause) {
    throw cause instanceof ReactAdapterError
      ? cause
      : new ReactAdapterError('REACT_DEPENDENCY_UNAVAILABLE', cause);
  }
}
/** Render trusted components synchronously after peer acquisition; reject incomplete Suspense fallback output and check the post-render byte budget. No data waiting/streaming or forced cancellation is supplied.
 * @param {ReactElement | null} view - Real React element or null; component code remains trusted host code.
 * @param {ReactServerOptions} options - Explicit prefix/cancellation/post-render byte policy; host owns component/data preparation.
 * @param {boolean} staticOnly - True uses non-hydratable static markup; false uses native string SSR.
 * @returns {Promise<string>} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
async function render(
  view: ReactElement | null,
  options: ReactServerOptions,
  staticOnly: boolean
): Promise<string> {
  options = { ...options };
  /** Validated explicit identifier used consistently by native useId/hydration. */
  const prefix = options.identifierPrefix ?? '';
  /** Validated finite byte ceiling; checked after trusted native rendering, not a CPU/allocation sandbox. */
  const limit = reactByteLimit(options.maxBytes);
  reactPrefix(prefix);
  checkReactAbort(options.signal);
  /** Qualified matching installed native peers, loaded only on explicit rendering. */
  const { React, server } = await peers();
  checkReactAbort(options.signal);
  if (view !== null && !React.isValidElement(view)) {
    throw new ReactAdapterError('INVALID_REACT_ELEMENT');
  }
  try {
    /** Native encoded HTML; incomplete fallback markers/private development templates reject. */
    const html = staticOnly
      ? server.renderToStaticMarkup(view, { identifierPrefix: prefix })
      : server.renderToString(view, { identifierPrefix: prefix });
    checkReactAbort(options.signal);
    // React development fallback templates may contain private error stacks/messages.
    // Incomplete native string-SSR boundaries need a streaming/data contract we do not provide.
    if (html.includes('<!--$!-->')) {
      throw new ReactAdapterError('REACT_INCOMPLETE_SSR');
    }
    if (new TextEncoder().encode(html).length > limit) {
      throw new ReactAdapterError('HTML_BYTE_LIMIT');
    }
    return html;
  } catch (cause) {
    throw cause instanceof ReactAdapterError
      ? cause
      : new ReactAdapterError('REACT_RENDER_FAILED', cause);
  }
}
/** Use native string SSR behind lazy peer acquisition. Host prepares/authorizes data and owns request resources; this API does not await suspended data.
 * @param {ReactElement | null} view - Real React element or null; component code remains trusted host code.
 * @param {ReactServerOptions} options - Explicit prefix/cancellation/post-render byte policy; host owns component/data preparation.
 * @returns {Promise<string>} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export function renderReactToString(
  view: ReactElement | null,
  options: ReactServerOptions = {}
): Promise<string> {
  return render(view, options, false);
}
/** Generate explicitly non-hydratable native static HTML; never pass it to hydrateRoot as a hydration contract.
 * @param {ReactElement | null} view - Real React element or null; component code remains trusted host code.
 * @param {ReactServerOptions} options - Explicit prefix/cancellation/post-render byte policy; host owns component/data preparation.
 * @returns {Promise<string>} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export function renderReactToStaticMarkup(
  view: ReactElement | null,
  options: ReactServerOptions = {}
): Promise<string> {
  return render(view, options, true);
}
/** Inspect the actually installed matching peer APIs without creating a root/server or implying streaming support.
 * @returns {Promise<object>} Explicit checked native result; private causes remain host-only and failed work is not replayed.
 */
export async function getReactServerCapabilities() {
  /** Qualified installed peer used only to report actual capabilities. */
  const { React } = await peers();
  return Object.freeze({
    version: React.version,
    ssr: true,
    staticHtml: true,
    hydration: true,
    streaming: false,
  });
}
