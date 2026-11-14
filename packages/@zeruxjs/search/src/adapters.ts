import { jsonBytes } from './json-budget.js';
import { SearchIndex } from './search-index.js';
import { validateSearchFilters } from './query.js';
import type { SearchDocument, SearchFilter } from './types.js';

/** Scores and task identifiers are meaningful only within the selected backend. */
export interface SearchCapabilities {
  /** Requires verified per-call tenant separation; advertising it is an adapter responsibility. */
  tenantIsolation: true;
  /** Declared memory or persistent storage; memory never satisfies a persistent requirement. */
  durability: 'memory' | 'persistent';
  /** Immediate visibility or eventual backend task completion; engine scores remain provider-specific. */
  consistency: 'immediate' | 'eventual';
  /** Explicitly supported structured filter operators; unsupported requests reject. */
  filters: readonly SearchFilter['operator'][];
  /** Allowlisted sortable field names; arbitrary sorting expressions are unsupported. */
  sort: readonly string[];
  /** Explicit supported mutation operations; absent operations are never emulated. */
  mutations: readonly ('index' | 'update' | 'delete')[];
  /** Only bounded offset pagination is exposed by this contract. */
  pagination: 'offset';
}
export interface SearchCall {
  /** Borrowed cooperative cancellation signal; retain ownership until actual settlement. */
  signal: AbortSignal;
  /** Absolute Unix milliseconds after which the adapter must stop cooperative work. */
  deadline: number;
  /** Server-verified tenant scope supplied outside user query/document fields. */
  tenant: string;
}
export interface ExternalSearchQuery {
  /** Bounded literal search text; never raw engine DSL. */
  text: string;
  /** Bounded result page size; service defaults to twenty and caps at one hundred. */
  limit?: number;
  /** Bounded result offset; service caps at ten thousand. */
  offset?: number;
  /** Explicitly supported structured filter operators; unsupported requests reject. */
  filters?: readonly SearchFilter[];
  /** Allowlisted sortable field names; arbitrary sorting expressions are unsupported. */
  sort?: {
    /** Allowlisted backend sortable field. */
    field: string; /** Explicit ascending/descending ordering. */
    direction: 'asc' | 'desc';
  };
}
export interface ExternalSearchPage {
  /** Bounded returned document clones with optional provider-specific finite scores. */
  hits: readonly {
    /** Inert document value; tenant scope is enforced outside its metadata. */
    document: SearchDocument; /** Optional provider-specific score, never comparable across engines. */
    score?: number;
  }[];
  /** Optional bounded nonnegative total; coverage must describe estimate limitations. */
  total?: number;
  /** Exact persisted view or partial/estimated coverage as declared by the provider. */
  coverage: 'exact' | 'partial';
}
export interface SearchMutationReceipt {
  /** Completed operation or merely accepted asynchronous task; not an exactly-once guarantee. */
  state: 'completed' | 'accepted';
  /** Accepted tasks need backend-specific monitoring; acceptance is not visibility. */
  taskId?: string;
}
export interface SearchAdapter {
  /** Validated snapshot of the adapter capabilities; do not mutate after registration. */
  readonly capabilities: SearchCapabilities;
  /** Search only the verified tenant using declared structured capabilities; returned values are bounded inert clones.
   * @param {ExternalSearchQuery} query - Bounded structured literal query; tenant is supplied separately.
   * @param {SearchCall} call - Cooperative request scope with verified tenant when applicable.
   * @returns {Promise<ExternalSearchPage>} Bounded page; failures preserve provider-specific causes privately.
   */
  search(
    query: ExternalSearchQuery,
    call: SearchCall
  ): Promise<ExternalSearchPage>;
  /** Index only the verified tenant batch; completion and asynchronous acceptance remain distinct.
   * @param {readonly SearchDocument[]} documents - Bounded inert document batch; application data does not establish tenant authority.
   * @param {SearchCall} call - Cooperative request scope with verified tenant when applicable.
   * @returns {Promise<SearchMutationReceipt>} Explicit completed/accepted receipt; acceptance does not imply visibility.
   */
  index?(
    documents: readonly SearchDocument[],
    call: SearchCall
  ): Promise<SearchMutationReceipt>;
  /** Replace only supported verified-tenant records; never fake unsupported update semantics.
   * @param {readonly SearchDocument[]} documents - Bounded inert document batch; application data does not establish tenant authority.
   * @param {SearchCall} call - Cooperative request scope with verified tenant when applicable.
   * @returns {Promise<SearchMutationReceipt>} Provider acknowledgement with explicit completion state.
   */
  update?(
    documents: readonly SearchDocument[],
    call: SearchCall
  ): Promise<SearchMutationReceipt>;
  /** Delete exact IDs only within verified tenant scope.
   * @param {readonly string[]} ids - Bounded exact document IDs within the verified tenant.
   * @param {SearchCall} call - Cooperative request scope with verified tenant when applicable.
   * @returns {Promise<SearchMutationReceipt>} Provider acknowledgement for tenant-scoped removal.
   */
  delete?(
    ids: readonly string[],
    call: SearchCall
  ): Promise<SearchMutationReceipt>;
  /** Return fixed health status without exposing credentials or backend diagnostics.
   * @param {Omit<SearchCall, 'tenant'>} call - Cooperative request scope with verified tenant when applicable.
   * @returns {Promise<'ready' | 'unavailable'>} Fixed health value under the operation deadline.
   */
  health(call: Omit<SearchCall, 'tenant'>): Promise<'ready' | 'unavailable'>;
  /** Stop new work, request cooperative cancellation and release owned adapters after actual unsettled work drains.
   * @returns {Promise<void> | void} Settles after owned cleanup; borrowed host clients remain host-owned.
   */
  close(): Promise<void> | void;
}
export interface SearchConnection {
  /** Optional explicitly allowlisted HTTPS endpoint; URL credentials/query/fragment reject. */
  endpoint?: string;
  /** Exact normalized endpoint allowlist supplied by the host. */
  allowedEndpoints?: readonly string[];
  /** Private host-owned credentials; never returned by this API. */
  credentials?: unknown;
}
export type SearchFactory = (
  connection: Readonly<SearchConnection>,
  signal: AbortSignal
) => Promise<SearchAdapter>;
export type SearchOperation = 'search' | 'index' | 'update' | 'delete';
export interface SearchServiceOptions {
  /** Explicit trusted backend implementations; no package scanning or model-supplied imports. */
  factories: Readonly<Record<string, SearchFactory>>;
  /** Named private connections, validated and acquired in configured order. */
  connections: readonly (SearchConnection & {
    /** Restricted unique application connection name. */
    name: string;
    /** Explicit key in the registered trusted factory map. */
    backend: string;
    /** Reject memory-only providers when true; no automatic local fallback. */
    requirePersistent?: boolean;
  })[];
  /** Verify the initiating principal and tenant for this exact connection and operation; query fields are never proof.
   * @param {unknown} context - Opaque initiating context to verify through host authorization.
   * @param {string} connection - Explicit named connection, or private factory connection settings.
   * @param {SearchOperation} operation - Declared operation to authorize independently for this invocation.
   * @returns {Promise<{tenant: string} | null> | {tenant: string} | null} Verified tenant or null to deny.
   */
  authorize(
    context: unknown,
    connection: string,
    operation: SearchOperation
  ):
    | Promise<{
        /** Server-verified tenant scope supplied outside user query/document fields. */
        tenant: string;
      } | null>
    | {
        /** Server-verified tenant scope supplied outside user query/document fields. */
        tenant: string;
      }
    | null;
  /** Default operation deadline in milliseconds, at most sixty thousand. */
  timeoutMs?: number;
  /** Actual-settlement concurrency limit, at most 1024 native operations. */
  maxPending?: number;
}
/** Fixed public failure with private causes and honest mutation uncertainty. */
export class SearchAdapterError extends Error {
  /** Create a redacted public error while retaining the original cause privately.
 * @param {| 'INVALID'
      | 'DENIED'
      | 'UNSUPPORTED'
      | 'UNAVAILABLE'
      | 'CLOSED'
      | 'LIMIT'
      | 'DEADLINE'
      | 'CANCELLED'} code - Fixed public diagnostic category; excludes private values.
 * @param {'not-started' | 'unknown'} outcome - Not-started or unknown mutation outcome; no automatic retry is implied.
 * @param {unknown} cause - Private original failure available only to trusted host diagnostics.
 * @returns {undefined} undefined
 */
  constructor(
    readonly code:
      | 'INVALID'
      | 'DENIED'
      | 'UNSUPPORTED'
      | 'UNAVAILABLE'
      | 'CLOSED'
      | 'LIMIT'
      | 'DEADLINE'
      | 'CANCELLED',
    readonly outcome: 'not-started' | 'unknown' = 'not-started',
    cause?: unknown
  ) {
    super(`Search operation failed (${code})`, { cause });
    this.name = 'SearchAdapterError';
  }
}
/** Throw a fixed public failure category without embedding credentials or query/document values.
 * @param {SearchAdapterError['code']} code - Fixed public failure category.
 * @returns {never} Always throws the redacted error.
 */
