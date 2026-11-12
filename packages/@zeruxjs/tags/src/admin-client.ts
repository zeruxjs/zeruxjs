import type { TagContainer, Values } from './types.js';
/** Fixed public failure category and mutation receipt, without private server payloads. */
export class TagAdminClientError extends Error {
  /** Represent a redacted administrative failure with separate committed and uncertain receipts; no server body or credential is retained.
 * @param {| 'conflict'
      | 'denied'
      | 'invalid'
      | 'unavailable'
      | 'cancelled'
      | 'closed'
      | 'overload'} code - Fixed public failure category.
 * @param {number} status - Observed HTTP status, or zero when no response was observed.
 * @param {boolean} committed - True only for an explicit server committed receipt, default false.
 * @param {number} version - Optional committed revision returned for authorized reconciliation.
 * @param {boolean} uncertain - Whether a mutation may have taken effect without a confirmed result, default false.
 */
  constructor(
    readonly code:
      | 'conflict'
      | 'denied'
      | 'invalid'
      | 'unavailable'
      | 'cancelled'
      | 'closed'
      | 'overload',
    readonly status: number,
    readonly committed = false,
    readonly version?: number,
    readonly uncertain = false
  ) {
    super(`Tag administration ${code}`);
    this.name = 'TagAdminClientError';
  }
}
export interface TagAdminClientOptions {
  /** Explicit root-relative or absolute API base with secure origin and validated path. */
  apiBaseUrl: string;
  /** Optional explicit resolution origin; otherwise browser location is used when available. */
  origin?: string;
  /** Borrowed injected Fetch implementation; default global Fetch remains host-owned. */
  fetch?: typeof fetch;
  /** Optional host session-bound token resolver per write; never an authorization bypass. */
  csrfToken?: (signal: AbortSignal) => string | Promise<string>;
  /** Caller observation deadline, default 10 seconds, maximum 30 seconds. */
  timeoutMs?: number;
  /** Actual pending request ceiling, default 4, maximum 16. */
  maxConcurrent?: number;
}
/** Create a browser-safe, opt-in headless client over fixed administrative endpoints. Import/construction makes no requests; each explicit operation uses credentials/no-store and never automatically retries a mutation.
 * @param {TagAdminClientOptions} options - Explicit API origin/path, borrowed Fetch, CSRF and bounded execution policy.
 * @returns {object} Owned client; close aborts cooperative work and drains native settlement without closing borrowed Fetch pools.
 */
