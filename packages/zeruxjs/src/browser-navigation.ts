import {
  NavigationError,
  NAVIGATION_ERROR_CODES,
  readPublicRouteManifest,
  matchNavigationRoute,
  withinBase,
} from './navigation-manifest.js';
import {
  createDocumentNavigationRenderer,
  type BrowserNavigationRenderer,
  type BrowserNavigationContext,
  type BrowserPageOwner,
} from './browser-renderer.js';
export * from './navigation-manifest.js';
export * from './browser-renderer.js';
export interface BrowserRouterOptions {
  /** Untrusted serialized public route manifest, independently validated. */
  manifest: unknown;
  /** Connected authored page root with explicit route/policy/scope markers. */
  root: HTMLElement;
  /** Read an opaque public host identity/tenant/session revision without treating it as authentication.
   * @returns {string} Bounded public scope marker; never a bearer token.
   */
  scope(): string;
  /** Optional explicit page preparation/commit/dispose adapter. */
  renderer?: BrowserNavigationRenderer;
  /** Optional already mounted page owner disposed on replacement/close. */
  initialOwner?: BrowserPageOwner;
  /** Optional trusted Fetch transport; response origin/mount identity still rechecks. */
  fetch?: typeof fetch;
  /** Bounded cooperative navigation/prefetch deadline. */
  timeoutMs?: number;
  /** Maximum fetched document bytes. */
  maxBytes?: number;
  /** Maximum parsed document nodes. */
  maxNodes?: number;
  /** Maximum actual unsettled navigation jobs. */
  maxActive?: number;
  /** Explicit opt-in to manifest module prefetch; document/authenticated data is not prefetched. */
  prefetch?: boolean;
  /** Bounded remembered prefetch asset identities. */
  maxPrefetch?: number;
  /** Fixed-code observer; private URLs/bodies never appear as diagnostic payloads. */
  onError?: (code: string) => void;
  /** Explicit host integration, useful for embedding/tests. Defaults to location.assign. */
  documentNavigate?: (url: string) => void;
}
/** Wrap a borrowed initial/prepared page owner with one actual disposal settlement.
 * @param {BrowserPageOwner} owner - Explicit page resource owner.
 * @returns {BrowserPageOwner} Idempotent disposal wrapper without premature settlement.
 */
const own = (owner: BrowserPageOwner): BrowserPageOwner => {
  let closing: Promise<void> | undefined;
  return {
    dispose: () => (closing ??= Promise.resolve().then(() => owner.dispose())),
  };
};
/** Weak root ownership fence preventing duplicate navigation owners. */
const routers = new WeakMap<HTMLElement, unknown>();
/** Weak owner-window fence for native history/listener ownership. */
const windows = new WeakSet<Window>();
/** Validate bounded public scope/policy/loader identity labels without treating them as credentials.
 * @param {unknown} value - Untrusted public label candidate.
 * @returns {boolean} Whether the label matches the bounded public syntax.
 */
const token = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
/** Create an explicit disposable browser navigation owner; import alone reads no DOM or Node globals.
 * @param {BrowserRouterOptions} options - Validated public manifest/root, scope revision and explicit host callbacks/budgets.
 * @returns {object} Owned router; await close before reusing its window/root.
 */