const fail = (code: SearchAdapterError['code']): never => {
  throw new SearchAdapterError(code);
};
/** Restricted connection/backend identifier predicate; not an authorization decision.
 * @param {unknown} v - Candidate connection/backend identifier.
 * @returns {boolean} Whether the candidate matches the restricted name grammar.
 */
const name = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
/** Safe-integer range predicate used before acquiring resources or dispatching calls.
 * @param {unknown} v - Candidate numeric limit.
 * @param {number} max - Inclusive maximum.
 * @param {number} min - Inclusive minimum; defaults to one.
 * @returns {boolean} Whether the candidate is a safe integer within bounds.
 */
const int = (v: unknown, max: number, min = 1): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
/** Reject unknown own keys, accessors and nonplain configuration containers before use.
 * @param {unknown} v - Candidate scalar/plain object under validation.
 * @param {readonly string[]} allowed - Exact permitted own keys; accessors and nonplain objects reject.
 * @returns {void} Completes only after plain own-data shape validation; invalid input throws.
 */
function keys(
  v: unknown,
  allowed: readonly string[]
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    Object.values(Object.getOwnPropertyDescriptors(v)).some(
      (d) => !('value' in d)
    )
  ) {
    fail('INVALID');
  }
}
/** Normalize an explicitly configured HTTPS endpoint; reject credentials, fragments and query strings.
 * @param {unknown} value - Untrusted candidate validated before use.
 * @returns {string} Normalized HTTPS URL after policy validation.
 */
function endpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    return fail('INVALID');
  }
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return fail('INVALID');
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.hash ||
    u.search
  ) {
    return fail('INVALID');
  }
  return u.href;
}
/** Validate explicit factory/connection policy without acquiring resources or executing factories.
 * @param {SearchServiceOptions} options - Explicit host configuration; trusted callbacks/credentials remain private.
 * @returns {void} No resources are acquired; invalid configuration throws.
 */
export function validateSearchServiceOptions(
  options: SearchServiceOptions
): void {
  keys(options, [
    'factories',
    'connections',
    'authorize',
    'timeoutMs',
    'maxPending',
  ]);
  if (
    typeof options.authorize !== 'function' ||
    !int(options.timeoutMs ?? 5000, 60000) ||
    !int(options.maxPending ?? 64, 1024)
  ) {
    fail('INVALID');
  }
  if (
    !Array.isArray(options.connections) ||
    !options.connections.length ||
    options.connections.length > 32
  ) {
    fail('INVALID');
  }
  keys(options.factories, Object.keys(options.factories ?? {}));
  if (
    Object.keys(options.factories).length > 32 ||
    Object.entries(options.factories).some(
      ([k, v]) => !name(k) || typeof v !== 'function'
    )
  ) {
    fail('INVALID');
  }
  /** Connection names already validated; duplicate registrations reject before startup. */
  const seen = new Set<string>();
  // Validate or acquire only explicitly named connections in host registration order.
  for (const c of options.connections) {
    keys(c, [
      'name',
      'backend',
      'endpoint',
      'allowedEndpoints',
      'credentials',
      'requirePersistent',
    ]);
    if (
      !name(c.name) ||
      seen.has(c.name) ||
      !name(c.backend) ||
      !Object.hasOwn(options.factories, c.backend) ||
      (c.requirePersistent !== undefined &&
        typeof c.requirePersistent !== 'boolean')
    ) {
      fail('INVALID');
    }
    seen.add(c.name);
    if (c.endpoint !== undefined) {
      if (
        !Array.isArray(c.allowedEndpoints) ||
        c.allowedEndpoints.length > 32 ||
        !c.allowedEndpoints.map(endpoint).includes(endpoint(c.endpoint))
      ) {
        fail('DENIED');
      }
    } else if (
      c.allowedEndpoints !== undefined ||
      c.credentials !== undefined
    ) {
      fail('INVALID');
    }
  }
}
/** Validate and freeze provider capability metadata; unsupported requirements are never silently emulated.
 * @param {SearchCapabilities} value - Untrusted candidate validated before use.
 * @returns {SearchCapabilities} Validated frozen capability snapshot.
 */
