import {
  absolute,
  plain,
  publicPolicy,
  type PublicSite,
  type CrawlerRequestContext,
} from './public-policy.js';
export interface PublicRedirect {
  /** Exact configured public mounted source path; traversal/wildcards reject. */
  from: string;
  /** Fixed approved public destination URL/path; queries/fragments reject. */
  to: string;
  /** Deliberate301/302/303/307/308 policy; this handler serves only GET/HEAD. */
  status: 301 | 302 | 303 | 307 | 308;
}
/** Compile bounded fixed GET/HEAD redirect rules with cycle/open-target prevention. Rules are inert configuration, not dynamic request-derived rewrites.
 * @param {{
  site: PublicSite;
  rules: readonly PublicRedirect[];
  externalOrigins?: readonly string[];
}} options - Trusted public settings, exact rules and optional approved external origins.
 * @param {PublicSite} options.site - Trusted configured public origin/prefix/proxy policy.
 * @param {readonly PublicRedirect[]} options.rules - At most1000 fixed exact rules.
 * @param {readonly string[]} options.externalOrigins - Optional at-most16 exact approved external origins.
 * @returns {object} Inert Fetch handler; no listener starts and all redirects are no-store.
 */
export function createPublicRedirects(options: {
  /** Trusted public origin/prefix/proxy configuration. */
  site: PublicSite;
  /** At most1000 exact fixed redirect declarations. */
  rules: readonly PublicRedirect[];
  /** At most16 exact explicit external origins; same-site is the default boundary. */
  externalOrigins?: readonly string[];
}) {
  plain(options, ['site', 'rules', 'externalOrigins']);
  /** Captured explicit public origin/prefix/proxy policy; it never reads forwarded values for Location. */
  const policy = publicPolicy(options.site);
  /** Validated fixed source-to-destination graph; request queries/captures never become destinations. */
  const rules = new Map<
    string,
    {
      url: string;
      /** Deliberate301/302/303/307/308 policy; this handler serves only GET/HEAD. */
      status: number;
    }
  >();
  if (
    !Array.isArray(options.rules) ||
    options.rules.length > 1000 ||
    !Array.isArray(options.externalOrigins ?? []) ||
    (options.externalOrigins?.length ?? 0) > 16
  ) {
    throw new RangeError('Redirect limit');
  }
  /** Explicit exact approved external origins; same-site destinations remain prefix-bound. */
  const external = (options.externalOrigins ?? []).map((value) => {
    /** Parsed validated fixed destination or request URL. */
    const url = absolute(value);
    if (url.pathname !== '/') {
      throw new TypeError('External origin required');
    }
    return url.origin;
  });
  // Compile only fixed configured redirects; no request parameter selects a target.
  for (const r of options.rules) {
    plain(r, ['from', 'to', 'status']);
    if (
      typeof r.from !== 'string' ||
      !r.from.startsWith('/') ||
      r.from.startsWith('//') ||
      absolute(policy.root + r.from).pathname !== r.from ||
      ![301, 302, 303, 307, 308].includes(r.status)
    ) {
      throw new TypeError('Invalid redirect');
    }
    /** Canonical configured public source URL; duplicate source rules reject. */
    const from = policy.page(policy.root + r.from);
    if (rules.has(from)) {
      throw new TypeError('Duplicate redirect');
    }
    /** Fixed validated destination with no query/fragment or traversal ambiguity. */
    const target =
      r.to?.startsWith('/') && !r.to.startsWith('//')
        ? absolute(policy.root + r.to)
        : absolute(r.to);
    if (target.origin === policy.root) {
      policy.page(target.href);
    } else if (!external.includes(target.origin)) {
      throw new TypeError('Open redirect denied');
    }
    rules.set(from, { url: target.href, status: r.status });
  }
  // Validate every configured source graph before returning an inert handler.
  for (const from of rules.keys()) {
    /** Per-source redirect graph traversal, bounded to32 nodes and rejecting cycles. */
    const seen = new Set<string>();
    let current = from;
    // Bound graph traversal and reject cycles, including redirects back to the original source.
    while (rules.has(current)) {
      if (seen.has(current) || seen.size >= 32) {
        throw new TypeError('Redirect loop or chain limit');
      }
      seen.add(current);
      current = rules.get(current)!.url;
    }
  }
  return {
    /** Match one fixed public GET/HEAD source after origin/direct-peer admission. Request queries/forwarding headers never affect Location.
     * @param {Request} request - Borrowed initiating Fetch request.
     * @param {CrawlerRequestContext} context - Optional trusted host direct-peer context.
     * @returns {Response} Configured fixed redirect,421/405 denial or404; no user-input redirect target is evaluated.
     */
    handler(request: Request, context?: CrawlerRequestContext) {
      if (!policy.request(request, context)) {
        return new Response(null, { status: 421 });
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response(null, {
          status: 405,
          headers: { allow: 'GET, HEAD' },
        });
      }
      /** Parsed validated fixed destination or request URL. */
      const url = new URL(request.url);
      /** Exact configured source-path match; no caller next/return URL is copied. */
      const match = rules.get(policy.root + url.pathname);
      return match
        ? new Response(null, {
            status: match.status,
            headers: { location: match.url, 'cache-control': 'no-store' },
          })
        : new Response(null, { status: 404 });
    },
  };
}
