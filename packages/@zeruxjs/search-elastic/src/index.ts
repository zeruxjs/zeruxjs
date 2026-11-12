import { createHash } from 'node:crypto';
import type * as estypes from '@elastic/elasticsearch/lib/api/types';
export interface ElasticRequestOptions {
  /** Borrowed cooperative cancellation signal; native work owns settlement. */
  signal: AbortSignal;
  /** Bounded native request deadline in milliseconds. */
  requestTimeout: number;
  /** Explicit retry budget; adapter requests always use zero. */
  maxRetries: number;
  /** Native timeout replay is explicitly disabled by adapter requests. */
  retryOnTimeout?: boolean;
}
/** Narrow injected-client surface; does not import optional ES|QL/Arrow helpers. */
export interface ElasticClient {
  /** Probe native engine metadata through the narrow injected client contract.
   * @param {estypes.InfoRequest} params - Narrow typed native request selected by this adapter.
   * @param {ElasticRequestOptions} options - Bounded native request settings with cooperative signal, deadline and zero retries.
   * @returns {Promise<estypes.InfoResponse>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
   */
  info(
    params: estypes.InfoRequest,
    options: ElasticRequestOptions
  ): Promise<estypes.InfoResponse>;
  /** Native search method required from an injected client; the adapter constructs tenant predicates and validates the returned page.
   * @param {estypes.SearchRequest} params - Narrow typed native request selected by this adapter.
   * @param {ElasticRequestOptions} options - Bounded native request settings with cooperative signal, deadline and zero retries.
   * @returns {Promise<estypes.SearchResponse<T>>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
   */
  search<T>(
    params: estypes.SearchRequest,
    options: ElasticRequestOptions
  ): Promise<estypes.SearchResponse<T>>;
  /** Native bulk method required from an injected client; the adapter owns bounded batch preparation and partial-outcome validation.
   * @param {estypes.BulkRequest} params - Narrow typed native request selected by this adapter.
   * @param {ElasticRequestOptions} options - Bounded native request settings with cooperative signal, deadline and zero retries.
   * @returns {Promise<estypes.BulkResponse>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
   */
  bulk(
    params: estypes.BulkRequest,
    options: ElasticRequestOptions
  ): Promise<estypes.BulkResponse>;
  /** Perform an explicit native full-document replacement/upsert; shared update emulation is not provided.
   * @param {estypes.IndexRequest} params - Narrow typed native request selected by this adapter.
   * @param {ElasticRequestOptions} options - Bounded native request settings with cooperative signal, deadline and zero retries.
   * @returns {Promise<estypes.IndexResponse>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
   */
  index(
    params: estypes.IndexRequest,
    options: ElasticRequestOptions
  ): Promise<estypes.IndexResponse>;
  /** Retrieve an exact native document/version through the narrow injected client contract.
   * @param {estypes.GetRequest} params - Narrow typed native request selected by this adapter.
   * @param {ElasticRequestOptions} options - Bounded native request settings with cooperative signal, deadline and zero retries.
   * @returns {Promise<estypes.GetResponse<T>>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
   */
  get<T>(
    params: estypes.GetRequest,
    options: ElasticRequestOptions
  ): Promise<estypes.GetResponse<T>>;
  /** Narrow injected index administration surface; broader cluster APIs are not required. */
  indices: {
    /** Create the exact declared index only through explicit privileged provisioning.
     * @param {estypes.IndicesCreateRequest} params - Narrow typed native request selected by this adapter.
     * @param {ElasticRequestOptions} options - Bounded native request settings with cooperative signal, deadline and zero retries.
     * @returns {Promise<estypes.IndicesCreateResponse>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
     */
    create(
      params: estypes.IndicesCreateRequest,
      options: ElasticRequestOptions
    ): Promise<estypes.IndicesCreateResponse>;
    /** Read mapping metadata required to verify one compatible concrete index.
     * @param {estypes.IndicesGetMappingRequest} params - Narrow typed native request selected by this adapter.
     * @param {ElasticRequestOptions} options - Bounded native request settings with cooperative signal, deadline and zero retries.
     * @returns {Promise<estypes.IndicesGetMappingResponse>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
     */
    getMapping(
      params: estypes.IndicesGetMappingRequest,
      options: ElasticRequestOptions
    ): Promise<estypes.IndicesGetMappingResponse>;
  };
  /** Native client close contract. The adapter invokes it only for a client it constructed; an injected client remains host-owned.
   * @returns {Promise<void>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
   */
  close(): Promise<void>;
}
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

export type ElasticField = 'keyword' | 'double' | 'boolean';
export type ElasticAuth =
  | { apiKey: string }
  | { username: string; password: string };
