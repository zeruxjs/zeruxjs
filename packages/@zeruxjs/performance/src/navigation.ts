/** Public-static navigation prefetching. Browser globals are read only when installed. */
export interface NavigationPrefetchOptions {
  /** Explicit public path prefixes, each beginning and ending with /. */
  paths: readonly string[];
  /** Distinct per-document hint budget, default 6, valid 1 through 20. */
  maxPages?: number;
  /** Intent debounce delay, default 120 ms, valid 0 through 2000. */
  delayMs?: number;
  /** Force link mode for restrictive CSPs or unsupported speculation rules. */
  strategy?: 'auto' | 'link';
  /** Optional host-approved CSP nonce for speculation rules; never an authorization credential. */
  nonce?: string;
}
export interface NavigationPrefetch {
  /** Submit one eligible deduplicated static-page hint if current network/page policy permits it.
   * @param {string} href - Explicit same-origin eligible directory URL; queries/private routes are not discovered automatically.
   * @returns {boolean} Whether a new hint was admitted; never proof that the browser fetched it.
   */
  prefetch(href: string): boolean;
  /** Fresh submitted URL snapshot; native browser completion is unknown. */
  readonly queued: readonly string[];
  /** Current supported strategy or disabled under network/page/server policy. */
  readonly mode: 'speculation' | 'link' | 'disabled';
  /** Remove only owned listeners, pending intent timer and injected hint nodes; does not erase native browser caches.
   * @returns {void} Idempotent teardown, including an inert server controller.
   */
  destroy(): void;
}
interface ConnectionInformation extends EventTarget {
  /** Borrowed native Save-Data preference; suppresses new hints. */
  saveData?: boolean;
  /** Borrowed native network class; 3g and slower suppress new hints. */
  effectiveType?: string;
}

/** Own bounded intent-driven hints for explicit public static prefixes. Browser policy can decline them; globals are read only at installation and server installation is inert.
 * @param {NavigationPrefetchOptions} options - Public side-effect-free paths, per-document budget, delay and optional CSP policy.
 * @returns {NavigationPrefetch} Disposable controller; queued means submitted hints, not completed cached requests.
 */