export function createBrowserRouter(options: BrowserRouterOptions) {
  if (
    !options ||
    !options.root ||
    typeof options.root.querySelector !== 'function' ||
    !options.root.isConnected ||
    typeof options.scope !== 'function' ||
    (options.fetch !== undefined && typeof options.fetch !== 'function') ||
    (options.onError !== undefined && typeof options.onError !== 'function') ||
    (options.documentNavigate !== undefined &&
      typeof options.documentNavigate !== 'function') ||
    (options.initialOwner !== undefined &&
      typeof options.initialOwner.dispose !== 'function') ||
    (options.prefetch !== undefined && typeof options.prefetch !== 'boolean')
  ) {
    throw new NavigationError('NAVIGATION_OPTIONS_INVALID');
  }
  /** Host-owned connected page root; this router never owns the entire application document. */
  const root = options.root;
  /** Owner document for events, parsing, focus and announcements. */
  const doc = root.ownerDocument;
  /** Explicit owner window; no browser globals are accessed on module import. */
  const win = doc.defaultView;
  if (
    !win ||
    !root.id ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(root.id) ||
    routers.has(root) ||
    windows.has(win)
  ) {
    throw new NavigationError('NAVIGATION_ROOT_INVALID');
  }
  /** Independently validated bounded public route manifest. */
  const manifest = readPublicRouteManifest(options.manifest);
  /** Explicit host renderer or the document renderer; no UI runtime is auto-installed. */
  const renderer = options.renderer ?? createDocumentNavigationRenderer();
  /** Injected Fetch or borrowed owner-window Fetch. */
  const transport = options.fetch ?? win.fetch?.bind(win);
  /** Validated whole-navigation/prefetch cooperative deadline. */
  const timeout = options.timeoutMs ?? 10000;
  /** Validated response byte ceiling. */
  const maxBytes = options.maxBytes ?? 1048576;
  /** Validated parsed-document node ceiling. */
  const maxNodes = options.maxNodes ?? 10000;
  /** Maximum actual unsettled navigation jobs. */
  const maxActive = options.maxActive ?? 4;
  /** Bounded remembered asset-prefetch identities. */
  const maxPrefetch = options.maxPrefetch ?? 8;
  if (
    !transport ||
    !renderer ||
    typeof renderer.prepare !== 'function' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 16777216 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 1 ||
    maxNodes > 100000 ||
    !Number.isSafeInteger(maxActive) ||
    maxActive < 1 ||
    maxActive > 32 ||
    !Number.isSafeInteger(maxPrefetch) ||
    maxPrefetch < 0 ||
    maxPrefetch > 32
  ) {
    throw new NavigationError('NAVIGATION_LIMIT_INVALID');
  }
  /** Expose only the fixed navigation error vocabulary; observer failure never replaces navigation.
   * @param {string} code - Candidate internal error code.
   * @returns {void} Safe observer notification completion.
   */
  const report = (code: string) => {
    try {
      options.onError?.(
        NAVIGATION_ERROR_CODES.find((value) => value === code) ??
          'NAVIGATION_FAILED'
      );
    } catch {
      /* Observation cannot replace navigation. */
    }
  };
  /** Read a bounded public host scope revision used to prevent cross-scope DOM reuse, never to authorize server operations.
   * @returns {string} Current opaque navigation scope label.
   */
  const scope = () => {
    /** Current host public scope label validated before document reuse. */
    const value = options.scope();
    if (!token(value)) {
      throw new NavigationError('NAVIGATION_SCOPE_INVALID');
    }
    return value;
  };
  /** Initial opaque scope revision pinned for this router lifetime. */
  const currentScope = scope();
  /** Initial server-authored public policy marker required on every fetched document. */
  const policy = root.getAttribute('data-zerux-policy');
  if (
    !token(policy) ||
    root.getAttribute('data-zerux-scope') !== currentScope
  ) {
    throw new NavigationError('NAVIGATION_DOCUMENT_IDENTITY_REQUIRED');
  }
  let closed = false,
    serial = 0,
    currentUrl = new URL(win.location.href),
    currentRoute =
      matchNavigationRoute(manifest, currentUrl.pathname)?.route ?? null,
    currentOwner = options.initialOwner ? own(options.initialOwner) : undefined,
    currentController: AbortController | undefined,
    currentPageController: AbortController | undefined;
  if (!withinBase(currentUrl.pathname, manifest.basePath)) {
    throw new NavigationError('NAVIGATION_BASE_MISMATCH');
  }
  /** Manifest route matching the authored root marker, including explicit boundaries. */
  const declaredInitial = manifest.routes.find(
    (route) => route.id === root.getAttribute('data-zerux-route')
  );
  if (
    !declaredInitial ||
    (declaredInitial !== currentRoute &&
      ![manifest.boundaries.notFound, manifest.boundaries.error].includes(
        declaredInitial.id
      ))
  ) {
    throw new NavigationError('NAVIGATION_INITIAL_ROUTE_INVALID');
  }
  currentRoute = declaredInitial;
  /** Actual unsettled navigation work retained through renderer/loader cleanup. */
  const jobs = new Set<Promise<unknown>>();
  /** Bounded asset URL/integrity identities with short observation expiry. */
  const prefetches = new Map<string, number>();
  /** Actual unsettled prefetch requests, capped independently. */
  const prefetchJobs = new Set<Promise<unknown>>();
  /** Owned cancellation controllers for accepted asset prefetches. */
  const prefetchControllers = new Set<AbortController>();
  /** Bounded history-ID to scroll/focus projection, excluding page data. */
  const positions = new Map<
    number,
    {
      /** Saved horizontal scroll coordinate. */
      x: number; /** Saved vertical scroll coordinate. */
      y: number; /** Authored focused-element ID for logical restoration. */
      focus: string;
    }
  >();
  let historyId = 0,
    currentHistory = 0,
    pageCounter = 0,
    currentPageId = 0,
    intentTimer: ReturnType<typeof setTimeout> | undefined,
    closing: Promise<void> | undefined;
  /** Original browser history restoration mode restored on router close. */
  const oldRestoration = win.history.scrollRestoration;
  /** Owned polite live-region node removed on teardown. */
  const announce = doc.createElement('div');
  announce.setAttribute('role', 'status');
  announce.setAttribute('aria-live', 'polite');
  announce.setAttribute('aria-atomic', 'true');
  Object.assign(announce.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
  });
  doc.body.append(announce);
  /** Retain one bounded history scroll/focus snapshot before changing the page.
   * @returns {void} Owner-local position update.
   */
  const save = () => {
    positions.set(currentHistory, {
      x: win.scrollX,
      y: win.scrollY,
      focus: doc.activeElement?.id ?? '',
    });
    if (positions.size > 128) {
      positions.delete(positions.keys().next().value!);
    }
  };
  /** Create a private navigation history marker while retaining unrelated native history state.
   * @param {number} id - Monotonic owner-local history ID.
   * @returns {object} Native history state with a bounded navigation marker.
   */
  const state = (id: number) => ({
    ...win.history.state,
    __zeruxNavigation: { version: 1, id, page: currentPageId },
  });
  try {
    win.history.replaceState(state(0), '');
    win.history.scrollRestoration = 'manual';
  } catch {
    announce.remove();
    throw new NavigationError('NAVIGATION_HISTORY_UNAVAILABLE');
  }
  /** Delegate safe HTTP(S) navigation to the browser/explicit host fallback when enhancement cannot continue.
   * @param {URL} url - Validated destination candidate without URL credentials.
   * @returns {void} Native document navigation request completion.
   */
  const full = (url: URL) => {
    if (closed) {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      report('NAVIGATION_URL_DENIED');
      return;
    }
    try {
      (
        options.documentNavigate ??
        /** Request native navigation after scheme/credential validation.
         * @param {string} value - Validated destination URL.
         * @returns {void} Native navigation request completion.
         */
        ((value) => win.location.assign(value))
      )(url.href);
    } catch {
      report('NAVIGATION_DOCUMENT_FAILED');
    }
  };
  /** Read bounded response bytes with streaming UTF-8 decode and actual reader cleanup.
   * @param {Response} response - Borrowed response transferring reader ownership here.
   * @param {AbortSignal} signal - Navigation/prefetch cancellation signal.
   * @param {number} budget - Explicit byte ceiling, default the configured document limit.
   * @returns {Promise<string>} Decoded bounded body; reader cancellation/unlock always settle.
   */
  const read = async (
    response: Response,
    signal: AbortSignal,
    budget = maxBytes
  ) => {
    if (!response.body) {
      return '';
    }
    /** Owned response-body reader cancelled and unlocked on every terminal path. */
    const reader = response.body.getReader();
    /** Incremental UTF-8 decoder preserving fragmented code points. */
    const decoder = new TextDecoder();
    let size = 0,
      text = '';
    /** Cancel an owned reader when the navigation signal aborts.
     * @returns {void} Reader cancellation scheduling completion.
     */
    const abort = () => void reader.cancel().catch(() => {});
    signal.addEventListener('abort', abort, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        /** One actual reader result checked after cancellation and against aggregate size. */
        const item = await reader.read();
        signal.throwIfAborted();
        if (item.done) {
          break;
        }
        size += item.value.byteLength;
        if (size > budget) {
          throw new NavigationError('NAVIGATION_BODY_LIMIT');
        }
        text += decoder.decode(item.value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      signal.removeEventListener('abort', abort);
    }
  };
  /** Restrict enhanced navigation to same-origin HTTP(S) URLs inside the configured mount.
   * @param {URL} url - Parsed candidate destination.
   * @returns {boolean} Whether router enhancement is allowed; server authorization remains authoritative.
   */
  const eligible = (url: URL) =>
    url.origin === win.location.origin &&
    !url.username &&
    !url.password &&
    /^https?:$/.test(url.protocol) &&
    url.href.length <= 8192 &&
    withinBase(url.pathname, manifest.basePath);
  /** Restore authored focus/anchor/scroll without manufacturing positive tabindex order.
   * @param {URL} url - Committed destination including its optional hash.
   * @param {object | undefined} position - Optional previously retained history position.
   * @param {number} position.x - Saved horizontal scroll coordinate.
   * @param {number} position.y - Saved vertical scroll coordinate.
   * @param {string} position.focus - Authored focused-element ID, if retained.
   * @returns {void} Synchronous native focus/scroll restoration.
   */
  const restore = (
    url: URL,
    position?: {
      /** Saved horizontal scroll coordinate. */
      x: number; /** Saved vertical scroll coordinate. */
      y: number; /** Authored focused-element ID for logical restoration. */
      focus: string;
    }
  ) => {
    let anchor: HTMLElement | null = null;
    if (url.hash) {
      try {
        anchor = doc.getElementById(decodeURIComponent(url.hash.slice(1)));
      } catch {
        /* Invalid fragment keeps normal top restoration. */
      }
    }
    /** Previously focused authored element, if its ID still exists. */
    const focus = position?.focus ? doc.getElementById(position.focus) : null;
    /** Logical authored focus target, fragment anchor, heading or host root fallback. */
    const target =
      focus ??
      anchor ??
      root.querySelector<HTMLElement>('[data-zerux-focus],h1') ??
      root;
    /** Original tabindex state restored after temporary programmatic focus. */
    const prior = target.getAttribute('tabindex');
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: true });
    if (prior === null) {
      target.removeAttribute('tabindex');
    }
    if (position) {
      win.scrollTo(position.x, position.y);
    } else if (anchor) {
      anchor.scrollIntoView?.();
    } else {
      win.scrollTo(0, 0);
    }
  };
  /** Prepare one bounded navigation, suppress stale work and commit only a matching public scope/policy document.
   * @param {string | URL} input - Explicit destination resolved against the current URL.
   * @param {string} mode - Internal push/replace/pop history policy.
   * @param {object | undefined} position - Optional retained history position.
   * @param {number} position.x - Saved horizontal scroll coordinate.
   * @param {number} position.y - Saved vertical scroll coordinate.
   * @param {string} position.focus - Authored focused-element ID, if retained.
   * @param {number | undefined} page - Optional owned history page identity.
   * @returns {Promise<string>} Explicit committed/cancelled/document fallback outcome.
   */
  const navigate = (
    input: string | URL,
    mode: 'push' | 'replace' | 'pop' = 'push',
    position?: {
      /** Saved horizontal scroll coordinate. */
      x: number; /** Saved vertical scroll coordinate. */
      y: number; /** Authored focused-element ID for logical restoration. */
      focus: string;
    },
    page?: number
  ): Promise<'committed' | 'cancelled' | 'document'> => {
    let url: URL;
    try {
      url = new URL(input, currentUrl);
    } catch {
      return Promise.reject(new NavigationError('NAVIGATION_URL_INVALID'));
    }
    if (closed) {
      return Promise.reject(new NavigationError('NAVIGATION_CLOSED'));
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      return Promise.reject(new NavigationError('NAVIGATION_URL_DENIED'));
    }
    if (!eligible(url)) {
      full(url);
      return Promise.resolve('document');
    }
    /** Monotonic navigation fence; stale results cannot commit. */
    const sequence = ++serial;
    currentController?.abort();
    if (
      url.pathname === currentUrl.pathname &&
      url.search === currentUrl.search &&
      (mode === 'pop'
        ? page === currentPageId
        : url.hash !== currentUrl.hash || !!url.hash || url.href.endsWith('#'))
    ) {
      if (mode !== 'pop') {
        save();
        win.history[mode === 'replace' ? 'replaceState' : 'pushState'](
          state(++historyId),
          '',
          url
        );
        currentHistory = historyId;
      }
      currentUrl = url;
      restore(url, position);
      return Promise.resolve('committed');
    }
    if (jobs.size >= maxActive) {
      report('NAVIGATION_OVERLOAD');
      full(url);
      return Promise.resolve('document');
    }
    /** Owned navigation or prefetch cooperative cancellation controller. */
    const controller = new AbortController();
    currentController = controller;
    /** Owned per-operation deadline timer removed after actual work settles. */
    const timer = setTimeout(() => controller.abort(), timeout);
    /** Actual navigation preparation/commit/cleanup settlement retained for capacity and close. */
    const job = (async () => {
      let prepared:
          | Awaited<ReturnType<BrowserNavigationRenderer['prepare']>>
          | undefined,
        committed = false,
        loading = true;
      /** Bounded navigation-owned disposers retained through actual load settlement. */
      const cleanups: (() => void | Promise<void>)[] = [];
      let release: Promise<void> | undefined;
      /** Release prepared page resources and registered disposers once, retaining actual cleanup settlement.
       * @returns {Promise<void>} Idempotent cleanup receipt with aggregated failures.
       */
      const cleanup = () =>
        (release ??= (async () => {
          /** Cleanup failures retained without skipping remaining owned releases. */
          const errors: unknown[] = [];
          try {
            await prepared?.dispose();
          } catch (error) {
            errors.push(error);
          }
          for (const dispose of cleanups.reverse()) {
            try {
              await dispose();
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length) {
            throw new AggregateError(errors, 'Navigation cleanup failed');
          }
        })());
      /** Navigation-local producer promise map, never a persisted cross-principal cache. */
      const cache = new Map<string, Promise<unknown>>();
      try {
        /** Opaque public host scope revision checked before and after response/preparation; not an auth token. */
        const authenticatedScope = scope();
        /** Actual HTML or explicit manifest-asset response under its own transfer policy. */
        const response = await transport(url.href, {
          method: 'GET',
          headers: { accept: 'text/html' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          redirect: 'follow',
        });
        if (sequence !== serial || controller.signal.aborted) {
          await response.body?.cancel();
          if (sequence === serial) {
            controller.signal.throwIfAborted();
          }
          return 'cancelled' as const;
        }
        /** Native final response URL rechecked against origin/mount policy before DOM adoption. */
        const finalUrl = new URL(response.url || url.href);
        if (!finalUrl.hash && !response.redirected) {
          finalUrl.hash = url.hash;
        }
        /** Shared manifest route match for the final path. */
        const match = matchNavigationRoute(manifest, finalUrl.pathname);
        /** Explicit manifest not-found/error route ID selected only for the response status. */
        let boundary: string | undefined;
        if (response.status === 404) {
          boundary = manifest.boundaries.notFound;
        } else if (response.status >= 500) {
          boundary = manifest.boundaries.error;
        } else {
          boundary = undefined;
        }
        /** Validated manifest route selected for document identity matching. */
        const route = boundary
          ? manifest.routes.find((route) => route.id === boundary)
          : match?.route;
        if (
          !eligible(finalUrl) ||
          response.status === 401 ||
          response.status === 403 ||
          (response.status >= 400 && !boundary) ||
          !route ||
          !/^text\/html(?:;|$)/i.test(
            response.headers.get('content-type') ?? ''
          )
        ) {
          await response.body?.cancel();
          full(finalUrl);
          return 'document' as const;
        }
        /** Bounded fetched document text; embedded scripts are not executed by this parser. */
        const html = await read(response, controller.signal);
        /** Detached parsed HTML document used only after bounded node/identity checks. */
        const parsed = new win.DOMParser().parseFromString(html, 'text/html');
        /** Unique detached root required to match route, scope and policy markers. */
        const incoming = parsed.getElementById(root.id);
        if (parsed.querySelectorAll('*').length > maxNodes) {
          throw new NavigationError('NAVIGATION_DOCUMENT_LIMIT');
        }
        if (
          !incoming ||
          parsed.querySelectorAll('[id]').length > 10000 ||
          parsed.querySelectorAll('#' + root.id).length !== 1 ||
          incoming.getAttribute('data-zerux-route') !== route.id ||
          incoming.getAttribute('data-zerux-policy') !== policy ||
          incoming.getAttribute('data-zerux-scope') !== authenticatedScope ||
          authenticatedScope !== currentScope ||
          scope() !== authenticatedScope
        ) {
          full(finalUrl);
          return 'document' as const;
        }
        /** Immutable navigation-local signal, validated route facts, public scope and cleanup/load authority. */
        const context: BrowserNavigationContext = Object.freeze({
          signal: controller.signal,
          url: finalUrl,
          route,
          params: match?.params ?? Object.freeze({}),
          scope: authenticatedScope,
          /** Register bounded page preparation cleanup while this navigation is loading.
           * @param {() => void | Promise<void>} dispose - Trusted disposer returning actual asynchronous settlement.
           * @returns {void} Cleanup registration completion.
           */
          onDispose(dispose: () => void | Promise<void>) {
            if (
              !loading ||
              typeof dispose !== 'function' ||
              cleanups.length >= 32
            ) {
              throw new NavigationError('NAVIGATION_CLEANUP_INVALID');
            }
            cleanups.push(dispose);
          },
          /** Memoize one bounded trusted producer within this navigation only.
           * @param {string} key - Bounded local producer identity.
           * @param {(signal: AbortSignal) => Promise<T>} producer - Signal-aware explicit host data producer.
           * @returns {Promise<T>} Navigation-local result; stale/cancelled navigation cannot commit it.
           */
          load<T>(
            key: string,
            producer: (signal: AbortSignal) => Promise<T>
          ): Promise<T> {
            if (!loading || !token(key) || typeof producer !== 'function') {
              throw new NavigationError('NAVIGATION_LOADER_INVALID');
            }
            controller.signal.throwIfAborted();
            if (!cache.has(key)) {
              if (cache.size >= 16) {
                throw new NavigationError('NAVIGATION_LOADER_LIMIT');
              }
              cache.set(
                key,
                Promise.resolve().then(() => {
                  controller.signal.throwIfAborted();
                  return producer(controller.signal);
                })
              );
            }
            return cache.get(key)! as Promise<T>;
          },
        });
        prepared = await renderer.prepare({
          root,
          incoming: doc.importNode(incoming, true),
          previous: currentRoute,
          context,
        });
        loading = false;
        await Promise.all(cache.values());
        if (sequence !== serial) {
          return 'cancelled' as const;
        }
        controller.signal.throwIfAborted();
        if (scope() !== authenticatedScope) {
          full(finalUrl);
          return 'document' as const;
        }
        if (
          !prepared ||
          typeof prepared.commit !== 'function' ||
          typeof prepared.dispose !== 'function'
        ) {
          throw new NavigationError('NAVIGATION_RENDERER_INVALID');
        }
        if (mode !== 'pop') {
          save();
        }
        currentPageController?.abort();
        await currentOwner?.dispose();
        if (sequence !== serial) {
          return 'cancelled' as const;
        }
        controller.signal.throwIfAborted();
        prepared.commit();
        committed = true;
        currentOwner = own({ dispose: cleanup });
        currentPageController = controller;
        currentController = undefined;
        currentRoute = route;
        currentUrl = finalUrl;
        root.setAttribute('data-zerux-route', route.id);
        doc.title = parsed.title;
        currentPageId =
          mode === 'pop' ? (page ?? ++pageCounter) : ++pageCounter;
        if (mode !== 'pop') {
          win.history[mode === 'replace' ? 'replaceState' : 'pushState'](
            state(++historyId),
            '',
            finalUrl
          );
          currentHistory = historyId;
        } else if (finalUrl.href !== win.location.href) {
          win.history.replaceState(state(currentHistory), '', finalUrl);
        }
        restore(finalUrl, position);
        announce.textContent =
          parsed.title ||
          root.querySelector('h1')?.textContent ||
          'Page changed';
        return 'committed' as const;
      } catch (error) {
        if (sequence !== serial || controller.signal.aborted) {
          if (sequence === serial && !closed) {
            report('NAVIGATION_TIMEOUT');
            full(url);
            return 'document' as const;
          }
          return 'cancelled' as const;
        }
        report(
          error instanceof NavigationError ? error.code : 'NAVIGATION_FAILED'
        );
        full(url);
        return 'document' as const;
      } finally {
        loading = false;
        clearTimeout(timer);
        try {
          if (!committed) {
            controller.abort();
            await cleanup();
          }
        } finally {
          await Promise.allSettled(cache.values());
          cache.clear();
        }
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job)).catch(() => {});
    return job;
  };
  /** Recognize an eligible authored anchor while preserving downloads, editing and explicit native navigation.
   * @param {Event} event - Borrowed native input event.
   * @returns {URL | null} Eligible same-origin URL or null for ordinary browser behavior.
   */
  const link = (event: Event) => {
    /** Logical authored focus target, fragment anchor, heading or host root fallback. */
    const target = event.target as Element | null;
    /** Closest authored eligible anchor; SVG/foreign anchors and overrides stay native. */
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (
      !anchor ||
      anchor.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      anchor.hasAttribute('download') ||
      anchor.hasAttribute('data-zerux-reload') ||
      (anchor.target && anchor.target.toLowerCase() !== '_self') ||
      anchor.relList.contains('external') ||
      anchor.closest('[contenteditable]:not([contenteditable="false"])')
    ) {
      return null;
    }
    try {
      /** Parsed explicit or authored link/prefetch destination, never a server authorization grant. */
      const url = new URL(anchor.href);
      return eligible(url) ? url : null;
    } catch {
      return null;
    }
  };
  /** Intercept only ordinary unmodified primary-button eligible links.
   * @param {MouseEvent} event - Borrowed native click event.
   * @returns {void} Enhanced navigation scheduling or unchanged native behavior.
   */
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    /** Parsed explicit or authored link/prefetch destination, never a server authorization grant. */
    const url = link(event);
    if (!url) {
      return;
    }
    event.preventDefault();
    void navigate(url).catch(() => report('NAVIGATION_FAILED'));
  };
  /** Validate owner history markers before restoring a previous page/position.
   * @param {PopStateEvent} event - Native history traversal event.
   * @returns {void} Enhanced restoration scheduling or document fallback.
   */
  const pop = (event: PopStateEvent) => {
    /** Untrusted native history marker checked before any owner-local restoration. */
    const state = event.state?.__zeruxNavigation;
    if (
      !state ||
      state.version !== 1 ||
      !Number.isSafeInteger(state.id) ||
      state.id < 0 ||
      !Number.isSafeInteger(state.page) ||
      state.page < 0
    ) {
      full(new URL(win.location.href));
      return;
    }
    save();
    currentHistory = state.id;
    void navigate(
      win.location.href,
      'pop',
      positions.get(state.id),
      state.page
    ).catch(() => report('NAVIGATION_FAILED'));
  };
  /** Fetch only a manifest-selected module asset under bounded anonymous integrity-checked transfer.
   * @param {string | URL} input - Candidate page destination, never an arbitrary asset URL.
   * @returns {Promise<boolean>} Whether this bounded prefetch observation succeeded or was already current.
   */
  const prefetch = async (input: string | URL) => {
    if (closed || !options.prefetch || !maxPrefetch || prefetchJobs.size >= 2) {
      return false;
    }
    /** Parsed explicit or authored link/prefetch destination, never a server authorization grant. */
    const url = new URL(input, currentUrl);
    if (!eligible(url)) {
      return false;
    }
    /** Validated manifest-selected module URL/integrity record; no document data is prefetched. */
    const asset = matchNavigationRoute(manifest, url.pathname)?.route.asset;
    if (!asset) {
      return false;
    }
    /** Asset URL/integrity identity, distinct from authenticated page data. */
    const key = asset.url + ' ' + asset.integrity;
    if ((prefetches.get(key) ?? 0) > Date.now()) {
      return true;
    }
    for (const [cached, expires] of prefetches) {
      if (expires <= Date.now()) {
        prefetches.delete(cached);
      }
    }
    if (prefetches.size >= maxPrefetch) {
      return false;
    }
    /** Owned navigation or prefetch cooperative cancellation controller. */
    const controller = new AbortController();
    prefetchControllers.add(controller);
    prefetches.set(key, Date.now() + 30000);
    /** Owned per-operation deadline timer removed after actual work settles. */
    const timer = setTimeout(() => controller.abort(), timeout);
    /** Actual bounded prefetch transfer retained until reader cleanup settles. */
    const task = (async () => {
      try {
        /** Actual HTML or explicit manifest-asset response under its own transfer policy. */
        const response = await transport(
          new URL(asset.url, win.location.origin),
          {
            credentials: 'omit',
            cache: 'force-cache',
            integrity: asset.integrity,
            redirect: 'error',
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new NavigationError('NAVIGATION_PREFETCH_FAILED');
        }
        await read(response, controller.signal, Math.min(maxBytes, 524288));
        return true;
      } catch {
        prefetches.delete(key);
        report('NAVIGATION_PREFETCH_FAILED');
        return false;
      } finally {
        clearTimeout(timer);
        prefetchControllers.delete(controller);
      }
    })();
    prefetchJobs.add(task);
    try {
      return await task;
    } finally {
      prefetchJobs.delete(task);
    }
  };
  /** Debounce an eligible pointer/focus prefetch intent without changing native navigation.
   * @param {Event} event - Borrowed pointer/focus event.
   * @returns {void} Optional bounded prefetch scheduling.
   */
  const intent = (event: Event) => {
    /** Parsed explicit or authored link/prefetch destination, never a server authorization grant. */
    const url = link(event);
    if (!url) {
      return;
    }
    clearTimeout(intentTimer);
    intentTimer = setTimeout(() => void prefetch(url), 100);
  };
  /** Cancel a pending intent timer before pointer/focus leaves or teardown.
   * @returns {void} Timer cancellation completion.
   */
  const clearIntent = () => clearTimeout(intentTimer);
  doc.addEventListener('click', click);
  win.addEventListener('popstate', pop);
  if (options.prefetch) {
    doc.addEventListener('pointerover', intent);
    doc.addEventListener('focusin', intent);
    doc.addEventListener('pointerout', clearIntent);
    doc.addEventListener('focusout', clearIntent);
  }
  /** Owned router handle; close releases native history/event/page ownership. */
  const api = {
    navigate: (url: string | URL) => navigate(url),
    prefetch,
    /** Count actual unsettled navigation jobs, including cleanup.
     * @returns {number} Current retained navigation job count.
     */
    get pending() {
      return jobs.size;
    },
    /** Count actual unsettled asset-prefetch transfers.
     * @returns {number} Current retained prefetch count.
     */
    get pendingPrefetch() {
      return prefetchJobs.size;
    },
    /** Abort active navigation/prefetch, detach owned events, restore history policy and drain actual work before releasing the current page.
     * @returns {Promise<void>} Idempotent router cleanup settlement with explicit aggregated failures.
     */
    close() {
      return (closing ??= (async () => {
        closed = true;
        serial++;
        clearTimeout(intentTimer);
        currentController?.abort();
        currentPageController?.abort();
        for (const controller of prefetchControllers) {
          controller.abort();
        }
        doc.removeEventListener('click', click);
        win.removeEventListener('popstate', pop);
        doc.removeEventListener('pointerover', intent);
        doc.removeEventListener('focusin', intent);
        doc.removeEventListener('pointerout', clearIntent);
        doc.removeEventListener('focusout', clearIntent);
        announce.remove();
        win.history.scrollRestoration = oldRestoration;
        /** Actual navigation and prefetch settlements collected before owner cleanup completes. */
        const results = await Promise.allSettled([...jobs, ...prefetchJobs]);
        /** Cleanup failures retained without skipping remaining owned releases. */
        const errors = results
          .filter((result) => result.status === 'rejected')
          .map((result) => (result as PromiseRejectedResult).reason);
        try {
          await currentOwner?.dispose();
        } catch (error) {
          errors.push(error);
        } finally {
          positions.clear();
          prefetches.clear();
          routers.delete(root);
          windows.delete(win);
        }
        if (errors.length) {
          throw new AggregateError(errors, 'Navigation cleanup failed');
        }
      })());
    },
  };
  routers.set(root, api);
  windows.add(win);
  return api;
}
