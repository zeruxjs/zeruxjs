import {
  RendererError,
  type RendererAdapter,
  type RendererContext,
} from './renderers.js';
import { validateResponseHeaders } from './response.js';

export interface RenderAsset {
  /** Validated root-relative public asset URL without traversal. */
  readonly url: string;
  /** Validated SHA-256 subresource integrity value. */
  readonly integrity: string;
}
/** Validate a local public asset URL and exact SHA-256 integrity metadata without fetching the asset.
 * @param {unknown} value - Untrusted manifest asset candidate.
 * @returns {RenderAsset} Immutable validated public record.
 */
function renderAsset(value: unknown): RenderAsset {
  /** Validated public asset descriptor, or the registration-time selected client entry. */
  const asset = value as RenderAsset;
  if (
    !asset ||
    typeof asset.url !== 'string' ||
    asset.url.length > 2048 ||
    !/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(asset.url) ||
    asset.url.split('/').some((part) => part === '.' || part === '..') ||
    typeof asset.integrity !== 'string' ||
    !/^sha256-[A-Za-z0-9+/]{43}=$/.test(asset.integrity)
  ) {
    throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
  }
  return Object.freeze({ url: asset.url, integrity: asset.integrity });
}
/** Consume a bounded generated public manifest; no private source path is exposed to renderer HTML.
 * @param {unknown} input - Untrusted public asset manifest candidate.
 * @returns {{entry(name: string): RenderAsset}} Immutable named entry lookup, with missing entries rejected.
 */
export function createRenderAssets(input: unknown): {
  /** Resolve one explicit named client entry before serving a generation.
   * @param {string} name - Validated authored entry name.
   * @returns {RenderAsset} Immutable asset record; unknown entries reject.
   */
  entry(name: string): RenderAsset;
} {
  if (!input || typeof input !== 'object') {
    throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
  }
  /** Untrusted public build manifest projection; private source paths are not accepted. */
  const manifest = input as {
    /** Required public manifest schema version. */
    schema?: unknown;
    /** Bounded public URL/integrity asset records. */
    assets?: unknown;
    /** Bounded authored entry-name to public JavaScript URL mapping. */
    namedEntries?: unknown;
  };
  if (
    manifest.schema !== 1 ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > 10000 ||
    !manifest.namedEntries ||
    typeof manifest.namedEntries !== 'object' ||
    Array.isArray(manifest.namedEntries) ||
    Object.keys(manifest.namedEntries).length > 32
  ) {
    throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
  }
  /** Validated URL-to-integrity records; duplicate URLs fail rather than overwrite. */
  const assets = new Map<string, RenderAsset>();
  for (const asset of manifest.assets) {
    /** Immutable validated public asset record before registry insertion. */
    const captured = renderAsset(asset);
    if (assets.has(captured.url)) {
      throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
    }
    assets.set(captured.url, captured);
  }
  /** Validated named JavaScript entry lookup; unknown names fail explicitly. */
  const entries = new Map<string, RenderAsset>();
  for (const [name, url] of Object.entries(manifest.namedEntries)) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      typeof url !== 'string' ||
      !assets.has(url) ||
      !/\.m?js$/.test(url)
    ) {
      throw new RendererError('RENDER_ASSET_MANIFEST_INVALID');
    }
    entries.set(name, assets.get(url)!);
  }
  return Object.freeze({
    /** Resolve one explicit named client entry before serving a generation.
     * @param {string} name - Validated authored entry name.
     * @returns {RenderAsset} Immutable asset record; unknown entries reject.
     */
    entry(name: string) {
      /** Validated public asset descriptor, or the registration-time selected client entry. */
      const asset = entries.get(name);
      if (!asset) {
        throw new RendererError('RENDER_ASSET_ENTRY_MISSING');
      }
      return asset;
    },
  });
}
export interface ZyroDocumentOutput {
  /** Trusted renderer-produced component HTML; sanitize untrusted content before rendering. */
  html: string;
  /** The encoded data from zyrojs/server, never HTML-escaped JSON. */
  data?: string;
  /** Explicit V1 hydration payload version when bootstrap data is present. */
  version?: 1;
  /** Validated hydration identifier prefix matching the encoded payload. */
  idPrefix?: string;
}
export interface ZyroDocumentOptions<V> {
  /** Produce trusted component HTML and optional already encoded V1 public hydration data.
   * @param {V} view - Renderer-specific validated view input.
   * @param {RendererContext} context - Borrowed request cancellation/cleanup context.
   * @returns {ZyroDocumentOutput | Promise<ZyroDocumentOutput>} Component output, not an arbitrary serialized runtime.
   */
  render(
    view: V,
    context: RendererContext
  ): ZyroDocumentOutput | Promise<ZyroDocumentOutput>;
  /** Create fresh per-document headers and an optional CSP nonce before any output.
   * @returns {{nonce?: string; headers: Record<string, string>}} Host-owned security response, validated by the document renderer.
   */
  security(): {
    /** Fresh CSP nonce supplied by the host security response. */
    nonce?: string; /** Host security response header bag, validated before commitment. */
    headers: Record<string, string>;
  };
  /** Bounded public URL/integrity asset records. */
  assets?: ReturnType<typeof createRenderAssets>;
  /** Explicit named build entry required when hydration data is emitted. */
  clientEntry?: string;
  /** Validated authored document root ID; defaults to zyro-root. */
  rootId?: string;
  /** Wrap component output in trusted authored structural HTML; do not pass untrusted notes or strings as shell markup.
   * @param {V} view - Renderer-specific validated view input.
   * @param {RendererContext} context - Borrowed request render context.
   * @returns {{before: string; after: string}} Trusted surrounding document fragments.
   */
  layout?(view: V, context: RendererContext): { before: string; after: string };
  /** Handle precommit rendering failure without serializing the internal cause into public HTML.
   * @param {unknown} error - Private renderer failure available only to trusted host code.
   * @param {RendererContext} context - Borrowed request render context.
   * @returns {ZyroDocumentOutput | Promise<ZyroDocumentOutput>} Safe host-selected fallback output.
   */
  errorBoundary?(
    error: unknown,
    context: RendererContext
  ): ZyroDocumentOutput | Promise<ZyroDocumentOutput>;
}
/** Create a static document adapter with optional explicit V1 bootstrap assets; streaming chunks already rendered HTML, not incremental component execution.
 * @param {ZyroDocumentOptions<V>} options - Trusted render/security callbacks and explicit public entry selection.
 * @returns {RendererAdapter<V>} Adapter registered under generation ownership; no runtime or bundler is imported here.
 */
