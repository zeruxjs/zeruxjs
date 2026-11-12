import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { Meilisearch } from 'meilisearch';
import {
  SearchAdapterError,
  type SearchAdapter,
  type SearchCall,
  type SearchFactory,
  type ExternalSearchQuery,
  type ExternalSearchPage,
} from '@zeruxjs/search/adapters';
import {
  validateSearchFilters,
  type SearchDocument,
  type SearchFilter,
} from '@zeruxjs/search';

export interface MilleSearchOptions {
  /** Validated exact index name; wildcards, traversal and arbitrary paths reject. */
  index: string;
  /** At most 32 declared scalar string/number/boolean fields. */
  fields?: Readonly<Record<string, 'string' | 'number' | 'boolean'>>;
  /** Ordered declared string attributes; defaults to text. */
  searchable?: readonly string[];
  /** Declared scalar filter attributes; defaults empty. */
  filterable?: readonly string[];
  /** Declared sort attributes; defaults to and must retain id. */
  sortable?: readonly string[];
  /** Private stable host key for tenant/index/task-bound references. Never browser configuration. */
  taskKey: Uint8Array;
  /** Stable engine/deployment namespace, distinct across independently numbered task queues. */
  taskScope: string;
  /** Optional exact approved HTTPS root endpoint for SDK construction. */
  endpoint?: string;
  /** Exact host-approved root HTTPS endpoint allowlist. */
  allowedEndpoints?: readonly string[];
  /** Private nonempty server key; never browser configuration. */
  apiKey?: string;
  /** Trusted server transport, e.g. for host CA policy; borrowed, never globally closed. */
  fetch?: typeof fetch;
  /** Borrowed official-client HTTP surface; must bound responses and honor extraRequestInit.signal. */
  client?: Pick<Meilisearch, 'httpRequest'>;
  /** Default maximum request/wait duration, 5000 ms; at most 60000 ms. */
  timeoutMs?: number;
  /** Actual native/wait concurrency cap, 32 by default; at most 128. */
  maxPending?: number;
}
export type MilleTaskState =
  | 'enqueued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';
export interface MilleTaskStatus {
  /** Opaque tenant/index/scope-bound task reference; not a raw native UID. */
  taskId: string;
  /** Native enqueued/processing/succeeded/failed/canceled state; acceptance is not visibility. */
  state: MilleTaskState;
  /** Optional fixed allowlisted code; native error messages are excluded. */
  failureCode?: string;
  /** Optional bounded nonnegative native received count. */
  receivedDocuments?: number;
  /** Optional bounded nonnegative native indexed count. */
  indexedDocuments?: number;
}
/** Throw a fixed validation category without including private input values.
 * @returns {never} Always throws the fixed INVALID category.
 */
const bad = (): never => {
  throw new SearchAdapterError('INVALID');
};
/** Reject unknown own keys, accessors and nonplain records before reading values.
 * @param {unknown} v - Untrusted candidate value before validation.
 * @param {readonly string[]} allowed - Optional exact permitted own-key list.
 * @returns {void} Completes only after plain own-data validation.
 */
function record(
  v: unknown,
  allowed?: readonly string[]
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).some(
      (k) =>
        typeof k !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(k) ||
        (allowed && !allowed.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(v, k)!)
    )
  ) {
    bad();
  }
}
/** Safe-integer range check before native requests or accepting task IDs/counts.
 * @param {unknown} v - Candidate integer.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {boolean} Whether the candidate is a safe integer in range.
 */
const integer = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
/** Stable SHA-256 namespace encoding; hashes scope data but never prove authorization.
 * @param {string} v - Verified namespace encoding.
 * @returns {string} Hexadecimal SHA-256 digest.
 */
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
/** Restricted public scalar-field grammar excluding reserved document keys.
 * @param {string} v - Candidate declared field name.
 * @returns {boolean} Whether the exact field grammar is permitted.
 */
const allowedField = (v: string) =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) &&
  !['id', 'text', 'constructor', 'prototype'].includes(v);
/** Fixed public failure-code allowlist; native messages/bodies are never returned. */
const errors = new Set([
  'index_not_found',
  'index_already_exists',
  'invalid_document_id',
  'missing_document_id',
  'primary_key_inference_failed',
  'invalid_search_filter',
  'invalid_search_sort',
  'invalid_api_key',
  'missing_authorization_header',
  'document_not_found',
  'invalid_settings_filterable_attributes',
  'invalid_settings_sortable_attributes',
]);
/** Redacted backend failure carrying fixed status/code, never native body or credential values. */
export class MilleBackendError extends SearchAdapterError {
  /** Create a redacted backend error retaining only public status/code.
   * @param {number} status - Native HTTP status without response bodies.
   * @param {string} backendCode - Fixed allowlisted backend error code; arbitrary native messages are excluded.
   * @returns {undefined} undefined
   */
  constructor(
    readonly status: number,
    readonly backendCode: string
  ) {
    super('UNAVAILABLE', 'unknown');
    this.name = 'MilleBackendError';
  }
}
/** Validate an exact HTTPS root endpoint without URL credentials, query, fragment or arbitrary path.
 * @param {unknown} v - Untrusted candidate value before validation.
 * @returns {string} Normalized approved HTTPS root URL.
 */
