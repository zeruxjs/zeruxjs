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
 * safePath.
 * @param {string} value - Input value for this operation.
 * @returns {string} Result produced by this operation.
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
 * createDiscoveryClient.
 * @param {DiscoveryClientOptions} config - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
 */
export function createDiscoveryClient(config: DiscoveryClientOptions = {}) {
  /** Stores the origin value used by this module. */
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
   * Application function endpoint.
   * @param {string} pathname - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const endpoint = (pathname: string) => new URL(safePath(pathname), origin);
  /** Stores the searchPath value used by this module. */
  const searchPath = safePath(config.searchPath ?? '/search');
  /** Stores the feedPath value used by this module. */
  const feedPath = safePath(config.feedPath ?? '/feed');
  /** Stores the timeout value used by this module. */
  const timeout = config.timeoutMs ?? 10000;
  /** Stores the maxBytes value used by this module. */
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
  /** Stores the transport value used by this module. */
  const transport = config.fetch ?? fetch;
  /** Stores the controllers value used by this module. */
  const controllers = new Set<AbortController>();
  let disposed = false;
  /** Stores the feedCache value used by this module. */
  const feedCache = new Map<
    string,
    { etag: string; body: string; contentType: string }
  >();
  /**
 * get.
 * @param {URL} url - Input value for this operation.
 * @param {string} accept - Input value for this operation.
 * @param {AbortSignal} signal - Input value for this operation.
 * @param {string} etag - Input value for this operation.
 * @returns {Promise<{
    status: number;
    body: string;
    etag?: string;
    contentType: string;
  }>} Result produced by this operation.
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
    /** Stores the controller value used by this module. */
    const controller = new AbortController();
    controllers.add(controller);
    /**
     * Application function abort.
     * @returns {unknown} Result produced by this operation.
     */
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }
    /** Stores the timer value used by this module. */
    const timer = setTimeout(
      () => controller.abort(new Error('Discovery request timed out')),
      timeout
    );
    try {
      /** Stores the headers value used by this module. */
      const headers = new Headers({ accept });
      if (etag) {
        headers.set('if-none-match', etag);
      }
      /** Stores the response value used by this module. */
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
      /** Stores the declared value used by this module. */
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new DiscoveryHttpError('Discovery response too large', 413);
      }
      if (!response.body) {
        throw new DiscoveryHttpError('Missing response body', 502);
      }
      /** Stores the reader value used by this module. */
      const reader = response.body.getReader();
      /** Stores the chunks value used by this module. */
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          /** Stores the next value used by this module. */
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
      /** Stores the bytes value used by this module. */
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
   * Application function integer.
   * @param {number | undefined} value - Input value for this operation.
   * @param {string} name - Input value for this operation.
   * @param {number} max - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
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
   * Application function search.
   * @param {string} q - Input value for this operation.
   * @param {DiscoverySearchOptions} options - Input value for this operation.
   * @returns {Promise<DiscoverySearchResponse<T>>} Result produced by this operation.
   */
  const search = async <T = unknown>(
    q: string,
    options: DiscoverySearchOptions = {}
  ): Promise<DiscoverySearchResponse<T>> => {
    if (typeof q !== 'string' || q.length > 1024) {
      throw new TypeError('Invalid search query');
    }
    /** Stores the url value used by this module. */
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
    /** Stores the result value used by this module. */
    const result = await get(url, 'application/json', options.signal);
    if (!/application\/json/i.test(result.contentType)) {
      throw new DiscoveryHttpError('Unexpected search content type', 502);
    }
    return JSON.parse(result.body) as DiscoverySearchResponse<T>;
  };
  /**
   * Application function suggest.
   * @param {string} q - Input value for this operation.
   * @param {AbortSignal} signal - Input value for this operation.
   * @returns {Promise<string[]>} Result produced by this operation.
   */
  const suggest = async (
    q: string,
    signal?: AbortSignal
  ): Promise<string[]> => {
    if (typeof q !== 'string' || q.length > 1024) {
      throw new TypeError('Invalid suggestion query');
    }
    /** Stores the url value used by this module. */
    const url = endpoint(searchPath);
    url.searchParams.set('q', q);
    url.searchParams.set('suggest', '1');
    /** Stores the result value used by this module. */
    const result = await get(url, 'application/json', signal);
    if (!/application\/json/i.test(result.contentType)) {
      throw new DiscoveryHttpError('Unexpected suggestion content type', 502);
    }
    /** Stores the parsed value used by this module. */
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
   * Application function feed.
   * @param {'rss' | 'atom' | 'json'} format - Input value for this operation.
   * @param {AbortSignal} signal - Input value for this operation.
   * @returns {Promise<string>} Result produced by this operation.
   */
  const feed = async (
    format: 'rss' | 'atom' | 'json' = 'rss',
    signal?: AbortSignal
  ): Promise<string> => {
    if (!['rss', 'atom', 'json'].includes(format)) {
      throw new TypeError('Invalid feed format');
    }
    /** Stores the accept value used by this module. */
    const accept = {
      rss: 'application/rss+xml',
      atom: 'application/atom+xml',
      json: 'application/feed+json',
    }[format];
    /** Stores the url value used by this module. */
    const url = endpoint(feedPath);
    /** Stores the cached value used by this module. */
    const cached = feedCache.get(format);
    /** Stores the result value used by this module. */
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
     * searchResource.
     * @param {string} q - Input value for this operation.
     * @param {Omit<DiscoverySearchOptions, 'signal'>} options - Input value for this operation.
     * @returns {RemoteResource<DiscoverySearchResponse<T>>} Result produced by this operation.
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
     * clearFeedCache.
     * @returns {unknown} Result produced by this operation.
     */
    clearFeedCache() {
      feedCache.clear();
    },
    /**
     * dispose.
     * @returns {unknown} Result produced by this operation.
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
