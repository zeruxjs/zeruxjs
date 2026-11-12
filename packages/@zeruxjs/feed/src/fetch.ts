import { createHash } from 'node:crypto';
import type { FeedOptions } from './types.js';
import { createFeedResponse } from './http.js';
import { normalizeFeed, updated } from './utils.js';
/** Declared representation identities; this does not enable a transport or remote provider. */
export type FeedFormat = 'rss' | 'atom' | 'json';
/** Explicit public publication policy; all host resources and authorization remain borrowed. */
export interface FeedFetchOptions {
  /** Public fixed facts or trusted producer receiving only context.signal; no request/tenant identity is inferred. */
  feed:
    | FeedOptions
    | ((context: {
        /** Borrowed cooperative attempt signal combining request, handler lifetime and observation deadline. */
        signal: AbortSignal;
      }) => FeedOptions | Promise<FeedOptions>);
  /** Explicit rss/atom/json, default rss; negotiate alone interprets the request Accept header. */
  format?: FeedFormat | 'negotiate';
  /** Integer public freshness seconds 0–31536000, default 300; this is not an authentication policy. */
  cacheSeconds?: number;
  /** Integer selected-prefix limit 1–10000, default 1000; emitted truncation is explicitly reported. */
  maxItems?: number;
  /** Returned UTF-8 byte ceiling 256–64 MiB, default 8 MiB; not a total-heap limit. */
  maxBytes?: number;
  /** Cooperative observation milliseconds 1–60000, default 5000; synchronous work is not preemptible. */
  timeoutMs?: number;
  /** Per-instance actual unsettled producer/work limit 1–128, default 8; timeout does not release native capacity. */
  maxPending?: number;
}
/** Select only declared representations using bounded Accept quality/specificity and deterministic format ties; exact exclusions override wildcards.
 * @param {string} accept - Raw Accept value; empty selects RSS, more than 8192 characters/128 ranges yields no acceptable representation.
 * @returns {FeedFormat | undefined} Supported format or undefined; this never invokes a producer or falls back from an explicit q=0.
 */
function preferredFormat(accept: string): FeedFormat | undefined {
  if (!accept.trim()) {
    return 'rss';
  }
  if (accept.length > 8192) {
    return undefined;
  }
  /** Finite Accept ranges in authored header order; range count is checked before expansion. */
  const tokens = accept.split(',');
  if (tokens.length > 128) {
    return undefined;
  }
  /** Normalized range/quality records; malformed parameters receive zero quality. */
  const values = tokens.map((token, i) => {
    /** Normalized literal media range and parameter list; never interpreted as executable configuration. */
    const [type, ...params] = token
      .trim()
      .toLowerCase()
      .split(';')
      .map((v) => v.trim());
    /** Only explicit q parameters; duplicate qualities reject the range. */
    const weights = params.filter((v) => v.startsWith('q='));
    /** Literal quality string; native numeric conversion occurs only after bounded syntax validation. */
    const q = weights[0]?.slice(2);
    /** Whether this exact range uses supported quality/charset syntax. */
    const valid =
      weights.length <= 1 &&
      (q === undefined || /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q)) &&
      params.every(
        (p) => p.startsWith('q=') || /^charset=(?:utf-8|"utf-8")$/.test(p)
      );
    return {
      type,
      q: (() => {
        if (valid) {
          if (q === undefined) {
            return 1;
          }
          return Number(q);
        }
        return 0;
      })(),
      i,
    };
  });
  /** Fixed deterministic representation preference order for otherwise equal quality. */
  const formats: [FeedFormat, string][] = [
    ['rss', 'application/rss+xml'],
    ['atom', 'application/atom+xml'],
    ['json', 'application/feed+json'],
  ];
  return formats
    .map(([format, mime], index) => {
      /** Most specific applicable range, then quality/header-order tie; exact q=0 remains authoritative. */
      const match = values
        .map((v) => ({
          ...v,
          s: (() => {
            if (v.type === mime) {
              return 2;
            }
            if (v.type === 'application/*') {
              return 1;
            }
            if (v.type === '*/*') {
              return 0;
            }
            return -1;
          })(),
        }))
        .filter((v) => v.s >= 0)
        .sort((a, b) => b.s - a.s || b.q - a.q || a.i - b.i)[0];
      return { format, q: match?.q ?? 0, index };
    })
    .filter((v) => v.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.format;
}
/** Create an explicit public-feed handler with per-instance actual-settlement producer capacity. It owns cancellation observation, not a listener, authentication or host database/client lifetime.
 * @param {FeedFetchOptions} options - Plain own-data configuration with a public feed source and finite publication/observation budgets.
 * @throws {TypeError | RangeError} When source shape, unknown fields, format or finite policy is invalid before request work begins.
 * @returns {((request: Request) => Promise<Response>) & {close: () => Promise<void>, status: () => Readonly<{closed: boolean, pending: number}>}} Retained callable owner; host must await close, and noncooperative producers can delay drain.
 */