function capabilities(value: SearchCapabilities): SearchCapabilities {
  keys(value, [
    'tenantIsolation',
    'durability',
    'consistency',
    'filters',
    'sort',
    'mutations',
    'pagination',
  ]);
  if (
    value.tenantIsolation !== true ||
    !['memory', 'persistent'].includes(value.durability) ||
    !['immediate', 'eventual'].includes(value.consistency) ||
    value.pagination !== 'offset'
  ) {
    fail('UNSUPPORTED');
  }
  if (
    !Array.isArray(value.filters) ||
    value.filters.length > 8 ||
    value.filters.some(
      (v) =>
        ![
          'eq',
          'neq',
          'in',
          'gte',
          'lte',
          'exists',
          'contains',
          'prefix',
        ].includes(v)
    ) ||
    !Array.isArray(value.sort) ||
    value.sort.length > 32 ||
    value.sort.some(
      (v) => typeof v !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(v)
    ) ||
    !Array.isArray(value.mutations) ||
    value.mutations.length > 3 ||
    value.mutations.some((v) => !['index', 'update', 'delete'].includes(v))
  ) {
    fail('INVALID');
  }
  return Object.freeze({
    ...value,
    filters: Object.freeze([...value.filters]),
    sort: Object.freeze([...value.sort]),
    mutations: Object.freeze([...value.mutations]),
  });
}
/** Create an inert private framework registration; start explicitly acquires a new owned service generation.
 * @param {SearchServiceOptions} options - Explicit host configuration; trusted callbacks/credentials remain private.
 * @returns {object} Inert registration with explicit validate/start; acquiring a generation is separate.
 */
export function registerSearchService(options: SearchServiceOptions) {
  validateSearchServiceOptions(options);
  // Snapshot configuration without cloning private credential/runtime objects.
  /** Private immutable-by-structure registration snapshot; credential/runtime objects remain borrowed. */
  const config = {
    ...options,
    factories: { ...options.factories },
    connections: options.connections.map((c) => ({
      ...c,
      allowedEndpoints: c.allowedEndpoints && [...c.allowedEndpoints],
    })),
  };
  return Object.freeze({
    kind: 'zerux-search-v1' as const,
    /** Revalidate the captured inert registration without starting services.
     * @returns {void} Completes after validating the private captured configuration.
     */
    validate() {
      validateSearchServiceOptions(config);
    },
    /** Explicitly acquire a fresh generation; caller/framework owns its close lifecycle.
     * @returns {Promise<SearchServices>} New owned generation requiring close on teardown.
     */
    start() {
      return createSearchServices(config);
    },
  });
}
/** Acquire explicit adapters with reverse rollback on failure. Call close to cancel observation, await actual settlement and close every accepted adapter.
 * @param {SearchServiceOptions} options - Explicit host configuration; trusted callbacks/credentials remain private.
 * @returns {Promise<SearchServices>} Owned service generation; failed acquisition awaits reverse cleanup.
 */