export function installNavigationPrefetch(
  options: NavigationPrefetchOptions
): NavigationPrefetch {
  /** Validated distinct-URL hint ceiling, default six and at most twenty. */
  const max = options.maxPages ?? 6;
  /** Validated intent debounce delay in milliseconds, default 120. */
  const delay = options.delayMs ?? 120;
  if (
    !Array.isArray(options.paths) ||
    options.paths.length < 1 ||
    options.paths.some(
      (path) => !/^\/(?:[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\/)*$/.test(path)
    )
  ) {
    throw new TypeError('Explicit public path prefixes are required');
  }
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 20 ||
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > 2000
  ) {
    throw new RangeError('Invalid navigation prefetch budget');
  }
  /** Per-controller unique submitted URLs; disposal does not clear browser caches. */
  const queued = new Set<string>();
  /** Only hint DOM nodes created by this controller; removed on suppression/destroy. */
  const nodes: HTMLElement[] = [];
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    typeof navigator === 'undefined'
  ) {
    return {
      prefetch: () => false,
      get queued() {
        return [];
      },
      mode: 'disabled',
      /** Remove only owned listeners, pending intent timer and injected hint nodes; does not erase native browser caches.
       * @returns {void} Idempotent teardown, including an inert server controller.
       */
      destroy() {},
    };
  }
  /** Borrowed optional native network information; listener lifetime is owned here. */
  const connection = (
    navigator as Navigator & { connection?: ConnectionInformation }
  ).connection;
  /** Check current visibility/connectivity/data-saving policy without treating it as authorization.
   * @returns {boolean} Whether new hints are currently allowed.
   */
  const allowed = () =>
    !destroyed &&
    !connection?.saveData &&
    !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '') &&
    navigator.onLine !== false &&
    document.visibilityState !== 'hidden';
  /** Native declaration of speculation-rule support, not proof of fetch execution. */
  const supports =
    typeof HTMLScriptElement !== 'undefined' &&
    typeof HTMLScriptElement.supports === 'function' &&
    HTMLScriptElement.supports('speculationrules');
  /** Explicit link override or supported speculation strategy selected once at installation. */
  const mode = options.strategy !== 'link' && supports ? 'speculation' : 'link';
  /** Resolve and restrict a candidate to known same-origin public static directory URLs.
   * @param {string} href - Candidate URL under the host public-prefix policy.
   * @returns {string | undefined} Normalized allowed URL, or undefined for an ineligible candidate.
   */
  const normalize = (href: string): string | undefined => {
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.origin !== window.location.origin ||
      url.username ||
      url.password ||
      url.search ||
      !url.pathname.endsWith('/') ||
      !options.paths.some((prefix) => url.pathname.startsWith(prefix)) ||
      url.pathname === window.location.pathname
    ) {
      return;
    }
    url.hash = '';
    return url.href;
  };
  /** Submit a bounded unique hint only while current runtime policy permits it.
   * @param {string} href - Candidate URL validated against public static prefixes.
   * @returns {boolean} Whether one new hint was submitted.
   */
  const prefetch = (href: string) => {
    /** Validated candidate absolute URL under explicitly public host prefixes. */
    const url = normalize(href);
    if (!allowed() || !url || queued.has(url) || queued.size >= max) {
      return false;
    }
    queued.add(url);
    if (mode === 'speculation') {
      /** Owned inert speculation-rules script containing a JSON URL list, not executable JavaScript. */
      const script = document.createElement('script');
      script.type = 'speculationrules';
      if (options.nonce) {
        script.nonce = options.nonce;
      }
      script.textContent = JSON.stringify({
        prefetch: [{ source: 'list', urls: [url] }],
      });
      script.dataset.zeruxPrefetch = 'speculation';
      document.head.append(script);
      nodes.push(script);
    } else {
      /** Owned native document-prefetch hint; the browser decides whether to fetch. */
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = url;
      link.dataset.zeruxPrefetch = 'link';
      document.head.append(link);
      nodes.push(link);
    }
    return true;
  };
  /** Cancel only the pending intent timer; active browser fetches remain browser-owned.
   * @returns {void} Clears the owned intent timer only.
   */
  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = undefined;
  };
  /** Inspect authored anchor intent without touching opted-out/private-action links.
   * @param {Event} event - Native pointer/focus intent event.
   * @returns {void} Schedules only an eligible link hint.
   */
  const intent = (event: Event) => {
    /** Borrowed native event target narrowed before closest-anchor inspection. */
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    /** Eligible authored link with explicit exclusions for downloads/nofollow/alternate targets. */
    const anchor = target.closest('a[href]');
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute('download') ||
      (anchor.target && anchor.target !== '_self') ||
      anchor.closest('[data-no-prefetch]') ||
      anchor.rel.split(/\s+/).includes('nofollow')
    ) {
      return;
    }
    /** Captured link destination revalidated before submitting the delayed hint. */
    const href = anchor.href;
    if (!normalize(href)) {
      return;
    }
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      prefetch(href);
    }, delay);
  };
  /** Suppress pending/injected hints when visibility/network policy changes.
   * @returns {void} Cancels/removes owned hints under current suppression policy.
   */
  const networkChanged = () => {
    if (!allowed()) {
      cancel();
      // Remove only this controller's injected hints, leaving authored links untouched.
      for (const node of nodes) {
        node.remove();
      }
    }
  };
  document.addEventListener('pointerover', intent, { passive: true });
  document.addEventListener('focusin', intent);
  document.addEventListener('pointerout', cancel, { passive: true });
  document.addEventListener('focusout', cancel);
  document.addEventListener('visibilitychange', networkChanged);
  connection?.addEventListener('change', networkChanged);
  return {
    prefetch,
    get queued() {
      return [...queued];
    },
    get mode() {
      return allowed() ? mode : 'disabled';
    },
    /** Remove only owned listeners, pending intent timer and injected hint nodes; does not erase native browser caches.
     * @returns {void} Idempotent teardown, including an inert server controller.
     */
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancel();
      document.removeEventListener('pointerover', intent);
      document.removeEventListener('focusin', intent);
      document.removeEventListener('pointerout', cancel);
      document.removeEventListener('focusout', cancel);
      document.removeEventListener('visibilitychange', networkChanged);
      connection?.removeEventListener('change', networkChanged);
      // Remove only this controller's injected hints, leaving authored links untouched.
      for (const node of nodes) {
        node.remove();
      }
    },
  };
}