export function createTagAdminClient(options: TagAdminClientOptions) {
  /** Validated explicit API origin/path; responses cannot redirect it elsewhere. */
  const base = new URL(
    options.apiBaseUrl,
    options.origin ?? globalThis.location?.origin
  );
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !/^\/[A-Za-z0-9/_-]+$/.test(base.pathname) ||
    base.pathname.includes('//') ||
    base.pathname.endsWith('/') ||
    (base.protocol !== 'https:' &&
      !(
        base.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      ))
  ) {
    throw new TypeError('Explicit admin API base required');
  }
  /** Finite observation deadline independent of actual native settlement. */
  const timeout = options.timeoutMs ?? 10000;
  /** Maximum actual native operations; cancelled calls retain their slots until settlement. */
  const max = options.maxConcurrent ?? 4;
  /** Borrowed host Fetch transport; client close never closes a global pool. */
  const fetcher = options.fetch ?? globalThis.fetch;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 30000 ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 16 ||
    typeof fetcher !== 'function' ||
    (options.csrfToken !== undefined && typeof options.csrfToken !== 'function')
  ) {
    throw new TypeError('Invalid admin client policy');
  }
  /** Owned per-operation cooperative controllers used by close. */
  const controllers = new Set<AbortController>();
  /** Actual native promises retained until settlement to enforce capacity and drain. */
  const jobs = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Execute one fixed API operation with bounded UTF-8 request/response and retained actual native work. Caller cancellation is not evidence of mutation rollback.
   * @param {string} path - Fixed operation suffix selected internally, never a model/user endpoint.
   * @param {string} method - Explicit GET/POST/PUT chosen by the public operation.
   * @param {unknown} body - Trusted typed host payload serialized within 128 KiB; runtime server validation remains authoritative.
   * @param {AbortSignal} signal - Optional cooperative initiating AbortSignal.
   * @returns {Promise<any>} Parsed server JSON or redacted typed failure; generic JSON parsing is not a schema guarantee.
   */
  async function request(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<any> {
    if (closed) {
      throw new TagAdminClientError('closed', 0);
    }
    if (jobs.size >= max) {
      throw new TagAdminClientError('overload', 0);
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError('Invalid cancellation');
    }
    /** Bounded serialized host request body; server still validates schema/authorization. */
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (
      encoded !== undefined &&
      new TextEncoder().encode(encoded).byteLength > 131072
    ) {
      throw new TagAdminClientError('invalid', 413);
    }
    let sent = false;
    /** Owned cooperative controller for this request only. */
    const c = new AbortController();
    /** Propagate caller/deadline cancellation to the owned operation signal.
     * @returns {void} Propagates abort to the owned controller.
     */
    const abort = () => c.abort();
    controllers.add(c);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
    let stop = () => {};
    /** Caller-observation rejection, separate from retained native settlement. */
    const cancelled = new Promise<never>((_, reject) => {
      stop = () =>
        reject(
          new TagAdminClientError(
            'cancelled',
            0,
            false,
            undefined,
            sent && method !== 'GET'
          )
        );
      c.signal.addEventListener('abort', stop, { once: true });
      if (c.signal.aborted) {
        stop();
      }
    });
    /** Owned deadline timer cleared after caller observation settles. */
    const timer = setTimeout(abort, timeout);

    /** Actual Fetch/token/body-read work retained until settlement even after caller timeout. */
    const native = (async () => {
      try {
        if (c.signal.aborted) {
          throw new TagAdminClientError('cancelled', 0);
        }
        /** Fixed public protocol headers plus explicit host-issued CSRF token. */
        const headers: Record<string, string> = { accept: 'application/json' };
        if (encoded !== undefined) {
          headers['content-type'] = 'application/json';
          /** Private session-bound token inserted only into the authenticated write request. */
          const token = await options.csrfToken?.(c.signal);
          if (token !== undefined) {
            if (
              typeof token !== 'string' ||
              token.length > 1024 ||
              // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
              /[\x00-\x1f]/.test(token)
            ) {
              throw new TagAdminClientError('invalid', 0);
            }
            headers['x-zerux-csrf'] = token;
          }
        }
        if (c.signal.aborted) {
          throw new TagAdminClientError('cancelled', 0);
        }
        sent = true;
        /** Borrowed Fetch response inspected without exposing raw failure bodies. */
        const response = await fetcher(base.href + path, {
          method,
          body: encoded,
          headers,
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          signal: c.signal,
        });
        if (!response.body) {
          throw new TagAdminClientError('unavailable', response.status);
        }
        /** Owned response-stream reader cancelled/released in finally. */
        const reader = response.body.getReader();
        /** Cancel the current body reader cooperatively without leaking rejection.
         * @returns {void} Starts cooperative reader cancellation; read/finally owns its eventual release.
         */
        const cancelReader = () => {
          void reader.cancel().catch(() => {});
        };
        c.signal.addEventListener('abort', cancelReader, { once: true });
        /** Fatal UTF-8 decoder; fragmented bytes preserve code points and malformed data rejects. */
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0,
          text = '';
        try {
          // Decode incrementally, enforcing bytes before accumulating another chunk.
          while (true) {
            if (c.signal.aborted) {
              throw new TagAdminClientError('cancelled', 0);
            }
            /** One streamed response chunk checked against the total response budget. */
            const next = await reader.read();
            if (next.done) {
              break;
            }
            bytes += next.value.byteLength;
            if (bytes > 131072) {
              throw new TagAdminClientError('invalid', 413);
            }
            text += decoder.decode(next.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          c.signal.removeEventListener('abort', cancelReader);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (c.signal.aborted) {
          throw new TagAdminClientError('cancelled', 0);
        }
        /** Parsed response JSON; fixed error receipts are selected without echoing arbitrary fields. */
        const value = JSON.parse(text);
        if (!response.ok) {
          // Preserve explicit error categories without returning provider/server error bodies.
          let code: TagAdminClientError['code'];
          if (response.status === 409) {
            code = 'conflict';
          } else if (response.status === 401 || response.status === 403) {
            code = 'denied';
          } else if (response.status === 422 || response.status === 413) {
            code = 'invalid';
          } else {
            code = 'unavailable';
          }
          throw new TagAdminClientError(
            code,
            response.status,
            value?.committed === true,
            Number.isSafeInteger(value?.version) ? value.version : undefined,
            value?.committed === 'unknown'
          );
        }
        return value;
      } catch (error) {
        if (error instanceof TagAdminClientError) {
          throw error;
        }
        throw new TagAdminClientError(
          c.signal.aborted ? 'cancelled' : 'unavailable',
          0,
          false,
          undefined,
          sent && method !== 'GET'
        );
      }
    })().finally(() => {
      jobs.delete(native);
      controllers.delete(c);
    });
    jobs.add(native);
    try {
      return await Promise.race([native, cancelled]);
    } finally {
      clearTimeout(timer);
      c.signal.removeEventListener('abort', stop);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    /** Explicitly load the authorized complete draft; this never publishes it.
     * @param {AbortSignal} signal - Optional cooperative initiating cancellation.
     * @returns {Promise<TagContainer>} Server draft; runtime schema authority stays server-side.
     */
    load: (signal?: AbortSignal): Promise<TagContainer> =>
      request('/api', 'GET', undefined, signal),
    /**
     * Full-document CRUD. Caller submits next revision; no implicit merge or auto retry on 409.
     * @param {TagContainer} document - Complete next draft; server validates fields and expected revision.
     * @param {AbortSignal} signal - Optional initiating cooperative cancellation.
     * @returns {Promise<any>} Server draft-save receipt or explicit conflict/uncertainty, never implicit publish.
     */
    save: (document: TagContainer, signal?: AbortSignal) =>
      request('/api', 'PUT', document, signal),
    /** Ask the protected server to validate a candidate without saving or publishing.
     * @param {TagContainer} document - Bounded candidate draft.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<any>} Validation receipt; not a durable write acknowledgement.
     */
    validate: (document: TagContainer, signal?: AbortSignal) =>
      request('/validate', 'POST', document, signal),
    /** Run an authorized pure trigger preview without destination execution.
     * @param {object} event - Explicit inert event and preview mode.
     * @param {string} event.name - Bounded event identifier.
     * @param {Values} event.properties - Optional scalar preview properties.
     * @param {Values} event.data - Optional scalar data-layer values.
     * @param {'draft' | 'published'} event.mode - Explicit snapshot choice, default draft.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<any>} Pure preview metadata; consent and destination policy still apply.
     */
    preview: (
      event: {
        /** Preview event name validated authoritatively by the server. */
        name: string;
        /** Optional bounded scalar preview properties; never executable expressions. */
        properties?: Values;
        /** Optional bounded public data-layer preview values. */
        data?: Values;
        /** Explicit draft/published preview; neither executes destinations. */
        mode?: 'draft' | 'published';
      },
      signal?: AbortSignal
    ) => request('/preview', 'POST', event, signal),
    /** Read authorized bounded draft/live release metadata.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<any>} Revision and retained release status; not raw event bodies.
     */
    status: (signal?: AbortSignal) =>
      request('/status', 'GET', undefined, signal),
    /** Request a separately authorized optimistic publication transition.
     * @param {number} expectedVersion - Required current draft revision.
     * @param {AbortSignal} signal - Optional cooperative cancellation; unknown writes never auto-retry.
     * @returns {Promise<any>} Explicit CAS/audit receipt or committed/uncertain failure.
     */
    publish: (expectedVersion: number, signal?: AbortSignal) =>
      request('/publish', 'POST', { expectedVersion }, signal),
    /** Request publication of one retained historical snapshot as a new release.
     * @param {number} expectedVersion - Required current draft revision.
     * @param {number} releaseId - Explicit retained release ID.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<any>} Explicit transition receipt; current draft remains separate.
     */
    rollback: (
      expectedVersion: number,
      releaseId: number,
      signal?: AbortSignal
    ) => request('/rollback', 'POST', { expectedVersion, releaseId }, signal),
    /** Validate and save an imported definition as a draft only.
     * @param {number} expectedVersion - Required current draft revision.
     * @param {string} definition - Bounded versioned inert transfer envelope.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<any>} Draft import receipt; incompatible schemas reject before mutation.
     */
    importDefinition: (
      expectedVersion: number,
      definition: string,
      signal?: AbortSignal
    ) => request('/import', 'POST', { expectedVersion, definition }, signal),
    /** Read an authorized definition-only envelope without governance or secrets.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<string>} Bounded JSON transfer text; no source code executes.
     */
    exportDefinition: async (signal?: AbortSignal) =>
      JSON.stringify(await request('/export', 'GET', undefined, signal)),
    /** Inspect fixed local lifecycle counters without request contents or credentials.
     * @returns {object} Closed state and actual pending native count.
     */
    statusOfClient: () => ({ closed, pending: jobs.size }),
    /** Stop new requests, abort cooperative controllers and await all actual native settlements. Noncooperative injected transport/token callbacks can delay shutdown.
     * @returns {Promise<void>} Shared idempotent drain promise; no global Fetch pool or host session is closed.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      // Stop all owned cooperative requests before draining native settlement.
      for (const c of controllers) {
        c.abort();
      }
      return (closing = (async () => {
        await Promise.allSettled([...jobs]);
      })());
    },
  };
}
export type TagAdminClient = ReturnType<typeof createTagAdminClient>;
