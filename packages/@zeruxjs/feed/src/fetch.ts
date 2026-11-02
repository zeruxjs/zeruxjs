import { createHash } from "node:crypto";
import type { FeedOptions } from "./types.js";
import { createFeedResponse } from "./http.js";
import { normalizeFeed, updated } from "./utils.js";
export type FeedFormat = "rss" | "atom" | "json";
export interface FeedFetchOptions {
  feed:
    | FeedOptions
    | ((context: {
        signal: AbortSignal;
      }) => FeedOptions | Promise<FeedOptions>);
  format?: FeedFormat | "negotiate";
  cacheSeconds?: number;
  maxItems?: number;
  maxBytes?: number;
  timeoutMs?: number;
  maxPending?: number;
}
function preferredFormat(accept: string): FeedFormat | undefined {
  if (!accept.trim()) return "rss";
  if (accept.length > 8192) return undefined;
  const tokens = accept.split(",");
  if (tokens.length > 128) return undefined;
  const values = tokens.map((token, i) => {
    const [type, ...params] = token
      .trim()
      .toLowerCase()
      .split(";")
      .map((v) => v.trim());
    const weights = params.filter((v) => v.startsWith("q="));
    const q = weights[0]?.slice(2);
    const valid =
      weights.length <= 1 &&
      (q === undefined || /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q)) &&
      params.every(
        (p) => p.startsWith("q=") || /^charset=(?:utf-8|"utf-8")$/.test(p),
      );
    return { type, q: valid ? (q === undefined ? 1 : Number(q)) : 0, i };
  });
  const formats: [FeedFormat, string][] = [
    ["rss", "application/rss+xml"],
    ["atom", "application/atom+xml"],
    ["json", "application/feed+json"],
  ];
  return formats
    .map(([format, mime], index) => {
      const match = values
        .map((v) => ({
          ...v,
          s:
            v.type === mime
              ? 2
              : v.type === "application/*"
                ? 1
                : v.type === "*/*"
                  ? 0
                  : -1,
        }))
        .filter((v) => v.s >= 0)
        .sort((a, b) => b.s - a.s || b.q - a.q || a.i - b.i)[0];
      return { format, q: match?.q ?? 0, index };
    })
    .filter((v) => v.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.format;
}
/** Public-feed Fetch endpoint. close drains actual producer settlement; no remote URL is fetched by this package. */
export function createFeedFetchHandler(
  options: FeedFetchOptions,
): ((request: Request) => Promise<Response>) & {
  close(): Promise<void>;
  status(): Readonly<{ closed: boolean; pending: number }>;
} {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (k) =>
        typeof k !== "string" ||
        ![
          "feed",
          "format",
          "cacheSeconds",
          "maxItems",
          "maxBytes",
          "timeoutMs",
          "maxPending",
        ].includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(options, k)!),
    )
  )
    throw new TypeError("Invalid feed handler options");
  const cache = options.cacheSeconds ?? 300,
    maxItems = options.maxItems ?? 1000,
    maxBytes = options.maxBytes ?? 8388608,
    timeout = options.timeoutMs ?? 5000,
    maxPending = options.maxPending ?? 8,
    mode = options.format ?? "rss",
    producer = options.feed;
  for (const [value, min, max] of [
    [cache, 0, 31536000],
    [maxItems, 1, 10000],
    [maxBytes, 256, 67108864],
    [timeout, 1, 60000],
    [maxPending, 1, 128],
  ])
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new RangeError("Invalid feed policy");
  if (
    !["rss", "atom", "json", "negotiate"].includes(mode) ||
    (typeof producer !== "function" &&
      (!producer || typeof producer !== "object"))
  )
    throw new TypeError("Invalid feed configuration");
  const jobs = new Set<Promise<unknown>>(),
    lifetime = new AbortController();
  let closed = false,
    closing: Promise<void> | undefined;
  const handler = async (request: Request): Promise<Response> => {
    const vary = mode === "negotiate" ? "Accept" : "",
      unavailable = () =>
        new Response(null, {
          status: 503,
          headers: {
            "cache-control": "no-store",
            ...(vary ? { vary } : {}),
            "retry-after": "1",
          },
        });
    if (closed) return unavailable();
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    const format =
      mode === "negotiate"
        ? preferredFormat(request.headers.get("accept") ?? "")
        : mode;
    if (!format)
      return new Response(null, {
        status: 406,
        headers: { vary: "Accept", "cache-control": "no-store" },
      });
    if (request.signal.aborted || jobs.size >= maxPending) return unavailable();
    const controller = new AbortController(),
      signal = AbortSignal.any([
        request.signal,
        lifetime.signal,
        controller.signal,
      ]);
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort = () => {};
    const canceled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("Feed canceled"));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
      }, timeout);
    });
    const work = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      const source =
        typeof producer === "function" ? await producer({ signal }) : producer;
      signal.throwIfAborted();
      if (
        !source ||
        typeof source !== "object" ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(source)) ||
        Object.values(Object.getOwnPropertyDescriptors(source)).some(
          (d) => !("value" in d),
        )
      )
        throw new TypeError("Invalid feed");
      const rows = source.items;
      if (
        !Array.isArray(rows) ||
        Object.getPrototypeOf(rows) !== Array.prototype ||
        rows.length > 10000
      )
        throw new RangeError("Feed source limit");
      const selected = [];
      for (let i = 0; i < Math.min(maxItems, rows.length); i++) {
        const d = Object.getOwnPropertyDescriptor(rows, String(i));
        if (!d || !("value" in d)) throw new TypeError("Invalid feed row");
        selected.push(d.value);
      }
      const feed = normalizeFeed({
          ...source,
          items: selected,
          maxItems,
          maxBytes,
        }),
        result = createFeedResponse(format, feed, cache);
      signal.throwIfAborted();
      return { feed, result, truncated: rows.length > selected.length };
    });
    jobs.add(work);
    void work.finally(() => jobs.delete(work)).catch(() => {});
    try {
      const { feed, result, truncated } = await Promise.race([work, canceled]);
      const etag =
          '"' +
          createHash("sha256")
            .update(format + "\0" + result.body)
            .digest("base64url") +
          '"',
        headers = new Headers(result.headers);
      headers.set("etag", etag);
      const personalized =
        request.headers.has("authorization") || request.headers.has("cookie");
      if (personalized) headers.set("cache-control", "private, no-store");
      const variations = [
        ...(vary ? [vary] : []),
        ...(personalized ? ["Cookie", "Authorization"] : []),
      ];
      if (variations.length) headers.set("vary", variations.join(", "));
      if (truncated) headers.set("x-feed-truncated", "true");
      const known =
          feed.updated !== undefined ||
          feed.items.some(
            (i) => i.date !== undefined || i.updated !== undefined,
          ),
        timestamp = known ? new Date(updated(feed)).getTime() : 0;
      if (known)
        headers.set("last-modified", new Date(timestamp).toUTCString());
      const match = request.headers
        .get("if-none-match")
        ?.split(",")
        .some((v) => v.trim().replace(/^W\//, "") === etag || v.trim() === "*");
      if (match) return new Response(null, { status: 304, headers });
      if (!request.headers.has("if-none-match") && known) {
        const since = request.headers.get("if-modified-since");
        if (
          since &&
          Number.isFinite(Date.parse(since)) &&
          Math.floor(timestamp / 1000) <= Math.floor(Date.parse(since) / 1000)
        )
          return new Response(null, { status: 304, headers });
      }
      return new Response(request.method === "HEAD" ? null : result.body, {
        headers,
      });
    } catch {
      return unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
  return Object.assign(handler, {
    close() {
      if (closing) return closing;
      closed = true;
      lifetime.abort();
      return (closing = (async () => {
        await Promise.allSettled([...jobs]);
      })());
    },
    status: () => Object.freeze({ closed, pending: jobs.size }),
  });
}