export async function createSearchServices(options: SearchServiceOptions) {
  validateSearchServiceOptions(options);
  options = {
    ...options,
    factories: { ...options.factories },
    connections: options.connections.map((c) => ({
      ...c,
      allowedEndpoints: c.allowedEndpoints && [...c.allowedEndpoints],
    })),
  };
  /** Generation-owned adapters with validated capability snapshots, closed in reverse acquisition order. */
  const instances = new Map<
    string,
    {
      adapter: SearchAdapter; /** Validated snapshot of the adapter capabilities; do not mutate after registration. */
      capabilities: SearchCapabilities;
    }
  >();
  /** Service lifetime signal; shutdown cancels observation and requests cooperative native cancellation. */
  const lifetime = new AbortController();
  /** Actual unsettled native operations; caller timeouts never release these capacity slots early. */
  const pending = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Validated default maximum call time; per-call budgets may only shorten it. */
  const timeout = options.timeoutMs ?? 5000;
  /** Maximum actual unsettled operations, including startup factory work. */
  const maxPending = options.maxPending ?? 64;
  /** Stop new work, request cooperative cancellation and release owned adapters after actual unsettled work drains.
   * @returns {Promise<void> | void} Settles after owned cleanup; borrowed host clients remain host-owned.
   */
  async function close() {
    if (closing) {
      return closing;
    }
    closed = true;
    lifetime.abort();
    closing = (async () => {
      await Promise.allSettled([...pending]);
      /** Private close failures collected while attempting cleanup of every owned adapter. */
      const errors: unknown[] = [];
      // Attempt every cleanup in reverse acquisition order, retaining failures until all owners were visited.
      for (const { adapter } of [...instances.values()].reverse()) {
        try {
          await adapter.close();
        } catch (e) {
          errors.push(e);
        }
      }
      instances.clear();
      if (errors.length) {
        throw new SearchAdapterError(
          'UNAVAILABLE',
          'unknown',
          new AggregateError(errors)
        );
      }
    })();
    return closing;
  }
  /** Bound caller observation while retaining native capacity/ownership until actual settlement; mutation uncertainty is preserved.
   * @param {(call: Omit<SearchCall, 'tenant'>) => Promise<T>} work - Trusted operation callback retained until its actual native promise settles.
   * @param {AbortSignal} signal - Optional caller cancellation signal; cancellation does not prove rollback.
   * @param {number} timeoutMs - Optional shortened call deadline; never exceeds service policy.
   * @param {boolean} mutation - Whether cancellation/errors must retain an unknown mutation outcome.
   * @returns {Promise<T>} Caller-facing result; native settlement may outlive cancellation.
   */
  async function bounded<T>(
    work: (call: Omit<SearchCall, 'tenant'>) => Promise<T>,
    signal?: AbortSignal,
    timeoutMs = timeout,
    mutation = false
  ): Promise<T> {
    if (closed) {
      return fail('CLOSED');
    }
    if (!int(timeoutMs, timeout)) {
      return fail('INVALID');
    }
    if (signal?.aborted) {
      return fail('CANCELLED');
    }
    if (pending.size >= maxPending) {
      return fail('LIMIT');
    }
    /** Per-operation cancellation request; it cannot force arbitrary adapter JavaScript to settle. */
    const controller = new AbortController();
    /** Absolute operation deadline supplied to cooperative adapters. */
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout>,
      abort!: () => void,
      shutdown!: () => void;
    /** Caller-facing cancellation/deadline race, separate from actual native settlement. */
    const stopped = new Promise<never>((_, reject) => {
      /** Cancel cooperative work and reject observation, preserving unknown mutation outcomes.
       * @param {'CANCELLED' | 'DEADLINE'} code - Caller-observation terminal category.
       * @returns {void} Requests cancellation and rejects the observation race.
       */
      const stop = (code: 'CANCELLED' | 'DEADLINE') => {
        controller.abort();
        reject(
          new SearchAdapterError(code, mutation ? 'unknown' : 'not-started')
        );
      };
      abort = () => stop('CANCELLED');
      shutdown = abort;
      signal?.addEventListener('abort', abort, { once: true });
      lifetime.signal.addEventListener('abort', shutdown, { once: true });
      timer = setTimeout(() => stop('DEADLINE'), timeoutMs);
    });
    /** Actual work promise retained until settlement even after caller cancellation. */
    const native = Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        return fail('CANCELLED');
      }
      return work({ signal: controller.signal, deadline });
    });
    pending.add(native);
    void native.finally(() => pending.delete(native)).catch(() => {});
    try {
      return await Promise.race([native, stopped]);
    } catch (error) {
      if (error instanceof SearchAdapterError) {
        throw error;
      }
      throw new SearchAdapterError(
        'UNAVAILABLE',
        mutation ? 'unknown' : 'not-started',
        error
      );
    } finally {
      clearTimeout(timer!);
      signal?.removeEventListener('abort', abort);
      lifetime.signal.removeEventListener('abort', shutdown);
    }
  }
  try {
    // Validate or acquire only explicitly named connections in host registration order.
    for (const c of options.connections) {
      // Startup owns late factory settlement and rollback too. Factories must cooperate with signals.
      /** Acquired adapter retained before capability checks so failed startup still owns rollback. */
      const adapter = await bounded(async (call) => {
        /** Factory result whose close ownership transfers to this generation after validation. */
        const factory = options.factories[c.backend];
        if (!factory) {
          throw new TypeError(`Unknown search backend: ${c.backend}`);
        }
        /** Adapter instance acquired under the bounded startup call scope. */
        const acquired = await factory(
          {
            endpoint: c.endpoint,
            allowedEndpoints: c.allowedEndpoints,
            credentials: c.credentials,
          },
          call.signal
        );
        if (!acquired || typeof acquired.close !== 'function') {
          return fail('INVALID');
        }
        instances.set(c.name, {
          adapter: acquired,
          capabilities: acquired.capabilities,
        });
        return acquired;
      });
      /** Validated frozen provider capability metadata; unsupported requirements reject before use. */
      const caps = capabilities(adapter.capabilities);
      if (
        typeof adapter.search !== 'function' ||
        typeof adapter.health !== 'function' ||
        typeof adapter.close !== 'function' ||
        caps.mutations.some((op) => typeof adapter[op] !== 'function') ||
        (c.requirePersistent && caps.durability !== 'persistent')
      ) {
        fail('UNSUPPORTED');
      }
      instances.set(c.name, { adapter, capabilities: caps });
    }
  } catch (e) {
    try {
      await close();
    } catch (cleanup) {
      throw new SearchAdapterError(
        'UNAVAILABLE',
        'unknown',
        new AggregateError([e, cleanup], 'Search startup and rollback failed')
      );
    }
    throw e instanceof SearchAdapterError
      ? e
      : new SearchAdapterError('UNAVAILABLE', 'not-started', e);
  }
  /** Select an explicitly registered adapter; closed or unknown names reject with fixed public errors.
   * @param {string} connection - Explicit named connection, or private factory connection settings.
   * @returns {object} Selected adapter/capability pair or a fixed-category failure.
   */
  function get(connection: string) {
    /** Selected generation-owned adapter; names never select packages dynamically. */
    const item = instances.get(connection);
    if (!item) {
      return fail(closed ? 'CLOSED' : 'INVALID');
    }
    return item;
  }
  return {
    /** Validate and freeze provider capability metadata; unsupported requirements are never silently emulated.
     * @param {string} connection - Explicit named connection, or private factory connection settings.
     * @returns {SearchCapabilities} Validated frozen capability snapshot.
     */
    capabilities(connection: string) {
      if (closed) {
        return fail('CLOSED');
      }
      return get(connection).capabilities;
    },
    /** Search only the verified tenant using declared structured capabilities; returned values are bounded inert clones.
     * @param {string} connection - Explicit named connection, or private factory connection settings.
     * @param {unknown} context - Opaque initiating context to verify through host authorization.
     * @param {ExternalSearchQuery} query - Bounded structured literal query; tenant is supplied separately.
     * @param {{ signal?: AbortSignal; timeoutMs?: number }} control - Optional cooperative signal and shortened deadline.
     * @param {AbortSignal} control.signal - Optional caller cancellation signal.
     * @param {number} control.timeoutMs - Optional shorter deadline in milliseconds.
     * @returns {Promise<ExternalSearchPage>} Bounded page; failures preserve provider-specific causes privately.
     */
    search(
      connection: string,
      context: unknown,
      query: ExternalSearchQuery,
      control: {
        /** Borrowed cooperative cancellation signal; retain ownership until actual settlement. */
        signal?: AbortSignal; /** Default operation deadline in milliseconds, at most sixty thousand. */
        timeoutMs?: number;
      } = {}
    ) {
      keys(query, ['text', 'limit', 'offset', 'filters', 'sort']);
      /** Selected generation-owned adapter; names never select packages dynamically. */
      const item = get(connection);
      if (
        typeof query.text !== 'string' ||
        query.text.length > 4096 ||
        !int(query.limit ?? 20, 100) ||
        !int(query.offset ?? 0, 10000, 0)
      ) {
        return fail('INVALID');
      }
      validateSearchFilters(query.filters);
      if (
        query.filters?.some(
          (f) => !item.capabilities.filters.includes(f.operator)
        )
      ) {
        return fail('UNSUPPORTED');
      }
      if (query.sort) {
        keys(query.sort, ['field', 'direction']);
        if (
          !item.capabilities.sort.includes(query.sort.field) ||
          !['asc', 'desc'].includes(query.sort.direction)
        ) {
          return fail('UNSUPPORTED');
        }
      }
      /** Independent validated query/batch copy; authorization supplies tenant separately. */
      const safe = structuredClone(query);
      return bounded(
        async (call) => {
          /** Host-verified per-invocation tenant result; caller document fields cannot override it. */
          const identity = await options.authorize(
            context,
            connection,
            'search'
          );
          if (
            !identity ||
            typeof identity.tenant !== 'string' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(identity.tenant)
          ) {
            return fail('DENIED');
          }
          if (call.signal.aborted) {
            return fail('CANCELLED');
          }
          /** Provider response validated for inert bytes, shape and finite scores before cloning. */
          const page = await item.adapter.search(safe, {
            ...call,
            tenant: identity.tenant,
          });
          jsonBytes(page, 1024 * 1024);
          if (
            !page ||
            !Array.isArray(page.hits) ||
            page.hits.length > (safe.limit ?? 20) ||
            !['exact', 'partial'].includes(page.coverage) ||
            (page.total !== undefined &&
              !int(page.total, Number.MAX_SAFE_INTEGER, 0))
          ) {
            return fail('INVALID');
          }
          // Validate each bounded returned hit before exposing any provider response to the caller.
          for (const hit of page.hits) {
            if (
              !hit ||
              !hit.document ||
              typeof hit.document.id !== 'string' ||
              !hit.document.id ||
              typeof hit.document.text !== 'string' ||
              (hit.score !== undefined &&
                (typeof hit.score !== 'number' || !Number.isFinite(hit.score)))
            ) {
              return fail('INVALID');
            }
          }
          return structuredClone(page);
        },
        control.signal,
        control.timeoutMs
      );
    },
    mutate(
      connection: string,
      context: unknown,
      operation: Exclude<SearchOperation, 'search'>,
      values: readonly SearchDocument[] | readonly string[],
      control: {
        /** Borrowed cooperative cancellation signal; retain ownership until actual settlement. */
        signal?: AbortSignal; /** Default operation deadline in milliseconds, at most sixty thousand. */
        timeoutMs?: number;
      } = {}
    ) {
      /** Selected generation-owned adapter; names never select packages dynamically. */
      const item = get(connection);
      if (
        !['index', 'update', 'delete'].includes(operation) ||
        !item.capabilities.mutations.includes(operation)
      ) {
        return fail('UNSUPPORTED');
      }
      if (!Array.isArray(values) || !values.length || values.length > 100) {
        return fail('LIMIT');
      }
      jsonBytes(values, 1024 * 1024);
      // Reject the complete batch before dispatch if any document/ID has an invalid shape.
      for (const value of values) {
        if (
          operation === 'delete'
            ? typeof value !== 'string' || !value || value.length > 512
            : !value ||
              typeof value !== 'object' ||
              typeof (value as SearchDocument).id !== 'string' ||
              !(value as SearchDocument).id ||
              typeof (value as SearchDocument).text !== 'string'
        ) {
          return fail('INVALID');
        }
      }
      /** Independent validated query/batch copy; authorization supplies tenant separately. */
      const safe = structuredClone(values);
      return bounded(
        async (call) => {
          /** Host-verified per-invocation tenant result; caller document fields cannot override it. */
          const identity = await options.authorize(
            context,
            connection,
            operation
          );
          if (
            !identity ||
            typeof identity.tenant !== 'string' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(identity.tenant)
          ) {
            return fail('DENIED');
          }
          if (call.signal.aborted) {
            return fail('CANCELLED');
          }
          /** Explicitly declared supported mutation method invoked with its original adapter receiver. */
          const method = item.adapter[operation]! as (
            values: typeof safe,
            call: SearchCall
          ) => Promise<SearchMutationReceipt>;
          /** Provider acknowledgement; accepted tasks remain distinct from completed mutations. */
          const receipt = await method.call(item.adapter, safe, {
            ...call,
            tenant: identity.tenant,
          });
          if (
            !receipt ||
            !['accepted', 'completed'].includes(receipt.state) ||
            (receipt.state === 'accepted' &&
              (typeof receipt.taskId !== 'string' ||
                !receipt.taskId ||
                receipt.taskId.length > 256))
          ) {
            return fail('INVALID');
          }
          return {
            state: receipt.state,
            ...(receipt.taskId ? { taskId: receipt.taskId } : {}),
          };
        },
        control.signal,
        control.timeoutMs,
        true
      );
    },
    /** Return fixed health status without exposing credentials or backend diagnostics.
     * @param {string} connection - Explicit named connection, or private factory connection settings.
     * @param {{ signal?: AbortSignal; timeoutMs?: number }} control - Optional cooperative signal and shortened deadline.
     * @param {AbortSignal} control.signal - Optional caller cancellation signal.
     * @param {number} control.timeoutMs - Optional shorter deadline in milliseconds.
     * @returns {Promise<'ready' | 'unavailable'>} Fixed health value under the operation deadline.
     */
    health(
      connection: string,
      control: {
        /** Borrowed cooperative cancellation signal; retain ownership until actual settlement. */
        signal?: AbortSignal; /** Default operation deadline in milliseconds, at most sixty thousand. */
        timeoutMs?: number;
      } = {}
    ) {
      /** Selected generation-owned adapter; names never select packages dynamically. */
      const item = get(connection);
      return bounded(
        async (call) => {
          /** Validated fixed health status, with no provider-specific secrets exposed. */
          const result = await item.adapter.health(call);
          if (!['ready', 'unavailable'].includes(result)) {
            return fail('INVALID');
          }
          return result;
        },
        control.signal,
        control.timeoutMs
      );
    },
    close,
  };
}
export type SearchServices = Awaited<ReturnType<typeof createSearchServices>>;

