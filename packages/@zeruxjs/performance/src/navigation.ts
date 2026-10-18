/** Public-static navigation prefetching. Browser globals are read only when installed. */
export interface NavigationPrefetchOptions {
  /** Explicit public path prefixes, each beginning and ending with /. */
  paths: readonly string[];
  maxPages?: number;
  delayMs?: number;
  /** Force link mode for restrictive CSPs or unsupported speculation rules. */
  strategy?: "auto" | "link";
  nonce?: string;
}
export interface NavigationPrefetch {
  prefetch(href: string): boolean;
  readonly queued: readonly string[];
  readonly mode: "speculation" | "link" | "disabled";
  destroy(): void;
}
interface ConnectionInformation extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
}

/** Install a bounded hover/focus prefetcher for explicitly public static pages.
 * @param options Public paths, resource budget and optional CSP nonce.
 * @returns Explicitly disposable controller; an inert controller without a DOM.
 * Globals: document, window, navigator and HTMLScriptElement, accessed at installation only.
 */
export function installNavigationPrefetch(
  options: NavigationPrefetchOptions,
): NavigationPrefetch {
  const max = options.maxPages ?? 6;
  const delay = options.delayMs ?? 120;
  if (
    !Array.isArray(options.paths) ||
    options.paths.length < 1 ||
    options.paths.some((path) => !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(path))
  )
    throw new TypeError("Explicit public path prefixes are required");
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 20 ||
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > 2000
  )
    throw new RangeError("Invalid navigation prefetch budget");
  const queued = new Set<string>();
  const nodes: HTMLElement[] = [];
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    typeof navigator === "undefined"
  ) {
    return {
      prefetch: () => false,
      get queued() {
        return [];
      },
      mode: "disabled",
      destroy() {},
    };
  }
  const connection = (
    navigator as Navigator & { connection?: ConnectionInformation }
  ).connection;
  const allowed = () =>
    !destroyed &&
    !connection?.saveData &&
    !["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "") &&
    navigator.onLine !== false &&
    document.visibilityState !== "hidden";
  const supports =
    typeof HTMLScriptElement !== "undefined" &&
    typeof HTMLScriptElement.supports === "function" &&
    HTMLScriptElement.supports("speculationrules");
  const mode = options.strategy !== "link" && supports ? "speculation" : "link";
  const normalize = (href: string): string | undefined => {
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.origin !== window.location.origin ||
      url.username ||
      url.password ||
      url.search ||
      !url.pathname.endsWith("/") ||
      !options.paths.some((prefix) => url.pathname.startsWith(prefix)) ||
      url.pathname === window.location.pathname
    )
      return;
    url.hash = "";
    return url.href;
  };
  const prefetch = (href: string) => {
    const url = normalize(href);
    if (!allowed() || !url || queued.has(url) || queued.size >= max)
      return false;
    queued.add(url);
    if (mode === "speculation") {
      const script = document.createElement("script");
      script.type = "speculationrules";
      if (options.nonce) script.nonce = options.nonce;
      script.textContent = JSON.stringify({
        prefetch: [{ source: "list", urls: [url] }],
      });
      script.dataset.zeruxPrefetch = "speculation";
      document.head.append(script);
      nodes.push(script);
    } else {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "document";
      link.href = url;
      link.dataset.zeruxPrefetch = "link";
      document.head.append(link);
      nodes.push(link);
    }
    return true;
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const intent = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self") ||
      anchor.closest("[data-no-prefetch]") ||
      anchor.rel.split(/\s+/).includes("nofollow")
    )
      return;
    const href = anchor.href;
    if (!normalize(href)) return;
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      prefetch(href);
    }, delay);
  };
  const networkChanged = () => {
    if (!allowed()) {
      cancel();
      for (const node of nodes) node.remove();
    }
  };
  document.addEventListener("pointerover", intent, { passive: true });
  document.addEventListener("focusin", intent);
  document.addEventListener("pointerout", cancel, { passive: true });
  document.addEventListener("focusout", cancel);
  document.addEventListener("visibilitychange", networkChanged);
  connection?.addEventListener("change", networkChanged);
  return {
    prefetch,
    get queued() {
      return [...queued];
    },
    get mode() {
      return allowed() ? mode : "disabled";
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      document.removeEventListener("pointerover", intent);
      document.removeEventListener("focusin", intent);
      document.removeEventListener("pointerout", cancel);
      document.removeEventListener("focusout", cancel);
      document.removeEventListener("visibilitychange", networkChanged);
      connection?.removeEventListener("change", networkChanged);
      for (const node of nodes) node.remove();
    },
  };
}