export interface ElasticSearchOptions {
  /** Validated exact index/alias name; wildcards and multi-index expressions reject. */
  index: string;
  /** At most 32 explicitly declared keyword/double/boolean fields. */
  fields?: Readonly<Record<string, ElasticField>>;
  /** Root HTTPS endpoint required only for owned clients. */
  endpoint?: string;
  /** Exact host-approved root HTTPS endpoint allowlist. */
  allowedEndpoints?: readonly string[];
  /** Private API-key or basic/TLS authentication; mixed modes reject. */
  auth?: ElasticAuth;
  /** Optional trusted PEM CA; verification cannot be disabled. */
  ca?: string;
  /** Injected clients are borrowed; the host owns their TLS, retries and endpoint policy. */
  client?: ElasticClient;
  /** Default per-request maximum in milliseconds; 5000 by default, at most 60000. */
  timeoutMs?: number;
  /** Actual unsettled native-operation cap; defaults to 32, at most 128. */
  maxPending?: number;
}
export interface ElasticVersion {
  /** Native nonnegative sequence number required together with primaryTerm. */
  seqNo: number;
  /** Native positive primary term; stale pairs fail without replay. */
  primaryTerm: number;
}
export interface ElasticBulkFailure {
  /** Zero-based failed item position in the original bounded batch. */
  position: number;
  /** Native status code without source bodies or backend reason strings. */
  status: number;
}
/** Partial success is not atomic and is never replayed automatically. No bodies or backend reason strings. */
export class ElasticBulkError extends SearchAdapterError {
  /** Create a fixed-category error without retaining private payloads.
   * @param {readonly ElasticBulkFailure[]} failures - Redacted failed item positions/statuses only.
   * @param {number} succeeded - Successful item count; the rest of the batch may have committed independently.
   */
  constructor(
    readonly failures: readonly ElasticBulkFailure[],
    readonly succeeded: number
  ) {
    super('UNAVAILABLE', 'unknown');
    this.name = 'ElasticBulkError';
  }
}
/** Explicit stale native version conflict; callers must reconcile rather than blindly retry. */
export class ElasticConflictError extends SearchAdapterError {
  /** Create a fixed-category error without retaining private payloads.
   */
  constructor() {
    super('INVALID');
    this.name = 'ElasticConflictError';
  }
}
/** Throw a fixed public validation error without retaining source values.
 * @returns {never} Always throws the fixed INVALID category.
 */
const invalid = (): never => {
  throw new SearchAdapterError('INVALID');
};
/** Reject nonplain records, accessors, unknown fields and prototype-sensitive keys before reading values.
 * @param {unknown} value - Untrusted candidate validated before traversal or dispatch.
 * @param {readonly string[]} allowed - Optional exact own-key allowlist.
 * @returns {void} Completes only after validation; the assertion narrows the candidate record.
 */
function record(
  value: unknown,
  allowed?: readonly string[]
): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(k) ||
        (allowed && !allowed.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(value, k)!)
    )
  ) {
    invalid();
  }
}
/** Check safe numeric bounds before backend dispatch or accepting native version tokens.
 * @param {unknown} v - Candidate integer.
 * @param {number} min - Inclusive lower bound.
 * @param {number} max - Inclusive upper bound.
 * @returns {boolean} Whether the candidate is a safe integer within bounds.
 */
const integer = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
/** SHA-256 namespace digest; hashes distinguish scope but do not prove authorization.
 * @param {string} v - Verified namespace or logical identity encoding.
 * @returns {string} Hexadecimal SHA-256 digest.
 */
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
/** Restricted declared scalar-field grammar, excluding reserved document properties.
 * @param {string} v - Candidate field name.
 * @returns {boolean} Whether the field name is permitted by the adapter.
 */
const fieldName = (v: string) =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) &&
  !['id', 'text', 'constructor', 'prototype'].includes(v);
/** Normalize a root HTTPS endpoint and reject URL credentials, query, fragment and path changes.
 * @param {unknown} v - Candidate bounded scalar or URL.
 * @returns {string} Typed native/provider result; failures retain causes only for trusted host diagnostics.
 */
function endpoint(v: unknown): string {
  if (typeof v !== 'string' || v.length > 2048) {
    return invalid();
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return invalid();
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/'
  ) {
    return invalid();
  }
  return u.href;
}
/** Validate and capture explicit index, mapping, authentication and ownership policy before opening a client.
 * @param {ElasticSearchOptions} options - Explicit host-owned policy, including trusted client/credential inputs.
 * @returns {ElasticSearchOptions} Captured validated policy; no client is opened here.
 */
