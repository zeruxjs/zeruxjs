import {
  NavigationError,
  type PublicNavigationRoute,
  type PublicRouteAsset,
} from './navigation-manifest.js';
export interface BrowserNavigationContext {
  /** Navigation cancellation signal; handlers remain cooperatively cancellable. */
  readonly signal: AbortSignal;
  /** Validated destination URL for this navigation. */
  readonly url: URL;
  /** Validated public manifest route descriptor. */
  readonly route: PublicNavigationRoute;
  /** Immutable shared-matcher parameter captures; handlers still validate values. */
  readonly params: Readonly<Record<string, string>>;
  /** Opaque host navigation scope revision; never an authorization decision. */
  readonly scope: string;
  /** Attach owned cleanup to this navigation rather than a process-global registry.
   * @param {() => void | Promise<void>} cleanup - Trusted disposer returning actual asynchronous settlement when needed.
   * @returns {void} Cleanup registration completion.
   */
  onDispose(cleanup: () => void | Promise<void>): void;
  /** Memoize one producer within this navigation and authenticated scope only.
   * @param {string} key - Explicit local producer key.
   * @param {(signal: AbortSignal) => Promise<T>} producer - Signal-aware trusted data producer.
   * @returns {Promise<T>} Navigation-local result; never a persisted cross-principal cache.
   */
  load<T>(
    key: string,
    producer: (signal: AbortSignal) => Promise<T>
  ): Promise<T>;
}
export interface BrowserPageOwner {
  /** Release resources created by this page owner.
   * @returns {void | Promise<void>} Actual cleanup settlement when asynchronous.
   */
  dispose(): void | Promise<void>;
}
export interface BrowserRouteModule {
  /** Mount only the detached page component. Structural layouts remain host-owned. */
  /** Prepare the detached page component without claiming ownership of structural layouts.
   * @param {HTMLElement} root - Detached incoming component root.
   * @param {BrowserNavigationContext} context - Navigation-owned signal and cleanup context.
   * @returns {BrowserPageOwner | Promise<BrowserPageOwner>} Owned page resources to dispose on cancellation/replacement.
   */
  prepare(
    root: HTMLElement,
    context: BrowserNavigationContext
  ): BrowserPageOwner | Promise<BrowserPageOwner>;
}
export interface PreparedBrowserPage extends BrowserPageOwner {
  /** Commit this prepared detached page exactly once while navigation remains active.
   * @returns {void} Synchronous DOM adoption; closed or cancelled preparations reject.
   */
  commit(): void;
}
export interface BrowserNavigationRenderer {
  /** Validate and prepare detached document content before an explicit commit.
   * @param {object} input - Current/incoming roots and navigation state.
   * @param {HTMLElement} input.root - Host-owned current root.
   * @param {HTMLElement} input.incoming - Detached incoming page root.
   * @param {PublicNavigationRoute | null} input.previous - Previous manifest route.
   * @param {BrowserNavigationContext} input.context - Navigation-owned context.
   * @returns {Promise<PreparedBrowserPage>} Prepared page with explicit commit and dispose operations.
   */
  prepare(input: {
    /** Host-owned live navigation root. */
    root: HTMLElement;
    /** Detached parsed incoming page to validate before adoption. */
    incoming: HTMLElement;
    /** Previous validated route, absent for initial navigation. */
    previous: PublicNavigationRoute | null;
    /** Borrowed navigation context owning cancellation and memoization. */
    context: BrowserNavigationContext;
  }): Promise<PreparedBrowserPage>;
}
/** Prepare static server DOM and optional explicitly loaded page modules; fetched HTML scripts are never executed.
 * @param {object} options - Optional trusted manifest module loader.
 * @param {Function} options.loadModule - Optional manifest-asset loader honoring navigation cancellation.
 * @returns {BrowserNavigationRenderer} Renderer borrowing the loader; each prepared page owns its optional module cleanup.
 */