function endpoint(v: unknown): string {
  if (typeof v !== 'string' || v.length > 2048) {
    return bad();
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return bad();
  }
  if (
    u.protocol !== 'https:' ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  ) {
    return bad();
  }
  return u.href;
}
/** Validate explicit engine/index/attribute/authentication policy and copy the private task key before startup.
 * @param {MilleSearchOptions} input - Explicit private adapter policy with stable task key and verified connection settings.
 * @returns {MilleSearchOptions} Captured policy with independent task key and attribute lists.
 */
function policy(input: MilleSearchOptions) {
  record(input, [
    'index',
    'fields',
    'searchable',
    'filterable',
    'sortable',
    'taskKey',
    'taskScope',
    'endpoint',
    'allowedEndpoints',
    'apiKey',
    'fetch',
    'client',
    'timeoutMs',
    'maxPending',
  ]);
  if (
    typeof input.index !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,127}$/.test(input.index) ||
    !(input.taskKey instanceof Uint8Array) ||
    input.taskKey.byteLength !== 32 ||
    typeof input.taskScope !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.taskScope) ||
    !integer(input.timeoutMs ?? 5000, 1, 60000) ||
    !integer(input.maxPending ?? 32, 1, 128)
  ) {
    bad();
  }
  /** Captured explicitly declared scalar fields; unknown metadata is not sent to the engine. */
  const fields = input.fields ?? {};
  record(fields);
  if (
    Object.keys(fields).length > 32 ||
    Object.entries(fields).some(
      ([k, v]) =>
        !allowedField(k) || !['string', 'number', 'boolean'].includes(v)
    )
  ) {
    bad();
  }
  /** Known document scalar types, including required id/text fields. */
  const types = { id: 'string', text: 'string', ...fields };
  /** Validate ordered declared attribute lists without evaluating engine expressions.
   * @param {readonly string[]} v - Host-declared attribute names.
   * @param {'search' | 'filter' | 'sort'} kind - Attribute capability being configured.
   * @returns {string[]} Independent validated ordered list.
   */
  const list = (v: readonly string[], kind: 'search' | 'filter' | 'sort') => {
    if (
      !Array.isArray(v) ||
      v.length > 34 ||
      new Set(v).size !== v.length ||
      v.some(
        (k) =>
          !Object.hasOwn(types, k) ||
          (kind !== 'search' && k === 'text') ||
          (kind === 'search' && types[k as keyof typeof types] !== 'string')
      )
    ) {
      bad();
    }
    return [...v];
  };
  /** Captured ordered string attributes; order remains significant to ranking/settings checks. */
  const searchable = list(input.searchable ?? ['text'], 'search');
  if (!searchable.length) {
    bad();
  }
  /** Captured declared filter attributes; internal tenant predicate is always added independently. */
  const filterable = list(input.filterable ?? [], 'filter');
  /** Captured sortable attributes; id remains available for deterministic tie ordering. */
  const sortable = list(input.sortable ?? ['id'], 'sort');
  if (!sortable.includes('id')) {
    bad();
  }
  if (input.client) {
    if (
      !input.client.httpRequest ||
      ['get', 'post', 'put', 'patch'].some(
        (k) => typeof (input.client!.httpRequest as any)[k] !== 'function'
      ) ||
      input.endpoint !== undefined ||
      input.allowedEndpoints !== undefined ||
      input.apiKey !== undefined ||
      input.fetch !== undefined
    ) {
      bad();
    }
  } else {
    /** Normalized explicitly allowlisted HTTPS root endpoint. */
    const node = endpoint(input.endpoint);
    if (
      !Array.isArray(input.allowedEndpoints) ||
      !input.allowedEndpoints.length ||
      input.allowedEndpoints.length > 16 ||
      !input.allowedEndpoints.map(endpoint).includes(node)
    ) {
      throw new SearchAdapterError('DENIED');
    }
    if (
      typeof input.apiKey !== 'string' ||
      !input.apiKey ||
      input.apiKey.length > 8192 ||
      (input.fetch !== undefined && typeof input.fetch !== 'function')
    ) {
      bad();
    }
  }
  return {
    ...input,
    fields: Object.freeze({ ...fields }),
    taskKey: Buffer.from(input.taskKey),
    searchable,
    filterable,
    sortable,
  };
}
/** Explicitly construct or borrow the official HTTP surface and probe supported engine version. Caller owns cancellation/drain; imports never connect or provision.
 * @param {MilleSearchOptions} input - Explicit private adapter policy with stable task key and verified connection settings.
 * @param {AbortSignal} startupSignal - Optional host startup cancellation signal.
 * @returns {Promise<MilleSearchAdapter>} Owned wrapper; startup failure drains and zeroes its copied key.
 */