function configuration(options: ElasticSearchOptions) {
  record(options, [
    'index',
    'fields',
    'endpoint',
    'allowedEndpoints',
    'auth',
    'ca',
    'client',
    'timeoutMs',
    'maxPending',
  ]);
  if (
    typeof options.index !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,127}$/.test(options.index) ||
    !integer(options.timeoutMs ?? 5000, 1, 60000) ||
    !integer(options.maxPending ?? 32, 1, 128)
  ) {
    invalid();
  }
  /** Declared scalar field policy; id is always an exact keyword field. */
  const fields = options.fields ?? {};
  record(fields);
  if (
    Object.keys(fields).length > 32 ||
    Object.entries(fields).some(
      ([k, v]) => !fieldName(k) || !['keyword', 'double', 'boolean'].includes(v)
    )
  ) {
    invalid();
  }
  if (options.client) {
    if (
      ['info', 'search', 'bulk', 'index', 'get', 'close'].some(
        (k) => typeof (options.client as any)[k] !== 'function'
      ) ||
      !options.client.indices ||
      typeof options.client.indices.create !== 'function' ||
      typeof options.client.indices.getMapping !== 'function' ||
      options.endpoint !== undefined ||
      options.allowedEndpoints !== undefined ||
      options.auth !== undefined ||
      options.ca !== undefined
    ) {
      invalid();
    }
  } else {
    /** Normalized allowlisted root HTTPS endpoint for an owned client. */
    const node = endpoint(options.endpoint);
    if (
      !Array.isArray(options.allowedEndpoints) ||
      !options.allowedEndpoints.length ||
      options.allowedEndpoints.length > 16 ||
      !options.allowedEndpoints.map(endpoint).includes(node)
    ) {
      throw new SearchAdapterError('DENIED');
    }
    record(options.auth, ['apiKey', 'username', 'password']);
    /** Validated private authentication object; API-key and basic modes cannot be mixed. */
    const a = options.auth;
    if (
      'apiKey' in a
        ? Object.keys(a).length !== 1 ||
          typeof a.apiKey !== 'string' ||
          !a.apiKey ||
          a.apiKey.length > 8192
        : Object.keys(a).length !== 2 ||
          typeof a.username !== 'string' ||
          !a.username ||
          typeof a.password !== 'string' ||
          !a.password ||
          a.username.length > 256 ||
          a.password.length > 8192
    ) {
      invalid();
    }
    if (
      options.ca !== undefined &&
      (typeof options.ca !== 'string' ||
        !options.ca ||
        options.ca.length > 65536)
    ) {
      invalid();
    }
  }
  return {
    ...options,
    fields: Object.freeze({ ...fields }),
    auth: options.auth && { ...options.auth },
  };
}
/** Require the documented Elasticsearch 9.5.x engine contract; other versions are not assumed compatible.
 * @param {{ version: { number: string } }} info - Native version response from the configured engine.
 * @param {{number: string}} info.version - Native engine version record.
 * @param {string} info.version.number - Exact native version string.
 * @returns {void} Completes only for the declared engine version.
 */
function checkVersion(info: { version: { number: string } }) {
  if (!/^9\.5\.\d+(?:[-+].*)?$/.test(info?.version?.number)) {
    throw new SearchAdapterError('UNSUPPORTED');
  }
}
/** Explicitly construct or borrow a client, probe its supported engine version, and own wrapper cancellation/drain. Imports never connect or provision indexes.
 * @param {ElasticSearchOptions} input - Explicit validated adapter policy; no package discovery or implicit startup.
 * @param {AbortSignal} startupSignal - Optional host startup cancellation signal.
 * @returns {Promise<ElasticSearchAdapter>} Owned wrapper; startup failure attempts complete owned cleanup.
 */