/** Create an inert explicit memory-only factory with separate bounded tenant indexes; never use it as automatic durable fallback.
 * @param {{
  maxTenants: number;
  maxDocumentsPerTenant: number;
}} options - Explicit host configuration; trusted callbacks/credentials remain private.
 * @param {number} options.maxTenants - Finite independent tenant-index cap.
 * @param {number} options.maxDocumentsPerTenant - Finite per-tenant document cap.
 * @returns {SearchFactory} Inert factory; invocation acquires a memory-only adapter.
 */
export function createLocalSearchFactory(options: {
  maxTenants: number;
  maxDocumentsPerTenant: number;
}): SearchFactory {
  keys(options, ['maxTenants', 'maxDocumentsPerTenant']);
  if (
    !int(options.maxTenants, 1000) ||
    !int(options.maxDocumentsPerTenant, 100000)
  ) {
    fail('INVALID');
  }
  /** Captured finite tenant/document policy for this explicit memory-only factory. */
  const limits = { ...options };
  return async (connection) => {
    if (
      connection.endpoint !== undefined ||
      connection.credentials !== undefined
    ) {
      return fail('INVALID');
    }
    /** Physically separate per-tenant local indexes; no shared private vocabulary. */
    const indices = new Map<string, SearchIndex<SearchDocument>>();
    let closed = false;
    /** Cooperative local lifetime guard; external authorization remains with the service.
     * @param {SearchCall} call - Verified scoped request with a cooperative signal.
     * @returns {void} Completes only while open and not cancelled.
     */
    const check = (call: SearchCall) => {
      if (closed) {
        fail('CLOSED');
      }
      if (call.signal.aborted) {
        fail('CANCELLED');
      }
    };
    return {
      capabilities: {
        tenantIsolation: true,
        durability: 'memory',
        consistency: 'immediate',
        filters: [
          'eq',
          'neq',
          'in',
          'gte',
          'lte',
          'exists',
          'contains',
          'prefix',
        ],
        sort: [],
        mutations: ['index', 'delete'],
        pagination: 'offset',
      },
      /** Search only the verified tenant using declared structured capabilities; returned values are bounded inert clones.
       * @param {ExternalSearchQuery} query - Bounded structured literal query; tenant is supplied separately.
       * @param {SearchCall} call - Cooperative request scope with verified tenant when applicable.
       * @returns {Promise<ExternalSearchPage>} Bounded page; failures preserve provider-specific causes privately.
       */
      async search(query, call) {
        check(call);
        /** Cloned local results from the verified tenant index only. */
        const hits =
          indices.get(call.tenant)?.search(query.text, {
            limit: query.limit,
            offset: query.offset,
            filters: query.filters,
          }) ?? [];
        return { hits, coverage: 'exact' };
      },
      /** Index only the verified tenant batch; completion and asynchronous acceptance remain distinct.
       * @param {readonly SearchDocument[]} documents - Bounded inert document batch; application data does not establish tenant authority.
       * @param {SearchCall} call - Cooperative request scope with verified tenant when applicable.
       * @returns {Promise<SearchMutationReceipt>} Explicit completed/accepted receipt; acceptance does not imply visibility.
       */
      async index(documents, call) {
        check(call);
        let index = indices.get(call.tenant);
        if (!index) {
          if (indices.size >= limits.maxTenants) {
            return fail('LIMIT');
          }
          index = new SearchIndex({
            maxDocuments: limits.maxDocumentsPerTenant,
          });
          index.addMany(documents);
          indices.set(call.tenant, index);
        } else {
          index.addMany(documents);
        }
        return { state: 'completed' };
      },
      /** Delete exact IDs only within verified tenant scope.
       * @param {readonly string[]} ids - Bounded exact document IDs within the verified tenant.
       * @param {SearchCall} call - Cooperative request scope with verified tenant when applicable.
       * @returns {Promise<SearchMutationReceipt>} Provider acknowledgement for tenant-scoped removal.
       */
      async delete(ids, call) {
        check(call);
        // Remove records only from the verified tenant index; absent IDs remain harmless.
        for (const id of ids) {
          indices.get(call.tenant)?.remove(id);
        }
        return { state: 'completed' };
      },
      /** Return fixed health status without exposing credentials or backend diagnostics.
       * @returns {Promise<'ready' | 'unavailable'>} Fixed health value under the operation deadline.
       */
      async health() {
        return closed ? 'unavailable' : 'ready';
      },
      /** Stop new work, request cooperative cancellation and release owned adapters after actual unsettled work drains.
       * @returns {Promise<void> | void} Settles after owned cleanup; borrowed host clients remain host-owned.
       */
      close() {
        closed = true;
        indices.clear();
      },
    };
  };
}
