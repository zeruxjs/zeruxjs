import { createRemoteResource, type RemoteResource } from './reactive.js';

export interface DiscoveryClientOptions {
  /** Absolute discovery service origin. */
  baseUrl?: string;
  /** Fetch implementation owned by the host or global runtime. */
  fetch?: typeof fetch;
  /** Bounded absolute path for search requests. */
  searchPath?: string;
  /** Bounded absolute path for feed requests. */
  feedPath?: string;
  /** Cooperative request deadline in milliseconds. */
  timeoutMs?: number;
  /** Maximum discovery response size in bytes. */
  maxResponseBytes?: number;
}
export interface DiscoverySearchOptions {
  /** Maximum number of results returned by the service. */
  limit?: number;
  /** Number of matching results to skip. */
  offset?: number;
  /** Whether any or all query terms must match. */
  mode?: 'any' | 'all';
  /** Request prefix matching instead of exact matching. */
  prefix?: boolean;
  /** Signal that cancels this caller's request. */
  signal?: AbortSignal;
}
export interface DiscoveryResult<T> {
  /** Source document returned for the match. */
  document: T;
  /** Service-provided relevance score. */
  score: number;
  /** Fields or terms that matched the query. */
  matches: string[];
}
export interface DiscoverySearchResponse<T> {
  /** Normalized query accepted by the service. */
  query: string;
  /** Bounded matching documents. */
  results: DiscoveryResult<T>[];
  /** Applied result limit. */
  limit: number;
  /** Applied result offset. */
  offset: number;
}
/** HTTP failure returned while reading a discovery document. */
export class DiscoveryHttpError extends Error {
  /**
   * Create a discovery error while retaining the response status.
   *
   * @param {string} message - Safe failure message.
   * @param {number} status - HTTP status returned by discovery.
   */
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'DiscoveryHttpError';
  }
}
/**
 * Reject absolute-origin/query/fragment/backslash overrides in configured endpoint paths.
 * @param {string} value - Trusted configuration candidate still requiring runtime path validation.
 * @returns {string} Validated origin-relative path without query/fragment overrides.
 */
function safePath(value: string): string {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('#') ||
    value.includes('?') ||
    /\\/.test(value)
  ) {
    throw new TypeError('Discovery paths must be origin-relative');
  }
  return value;
}
/** Browser/SSR client for Zerux Search and Feed endpoints, without hidden global state. */
/**
 * Create an inert client with instance-owned conditional feed cache and request cancellation.
 * @param {DiscoveryClientOptions} config - Explicit origin/routes, borrowed transport and bounded request policy.
 * @returns {object} Instance-owned search/suggest/feed methods and explicit disposal.
 */