export function createDocumentNavigationRenderer(
  options: {
    /** Explicit trusted loader for manifest-declared client modules only. */
    loadModule?: (
      asset: PublicRouteAsset,
      signal: AbortSignal
    ) => Promise<BrowserRouteModule>;
  } = {}
): BrowserNavigationRenderer {
  if (
    !options ||
    (options.loadModule !== undefined &&
      typeof options.loadModule !== 'function')
  ) {
    throw new NavigationError('NAVIGATION_RENDERER_INVALID');
  }
  /** Borrowed explicit manifest-module loader; fetched document scripts never select executable code. */
  const loadModule = options.loadModule;
  return {
    /** Validate inactive content and retain the common layout prefix before adoption.
     * @param {object} input - Explicit current/incoming navigation inputs.
     * @param {HTMLElement} input.root - Current host root.
     * @param {HTMLElement} input.incoming - Detached incoming root.
     * @param {PublicNavigationRoute | null} input.previous - Previous route descriptor.
     * @param {BrowserNavigationContext} input.context - Navigation signal and manifest facts.
     * @returns {Promise<PreparedBrowserPage>} Uncommitted owner with idempotent cleanup.
     */
    async prepare({ root, incoming, previous, context }) {
      context.signal.throwIfAborted();
      // Scripts from fetched HTML are never executed. Bootstrap code comes only from
      // manifest modules. Reject active embeds/handlers instead of treating DOMParser as a sanitizer.
      for (const element of [incoming, ...incoming.querySelectorAll('*')]) {
        if (
          element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
          ['BASE', 'IFRAME', 'OBJECT', 'EMBED', 'META'].includes(
            element.tagName
          ) ||
          [...element.attributes].some(
            (attribute) =>
              /^on/i.test(attribute.name) ||
              (/^(?:href|src|action|formaction|xlink:href)$/i.test(
                attribute.name
              ) &&
                !['http:', 'https:', 'mailto:', 'tel:'].includes(
                  new URL(attribute.value, 'https://localhost/').protocol
                ))
          )
        ) {
          throw new NavigationError('NAVIGATION_DOCUMENT_UNSAFE');
        }
        if (
          element.tagName === 'SCRIPT' &&
          element.getAttribute('type') !== 'application/json'
        ) {
          element.remove();
        }
      }
      /** Validate one authored layout/outlet chain without mutating either document.
       * @param {HTMLElement} container - Detached incoming or current root.
       * @param {readonly string[]} ids - Manifest-declared ordered layout identifiers.
       * @returns {HTMLElement[]} Validated nested outlets in declaration order.
       */
      const chain = (container: HTMLElement, ids: readonly string[]) => {
        /** Captured outlet chain used to retain only the common layout prefix. */
        const outlets: HTMLElement[] = [];
        let parent = container;
        for (const id of ids) {
          /** Exact matching layout candidates under the current authored parent. */
          const layouts = [
            ...parent.querySelectorAll<HTMLElement>('[data-zerux-layout]'),
          ].filter((node) => node.getAttribute('data-zerux-layout') === id);
          if (layouts.length !== 1) {
            throw new NavigationError('NAVIGATION_LAYOUT_INVALID');
          }
          // Exactly one layout was required before indexing this candidate.
          /** Unique layout candidate required by the manifest chain. */
          const layout = layouts[0]!;
          /** Required direct child outlet of this authored layout. */
          const outlet = layout.querySelector<HTMLElement>(
            ':scope > [data-zerux-outlet]'
          );
          if (!outlet) {
            throw new NavigationError('NAVIGATION_LAYOUT_INVALID');
          }
          outlets.push(outlet);
          parent = outlet;
        }
        return outlets;
      };
      /** Validated incoming document layout outlets. */
      const nextChain = chain(incoming, context.route.layouts);
      /** Validated current layout chain, absent for the first page. */
      const oldChain = previous ? chain(root, previous.layouts) : [];
      let common = 0;
      if (previous) {
        while (
          common < previous.layouts.length &&
          previous.layouts[common] === context.route.layouts[common]
        ) {
          common++;
        }
      }
      /** Retained current common-layout outlet, or the host root for a full replacement. */
      const target = common ? oldChain[common - 1]! : root;
      /** Incoming common-layout outlet, or complete detached incoming root. */
      const source = common ? nextChain[common - 1]! : incoming;
      let owner: BrowserPageOwner | undefined;
      if (context.route.asset) {
        if (!loadModule) {
          throw new NavigationError('NAVIGATION_MODULE_LOADER_REQUIRED');
        }
        /** Explicitly loaded manifest module; its prepare function is required before ownership transfer. */
        const module = await loadModule(context.route.asset, context.signal);
        context.signal.throwIfAborted();
        if (!module || typeof module.prepare !== 'function') {
          throw new NavigationError('NAVIGATION_MODULE_INVALID');
        }
        owner = await module.prepare(incoming, context);
        if (!owner || typeof owner.dispose !== 'function') {
          throw new NavigationError('NAVIGATION_MODULE_INVALID');
        }
      }
      let disposed: Promise<void> | undefined,
        committed = false;
      /** Release the optional page owner once, retaining its actual cleanup settlement.
       * @returns {Promise<void>} Idempotent page-owner disposal settlement.
       */
      const dispose = () =>
        (disposed ??= Promise.resolve().then(() => owner?.dispose()));
      if (context.signal.aborted) {
        await dispose();
        context.signal.throwIfAborted();
      }
      return {
        /** Commit this prepared detached page exactly once while navigation remains active.
         * @returns {void} Synchronous DOM adoption; closed or cancelled preparations reject.
         */
        commit() {
          context.signal.throwIfAborted();
          if (committed || disposed) {
            throw new NavigationError('NAVIGATION_PAGE_CLOSED');
          }
          committed = true;
          target.replaceChildren(...source.childNodes);
        },
        dispose,
      };
    },
  };
}
