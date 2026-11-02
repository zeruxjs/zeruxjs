import {
  absolute,
  plain,
  publicPolicy,
  type PublicSite,
  type CrawlerRequestContext,
} from "./public-policy.js";
export interface PublicRedirect {
  from: string;
  to: string;
  status: 301 | 302 | 303 | 307 | 308;
}
/** Exact GET/HEAD rules. No request-derived target, wildcard rewrite or query copying. */
export function createPublicRedirects(options: {
  site: PublicSite;
  rules: readonly PublicRedirect[];
  externalOrigins?: readonly string[];
}) {
  plain(options, ["site", "rules", "externalOrigins"]);
  const policy = publicPolicy(options.site),
    rules = new Map<string, { url: string; status: number }>();
  if (
    !Array.isArray(options.rules) ||
    options.rules.length > 1000 ||
    !Array.isArray(options.externalOrigins ?? []) ||
    (options.externalOrigins?.length ?? 0) > 16
  )
    throw new RangeError("Redirect limit");
  const external = (options.externalOrigins ?? []).map((value) => {
    const url = absolute(value);
    if (url.pathname !== "/") throw new TypeError("External origin required");
    return url.origin;
  });
  for (const r of options.rules) {
    plain(r, ["from", "to", "status"]);
    if (
      typeof r.from !== "string" ||
      !r.from.startsWith("/") ||
      r.from.startsWith("//") ||
      absolute(policy.root + r.from).pathname !== r.from ||
      ![301, 302, 303, 307, 308].includes(r.status)
    )
      throw new TypeError("Invalid redirect");
    const from = policy.page(policy.root + r.from);
    if (rules.has(from)) throw new TypeError("Duplicate redirect");
    const target =
      r.to?.startsWith("/") && !r.to.startsWith("//")
        ? absolute(policy.root + r.to)
        : absolute(r.to);
    if (target.origin === policy.root) policy.page(target.href);
    else if (!external.includes(target.origin))
      throw new TypeError("Open redirect denied");
    rules.set(from, { url: target.href, status: r.status });
  }
  for (const from of rules.keys()) {
    const seen = new Set<string>();
    let current = from;
    while (rules.has(current)) {
      if (seen.has(current) || seen.size >= 32)
        throw new TypeError("Redirect loop or chain limit");
      seen.add(current);
      current = rules.get(current)!.url;
    }
  }
  return {
    handler(request: Request, context?: CrawlerRequestContext) {
      if (!policy.request(request, context))
        return new Response(null, { status: 421 });
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      const url = new URL(request.url),
        match = rules.get(policy.root + url.pathname);
      return match
        ? new Response(null, {
            status: match.status,
            headers: { location: match.url, "cache-control": "no-store" },
          })
        : new Response(null, { status: 404 });
    },
  };
}