export function createZyroDocumentRenderer<V>(
  options: ZyroDocumentOptions<V>
): RendererAdapter<V> {
  if (
    !options ||
    typeof options.render !== 'function' ||
    typeof options.security !== 'function' ||
    (options.layout !== undefined && typeof options.layout !== 'function') ||
    (options.errorBoundary !== undefined &&
      typeof options.errorBoundary !== 'function')
  ) {
    throw new RendererError('RENDER_DOCUMENT_OPTIONS_INVALID');
  }
  /** Trusted authored renderer callbacks and explicit public asset selection captured at registration. */
  const { render, security, layout, errorBoundary, assets, clientEntry } =
    options;
  /** Validated fixed HTML root identifier; never arbitrary request-supplied markup. */
  const rootId = options.rootId ?? 'zyro-root';
  if (
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(rootId) ||
    (clientEntry !== undefined && (!assets || typeof clientEntry !== 'string'))
  ) {
    throw new RendererError('RENDER_DOCUMENT_OPTIONS_INVALID');
  }
  // Resolve at registration, before this generation can serve requests.
  /** Validated public asset descriptor, or the registration-time selected client entry. */
  const asset =
    clientEntry === undefined
      ? undefined
      : renderAsset(assets!.entry(clientEntry));
  return {
    name: 'zyro-document',
    capabilities: {
      staticHtml: true,
      streaming: true,
      hydration: false,
      clientOnly: false,
    },
    /** Build a validated document using fresh host security policy before commitment.
     * @param {V} view - Renderer-specific validated view input.
     * @param {RendererContext} context - Borrowed request cancellation/cleanup context.
     * @returns {Promise<import('./renderers.js').RendererResult>} HTML or owned chunked document result.
     */
    async render(view, context) {
      context.signal.throwIfAborted();
      /** Fresh host-owned per-document security response, validated before output. */
      const policy = security();
      validateResponseHeaders(policy.headers);
      if (
        policy.nonce !== undefined &&
        (typeof policy.nonce !== 'string' ||
          !/^[A-Za-z0-9+/_-]{22,86}={0,2}$/.test(policy.nonce))
      ) {
        throw new RendererError('RENDER_DOCUMENT_NONCE_INVALID');
      }
      /** Per-document headers with private no-store behavior preserved. */
      const headers = { ...policy.headers, 'cache-control': 'no-store' };
      let output: ZyroDocumentOutput;
      try {
        output = await render(view, context);
      } catch (error) {
        context.signal.throwIfAborted();
        if (!errorBoundary) {
          throw error;
        }
        output = await errorBoundary(error, context);
      }
      context.signal.throwIfAborted();
      if (!output || typeof output.html !== 'string') {
        throw new RendererError('RENDER_DOCUMENT_OUTPUT_INVALID');
      }
      /** Trusted authored surrounding HTML or the fixed default document shell. */
      const shell = layout?.(view, context) ?? {
        before:
          '<!doctype html><html><head><meta charset="utf-8"></head><body>',
        after: '</body></html>',
      };
      if (
        !shell ||
        typeof shell.before !== 'string' ||
        typeof shell.after !== 'string'
      ) {
        throw new RendererError('RENDER_DOCUMENT_LAYOUT_INVALID');
      }
      let bootstrap = '';
      if (output.data !== undefined) {
        if (
          !asset ||
          !policy.nonce ||
          output.version !== 1 ||
          typeof output.data !== 'string' ||
          Buffer.byteLength(output.data) > 1048576 ||
          /[<>&\u2028\u2029]/.test(output.data)
        ) {
          throw new RendererError('RENDER_DOCUMENT_HYDRATION_INVALID');
        }
        let data;
        try {
          data = JSON.parse(output.data);
        } catch {
          throw new RendererError('RENDER_DOCUMENT_HYDRATION_INVALID');
        }
        if (
          data?.version !== 1 ||
          data.idPrefix !== output.idPrefix ||
          typeof data.idPrefix !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(data.idPrefix) ||
          Object.keys(data).sort().join(',') !== 'idPrefix,props,version'
        ) {
          throw new RendererError('RENDER_DOCUMENT_HYDRATION_INVALID');
        }
        /** Validated per-document nonce required to match the enforced script-src policy. */
        const nonce = policy.nonce;
        /** Case-insensitive enforced CSP header inspected for the exact required nonce. */
        const csp = Object.entries(headers).find(
          ([key]) => key.toLowerCase() === 'content-security-policy'
        )?.[1];
        if (
          !csp
            ?.split(';')
            .some(
              (directive) =>
                /^\s*script-src\s/.test(directive) &&
                directive.split(/\s+/).includes(`'nonce-${nonce}'`)
            )
        ) {
          throw new RendererError('RENDER_DOCUMENT_NONCE_POLICY_REQUIRED');
        }
        bootstrap = `<script type="application/json" id="${rootId}-data" nonce="${nonce}">${output.data}</script><script type="module" src="${asset.url}" integrity="${asset.integrity}" crossorigin="anonymous" nonce="${nonce}"></script>`;
      } else if (asset) {
        throw new RendererError('RENDER_DOCUMENT_HYDRATION_DATA_REQUIRED');
      }
      /** Ordered document shell, trusted component output and explicit encoded bootstrap fragments. */
      const parts = [
        shell.before,
        `<div id="${rootId}">${output.html}</div>`,
        bootstrap,
        shell.after,
      ];
      if (context.feature === 'streaming') {
        return {
          kind: 'stream',
          source: (async function* () {
            for (const part of parts) {
              context.signal.throwIfAborted();
              yield part;
            }
          })(),
          headers,
        };
      }
      return { kind: 'html', html: parts.join(''), headers };
    },
  };
}