export function createDiscoveryClient(config: DiscoveryClientOptions = {}) {
  /** Validated private client origin; credentials/query/hash are not accepted in this configuration. */
  const origin = new URL(
    config.baseUrl ??
      (typeof location !== 'undefined' ? location.origin : 'http://localhost')
  );
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  ) {
    throw new TypeError('Invalid discovery origin');
  }
  /**
   * Resolve only a validated origin-relative configured route.
   * @param {string} pathname - Fixed configured route; search text is added separately as encoded query values.
   * @returns {URL} Resolved fixed endpoint, before query values are added.
   */
  const endpoint = (pathname: string) => new URL(safePath(pathname), origin);
  /** Fixed origin-relative search route; no caller-controlled endpoint discovery. */
  const searchPath = safePath(config.searchPath ?? '/search');
  /** Fixed origin-relative feed route used by every representation. */
  const feedPath = safePath(config.feedPath ?? '/feed');
  /** Finite cooperative request deadline, cleared when the request settles. */
  const timeout = config.timeoutMs ?? 10000;
  /** Maximum accumulated response bytes for search, suggestions or feed representations. */
  const maxBytes = config.maxResponseBytes ?? 2_097_152;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 256 ||
    maxBytes > 50_000_000
  ) {
    throw new RangeError('Invalid discovery limits');
  }
  /** Borrowed Fetch implementation; disposal never closes a host/global transport pool. */
  const transport = config.fetch ?? fetch;
  /** Active request controllers signalled on dispose; noncooperative transports may settle later. */
  const controllers = new Set<AbortController>();
  let disposed = false;
  /** At most one conditional representation per supported format; not a shared tenant cache. */
  const feedCache = new Map<
    string,
    { etag: string; body: string; contentType: string }
  >();
  /**
 * Fetch one bounded representation with cooperative deadline and detached signal listeners.
 * @param {URL} url - Internally constructed approved discovery endpoint.
 * @param {string} accept - Required representation MIME type.
 * @param {AbortSignal} signal - Borrowed cooperative caller cancellation.
 * @param {string} etag - Prior server validator for this same cached representation.
 * @returns {Promise<{
    status: number;
    body: string;
    etag?: string;
    contentType: string;
  }>} Bounded decoded representation plus HTTP validator metadata.
 */
  async function get(
    url: URL,
    accept: string,
    signal?: AbortSignal,
    etag?: string
  ): Promise<{
    status: number;
    body: string;
    etag?: string;
    contentType: string;
  }> {
    if (disposed) {
      throw new Error('Discovery client disposed');
    }
    /** This request’s cancellation owner, removed from the active set in finally. */
    const controller = new AbortController();
    controllers.add(controller);
    /**
     * Forward this request’s borrowed cancellation into its owned controller.
     * @returns {void} Signals this request’s owned controller.
     */
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }
    /** Owned cooperative deadline; signalling does not prove a remote request was rolled back. */
    const timer = setTimeout(
      () => controller.abort(new Error('Discovery request timed out')),
      timeout
    );
    try {
      /** Fresh negotiation/validator headers with credentials explicitly omitted. */
      const headers = new Headers({ accept });
      if (etag) {
        headers.set('if-none-match', etag);
      }
      /** One response; optional feed cache is reused only after a matching 304. */
      const response = await transport(url.toString(), {
        method: 'GET',
        headers,
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 304) {
        return {
          status: 304,
          body: '',
          contentType: response.headers.get('content-type') ?? '',
          etag: response.headers.get('etag') ?? undefined,
        };
      }
      if (!response.ok) {
        throw new DiscoveryHttpError(
          `Discovery request failed: ${response.status}`,
          response.status
        );
      }
      /** Declared byte count is only an early guard; streamed byte counts remain authoritative. */
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new DiscoveryHttpError('Discovery response too large', 413);
      }
      if (!response.body) {
        throw new DiscoveryHttpError('Missing response body', 502);
      }
      /** Exclusive body reader released even if decoding/accumulation fails. */
      const reader = response.body.getReader();
      /** Bounded response pieces, combined only after byte accounting succeeds. */
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          /** Transport read result; accumulated size is checked before retaining the chunk. */
          const next = await reader.read();
          if (next.done) {
            break;
          }
          size += next.value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new DiscoveryHttpError('Discovery response too large', 413);
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      /** Exact-sized completed body decoded with fatal UTF-8 handling. */
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        status: response.status,
        body: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        etag: response.headers.get('etag') ?? undefined,
        contentType: response.headers.get('content-type') ?? '',
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controllers.delete(controller);
    }
  }
  /**
   * Reject unsafe/negative/oversized pagination values before sending a request.
   * @param {number | undefined} value - Trusted configuration candidate still requiring runtime path validation.
   * @param {string} name - Fixed diagnostic label for the pagination field.
   * @param {number} max - Maximum allowed pagination value.
   * @returns {number | undefined} Validated pagination value, preserving omission.
   */
  const integer = (value: number | undefined, name: string, max: number) => {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0 || value > max)
    ) {
      throw new RangeError(`Invalid ${name}`);
    }
    return value;
  };
  /**
   * Request bounded search data; generic document types are a host contract, not runtime schema validation.
   * @param {string} q - Query text capped at 1024 JavaScript code units, encoded as a value rather than a URL.
   * @param {DiscoverySearchOptions} options - Pagination/matching policy and cooperative signal for this request.
   * @returns {Promise<DiscoverySearchResponse<T>>} Parsed search envelope; document schema remains a host contract.
   */
  const search = async <T = unknown>(
    q: string,
    options: DiscoverySearchOptions = {}
  ): Promise<DiscoverySearchResponse<T>> => {
    if (typeof q !== 'string' || q.length > 1024) {
      throw new TypeError('Invalid search query');
    }
    /** Fixed configured endpoint with query values encoded through URLSearchParams. */
    const url = endpoint(searchPath);
    url.searchParams.set('q', q);
    if (options.limit !== undefined) {
      url.searchParams.set(
        'limit',
        String(integer(options.limit, 'limit', 1000))
      );
    }
    if (options.offset !== undefined) {
      url.searchParams.set(
        'offset',
        String(integer(options.offset, 'offset', 1_000_000))
      );
    }
    if (options.mode) {
      url.searchParams.set('mode', options.mode);
    }
    if (options.prefix) {
      url.searchParams.set('prefix', '1');
    }
    /** Bounded response requiring representation-specific validation before exposure. */
    const result = await get(url, 'application/json', options.signal);
    if (!/application\/json/i.test(result.contentType)) {
      throw new DiscoveryHttpError('Unexpected search content type', 502);
    }
    return JSON.parse(result.body) as DiscoverySearchResponse<T>;
  };
  /**
   * Request suggestions and independently validate every returned string.
   * @param {string} q - Query text capped at 1024 JavaScript code units, encoded as a value rather than a URL.
   * @param {AbortSignal} signal - Borrowed cooperative caller cancellation.
   * @returns {Promise<string[]>} Validated suggestion strings.
   */
  const suggest = async (
    q: string,
    signal?: AbortSignal
  ): Promise<string[]> => {
    if (typeof q !== 'string' || q.length > 1024) {
      throw new TypeError('Invalid suggestion query');
    }
    /** Fixed configured endpoint with query values encoded through URLSearchParams. */
    const url = endpoint(searchPath);
    url.searchParams.set('q', q);
    url.searchParams.set('suggest', '1');
    /** Bounded response requiring representation-specific validation before exposure. */
    const result = await get(url, 'application/json', signal);
    if (!/application\/json/i.test(result.contentType)) {
      throw new DiscoveryHttpError('Unexpected suggestion content type', 502);
    }
    /** Suggestion payload independently checked for an array of strings. */
    const parsed = JSON.parse(result.body) as { suggestions?: unknown };
    if (
      !Array.isArray(parsed.suggestions) ||
      parsed.suggestions.some((s) => typeof s !== 'string')
    ) {
      throw new DiscoveryHttpError('Invalid suggestion payload', 502);
    }
    return parsed.suggestions;
  };
  /**
   * Fetch one negotiated feed, retaining only a server-validated conditional representation.
   * @param {'rss' | 'atom' | 'json'} format - Explicit supported RSS, Atom or JSON representation.
   * @param {AbortSignal} signal - Borrowed cooperative caller cancellation.
   * @returns {Promise<string>} Negotiated feed text, reused only after a valid conditional response.
   */
  const feed = async (
    format: 'rss' | 'atom' | 'json' = 'rss',
    signal?: AbortSignal
  ): Promise<string> => {
    if (!['rss', 'atom', 'json'].includes(format)) {
      throw new TypeError('Invalid feed format');
    }
    /** Exact requested feed representation, never inferred from untrusted endpoint text. */
    const accept = {
      rss: 'application/rss+xml',
      atom: 'application/atom+xml',
      json: 'application/feed+json',
    }[format];
    /** Fixed configured endpoint with query values encoded through URLSearchParams. */
    const url = endpoint(feedPath);
    /** Previous representation used only with its server ETag. */
    const cached = feedCache.get(format);
    /** Bounded response requiring representation-specific validation before exposure. */
    const result = await get(url, accept, signal, cached?.etag);
    if (result.status === 304) {
      if (!cached) {
        throw new DiscoveryHttpError('Uncached 304 feed response', 502);
      }
      return cached.body;
    }
    if (!result.contentType.toLowerCase().includes(accept)) {
      throw new DiscoveryHttpError('Unexpected feed content type', 502);
    }
    if (result.etag) {
      feedCache.set(format, {
        etag: result.etag,
        body: result.body,
        contentType: result.contentType,
      });
    } else {
      feedCache.delete(format);
    }
    return result.body;
  };
  return {
    search,
    suggest,
    feed,
    /** A Zyro reactive resource with explicit refresh/cancel/dispose. */
    /**
     * Create inert reactive search state; explicit refresh starts the request.
     * @param {string} q - Query text capped at 1024 JavaScript code units, encoded as a value rather than a URL.
     * @param {Omit<DiscoverySearchOptions, 'signal'>} options - Pagination/matching policy and cooperative signal for this request.
     * @returns {RemoteResource<DiscoverySearchResponse<T>>} Inert resource; refresh starts the request and dispose fences state commits.
     */
    searchResource<T = unknown>(
      q: string,
      options: Omit<DiscoverySearchOptions, 'signal'> = {}
    ): RemoteResource<DiscoverySearchResponse<T>> {
      return createRemoteResource((signal) =>
        search<T>(q, { ...options, signal })
      );
    },
    /**
     * Drop all local feed validators/bodies without touching active requests.
     * @returns {void} Drops only local conditional representation state.
     */
    clearFeedCache() {
      feedCache.clear();
    },
    /**
     * Reject future requests, signal active controllers and clear private representation state.
     * @returns {void} Fences future calls and signals active requests; borrowed transport remains open.
     */
    dispose() {
      disposed = true;
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
      feedCache.clear();
    },
  };
}
