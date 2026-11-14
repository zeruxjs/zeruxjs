import { compileStylesheet } from './stylesheet.js';
import { createZuix } from './compiler.js';
import { extractClasses } from './scanner.js';
import type { ZuixConfig } from './types.js';
/** Create an explicit framework-neutral bundler adapter with targeted stylesheet invalidation.
 * @param {ZuixConfig} config - Application compiler/scanner policy.
 * @returns {object} Vite-compatible hooks; real framework/browser qualification remains separate.
 */
export function zuixVite(config: ZuixConfig = {}) {
  /** Public virtual stylesheet ID consumed by the bundler, never a network URL. */
  const virtualId = 'virtual:zuix.css';
  /** Internal virtual stylesheet ID recognized only by this adapter. */
  const resolved = '\0' + virtualId;
  /** Authored CSS module IDs containing an explicit Zuixs import. */
  const cssEntries = new Set<string>();
  /** Current transformed source tokens, taking precedence over initial disk scans. */
  const modules = new Map<string, Set<string>>();
  let scanned = new Map<string, string[]>(),
    root = '';
  let server:
    | {
        moduleGraph: {
          /** Borrow a host module record by its known stylesheet ID.
           * @param {string} id - Known internal or authored stylesheet module ID.
           * @returns {unknown} Host-owned module record, if present.
           */
          getModuleById(id: string): unknown;
          /** Ask the host to invalidate one borrowed stylesheet module.
           * @param {unknown} module - Known host module record.
           * @returns {void} Host retains module lifecycle ownership.
           */
          invalidateModule(module: unknown): void;
        };
        ws: {
          /** Send a targeted update through the host’s existing development socket.
           * @param {unknown} message - Structured stylesheet update.
           * @returns {void} No independent socket is allocated.
           */
          send(message: unknown): void;
        };
      }
    | undefined;
  /** Convert a bundler module ID into a project-relative source identity.
   * @param {string} id - Bundler module ID with optional query.
   * @returns {string | null} Project-relative path or null outside the configured root.
   */
  const relative = (id: string) => {
    /** Query-free normalized module path; split always supplies its first string. */
    const pathname = id.split('?')[0]!.replace(/\\/g, '/');
    if (!root || !pathname.startsWith(root + '/')) {
      return null;
    }
    return pathname.slice(root.length + 1);
  };
  /** Compile the union of scanned and current transformed tokens.
   * @returns {string} Generated CSS for the virtual stylesheet.
   */
  const generate = () => {
    /** Current token union; transformed modules replace their scanned source records. */
    const tokens = new Set<string>();
    for (const [file, values] of scanned) {
      if (!modules.has(file)) {
        for (const value of values) {
          tokens.add(value);
        }
      }
    }
    for (const values of modules.values()) {
      for (const value of values) {
        tokens.add(value);
      }
    }
    return createZuix(config).generate(tokens).css;
  };
  /** Select only known Zuixs stylesheet modules for targeted invalidation.
   * @returns {unknown[]} Host-owned module records, never unrelated modules.
   */
  const styleModules = () =>
    [...new Set([...cssEntries, resolved])].flatMap((id) => {
      /** Borrowed module-graph record; the bundler retains lifecycle ownership. */
      const module = server?.moduleGraph.getModuleById(id);
      return module ? [module] : [];
    });
  /** Notify only stylesheet modules with bounded valid host-supplied URLs.
   * @returns {void} Invalidates known styles without a full-page reload fallback.
   */
  const invalidate = () => {
    /** Bounded-by-known-modules HMR updates using the host’s module URLs. */
    const updates: {
      type: 'js-update';
      path: string;
      acceptedPath: string;
      timestamp: number;
    }[] = [];
    for (const module of styleModules()) {
      server?.moduleGraph.invalidateModule(module);
      /** Borrowed module URL checked for line breaks and a fixed length ceiling. */
      const url = (module as { url?: unknown }).url;
      if (
        typeof url === 'string' &&
        url.length <= 2048 &&
        !/[\r\n]/.test(url)
      ) {
        updates.push({
          type: 'js-update',
          path: url,
          acceptedPath: url,
          timestamp: Date.now(),
        });
      }
    }
    if (updates.length) {
      server?.ws.send({ type: 'update', updates });
    }
  };
  /** Refresh the bounded Node source baseline, then invalidate known styles.
   * @returns {Promise<void>} Source scan and invalidation completion.
   */
  const refresh = async () => {
    /** Lazy Node scanner import; browser root imports do not eagerly load filesystem modules. */
    const { scanProjectFiles } = await import('./node.js');
    scanned = scanProjectFiles(root, config);
    invalidate();
  };
  return {
    name: 'zuix',
    enforce: 'pre' as const,
    /** Capture the host’s explicit root with normalized separators.
     * @param {{ root: string }} resolvedConfig - Resolved host configuration.
     * @param {string} resolvedConfig.root - Host-resolved project directory.
     * @returns {void} Updates this adapter only.
     */
    configResolved(resolvedConfig: { root: string }) {
      root = resolvedConfig.root.replace(/\\/g, '/').replace(/\/$/, '');
    },
    /** Scan the initial bounded project baseline before generating CSS.
     * @returns {Promise<void>} Initial scan completion.
     */
    async buildStart() {
      await refresh();
    },
    /** Borrow the host’s graph/socket without creating a second server.
     * @param {typeof server} s - Existing host development server surface.
     * @returns {void} Stores only this adapter’s borrowed host reference.
     */
    configureServer(s: typeof server) {
      server = s;
    },
    /** Recognize only the explicit Zuixs virtual stylesheet ID.
     * @param {string} id - Requested bundler module identifier.
     * @returns {string | null} Internal ID or null for unrelated imports.
     */
    resolveId(id: string) {
      return id === virtualId ? resolved : null;
    },
    /** Generate CSS only for the recognized virtual module.
     * @param {string} id - Resolved bundler module ID.
     * @returns {string | null} Generated CSS or null for unrelated modules.
     */
    load(id: string) {
      return id === resolved ? generate() : null;
    },
    /** Compile explicit CSS imports or update literal source tokens without executing modules.
     * @param {string} code - Host-supplied source text.
     * @param {string} id - Host-supplied module ID.
     * @returns {object | null} Compiled CSS result or null when the host should retain its source.
     */
    transform(code: string, id: string) {
      if (
        id.split('?', 1)[0]!.endsWith('.css') &&
        /@import\s+(["'])zuixs\1\s*;/.test(code)
      ) {
        cssEntries.add(id);
        /** Current token union; transformed modules replace their scanned source records. */
        const tokens = new Set<string>();
        for (const [file, values] of scanned) {
          if (!modules.has(file)) {
            for (const value of values) {
              tokens.add(value);
            }
          }
        }
        for (const values of modules.values()) {
          for (const value of values) {
            tokens.add(value);
          }
        }
        return { code: compileStylesheet(code, tokens, config).css, map: null };
      }
      if (
        !/\.(?:tsx?|jsx?|vue|svelte|astro|html)$/.test(id.split('?', 1)[0]!)
      ) {
        return null;
      }
      /** Project-relative transformed/changed source identity. */
      const file = relative(id);
      if (!file) {
        return null;
      }
      /** Fresh token set replacing this source’s earlier extraction. */
      const next = new Set(extractClasses(code, { limits: config.limits }));
      /** Previous transformed tokens used to avoid unnecessary stylesheet updates. */
      const old = modules.get(file);
      if (
        !old ||
        next.size !== old.size ||
        [...next].some((c) => !old.has(c))
      ) {
        modules.set(file, next);
        invalidate();
      }
      return null;
    },
    /** Remove deleted source tokens or refresh the baseline for source additions.
     * @param {string} id - Changed module ID.
     * @param {{ event: string }} change - Host event classification.
     * @param {string} change.event - Host create/update/delete event classification.
     * @returns {Promise<void> | undefined} Optional refresh completion for new files.
     */
    watchChange(id: string, change: { event: string }) {
      /** Project-relative transformed/changed source identity. */
      const file = relative(id);
      if (!file) {
        return;
      }
      if (change.event === 'delete') {
        modules.delete(file);
        scanned.delete(file);
        invalidate();
      } else if (change.event === 'create') {
        return refresh();
      }
    },
    /** Return the source’s affected modules plus known stylesheet modules, excluding unrelated graph entries.
 * @param {{
      file: string;
      read?: () => Promise<string>;
      modules?: unknown[];
    }} ctx - Host update context and optional source reader.
 * @param {string} ctx.file - Changed source path.
 * @param {() => Promise<string>} [ctx.read] - Host-owned source reader.
 * @param {unknown[]} [ctx.modules] - Source modules already affected by the host.
 * @returns {Promise<unknown[] | undefined>} Targeted module set, or undefined outside this project.
 */
    async handleHotUpdate(ctx: {
      file: string;
      read?: () => Promise<string>;
      modules?: unknown[];
    }) {
      /** Project-relative transformed/changed source identity. */
      const file = relative(ctx.file);
      if (!file) {
        return;
      }
      if (ctx.read && /\.(?:tsx?|jsx?|vue|svelte|astro|html)$/.test(file)) {
        modules.set(
          file,
          new Set(extractClasses(await ctx.read(), { limits: config.limits }))
        );
      }
      invalidate();
      // Include the source's own affected modules and only Zuixs stylesheet modules.
      return [...new Set([...(ctx.modules ?? []), ...styleModules()])];
    },
    /** Release adapter-owned token/ID state and detach the borrowed host reference.
     * @returns {void} Does not close the host’s server or socket.
     */
    closeBundle() {
      cssEntries.clear();
      modules.clear();
      scanned.clear();
      server = undefined;
    },
  };
}
/** Inject one owned browser style node; absent DOM globals return an inert disposer.
 * @param {Iterable<string>} classes - Finite literal-token iterable.
 * @param {ZuixConfig} config - Application compiler policy.
 * @returns {() => void} Idempotent style-node removal callback for host teardown.
 */
export function injectZuix(
  classes: Iterable<string>,
  config: ZuixConfig = {}
): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  /** Owned browser style node removed only by its returned disposer. */
  const style = document.createElement('style');
  style.setAttribute('data-zuix', '');
  style.textContent = createZuix(config).generate(classes).css;
  document.head.appendChild(style);
  return () => style.remove();
}
/** Serialize escaped inline CSS for explicit SSR use; the host owns CSP policy.
 * @param {Iterable<string>} classes - Finite literal-token iterable.
 * @param {ZuixConfig} config - Application compiler policy.
 * @returns {string} Inline style element; strict CSP generally prefers external CSS or a host nonce.
 */
export function renderZuixStyle(
  classes: Iterable<string>,
  config: ZuixConfig = {}
): string {
  /** Compiled CSS with style termination escaped before inline SSR serialization. */
  const css = createZuix(config)
    .generate(classes)
    .css.replace(/<\/style/gi, '<\\/style');
  return `<style data-zuix>${css}</style>`;
}