export async function createElasticSearchAdapter(
  input: ElasticSearchOptions,
  startupSignal?: AbortSignal
) {
  /** Validated captured adapter configuration; injected client/credentials remain host-private. */
  const options = configuration(input);
  /** Only clients constructed here transfer native close ownership to this wrapper. */
  const own = !options.client;
  let client = options.client;
  if (!client) {
    try {
      /** Fixed official-client package specifier; no caller-controlled package loading. */
      const moduleId = '@elastic/elasticsearch';
      /** Official native client constructor loaded only for explicit owned-client creation. */
      const { Client } = (await import(moduleId)) as {
        Client: new (options: Record<string, unknown>) => ElasticClient;
      };
      client = new Client({
        node: endpoint(options.endpoint),
        auth: options.auth,
        tls: {
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          ...(options.ca ? { ca: options.ca } : {}),
        },
        maxRetries: 0,
        sniffOnStart: false,
        sniffOnConnectionFault: false,
        sniffInterval: false,
        requestTimeout: options.timeoutMs ?? 5000,
        maxResponseSize: 1024 * 1024,
        maxCompressedResponseSize: 1024 * 1024,
      });
    } catch (cause) {
      throw new SearchAdapterError('UNAVAILABLE', 'not-started', cause);
    }
  }
  /** Retained compatible client; borrowed clients are never closed by this wrapper. */
  const native = client;
  let closed = false,
    closing: Promise<void> | undefined;
  /** Actual unsettled native calls; capacity is held until their promises settle. */
  const pending = new Set<Promise<unknown>>();
  /** Owned per-operation cancellation controllers aborted during wrapper shutdown. */
  const controllers = new Set<AbortController>();
  /** Validated maximum request duration; each call also honors its absolute deadline. */
  const timeout = options.timeoutMs ?? 5000;
  /** Maximum actual unsettled requests retained by this adapter generation. */
  const maxPending = options.maxPending ?? 32;
  /** Declared scalar field policy; id is always an exact keyword field. */
  const fields: Record<string, ElasticField> = {
    id: 'keyword',
    ...options.fields,
  };
  /** Exact strict mapping contract; creation is explicit and existing mappings are never silently rewritten. */
  const mappings = {
    dynamic: 'strict' as const,
    properties: {
      _zxTenant: { type: 'keyword' as const },
      id: { type: 'keyword' as const },
      text: { type: 'text' as const },
      ...Object.fromEntries(
        Object.entries(options.fields).map(([k, type]) => [k, { type }])
      ),
    },
  };
  /** Validate deadline, cooperative signal and required verified tenant scope before native work.
   * @param {Omit<SearchCall, 'tenant'> & { tenant?: string }} call - Host-verified request scope with tenant when required and an absolute deadline.
   * @param {boolean} tenant - Whether this operation requires a verified tenant namespace.
   * @returns {string} Verified tenant digest or empty string for non-tenant administration.
   */
  function callScope(
    call: Omit<SearchCall, 'tenant'> & { tenant?: string },
    tenant: boolean
  ) {
    record(call, ['signal', 'deadline', 'tenant']);
    if (
      !(call.signal instanceof AbortSignal) ||
      !Number.isSafeInteger(call.deadline) ||
      (tenant &&
        (typeof call.tenant !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(call.tenant)))
    ) {
      invalid();
    }
    if (call.signal.aborted) {
      throw new SearchAdapterError('CANCELLED');
    }
    if (call.deadline <= Date.now()) {
      throw new SearchAdapterError('DEADLINE');
    }
    return tenant ? digest(call.tenant!) : '';
  }
  /** Retain actual native work and controller ownership through settlement; zero retries and uncertain write outcomes are preserved.
 * @param {Omit<SearchCall, 'tenant'>} call - Host-verified request scope with tenant when required and an absolute deadline.
 * @param {(request: {
      signal: AbortSignal;
      requestTimeout: number;
      maxRetries: number;
      retryOnTimeout: boolean;
    }) => Promise<T>} work - Trusted callback issuing native calls with zero retries and bounded request settings.
 * @param {boolean} write - Whether an interrupted result must retain unknown write outcome.
 * @returns {Promise<T>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
 */
  async function run<T>(
    call: Omit<SearchCall, 'tenant'>,
    work: (request: {
      /** Borrowed cooperative cancellation signal; native work owns settlement. */
      signal: AbortSignal;
      /** Bounded native request deadline in milliseconds. */
      requestTimeout: number;
      /** Explicit retry budget; adapter requests always use zero. */
      maxRetries: number;
      /** Native timeout replay is explicitly disabled by adapter requests. */
      retryOnTimeout: boolean;
    }) => Promise<T>,
    write = false
  ): Promise<T> {
    callScope(call, false);
    if (closed) {
      throw new SearchAdapterError('CLOSED');
    }
    if (pending.size >= maxPending) {
      throw new SearchAdapterError('LIMIT');
    }
    /** Owned cancellation request for one actual native operation. */
    const controller = new AbortController();
    controllers.add(controller);
    /** Combined caller/lifetime/deadline signal; abort cannot prove a write was rolled back. */
    const signal = AbortSignal.any([
      call.signal,
      controller.signal,
      AbortSignal.timeout(
        Math.min(timeout, Math.max(1, call.deadline - Date.now()))
      ),
    ]);
    /** Native settlement promise retained through cleanup, distinct from outer observation deadlines. */
    const task = Promise.resolve().then(() => {
      if (signal.aborted) {
        throw new SearchAdapterError('CANCELLED');
      }
      return work({
        signal,
        requestTimeout: Math.min(
          timeout,
          Math.max(1, call.deadline - Date.now())
        ),
        maxRetries: 0,
        retryOnTimeout: false,
      });
    });
    pending.add(task);
    try {
      /** Native response validated before it is exposed as a neutral result or receipt. */
      const result = await task;
      if (signal.aborted) {
        throw new SearchAdapterError(
          call.signal.aborted || controller.signal.aborted
            ? 'CANCELLED'
            : 'DEADLINE',
          write ? 'unknown' : 'not-started'
        );
      }
      return result;
    } catch (e) {
      if (e instanceof SearchAdapterError) {
        throw e;
      }
      if ((e as any)?.meta?.statusCode === 409) {
        throw new ElasticConflictError();
      }
      // Classify cancellation before wrapping the private cause; writes may already have committed.
      let category: SearchAdapterError['code'];
      if (signal.aborted) {
        if (call.signal.aborted || controller.signal.aborted) {
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
        e
      );
    } finally {
      pending.delete(task);
      controllers.delete(controller);
    }
  }
  /** Require one concrete strict mapping identical to the declared scalar schema before any data operation.
   * @param {ElasticRequestOptions} request - Native cancellation/deadline/retry settings for this call.
   * @returns {Promise<void>} Resolves only for one exact compatible mapping.
   */
  async function verifyMapping(request: ElasticRequestOptions) {
    /** Native response validated before it is exposed as a neutral result or receipt. */
    const result = await native.indices.getMapping(
      { index: options.index },
      request
    );
    /** Concrete index mappings resolved by the fixed index/alias; more than one is unsupported. */
    const entries = Object.values(result);
    if (entries.length !== 1) {
      throw new SearchAdapterError('UNSUPPORTED');
    }
    /** Single concrete mapping verified against every declared scalar property. */
    const actual = entries[0].mappings;
    if (
      actual.dynamic !== 'strict' ||
      !actual.properties ||
      Object.keys(actual.properties).length !==
        Object.keys(mappings.properties).length ||
      Object.entries(mappings.properties).some(([key, property]) => {
        /** Native field mapping; extra analyzer/options are rejected rather than assumed compatible. */
        const mapped = actual.properties![key];
        return (
          !mapped ||
          Object.keys(mapped).length !== 1 ||
          !('type' in mapped) ||
          mapped.type !== property.type
        );
      })
    ) {
      throw new SearchAdapterError('UNSUPPORTED');
    }
  }
  /** Validate an inert bounded scalar document with only declared fields; executable/accessor/prototype data reject.
   * @param {unknown} value - Untrusted candidate validated before traversal or dispatch.
   * @returns {SearchDocument} Typed native/provider result; failures retain causes only for trusted host diagnostics.
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
      invalid();
    }
    // Enforce each declared scalar type before any serialization/native call.
    for (const [key, v] of Object.entries(value)) {
      if (key === 'id' || key === 'text') {
        continue;
      }
      /** Declared scalar type; keyword, boolean and finite double checks stay distinct. */
      const type = options.fields[key];
      // Keep the scalar branches explicit; coercion could weaken the strict engine mapping.
      if (type === 'keyword') {
        if (typeof v !== 'string' || v.length > 4096) {
          invalid();
        }
      } else if (type === 'boolean') {
        if (typeof v !== 'boolean') {
          invalid();
        }
      } else if (
        typeof v !== 'number' ||
        !Number.isFinite(v) ||
        (Number.isInteger(v) && !Number.isSafeInteger(v))
      ) {
        invalid();
      }
    }
    if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024) {
      throw new SearchAdapterError('LIMIT');
    }
    return { ...value } as SearchDocument;
  }
  /** Tenant-bound logical-ID digest shared by writes/gets/deletes; not an authentication token.
   * @param {string} tenant - Previously verified tenant digest.
   * @param {string} id - Exact logical document identity.
   * @returns {string} Stable engine ID namespaced by the verified tenant.
   */
  const identifier = (tenant: string, id: string) =>
    digest(JSON.stringify([tenant, id]));
  /** Translate only allowlisted structured scalar predicates; raw DSL and reserved tenant fields are unsupported.
   * @param {readonly SearchFilter[]} input - At most sixteen bounded structured filter clauses; no raw engine DSL.
   * @returns {estypes.QueryDslQueryContainer[]} Typed native/provider result; failures retain causes only for trusted host diagnostics.
   */
  function filters(
    input: readonly SearchFilter[] = []
  ): estypes.QueryDslQueryContainer[] {
    if (!Array.isArray(input) || input.length > 16) {
      invalid();
    }
    // Validate all clause records before translating any operator.
    for (const f of input) {
      record(f, ['field', 'operator', 'value', 'caseSensitive']);
    }
    /** Cloned structured filter clauses after common bounded validation. */
    const validated = validateSearchFilters(input);
    return validated.map((f) => {
      if (
        !Object.hasOwn(fields, f.field) ||
        f.caseSensitive === false ||
        !['eq', 'neq', 'in', 'exists', 'gte', 'lte'].includes(f.operator)
      ) {
        throw new SearchAdapterError('UNSUPPORTED');
      }
      /** Required scalar JavaScript type for this explicitly declared engine field. */
      let expected: string;
      if (fields[f.field] === 'keyword') {
        expected = 'string';
      } else if (fields[f.field] === 'double') {
        expected = 'number';
      } else {
        expected = 'boolean';
      }
      if (f.operator !== 'exists') {
        // IN checks every scalar, including safe-integer preservation.
        for (const value of f.operator === 'in'
          ? (f.value as unknown[])
          : [f.value]) {
          if (
            value === null ||
            typeof value !== expected ||
            (typeof value === 'number' &&
              Number.isInteger(value) &&
              !Number.isSafeInteger(value))
          ) {
            invalid();
          }
        }
      }
      if (f.operator === 'exists') {
        return { exists: { field: f.field } };
      }
      if (f.operator === 'in') {
        return (f.value as unknown[]).length
          ? { terms: { [f.field]: f.value as string[] } }
          : { match_none: {} };
      }
      if (f.operator === 'gte' || f.operator === 'lte') {
        if (fields[f.field] !== 'double') {
          throw new SearchAdapterError('UNSUPPORTED');
        }
        return { range: { [f.field]: { [f.operator]: f.value } } };
      }
      /** Literal term predicate; neq wraps it in must_not without raw DSL evaluation. */
      const term = { term: { [f.field]: f.value as string } };
      return f.operator === 'neq' ? { bool: { must_not: [term] } } : term;
    });
  }
  /** Validate the complete bounded batch before sending; tenant IDs and partial outcomes remain explicit and never auto-replayed.
   * @param {readonly SearchDocument[] | readonly string[]} values - Bounded document or ID batch, validated completely before sending.
   * @param {SearchCall} call - Host-verified request scope with tenant when required and an absolute deadline.
   * @param {boolean} remove - Select explicit delete metadata instead of upsert documents.
   * @returns {Promise<import('@zeruxjs/search/adapters').SearchMutationReceipt>} Completed indexing receipt, not an immediate search-refresh guarantee.
   */
  async function bulk(
    values: readonly SearchDocument[] | readonly string[],
    call: SearchCall,
    remove: boolean
  ) {
    /** Digest of the host-verified tenant supplied outside user documents or filters. */
    const tenant = callScope(call, true);
    if (!Array.isArray(values) || !values.length || values.length > 100) {
      throw new SearchAdapterError('LIMIT');
    }
    /** Bounded native bulk metadata/document sequence; the whole batch is not transactional. */
    const operations: any[] = [];
    /** Batch-local duplicate logical-ID detector to prevent ambiguous repeated operations. */
    const ids = new Set<string>();
    // Prepare the entire bounded request before dispatch; a batch is not a transaction.
    for (const value of values) {
      /** Validated inert scalar document prepared independently of retained caller input. */
      const doc = remove ? undefined : document(value);
      /** Exact logical document ID before tenant-bound engine namespacing. */
      const id = remove ? value : doc!.id;
      if (typeof id !== 'string' || !id || id.length > 512 || ids.has(id)) {
        invalid();
      }
      ids.add(id);
      operations.push({
        [remove ? 'delete' : 'index']: {
          _index: options.index,
          _id: identifier(tenant, id),
        },
      });
      if (doc) {
        operations.push({ ...doc, _zxTenant: tenant });
      }
    }
    if (
      operations.reduce(
        (n, v) => n + Buffer.byteLength(JSON.stringify(v)) + 1,
        0
      ) >
      1024 * 1024
    ) {
      throw new SearchAdapterError('LIMIT');
    }
    return run(
      call,
      async (request) => {
        await verifyMapping(request);
        /** Native response validated before it is exposed as a neutral result or receipt. */
        const result = await native.bulk(
          {
            operations,
            refresh: false,
            timeout: `${request.requestTimeout}ms`,
          },
          request
        );
        if (
          !Array.isArray(result.items) ||
          result.items.length !== values.length
        ) {
          throw new SearchAdapterError('UNAVAILABLE', 'unknown');
        }
        /** Redacted failed bulk item positions/statuses; payloads and native reasons are excluded. */
        const failures: ElasticBulkFailure[] = [];
        result.items.forEach((item, position) => {
          /** One native bulk item outcome; partial failures are explicit and never replayed. */
          const outcome = remove ? item.delete : item.index;
          if (
            !outcome ||
            !integer(outcome.status, 100, 599) ||
            outcome.error ||
            (outcome.status >= 300 && !(remove && outcome.status === 404))
          ) {
            failures.push({ position, status: outcome?.status ?? 0 });
          }
        });
        if (failures.length || result.errors) {
          throw new ElasticBulkError(
            Object.freeze(failures),
            values.length - failures.length
          );
        }
        return { state: 'completed' as const };
      },
      true
    );
  }
  /** Owned wrapper lifecycle with optional native client ownership and explicit provisioning. */
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
      sort: Object.freeze(Object.keys(fields)),
      mutations: Object.freeze(['index', 'delete'] as const),
      pagination: 'offset' as const,
    }),
    /** Apply the verified tenant predicate independently of literal text, filters and sorts; validate native results before exposing them.
     * @param {ExternalSearchQuery} query - Allowlisted structured literal search query; never raw engine DSL.
     * @param {SearchCall} call - Host-verified request scope with tenant when required and an absolute deadline.
     * @returns {Promise<ExternalSearchPage>} Typed native/provider result; failures retain causes only for trusted host diagnostics.
     */
    async search(
      query: ExternalSearchQuery,
      call: SearchCall
    ): Promise<ExternalSearchPage> {
      /** Digest of the host-verified tenant supplied outside user documents or filters. */
      const tenant = callScope(call, true);
      record(query, ['text', 'limit', 'offset', 'filters', 'sort']);
      if (
        typeof query.text !== 'string' ||
        query.text.length > 4096 ||
        !integer(query.limit ?? 20, 1, 100) ||
        !integer(query.offset ?? 0, 0, 10000) ||
        (query.offset ?? 0) + (query.limit ?? 20) > 10000
      ) {
        invalid();
      }
      /** Allowlisted structured clauses; verified tenant predicate is added independently. */
      const translated = filters(query.filters);
      /** Bounded literal match text, never query_string or raw engine DSL. */
      const text = query.text;
      /** Validated result page size, capped at one hundred. */
      const limit = query.limit ?? 20;
      /** Validated offset; offset plus limit cannot exceed ten thousand. */
      const offset = query.offset ?? 0;
      if (query.sort) {
        record(query.sort, ['field', 'direction']);
        if (
          !Object.hasOwn(fields, query.sort.field) ||
          !['asc', 'desc'].includes(query.sort.direction)
        ) {
          throw new SearchAdapterError('UNSUPPORTED');
        }
      }
      /** Declared sort plus deterministic logical-ID tie breaker. */
      const sort: estypes.Sort = query.sort
        ? [
            { [query.sort.field]: query.sort.direction },
            ...(query.sort.field === 'id' ? [] : [{ id: 'asc' as const }]),
          ]
        : [{ _score: { order: 'desc' } }, { id: 'asc' }];
      return run(call, async (request) => {
        await verifyMapping(request);
        /** Native response validated before it is exposed as a neutral result or receipt. */
        const result = await native.search<
          SearchDocument & { _zxTenant: string }
        >(
          {
            index: options.index,
            from: offset,
            size: limit,
            sort,
            track_total_hits: true,
            allow_partial_search_results: false,
            timeout: `${request.requestTimeout}ms`,
            query: {
              bool: {
                filter: [{ term: { _zxTenant: tenant } }, ...translated],
                must: [
                  text
                    ? { match: { text: { query: text, operator: 'and' } } }
                    : { match_all: {} },
                ],
              },
            },
          },
          request
        );
        if (
          !Array.isArray(result.hits?.hits) ||
          result.hits.hits.length > limit
        ) {
          throw new SearchAdapterError('UNAVAILABLE');
        }
        /** Validated tenant-matching result documents with internal tenant metadata removed. */
        const hits = result.hits.hits.map((hit) => {
          if (!hit._source || hit._source._zxTenant !== tenant) {
            throw new SearchAdapterError('DENIED');
          }
          /** Strip only the checked internal namespace field before public document validation. */
          const { _zxTenant: _, ...source } = hit._source;
          return {
            document: document(source),
            ...(typeof hit._score === 'number' && Number.isFinite(hit._score)
              ? { score: hit._score }
              : {}),
          };
        });
        /** Native count/relation; nonexact totals or failed/timed-out shards mark partial coverage. */
        const total = result.hits.total;
        if (
          (typeof total === 'object' &&
            !integer(total.value, 0, Number.MAX_SAFE_INTEGER)) ||
          Buffer.byteLength(JSON.stringify(hits)) > 1024 * 1024
        ) {
          throw new SearchAdapterError('UNAVAILABLE');
        }
        return {
          hits,
          ...(typeof total === 'object' ? { total: total.value } : {}),
          coverage:
            result.timed_out ||
            result._shards.failed ||
            typeof total !== 'object' ||
            total.relation !== 'eq'
              ? 'partial'
              : 'exact',
        };
      });
    },
    /** Send a bounded full-document upsert batch; native bulk partial failures remain explicit.
     * @param {readonly SearchDocument[]} documents - Complete inert scalar records.
     * @param {SearchCall} call - Verified tenant and finite cooperative request scope.
     * @returns {Promise<object>} Completed indexing receipt, with eventual search visibility.
     */
    index: (documents: readonly SearchDocument[], call: SearchCall) =>
      bulk(documents, call, false),
    /** Delete exact verified-tenant IDs; missing documents are idempotent native successes.
     * @param {readonly string[]} ids - Bounded logical IDs before tenant namespacing.
     * @param {SearchCall} call - Verified tenant and finite cooperative request scope.
     * @returns {Promise<object>} Native completed receipt or explicit partial/uncertain failure.
     */
    delete: (ids: readonly string[], call: SearchCall) => bulk(ids, call, true),
    /** Explicit privileged provisioning; conflicts never trigger mapping replacement or alias changes.
     * @param {Omit<SearchCall, 'tenant'>} call - Host-verified request scope with tenant when required and an absolute deadline.
     * @returns {Promise<void>} Completes explicit index creation; mapping conflicts propagate.
     */
    ensureIndex(call: Omit<SearchCall, 'tenant'>) {
      return run(
        call,
        async (request) => {
          await native.indices.create(
            { index: options.index, mappings },
            request
          );
        },
        true
      );
    },
    /** Get one verified-tenant logical document together with its native optimistic concurrency tokens.
     * @param {string} id - Exact logical document identity within the verified tenant.
     * @param {SearchCall} call - Host-verified request scope with tenant when required and an absolute deadline.
     * @returns {Promise<object>} Validated document and native concurrency tokens.
     */
    async getVersion(id: string, call: SearchCall) {
      /** Digest of the host-verified tenant supplied outside user documents or filters. */
      const tenant = callScope(call, true);
      if (typeof id !== 'string' || !id || id.length > 512) {
        invalid();
      }
      return run(call, async (request) => {
        await verifyMapping(request);
        /** Native versioned document; tenant and logical ID are verified before exposure. */
        const hit = await native.get<SearchDocument & { _zxTenant: string }>(
          { index: options.index, id: identifier(tenant, id) },
          request
        );
        if (
          !hit._source ||
          hit._source._zxTenant !== tenant ||
          hit._source.id !== id
        ) {
          throw new SearchAdapterError('DENIED');
        }
        /** Strip only the checked internal namespace field before public document validation. */
        const { _zxTenant: _, ...source } = hit._source;
        if (
          !integer(hit._seq_no, 0, Number.MAX_SAFE_INTEGER) ||
          !integer(hit._primary_term, 1, Number.MAX_SAFE_INTEGER)
        ) {
          throw new SearchAdapterError('UNAVAILABLE');
        }
        return {
          document: document(source),
          version: { seqNo: hit._seq_no!, primaryTerm: hit._primary_term! },
        };
      });
    },
    /** Replace a verified-tenant document only under both explicit native concurrency tokens; conflicts are not retried.
     * @param {SearchDocument} value - Untrusted candidate validated before traversal or dispatch.
     * @param {ElasticVersion} version - Both native sequence and primary-term tokens from a prior authorized read.
     * @param {SearchCall} call - Host-verified request scope with tenant when required and an absolute deadline.
     * @returns {Promise<import('@zeruxjs/search/adapters').SearchMutationReceipt>} Completed native replacement or explicit conflict/uncertain failure.
     */
    replaceIfVersion(
      value: SearchDocument,
      version: ElasticVersion,
      call: SearchCall
    ) {
      /** Digest of the host-verified tenant supplied outside user documents or filters. */
      const tenant = callScope(call, true);
      /** Validated inert scalar document prepared independently of retained caller input. */
      const doc = document(value);
      record(version, ['seqNo', 'primaryTerm']);
      if (
        !integer(version.seqNo, 0, Number.MAX_SAFE_INTEGER) ||
        !integer(version.primaryTerm, 1, Number.MAX_SAFE_INTEGER)
      ) {
        invalid();
      }
      /** Validated native optimistic concurrency pair; no automatic stale-write retry. */
      const { seqNo, primaryTerm } = version;
      return run(
        call,
        async (request) => {
          await verifyMapping(request);
          await native.index(
            {
              index: options.index,
              id: identifier(tenant, doc.id),
              document: { ...doc, _zxTenant: tenant },
              if_seq_no: seqNo,
              if_primary_term: primaryTerm,
              refresh: false,
            },
            request
          );
          return { state: 'completed' as const };
        },
        true
      );
    },
    /** Probe the supported engine version under the same bounded cancellation policy.
     * @param {Omit<SearchCall, 'tenant'>} call - Host-verified request scope with tenant when required and an absolute deadline.
     * @returns {Promise<'ready'>} Ready only after the version probe succeeds.
     */
    health(call: Omit<SearchCall, 'tenant'>) {
      return run(call, async (request) => {
        checkVersion(await native.info({}, request));
        return 'ready' as const;
      });
    },
    /** Invalidate the wrapper, abort cooperative scopes, await actual settlement and close only an owned native client.
     * @returns {Promise<void>} Settles after drain and owned-client cleanup; borrowed clients remain open.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      // Request cancellation on every owned scope before draining actual native settlement.
      for (const c of controllers) {
        c.abort();
      }
      return (closing = (async () => {
        await Promise.allSettled([...pending]);
        if (own) {
          try {
            await native.close();
          } catch (e) {
            throw new SearchAdapterError('UNAVAILABLE', 'unknown', e);
          }
        }
      })());
    },
  } satisfies SearchAdapter & Record<string, unknown>;
  try {
    await adapter.health({
      signal: startupSignal ?? new AbortController().signal,
      deadline: Date.now() + timeout,
    });
  } catch (e) {
    try {
      await adapter.close();
    } catch (cleanup) {
      throw new SearchAdapterError(
        'UNAVAILABLE',
        'unknown',
        new AggregateError([e, cleanup])
      );
    }
    throw e;
  }
  return adapter;
}
export type ElasticSearchAdapter = Awaited<
  ReturnType<typeof createElasticSearchAdapter>
>;
/** Create an inert trusted adapter factory; private endpoint/auth settings arrive from explicit named shared-search configuration.
 * @param {Pick<
    ElasticSearchOptions,
    'index' | 'fields' | 'timeoutMs' | 'maxPending' | 'ca'
  >} options - Explicit host-owned policy, including trusted client/credential inputs.
 * @returns {SearchFactory} Typed native/provider result; failures retain causes only for trusted host diagnostics.
 */
export function createElasticSearchFactory(
  options: Pick<
    ElasticSearchOptions,
    'index' | 'fields' | 'timeoutMs' | 'maxPending' | 'ca'
  >
): SearchFactory {
  record(options, ['index', 'fields', 'timeoutMs', 'maxPending', 'ca']);
  if (options.fields !== undefined) {
    record(options.fields);
  }
  /** Captured inert factory policy; private endpoint/auth arrive only from the named shared connection. */
  const policy = {
    ...options,
    fields: options.fields && { ...options.fields },
  };
  return (connection, signal) =>
    createElasticSearchAdapter(
      {
        ...policy,
        endpoint: connection.endpoint,
        allowedEndpoints: connection.allowedEndpoints,
        auth: connection.credentials as ElasticAuth,
      },
      signal
    );
}