export function createFeedFetchHandler(options: FeedFetchOptions): ((
  request: Request
) => Promise<Response>) & {
  /** Stop admission, abort cooperative producers and await their actual work settlement; never force-cancel arbitrary JavaScript or close borrowed host clients.
   * @returns {Promise<void>} Idempotent producer drain; underlying HTTP response/socket ownership stays with the caller.
   */
  close(): Promise<void>;
  /** Project only immutable per-handler admission and actual unsettled-work counts.
   * @returns {Readonly<{closed: boolean, pending: number}>} Path/identity/content-free status; no distributed capacity or durability guarantee.
   */
  status(): Readonly<{
    /** Whether this handler has stopped admitting new work. */
    closed: boolean; /** Count of actual unsettled producer/serialization jobs, including timed-out callers. */
    pending: number;
  }>;
} {
  if (
    !options ||
    typeof options !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (k) =>
        typeof k !== 'string' ||
        ![
          'feed',
          'format',
          'cacheSeconds',
          'maxItems',
          'maxBytes',
          'timeoutMs',
          'maxPending',
        ].includes(k) ||
        !('value' in Object.getOwnPropertyDescriptor(options, k)!)
    )
  ) {
    throw new TypeError('Invalid feed handler options');
  }
  /** Validated public freshness seconds; Cookie/Authorization requests later receive defensive private headers. */
  const cache = options.cacheSeconds ?? 300;
  /** Finite selected-prefix budget, independent of a producer's source cardinality. */
  const maxItems = options.maxItems ?? 1000;
  /** Finite serialized UTF-8 budget applied to the selected publication. */
  const maxBytes = options.maxBytes ?? 8388608;
  /** Cooperative caller observation deadline in milliseconds, never forced native cancellation. */
  const timeout = options.timeoutMs ?? 5000;
  /** Per-handler actual unsettled-work ceiling; no global/distributed coordination. */
  const maxPending = options.maxPending ?? 8;
  /** Fixed format or explicit negotiation; unknown configuration rejects before acquisition. */
  const mode = options.format ?? 'rss';
  /** Trusted fixed facts or registered host callback; no URL/module discovery or automatic fetch. */
  const producer = options.feed;
  // Validate each fixed numeric policy before creating any producer/cancellation owner.
  for (const [value, min, max] of [
    [cache, 0, 31536000],
    [maxItems, 1, 10000],
    [maxBytes, 256, 67108864],
    [timeout, 1, 60000],
    [maxPending, 1, 128],
  ]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError('Invalid feed policy');
    }
  }
  if (
    !['rss', 'atom', 'json', 'negotiate'].includes(mode) ||
    (typeof producer !== 'function' &&
      (!producer || typeof producer !== 'object'))
  ) {
    throw new TypeError('Invalid feed configuration');
  }
  /** Actual unsettled producer/serialization promises; retained after caller timeout until native settlement. */
  const jobs = new Set<Promise<unknown>>();
  /** Owned handler cancellation scope; close aborts it before draining current jobs. */
  const lifetime = new AbortController();
  let closed = false,
    closing: Promise<void> | undefined;
  /**
   * Observe one public request while actual producer settlement independently owns capacity.
   *
   * @param {Request} request - Host-owned Fetch request; Cookie/Authorization affects cache privacy, never source authorization.
   * @returns {Promise<Response>} Selected public representation/validator response or redacted no-store failure; no mutation retries.
   */
  const handler = async (request: Request): Promise<Response> => {
    /** Accept variation only when this handler negotiates representations. */
    const vary = mode === 'negotiate' ? 'Accept' : '';
    /**
     * Project a body-free no-store unavailable response without raw dependency causes.
     *
     * @returns {Response} Fixed 503/retry metadata and negotiated Vary only; no automatic retry occurs.
     */
    const unavailable = () =>
      new Response(null, {
        status: 503,
        headers: {
          'cache-control': 'no-store',
          ...(vary ? { vary } : {}),
          'retry-after': '1',
        },
      });
    if (closed) {
      return unavailable();
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    /** Explicit configured or bounded negotiated representation, before invoking the producer. */
    const format =
      mode === 'negotiate'
        ? preferredFormat(request.headers.get('accept') ?? '')
        : mode;
    if (!format) {
      return new Response(null, {
        status: 406,
        headers: { vary: 'Accept', 'cache-control': 'no-store' },
      });
    }
    if (request.signal.aborted || jobs.size >= maxPending) {
      return unavailable();
    }
    /** Owned per-attempt observation deadline scope; native callback receives the combined signal. */
    const controller = new AbortController();
    /** Combined borrowed request, owned lifetime and owned deadline cancellation. */
    const signal = AbortSignal.any([
      request.signal,
      lifetime.signal,
      controller.signal,
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort = () => {};
    /** Observation rejection path; listener/timer ownership ends when this request observation finishes. */
    const canceled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('Feed canceled'));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
      }, timeout);
    });
    /** Actual producer plus normalization/serialization work; its settlement alone releases capacity. */
    const work = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      /** Trusted producer result checked for own data descriptors before reading selected content. */
      const source =
        typeof producer === 'function' ? await producer({ signal }) : producer;
      signal.throwIfAborted();
      if (
        !source ||
        typeof source !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(source)) ||
        Object.values(Object.getOwnPropertyDescriptors(source)).some(
          (d) => !('value' in d)
        )
      ) {
        throw new TypeError('Invalid feed');
      }
      /** Source array capped at 10000; only the selected prefix is normalized and emitted. */
      const rows = source.items;
      if (
        !Array.isArray(rows) ||
        Object.getPrototypeOf(rows) !== Array.prototype ||
        rows.length > 10000
      ) {
        throw new RangeError('Feed source limit');
      }
      /** Detached selected-prefix array; duplicate/field validation applies to emitted records. */
      const selected = [];
      // Read only selected own data descriptors; trailing source items are never silently evaluated.
      for (let i = 0; i < Math.min(maxItems, rows.length); i++) {
        /** Exact own indexed data descriptor; never invoke an accessor to read a selected item. */
        const d = Object.getOwnPropertyDescriptor(rows, String(i));
        if (!d || !('value' in d)) {
          throw new TypeError('Invalid feed row');
        }
        selected.push(d.value);
      }
      /** Detached validated selected publication; handler policy overrides source item/output budgets. */
      const feed = normalizeFeed({
        ...source,
        items: selected,
        maxItems,
        maxBytes,
      });
      /** Serialized low-level descriptor; later Fetch policy adds validators and defensive privacy. */
      const result = createFeedResponse(format, feed, cache);
      signal.throwIfAborted();
      return { feed, result, truncated: rows.length > selected.length };
    });
    jobs.add(work);
    void work.finally(() => jobs.delete(work)).catch(() => {});
    try {
      /** Completed selected work receipt; native work may instead outlive a cancelled caller. */
      const { feed, result, truncated } = await Promise.race([work, canceled]);
      /** Strong SHA-256 identity over format plus exact serialized body; no generation clock or private labels. */
      const etag =
        '"' +
        createHash('sha256')
          .update(format + '\0' + result.body)
          .digest('base64url') +
        '"';
      /** Owned response header projection; do not mutate a borrowed host response. */
      const headers = new Headers(result.headers);
      headers.set('etag', etag);
      /** Presence of credentials triggers defensive no-store/Vary, without authenticating or personalizing the source. */
      const personalized =
        request.headers.has('authorization') || request.headers.has('cookie');
      if (personalized) {
        headers.set('cache-control', 'private, no-store');
      }
      /** Explicit representation/credential variation fields for this response only. */
      const variations = [
        ...(vary ? [vary] : []),
        ...(personalized ? ['Cookie', 'Authorization'] : []),
      ];
      if (variations.length) {
        headers.set('vary', variations.join(', '));
      }
      if (truncated) {
        headers.set('x-feed-truncated', 'true');
      }
      /** Whether supplied feed/item dates contain a real update/publication fact. */
      const known =
        feed.updated !== undefined ||
        feed.items.some((i) => i.date !== undefined || i.updated !== undefined);
      /** Known maximum content epoch, or unused zero when no date fact exists. */
      const timestamp = known ? new Date(updated(feed)).getTime() : 0;
      if (known) {
        headers.set('last-modified', new Date(timestamp).toUTCString());
      }
      /** Most specific applicable range, then quality/header-order tie; exact q=0 remains authoritative. */
      const match = request.headers
        .get('if-none-match')
        ?.split(',')
        .some((v) => v.trim().replace(/^W\//, '') === etag || v.trim() === '*');
      if (match) {
        return new Response(null, { status: 304, headers });
      }
      if (!request.headers.has('if-none-match') && known) {
        /** Conditional date considered only when no If-None-Match field is present. */
        const since = request.headers.get('if-modified-since');
        if (
          since &&
          Number.isFinite(Date.parse(since)) &&
          Math.floor(timestamp / 1000) <= Math.floor(Date.parse(since) / 1000)
        ) {
          return new Response(null, { status: 304, headers });
        }
      }
      return new Response(request.method === 'HEAD' ? null : result.body, {
        headers,
      });
    } catch {
      return unavailable();
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      signal.removeEventListener('abort', abort);
    }
  };
  return Object.assign(handler, {
    /** Stop admission, abort cooperative producers and await their actual work settlement; never force-cancel arbitrary JavaScript or close borrowed host clients.
     * @returns {Promise<void>} Idempotent producer drain; underlying HTTP response/socket ownership stays with the caller.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      lifetime.abort();
      return (closing = (async () => {
        await Promise.allSettled([...jobs]);
      })());
    },
    status: () => Object.freeze({ closed, pending: jobs.size }),
  });
}