export async function createMilleSearchAdapter(
  input: MilleSearchOptions,
  startupSignal?: AbortSignal
) {
  /** Validated private adapter policy; task key is copied for this wrapper generation. */
  const options = policy(input);
  /** Maximum request/wait duration, also bounded by the initiating absolute deadline. */
  const timeout = options.timeoutMs ?? 5000;
  /** Actual unsettled operation capacity; timeouts do not release native work early. */
  const maxPending = options.maxPending ?? 32;
  /** Owned cooperative shutdown signal shared by request and polling scopes. */
  const lifetime = new AbortController();
  /** Actual native/wait promises retained through settlement, separate from manager observation deadlines. */
  const pending = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  let client = options.client;
  if (!client) {
    try {
      /** Fixed official SDK constructor loaded only on explicit owned-wrapper creation. */
      const { Meilisearch } = await import('meilisearch');
      /** Fixed approved endpoint origin; SDK transport cannot select another origin. */
      const origin = new URL(endpoint(options.endpoint)).origin;
      client = new Meilisearch({
        host: options.endpoint!,
        apiKey: options.apiKey,
        timeout,
        requestInit: { redirect: 'error', cache: 'no-store' },
        // Pinned SDK's public hook (deprecated upstream): bound bytes before JSON decoding.
        httpClient: async (url, init) => {
          if (new URL(String(url)).origin !== origin) {
            throw new SearchAdapterError('DENIED');
          }
          /** Native Fetch response whose bytes are bounded before JSON parsing. */
          const response = await (options.fetch ?? fetch)(url, {
            ...init,
            redirect: 'error',
            cache: 'no-store',
          });
          /** Owned response stream reader, cancelled and released on success/failure. */
          const reader = response.body?.getReader();
          let size = 0;
          /** Bounded response chunks, at most one MiB before decoding. */
          const chunks: Uint8Array[] = [];
          try {
            if (reader) {
              // Charge response bytes before retaining chunks or parsing untrusted JSON.
              while (true) {
                /** One response-stream chunk; budget checks precede retention. */
                const next = await reader.read();
                if (next.done) {
                  break;
                }
                size += next.value.byteLength;
                if (size > 1024 * 1024) {
                  throw new SearchAdapterError('LIMIT');
                }
                chunks.push(next.value);
              }
            }
          } finally {
            if (reader) {
              await reader.cancel().catch(() => {});
              reader.releaseLock();
            }
          }
          let body: any;
          try {
            body = size
              ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
              : undefined;
          } catch {
            throw new SearchAdapterError('UNAVAILABLE');
          }
          if (!response.ok) {
            throw new MilleBackendError(
              response.status,
              errors.has(body?.code) ? body.code : 'backend_error'
            );
          }
          return body;
        },
      });
    } catch (cause) {
      throw new SearchAdapterError('UNAVAILABLE', 'not-started', cause);
    }
  }
  /** Borrowed official HTTP surface; no global Fetch pool or injected client is closed. */
  const http = client.httpRequest;
  /** Fixed validated index path used for all scoped engine operations. */
  const base = `indexes/${options.index}`;
  /** Explicit supported index settings; provisioning/migration remains a separate privileged operation. */
  const expected = {
    searchableAttributes: options.searchable,
    filterableAttributes: ['_zxTenant', ...options.filterable],
    sortableAttributes: options.sortable,
    displayedAttributes: [
      '_zxId',
      '_zxTenant',
      'id',
      'text',
      ...Object.keys(options.fields),
    ],
    distinctAttribute: null,
    pagination: { maxTotalHits: 10000 },
  };
  /** Require a verified tenant call scope and return its namespace digest; document/query fields never authorize callers.
   * @param {SearchCall} call - Host-verified tenant/signal/deadline context; health may omit tenant.
   * @returns {string} Verified tenant digest.
   */
  function scope(call: SearchCall) {
    if (closed) {
      throw new SearchAdapterError('CLOSED');
    }
    record(call, ['tenant', 'signal', 'deadline']);
    if (
      typeof call.tenant !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(call.tenant)
    ) {
      bad();
    }
    return hash(call.tenant);
  }
  /** Bound cooperative operation lifetime while retaining actual native/wait work through settlement. Unknown writes are never replayed.
   * @param {Omit<SearchCall, 'tenant'>} call - Host-verified tenant/signal/deadline context; health may omit tenant.
   * @param {(signal: AbortSignal) => Promise<T>} work - Trusted native/wait callback retaining ownership until actual settlement.
   * @param {boolean} write - Whether an interrupted outcome may already have enqueued a side effect.
   * @returns {Promise<T>} Native result after actual settlement or redacted explicit failure.
   */
  async function run<T>(
    call: Omit<SearchCall, 'tenant'>,
    work: (signal: AbortSignal) => Promise<T>,
    write = false
  ): Promise<T> {
    record(call, ['tenant', 'signal', 'deadline']);
    if (
      !(call.signal instanceof AbortSignal) ||
      !Number.isSafeInteger(call.deadline)
    ) {
      bad();
    }
    if (closed) {
      throw new SearchAdapterError('CLOSED');
    }
    if (call.signal.aborted) {
      throw new SearchAdapterError('CANCELLED');
    }
    if (call.deadline <= Date.now()) {
      throw new SearchAdapterError('DEADLINE');
    }
    if (pending.size >= maxPending) {
      throw new SearchAdapterError('LIMIT');
    }
    /** Combined initiating, generation and deadline cancellation request; not forced JavaScript cancellation. */
    const signal = AbortSignal.any([
      call.signal,
      lifetime.signal,
      AbortSignal.timeout(
        Math.min(timeout, Math.max(1, call.deadline - Date.now()))
      ),
    ]);
    /** Actual native/wait settlement promise; the pending slot remains occupied until finally. */
    const job = Promise.resolve().then(() => {
      if (signal.aborted) {
        throw new SearchAdapterError('CANCELLED');
      }
      return work(signal);
    });
    pending.add(job);
    try {
      /** Validated native result or bounded sanitized task status, never a native error body. */
      const result = await job;
      if (signal.aborted) {
        throw new SearchAdapterError(
          call.signal.aborted || lifetime.signal.aborted
            ? 'CANCELLED'
            : 'DEADLINE',
          write ? 'unknown' : 'not-started'
        );
      }
      return result;
    } catch (cause) {
      if (cause instanceof SearchAdapterError) {
        throw cause;
      }
      if ((cause as { cause?: unknown })?.cause instanceof SearchAdapterError) {
        throw (cause as { cause: SearchAdapterError }).cause;
      }
      // Preserve the initiating cancellation category without discarding write uncertainty.
      let category: SearchAdapterError['code'];
      if (signal.aborted) {
        if (call.signal.aborted || lifetime.signal.aborted) {
          category = 'CANCELLED';
        } else {
          category = 'DEADLINE';
        }
      } else {
        category = 'UNAVAILABLE';
      }
      throw new SearchAdapterError(
        category,
        write ? 'unknown' : 'not-started',
        cause
      );
    } finally {
      pending.delete(job);
    }
  }
  /** Require the configured index primary key and declared supported settings before any data operation.
   * @param {AbortSignal} signal - Cooperative cancellation signal for this actual native/polling operation.
   * @returns {Promise<void>} Resolves only for a compatible native index/settings policy.
   */
  async function verify(signal: AbortSignal) {
    /** Native index identity/primary-key response checked before data operations. */
    const info = await http.get<any>({
      path: base,
      extraRequestInit: { signal },
    });
    if (info?.uid !== options.index || info.primaryKey !== '_zxId') {
      throw new SearchAdapterError('UNSUPPORTED');
    }
    /** Native settings or token MAC bytes checked against the captured expected policy. */
    const actual = await http.get<any>({
      path: base + '/settings',
      extraRequestInit: { signal },
    });
    // Compare declared settings without treating searchable order as interchangeable.
    for (const key of [
      'searchableAttributes',
      'filterableAttributes',
      'sortableAttributes',
      'displayedAttributes',
    ] as const) {
      /** Explicit native attribute list or bounded scalar operands under validation. */
      const values = actual?.[key];
      if (
        !Array.isArray(values) ||
        values.some((v) => typeof v !== 'string') ||
        values.length !== expected[key].length ||
        (key === 'searchableAttributes' ? values : [...values].sort()).some(
          (v, i) =>
            v !==
            (key === 'searchableAttributes'
              ? expected[key]
              : [...expected[key]].sort())[i]
        )
      ) {
        throw new SearchAdapterError('UNSUPPORTED');
      }
    }
    if (
      actual.distinctAttribute !== null ||
      actual.pagination?.maxTotalHits !== 10000
    ) {
      throw new SearchAdapterError('UNSUPPORTED');
    }
  }
  /** Tenant/logical-ID digest shared by writes and result verification.
   * @param {string} tenant - Previously verified tenant digest.
   * @param {string} id - Exact logical document ID.
   * @returns {string} Stable tenant-bound engine primary key.
   */
  const idFor = (tenant: string, id: string) =>
    hash(JSON.stringify([tenant, id]));
  /** Validate a bounded inert scalar document; nested data, accessors, undeclared fields and unsafe integers reject.
   * @param {unknown} value - Untrusted scalar document validated completely before native use.
   * @returns {SearchDocument} Independent validated scalar document.
   */
  function document(value: unknown): SearchDocument {
    record(value, ['id', 'text', ...Object.keys(options.fields)]);
    if (
      typeof value.id !== 'string' ||
      !value.id ||
      value.id.length > 512 ||
      typeof value.text !== 'string' ||
      value.text.length > 65536
    ) {
      bad();
    }
    // Validate every declared scalar before encoding any native document.
    for (const [key, v] of Object.entries(value)) {
      if (key !== 'id' && key !== 'text') {
        /** Declared scalar type; no coercion or nested-object evaluation is allowed. */
        const type = options.fields[key];
        if (
          typeof v !== type ||
          (type === 'string' && (v as string).length > 4096) ||
          (type === 'number' &&
            (!Number.isFinite(v) ||
              (Number.isInteger(v) && !Number.isSafeInteger(v))))
        ) {
          bad();
        }
      }
    }
    if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024) {
      throw new SearchAdapterError('LIMIT');
    }
    return { ...value } as SearchDocument;
  }
  /** HMAC of version/scope/index/native UID/tenant with the copied private task key.
   * @param {number} uid - Validated native task UID.
   * @param {string} tenant - Verified tenant digest.
   * @returns {string} Base64url authentication tag; no key material is returned.
   */
  const mac = (uid: number, tenant: string) =>
    createHmac('sha256', options.taskKey)
      .update(
        JSON.stringify([
          'mille-task-v1',
          options.taskScope,
          options.index,
          uid,
          tenant,
        ])
      )
      .digest('base64url');
  /** Encode a native task UID with a versioned tenant/index/deployment-bound HMAC.
   * @param {number} uid - Validated native nonnegative task UID.
   * @param {string} tenant - Previously verified tenant namespace digest.
   * @returns {string} Versioned authenticated opaque reference.
   */
  function taskToken(uid: number, tenant: string) {
    return `m1.${uid}.${mac(uid, tenant)}`;
  }
  /** Verify an opaque task reference before making native status requests; forged/foreign references reject.
   * @param {string} token - Opaque authenticated task reference; native UIDs alone are not accepted.
   * @param {string} tenant - Previously verified tenant namespace digest.
   * @returns {number} Validated native UID; malformed/foreign tokens throw before HTTP.
   */
  function taskUid(token: string, tenant: string) {
    if (typeof token !== 'string' || token.length > 128) {
      throw new SearchAdapterError('DENIED');
    }
    /** Restricted token grammar match; forged references reject before engine access. */
    const m = /^m1\.(0|[1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m || !integer(Number(m[1]), 0, Number.MAX_SAFE_INTEGER)) {
      throw new SearchAdapterError('DENIED');
    }
    /** Native settings or token MAC bytes checked against the captured expected policy. */
    const actual = Buffer.from(m[2]);
    /** Explicit supported index settings; provisioning/migration remains a separate privileged operation. */
    const expected = Buffer.from(mac(Number(m[1]), tenant));
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new SearchAdapterError('DENIED');
    }
    return Number(m[1]);
  }
  /** Validate native enqueue acknowledgement and expose only an opaque accepted task reference, never searchable completion.
   * @param {any} task - Native enqueue response, not an application-owned durable receipt.
   * @param {string} tenant - Previously verified tenant namespace digest.
   * @returns {object} Accepted receipt with opaque taskId, not a searchable-completion guarantee.
   */
  function receipt(task: any, tenant: string) {
    if (
      !task ||
      !integer(task.taskUid, 0, Number.MAX_SAFE_INTEGER) ||
      task.indexUid !== options.index ||
      !['enqueued', 'processing', 'succeeded'].includes(task.status)
    ) {
      throw new SearchAdapterError('UNAVAILABLE', 'unknown');
    }
    return {
      state: 'accepted' as const,
      taskId: taskToken(task.taskUid, tenant),
    };
  }
  /** Read one verified task and return only allowlisted state/error/count metadata without native bodies.
   * @param {string} token - Opaque authenticated task reference; native UIDs alone are not accepted.
   * @param {number} uid - Validated native nonnegative task UID.
   * @param {AbortSignal} signal - Cooperative cancellation signal for this actual native/polling operation.
   * @returns {Promise<MilleTaskStatus>} Sanitized native state with bounded optional counts.
   */
  async function status(
    token: string,
    uid: number,
    signal: AbortSignal
  ): Promise<MilleTaskStatus> {
    /** Native task acknowledgement/status checked for UID, index and supported state. */
    const task = await http.get<any>({
      path: `tasks/${uid}`,
      extraRequestInit: { signal },
    });
    if (
      !task ||
      task.uid !== uid ||
      task.indexUid !== options.index ||
      !['enqueued', 'processing', 'succeeded', 'failed', 'canceled'].includes(
        task.status
      )
    ) {
      throw new SearchAdapterError('DENIED');
    }
    /** Validated native result or bounded sanitized task status, never a native error body. */
    const result: MilleTaskStatus = { taskId: token, state: task.status };
    if (task.status === 'failed') {
      result.failureCode = errors.has(task.error?.code)
        ? task.error.code
        : 'task_failed';
    }
    // Expose only bounded numeric coverage, never arbitrary native task details.
    for (const key of ['receivedDocuments', 'indexedDocuments'] as const) {
      if (integer(task.details?.[key], 0, Number.MAX_SAFE_INTEGER)) {
        result[key] = task.details[key];
      }
    }
    return result;
  }
  /** Translate only declared structured literal predicates; string comparisons require explicit native case-insensitive semantics.
   * @param {readonly SearchFilter[]} input - At most sixteen structured literal filter clauses; no raw engine expression is accepted.
   * @returns {string[]} Allowlisted native literal predicates, never user-supplied raw expressions.
   */
  function filters(input: readonly SearchFilter[] = []) {
    if (!Array.isArray(input) || input.length > 16) {
      bad();
    }
    // Reject malformed clause records before producing any native filter expression.
    for (const f of input) {
      record(f, ['field', 'operator', 'value', 'caseSensitive']);
    }
    return validateSearchFilters(input).map((f) => {
      if (
        !options.filterable.includes(f.field) ||
        !['eq', 'neq', 'in', 'exists', 'gte', 'lte'].includes(f.operator)
      ) {
        throw new SearchAdapterError('UNSUPPORTED');
      }
      /** Declared scalar type; no coercion or nested-object evaluation is allowed. */
      const type = f.field === 'id' ? 'string' : options.fields[f.field];
      if (
        type === 'string' &&
        f.operator !== 'exists' &&
        f.caseSensitive !== false
      ) {
        throw new SearchAdapterError('UNSUPPORTED');
      }
      /** Explicit native attribute list or bounded scalar operands under validation. */
      let values: unknown[];
      if (f.operator === 'exists') {
        values = [];
      } else if (f.operator === 'in') {
        values = f.value as unknown[];
      } else {
        values = [f.value];
      }
      // Validate each IN/scalar operand before literal JSON quoting.
      for (const v of values) {
        if (
          v === null ||
          typeof v !== type ||
          (typeof v === 'number' &&
            (!Number.isFinite(v) ||
              (Number.isInteger(v) && !Number.isSafeInteger(v)))) ||
          // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
          (typeof v === 'string' && /[\x00-\x1f\x7f]/.test(v))
        ) {
          bad();
        }
      }
      if (f.operator === 'exists') {
        return `${f.field} EXISTS`;
      }
      if (f.operator === 'in') {
        return values.length
          ? `${f.field} IN ${JSON.stringify(values)}`
          : '_zxTenant = "impossible-non-hash-tenant"';
      }
      if (['gte', 'lte'].includes(f.operator) && type !== 'number') {
        throw new SearchAdapterError('UNSUPPORTED');
      }
      return `${f.field} ${{ eq: '=', neq: '!=', gte: '>=', lte: '<=' }[f.operator as 'eq']} ${JSON.stringify(f.value)}`;
    });
  }
  /** Prepare a complete bounded tenant-scoped batch before native enqueue; accepted writes need separate status inspection.
   * @param {readonly SearchDocument[] | readonly string[]} values - Complete bounded documents or exact logical IDs for one enqueue.
   * @param {SearchCall} call - Host-verified tenant/signal/deadline context; health may omit tenant.
   * @param {boolean} remove - Select delete-batch instead of full-document upsert.
   * @returns {Promise<object>} Accepted opaque task receipt; no automatic replay is performed.
   */
  async function mutate(
    values: readonly SearchDocument[] | readonly string[],
    call: SearchCall,
    remove: boolean
  ) {
    /** Digest of the verified initiating tenant supplied outside user query/document fields. */
    const tenant = scope(call);
    if (!Array.isArray(values) || !values.length || values.length > 100) {
      throw new SearchAdapterError('LIMIT');
    }
    /** Batch-local duplicate ID detector; repeated logical IDs reject before enqueue. */
    const seen = new Set<string>();
    /** Complete validated native batch prepared before any enqueue request. */
    const data = values.map((value) => {
      /** Validated independent public document; internal response fields are stripped only after verification. */
      const doc = remove ? undefined : document(value);
      /** Exact logical document identity before verified tenant namespacing. */
      const id = remove ? value : doc!.id;
      if (typeof id !== 'string' || !id || id.length > 512 || seen.has(id)) {
        bad();
      }
      seen.add(id);
      /** Composite native document ID; identical logical IDs in other tenants remain distinct. */
      const key = idFor(tenant, id);
      return remove ? key : { ...doc, _zxId: key, _zxTenant: tenant };
    });
    if (Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024) {
      throw new SearchAdapterError('LIMIT');
    }
    return run(
      call,
      async (signal) => {
        await verify(signal);
        /** Native task acknowledgement/status checked for UID, index and supported state. */
        const task = await http.post<any>({
          path: remove ? base + '/documents/delete-batch' : base + '/documents',
          body: data,
          extraRequestInit: { signal },
        });
        return receipt(task, tenant);
      },
      true
    );
  }
  /** Owned wrapper scope; close drains actual work and zeroes only this copied key. */
  const adapter = {
    capabilities: Object.freeze({
      tenantIsolation: true as const,
      durability: 'persistent' as const,
      consistency: 'eventual' as const,
      filters: Object.freeze([
        'eq',
        'neq',
        'in',
        'exists',
        'gte',
        'lte',
      ] as const),
      sort: Object.freeze([...options.sortable]),
      mutations: Object.freeze(['index', 'delete'] as const),
      pagination: 'offset' as const,
    }),
    /** Apply verified tenant scope independently of literal q/filter/sort input, then verify and strip returned internal metadata.
     * @param {ExternalSearchQuery} query - Bounded structured query; no raw native filter or executable expression.
     * @param {SearchCall} call - Host-verified tenant/signal/deadline context; health may omit tenant.
     * @returns {Promise<ExternalSearchPage>} Cloned verified page with partial estimated-count coverage.
     */
    async search(
      query: ExternalSearchQuery,
      call: SearchCall
    ): Promise<ExternalSearchPage> {
      /** Digest of the verified initiating tenant supplied outside user query/document fields. */
      const tenant = scope(call);
      record(query, ['text', 'limit', 'offset', 'filters', 'sort']);
      if (
        typeof query.text !== 'string' ||
        query.text.length > 4096 ||
        !integer(query.limit ?? 20, 1, 100) ||
        !integer(query.offset ?? 0, 0, 10000) ||
        (query.offset ?? 0) + (query.limit ?? 20) > 10000
      ) {
        bad();
      }
      /** Allowlisted native literal filter expressions; tenant scope is added outside these clauses. */
      const translated = filters(query.filters);
      /** Bounded literal native q text; no raw filter/JavaScript expression is accepted. */
      const text = query.text;
      /** Validated page size capped at one hundred. */
      const limit = query.limit ?? 20;
      /** Validated result offset; offset plus page size cannot exceed ten thousand. */
      const offset = query.offset ?? 0;
      if (query.sort) {
        record(query.sort, ['field', 'direction']);
        if (
          !options.sortable.includes(query.sort.field) ||
          !['asc', 'desc'].includes(query.sort.direction)
        ) {
          throw new SearchAdapterError('UNSUPPORTED');
        }
      }
      /** Declared native field direction with an explicit id tie breaker. */
      const sort = query.sort
        ? [
            query.sort.field + ':' + query.sort.direction,
            ...(query.sort.field === 'id' ? [] : ['id:asc']),
          ]
        : undefined;
      return run(call, async (signal) => {
        await verify(signal);
        /** Validated native result or bounded sanitized task status, never a native error body. */
        const result = await http.post<any>({
          path: base + '/search',
          body: {
            q: text,
            limit,
            offset,
            filter: [`_zxTenant = "${tenant}"`, ...translated],
            ...(sort ? { sort } : {}),
            attributesToRetrieve: expected.displayedAttributes,
          },
          extraRequestInit: { signal },
        });
        if (
          !Array.isArray(result?.hits) ||
          result.hits.length > limit ||
          Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024
        ) {
          throw new SearchAdapterError('UNAVAILABLE');
        }
        /** Verified independent document records; native internal identifiers never escape. */
        const hits = result.hits.map((hit: any) => {
          record(hit);
          if (
            hit._zxTenant !== tenant ||
            typeof hit.id !== 'string' ||
            hit._zxId !== idFor(tenant, hit.id)
          ) {
            throw new SearchAdapterError('DENIED');
          }
          /** Remove checked internal namespace metadata before public scalar validation. */
          const { _zxTenant: _, _zxId: __, ...doc } = hit;
          return { document: document(doc) };
        });
        return {
          hits,
          ...(integer(result.estimatedTotalHits, 0, Number.MAX_SAFE_INTEGER)
            ? { total: result.estimatedTotalHits }
            : {}),
          coverage: 'partial' as const,
        };
      });
    },
    /** Enqueue a full tenant-scoped document batch; acceptance does not mean searchable completion.
     * @param {readonly SearchDocument[]} values - Complete bounded inert document records.
     * @param {SearchCall} call - Verified initiating tenant and cooperative deadline scope.
     * @returns {Promise<object>} Accepted opaque task reference; inspect status separately.
     */
    index: (values: readonly SearchDocument[], call: SearchCall) =>
      mutate(values, call, false),
    /** Enqueue tenant-scoped deletion without automatically retrying ambiguous acknowledgements.
     * @param {readonly string[]} values - Bounded exact logical document IDs.
     * @param {SearchCall} call - Verified initiating tenant and cooperative deadline scope.
     * @returns {Promise<object>} Accepted opaque task reference, not completed deletion.
     */
    delete: (values: readonly string[], call: SearchCall) =>
      mutate(values, call, true),
    /** Explicit privileged asynchronous index creation. Wait for success before applying settings.
     * @param {SearchCall} call - Host-verified tenant/signal/deadline context; health may omit tenant.
     * @returns {Promise<object>} Accepted setup task; explicitly wait for a succeeded terminal state.
     */
    createIndex(call: SearchCall) {
      /** Digest of the verified initiating tenant supplied outside user query/document fields. */
      const tenant = scope(call);
      return run(
        call,
        async (signal) =>
          receipt(
            await http.post<any>({
              path: 'indexes',
              body: { uid: options.index, primaryKey: '_zxId' },
              extraRequestInit: { signal },
            }),
            tenant
          ),
        true
      );
    },
    /** Explicit privileged asynchronous settings replacement. Existing settings are not automatically migrated.
     * @param {SearchCall} call - Host-verified tenant/signal/deadline context; health may omit tenant.
     * @returns {Promise<object>} Accepted settings task; no automatic migration.
     */
    configureIndex(call: SearchCall) {
      /** Digest of the verified initiating tenant supplied outside user query/document fields. */
      const tenant = scope(call);
      return run(
        call,
        async (signal) =>
          receipt(
            await http.patch<any>({
              path: base + '/settings',
              body: expected,
              extraRequestInit: { signal },
            }),
            tenant
          ),
        true
      );
    },
    /** Verify tenant/index/scope-bound reference before reading a sanitized native task state.
     * @param {string} token - Opaque authenticated task reference; native UIDs alone are not accepted.
     * @param {SearchCall} call - Host-verified tenant/signal/deadline context; health may omit tenant.
     * @returns {Promise<MilleTaskStatus>} Verified sanitized task state.
     */
    taskStatus(token: string, call: SearchCall) {
      /** Digest of the verified initiating tenant supplied outside user query/document fields. */
      const tenant = scope(call);
      /** Native task UID accepted only after validating its tenant/index/scope-bound MAC. */
      const uid = taskUid(token, tenant);
      return run(call, (signal) => status(token, uid, signal));
    },
    /** Poll a verified task under finite attempts, bounded cancellable delays and one operation deadline; failed/canceled are terminal results too.
     * @param {string} token - Opaque authenticated task reference; native UIDs alone are not accepted.
     * @param {SearchCall} call - Host-verified tenant/signal/deadline context; health may omit tenant.
     * @param {{ intervalMs?: number; maxPolls?: number }} wait - Finite polling configuration; defaults to 100 ms and fifty polls.
     * @param {number} wait.intervalMs - Poll delay from ten to one thousand milliseconds.
     * @param {number} wait.maxPolls - Finite count from one to one hundred polls.
     * @returns {Promise<MilleTaskStatus>} Terminal state including failure/cancellation; exhaustion throws.
     */
    waitForTask(
      token: string,
      call: SearchCall,
      wait: { intervalMs?: number; maxPolls?: number } = {}
    ) {
      /** Digest of the verified initiating tenant supplied outside user query/document fields. */
      const tenant = scope(call);
      /** Native task UID accepted only after validating its tenant/index/scope-bound MAC. */
      const uid = taskUid(token, tenant);
      record(wait, ['intervalMs', 'maxPolls']);
      /** Bounded polling interval; delays occupy the same operation slot and cancellation scope. */
      const interval = wait.intervalMs ?? 100;
      /** Finite task poll budget, independent of the absolute operation deadline. */
      const max = wait.maxPolls ?? 50;
      if (!integer(interval, 10, 1000) || !integer(max, 1, 100)) {
        bad();
      }
      return run(call, async (signal) => {
        // Poll terminal state within one pending slot, signal and absolute deadline.
        for (let i = 0; i < max; i++) {
          /** Validated native result or bounded sanitized task status, never a native error body. */
          const result = await status(token, uid, signal);
          if (['succeeded', 'failed', 'canceled'].includes(result.state)) {
            return result;
          }
          if (i + 1 < max) {
            await pause(interval, undefined, { signal });
          }
        }
        throw new SearchAdapterError('DEADLINE');
      });
    },
    /** Probe the declared supported engine version under the normal bounded scope.
     * @param {Omit<SearchCall, 'tenant'>} call - Host-verified tenant/signal/deadline context; health may omit tenant.
     * @returns {Promise<'ready'>} Ready only after version validation.
     */
    health(call: Omit<SearchCall, 'tenant'>) {
      return run(call, async (signal) => {
        /** Validated native result or bounded sanitized task status, never a native error body. */
        const result = await http.get<any>({
          path: 'version',
          extraRequestInit: { signal },
        });
        if (
          typeof result?.pkgVersion !== 'string' ||
          !/^1\.[0-9]+\.[0-9]+(?:[-+].*)?$/.test(result.pkgVersion)
        ) {
          throw new SearchAdapterError('UNSUPPORTED');
        }
        return 'ready' as const;
      });
    },
    /** Reject new calls, abort cooperative work, await actual settlement and zero this wrapper task-key copy; borrowed transports/pools stay open.
     * @returns {Promise<void>} Settles after cooperative work drains and copied key is cleared.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      lifetime.abort();
      return (closing = (async () => {
        await Promise.allSettled([...pending]);
        options.taskKey.fill(0);
      })());
    },
  } satisfies SearchAdapter & Record<string, unknown>;
  try {
    await adapter.health({
      signal: startupSignal ?? new AbortController().signal,
      deadline: Date.now() + timeout,
    });
  } catch (error) {
    await adapter.close();
    throw error;
  }
  return adapter;
}
export type MilleSearchAdapter = Awaited<
  ReturnType<typeof createMilleSearchAdapter>
>;
/** Capture explicit trusted adapter policy without connecting; named shared configuration supplies private endpoint/credentials.
 * @param {Omit<
    MilleSearchOptions,
    'endpoint' | 'allowedEndpoints' | 'apiKey' | 'client' | 'fetch'
  >} options - Explicit inert factory policy; endpoint/key/transport come from shared connection.
 * @returns {SearchFactory} Inert trusted factory; its invocation explicitly acquires a wrapper.
 */
export function createMilleSearchFactory(
  options: Omit<
    MilleSearchOptions,
    'endpoint' | 'allowedEndpoints' | 'apiKey' | 'client' | 'fetch'
  >
): SearchFactory {
  record(options, [
    'index',
    'fields',
    'searchable',
    'filterable',
    'sortable',
    'taskKey',
    'taskScope',
    'timeoutMs',
    'maxPending',
  ]);
  if (options.fields !== undefined) {
    record(options.fields);
    if (Object.keys(options.fields).length > 32) {
      bad();
    }
  }
  if (
    !(options.taskKey instanceof Uint8Array) ||
    options.taskKey.byteLength !== 32
  ) {
    bad();
  }
  // Capture only bounded explicit lists; factory creation must remain inert.
  for (const values of [
    options.searchable,
    options.filterable,
    options.sortable,
  ]) {
    if (
      values !== undefined &&
      (!Array.isArray(values) || values.length > 34)
    ) {
      bad();
    }
  }
  /** Captured inert factory policy; stable task key is copied and connection credentials stay private. */
  const config = {
    ...options,
    fields: options.fields && { ...options.fields },
    searchable: options.searchable && [...options.searchable],
    filterable: options.filterable && [...options.filterable],
    sortable: options.sortable && [...options.sortable],
    taskKey: Buffer.from(options.taskKey),
  };
  return (connection, signal) => {
    record(connection.credentials, ['apiKey']);
    return createMilleSearchAdapter(
      {
        ...config,
        endpoint: connection.endpoint,
        allowedEndpoints: connection.allowedEndpoints,
        apiKey: connection.credentials.apiKey,
      },
      signal
    );
  };
}
