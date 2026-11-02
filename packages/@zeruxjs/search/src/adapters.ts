import { jsonBytes } from "./json-budget.js";
import { SearchIndex } from "./search-index.js";
import { validateSearchFilters } from "./query.js";
import type { SearchDocument, SearchFilter } from "./types.js";

/** Scores and task identifiers are meaningful only within the selected backend. */
export interface SearchCapabilities {
  tenantIsolation: true;
  durability: "memory" | "persistent";
  consistency: "immediate" | "eventual";
  filters: readonly SearchFilter["operator"][];
  sort: readonly string[];
  mutations: readonly ("index" | "update" | "delete")[];
  pagination: "offset";
}
export interface SearchCall {
  signal: AbortSignal;
  deadline: number;
  tenant: string;
}
export interface ExternalSearchQuery {
  text: string;
  limit?: number;
  offset?: number;
  filters?: readonly SearchFilter[];
  sort?: { field: string; direction: "asc" | "desc" };
}
export interface ExternalSearchPage {
  hits: readonly { document: SearchDocument; score?: number }[];
  total?: number;
  coverage: "exact" | "partial";
}
export interface SearchMutationReceipt {
  state: "completed" | "accepted";
  /** Accepted tasks need backend-specific monitoring; acceptance is not visibility. */
  taskId?: string;
}
export interface SearchAdapter {
  readonly capabilities: SearchCapabilities;
  search(
    query: ExternalSearchQuery,
    call: SearchCall,
  ): Promise<ExternalSearchPage>;
  index?(
    documents: readonly SearchDocument[],
    call: SearchCall,
  ): Promise<SearchMutationReceipt>;
  update?(
    documents: readonly SearchDocument[],
    call: SearchCall,
  ): Promise<SearchMutationReceipt>;
  delete?(
    ids: readonly string[],
    call: SearchCall,
  ): Promise<SearchMutationReceipt>;
  health(call: Omit<SearchCall, "tenant">): Promise<"ready" | "unavailable">;
  close(): Promise<void> | void;
}
export interface SearchConnection {
  endpoint?: string;
  allowedEndpoints?: readonly string[];
  /** Private host-owned credentials; never returned by this API. */
  credentials?: unknown;
}
export type SearchFactory = (
  connection: Readonly<SearchConnection>,
  signal: AbortSignal,
) => Promise<SearchAdapter>;
export type SearchOperation = "search" | "index" | "update" | "delete";
export interface SearchServiceOptions {
  factories: Readonly<Record<string, SearchFactory>>;
  connections: readonly (SearchConnection & {
    name: string;
    backend: string;
    requirePersistent?: boolean;
  })[];
  /** Verify host sessions/authorization here. Never return an unverified header tenant. */
  authorize(
    context: unknown,
    connection: string,
    operation: SearchOperation,
  ): Promise<{ tenant: string } | null> | { tenant: string } | null;
  timeoutMs?: number;
  maxPending?: number;
}
export class SearchAdapterError extends Error {
  constructor(
    readonly code:
      | "INVALID"
      | "DENIED"
      | "UNSUPPORTED"
      | "UNAVAILABLE"
      | "CLOSED"
      | "LIMIT"
      | "DEADLINE"
      | "CANCELLED",
    readonly outcome: "not-started" | "unknown" = "not-started",
    cause?: unknown,
  ) {
    super(`Search operation failed (${code})`, { cause });
    this.name = "SearchAdapterError";
  }
}
const fail = (code: SearchAdapterError["code"]): never => {
  throw new SearchAdapterError(code);
};
const name = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(v);
const int = (v: unknown, max: number, min = 1): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
function keys(
  v: unknown,
  allowed: readonly string[],
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    Object.values(Object.getOwnPropertyDescriptors(v)).some(
      (d) => !("value" in d),
    )
  )
    fail("INVALID");
}
function endpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return fail("INVALID");
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return fail("INVALID");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search)
    return fail("INVALID");
  return u.href;
}
export function validateSearchServiceOptions(
  options: SearchServiceOptions,
): void {
  keys(options, [
    "factories",
    "connections",
    "authorize",
    "timeoutMs",
    "maxPending",
  ]);
  if (
    typeof options.authorize !== "function" ||
    !int(options.timeoutMs ?? 5000, 60000) ||
    !int(options.maxPending ?? 64, 1024)
  )
    fail("INVALID");
  if (
    !Array.isArray(options.connections) ||
    !options.connections.length ||
    options.connections.length > 32
  )
    fail("INVALID");
  keys(options.factories, Object.keys(options.factories ?? {}));
  if (
    Object.keys(options.factories).length > 32 ||
    Object.entries(options.factories).some(
      ([k, v]) => !name(k) || typeof v !== "function",
    )
  )
    fail("INVALID");
  const seen = new Set<string>();
  for (const c of options.connections) {
    keys(c, [
      "name",
      "backend",
      "endpoint",
      "allowedEndpoints",
      "credentials",
      "requirePersistent",
    ]);
    if (
      !name(c.name) ||
      seen.has(c.name) ||
      !name(c.backend) ||
      !Object.hasOwn(options.factories, c.backend) ||
      (c.requirePersistent !== undefined &&
        typeof c.requirePersistent !== "boolean")
    )
      fail("INVALID");
    seen.add(c.name);
    if (c.endpoint !== undefined) {
      if (
        !Array.isArray(c.allowedEndpoints) ||
        c.allowedEndpoints.length > 32 ||
        !c.allowedEndpoints.map(endpoint).includes(endpoint(c.endpoint))
      )
        fail("DENIED");
    } else if (c.allowedEndpoints !== undefined || c.credentials !== undefined)
      fail("INVALID");
  }
}
function capabilities(value: SearchCapabilities): SearchCapabilities {
  keys(value, [
    "tenantIsolation",
    "durability",
    "consistency",
    "filters",
    "sort",
    "mutations",
    "pagination",
  ]);
  if (
    value.tenantIsolation !== true ||
    !["memory", "persistent"].includes(value.durability) ||
    !["immediate", "eventual"].includes(value.consistency) ||
    value.pagination !== "offset"
  )
    fail("UNSUPPORTED");
  if (
    !Array.isArray(value.filters) ||
    value.filters.length > 8 ||
    value.filters.some(
      (v) =>
        ![
          "eq",
          "neq",
          "in",
          "gte",
          "lte",
          "exists",
          "contains",
          "prefix",
        ].includes(v),
    ) ||
    !Array.isArray(value.sort) ||
    value.sort.length > 32 ||
    value.sort.some(
      (v) => typeof v !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(v),
    ) ||
    !Array.isArray(value.mutations) ||
    value.mutations.length > 3 ||
    value.mutations.some((v) => !["index", "update", "delete"].includes(v))
  )
    fail("INVALID");
  return Object.freeze({
    ...value,
    filters: Object.freeze([...value.filters]),
    sort: Object.freeze([...value.sort]),
    mutations: Object.freeze([...value.mutations]),
  });
}
/** A private inert registration consumed by zeruxjs search.registration. No package discovery. */
export function registerSearchService(options: SearchServiceOptions) {
  validateSearchServiceOptions(options);
  // Snapshot configuration without cloning private credential/runtime objects.
  const config = {
    ...options,
    factories: { ...options.factories },
    connections: options.connections.map((c) => ({
      ...c,
      allowedEndpoints: c.allowedEndpoints && [...c.allowedEndpoints],
    })),
  };
  return Object.freeze({
    kind: "zerux-search-v1" as const,
    validate() {
      validateSearchServiceOptions(config);
    },
    start() {
      return createSearchServices(config);
    },
  });
}
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
  const instances = new Map<
    string,
    { adapter: SearchAdapter; capabilities: SearchCapabilities }
  >();
  const lifetime = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  const timeout = options.timeoutMs ?? 5000,
    maxPending = options.maxPending ?? 64;
  async function close() {
    if (closing) return closing;
    closed = true;
    lifetime.abort();
    closing = (async () => {
      await Promise.allSettled([...pending]);
      const errors: unknown[] = [];
      for (const { adapter } of [...instances.values()].reverse())
        try {
          await adapter.close();
        } catch (e) {
          errors.push(e);
        }
      instances.clear();
      if (errors.length)
        throw new SearchAdapterError(
          "UNAVAILABLE",
          "unknown",
          new AggregateError(errors),
        );
    })();
    return closing;
  }
  async function bounded<T>(
    work: (call: Omit<SearchCall, "tenant">) => Promise<T>,
    signal?: AbortSignal,
    timeoutMs = timeout,
    mutation = false,
  ): Promise<T> {
    if (closed) return fail("CLOSED");
    if (!int(timeoutMs, timeout)) return fail("INVALID");
    if (signal?.aborted) return fail("CANCELLED");
    if (pending.size >= maxPending) return fail("LIMIT");
    const controller = new AbortController(),
      deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout>,
      abort!: () => void,
      shutdown!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      const stop = (code: "CANCELLED" | "DEADLINE") => {
        controller.abort();
        reject(
          new SearchAdapterError(code, mutation ? "unknown" : "not-started"),
        );
      };
      abort = () => stop("CANCELLED");
      shutdown = abort;
      signal?.addEventListener("abort", abort, { once: true });
      lifetime.signal.addEventListener("abort", shutdown, { once: true });
      timer = setTimeout(() => stop("DEADLINE"), timeoutMs);
    });
    const native = Promise.resolve().then(() => {
      if (controller.signal.aborted) return fail("CANCELLED");
      return work({ signal: controller.signal, deadline });
    });
    pending.add(native);
    void native.finally(() => pending.delete(native)).catch(() => {});
    try {
      return await Promise.race([native, stopped]);
    } catch (error) {
      if (error instanceof SearchAdapterError) throw error;
      throw new SearchAdapterError(
        "UNAVAILABLE",
        mutation ? "unknown" : "not-started",
        error,
      );
    } finally {
      clearTimeout(timer!);
      signal?.removeEventListener("abort", abort);
      lifetime.signal.removeEventListener("abort", shutdown);
    }
  }
  try {
    for (const c of options.connections) {
      // Startup owns late factory settlement and rollback too. Factories must cooperate with signals.
      const adapter = await bounded(async (call) => {
        const acquired = await options.factories[c.backend](
          {
            endpoint: c.endpoint,
            allowedEndpoints: c.allowedEndpoints,
            credentials: c.credentials,
          },
          call.signal,
        );
        if (!acquired || typeof acquired.close !== "function")
          return fail("INVALID");
        instances.set(c.name, {
          adapter: acquired,
          capabilities: acquired.capabilities,
        });
        return acquired;
      });
      const caps = capabilities(adapter.capabilities);
      if (
        typeof adapter.search !== "function" ||
        typeof adapter.health !== "function" ||
        typeof adapter.close !== "function" ||
        caps.mutations.some((op) => typeof adapter[op] !== "function") ||
        (c.requirePersistent && caps.durability !== "persistent")
      )
        fail("UNSUPPORTED");
      instances.set(c.name, { adapter, capabilities: caps });
    }
  } catch (e) {
    try {
      await close();
    } catch (cleanup) {
      throw new SearchAdapterError(
        "UNAVAILABLE",
        "unknown",
        new AggregateError([e, cleanup], "Search startup and rollback failed"),
      );
    }
    throw e instanceof SearchAdapterError
      ? e
      : new SearchAdapterError("UNAVAILABLE", "not-started", e);
  }
  function get(connection: string) {
    const item = instances.get(connection);
    if (!item) return fail(closed ? "CLOSED" : "INVALID");
    return item;
  }
  return {
    capabilities(connection: string) {
      if (closed) return fail("CLOSED");
      return get(connection).capabilities;
    },
    search(
      connection: string,
      context: unknown,
      query: ExternalSearchQuery,
      control: { signal?: AbortSignal; timeoutMs?: number } = {},
    ) {
      keys(query, ["text", "limit", "offset", "filters", "sort"]);
      const item = get(connection);
      if (
        typeof query.text !== "string" ||
        query.text.length > 4096 ||
        !int(query.limit ?? 20, 100) ||
        !int(query.offset ?? 0, 10000, 0)
      )
        return fail("INVALID");
      validateSearchFilters(query.filters);
      if (
        query.filters?.some(
          (f) => !item.capabilities.filters.includes(f.operator),
        )
      )
        return fail("UNSUPPORTED");
      if (query.sort) {
        keys(query.sort, ["field", "direction"]);
        if (
          !item.capabilities.sort.includes(query.sort.field) ||
          !["asc", "desc"].includes(query.sort.direction)
        )
          return fail("UNSUPPORTED");
      }
      const safe = structuredClone(query);
      return bounded(
        async (call) => {
          const identity = await options.authorize(
            context,
            connection,
            "search",
          );
          if (
            !identity ||
            typeof identity.tenant !== "string" ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(identity.tenant)
          )
            return fail("DENIED");
          if (call.signal.aborted) return fail("CANCELLED");
          const page = await item.adapter.search(safe, {
            ...call,
            tenant: identity.tenant,
          });
          jsonBytes(page, 1024 * 1024);
          if (
            !page ||
            !Array.isArray(page.hits) ||
            page.hits.length > (safe.limit ?? 20) ||
            !["exact", "partial"].includes(page.coverage) ||
            (page.total !== undefined &&
              !int(page.total, Number.MAX_SAFE_INTEGER, 0))
          )
            return fail("INVALID");
          for (const hit of page.hits) {
            if (
              !hit ||
              !hit.document ||
              typeof hit.document.id !== "string" ||
              !hit.document.id ||
              typeof hit.document.text !== "string" ||
              (hit.score !== undefined &&
                (typeof hit.score !== "number" || !Number.isFinite(hit.score)))
            )
              return fail("INVALID");
          }
          return structuredClone(page);
        },
        control.signal,
        control.timeoutMs,
      );
    },
    mutate(
      connection: string,
      context: unknown,
      operation: Exclude<SearchOperation, "search">,
      values: readonly SearchDocument[] | readonly string[],
      control: { signal?: AbortSignal; timeoutMs?: number } = {},
    ) {
      const item = get(connection);
      if (
        !["index", "update", "delete"].includes(operation) ||
        !item.capabilities.mutations.includes(operation)
      )
        return fail("UNSUPPORTED");
      if (!Array.isArray(values) || !values.length || values.length > 100)
        return fail("LIMIT");
      jsonBytes(values, 1024 * 1024);
      for (const value of values)
        if (
          operation === "delete"
            ? typeof value !== "string" || !value || value.length > 512
            : !value ||
              typeof value !== "object" ||
              typeof (value as SearchDocument).id !== "string" ||
              !(value as SearchDocument).id ||
              typeof (value as SearchDocument).text !== "string"
        )
          return fail("INVALID");
      const safe = structuredClone(values);
      return bounded(
        async (call) => {
          const identity = await options.authorize(
            context,
            connection,
            operation,
          );
          if (
            !identity ||
            typeof identity.tenant !== "string" ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(identity.tenant)
          )
            return fail("DENIED");
          if (call.signal.aborted) return fail("CANCELLED");
          const method = item.adapter[operation]! as (
            values: typeof safe,
            call: SearchCall,
          ) => Promise<SearchMutationReceipt>;
          const receipt = await method.call(item.adapter, safe, {
            ...call,
            tenant: identity.tenant,
          });
          if (
            !receipt ||
            !["accepted", "completed"].includes(receipt.state) ||
            (receipt.state === "accepted" &&
              (typeof receipt.taskId !== "string" ||
                !receipt.taskId ||
                receipt.taskId.length > 256))
          )
            return fail("INVALID");
          return {
            state: receipt.state,
            ...(receipt.taskId ? { taskId: receipt.taskId } : {}),
          };
        },
        control.signal,
        control.timeoutMs,
        true,
      );
    },
    health(
      connection: string,
      control: { signal?: AbortSignal; timeoutMs?: number } = {},
    ) {
      const item = get(connection);
      return bounded(
        async (call) => {
          const result = await item.adapter.health(call);
          if (!["ready", "unavailable"].includes(result))
            return fail("INVALID");
          return result;
        },
        control.signal,
        control.timeoutMs,
      );
    },
    close,
  };
}
export type SearchServices = Awaited<ReturnType<typeof createSearchServices>>;

/** Explicit process-local selection, never an automatic durable backend fallback. */
export function createLocalSearchFactory(options: {
  maxTenants: number;
  maxDocumentsPerTenant: number;
}): SearchFactory {
  keys(options, ["maxTenants", "maxDocumentsPerTenant"]);
  if (
    !int(options.maxTenants, 1000) ||
    !int(options.maxDocumentsPerTenant, 100000)
  )
    fail("INVALID");
  const limits = { ...options };
  return async (connection) => {
    if (
      connection.endpoint !== undefined ||
      connection.credentials !== undefined
    )
      return fail("INVALID");
    const indices = new Map<string, SearchIndex<SearchDocument>>();
    let closed = false;
    const check = (call: SearchCall) => {
      if (closed) fail("CLOSED");
      if (call.signal.aborted) fail("CANCELLED");
    };
    return {
      capabilities: {
        tenantIsolation: true,
        durability: "memory",
        consistency: "immediate",
        filters: [
          "eq",
          "neq",
          "in",
          "gte",
          "lte",
          "exists",
          "contains",
          "prefix",
        ],
        sort: [],
        mutations: ["index", "delete"],
        pagination: "offset",
      },
      async search(query, call) {
        check(call);
        const hits =
          indices.get(call.tenant)?.search(query.text, {
            limit: query.limit,
            offset: query.offset,
            filters: query.filters,
          }) ?? [];
        return { hits, coverage: "exact" };
      },
      async index(documents, call) {
        check(call);
        let index = indices.get(call.tenant);
        if (!index) {
          if (indices.size >= limits.maxTenants) return fail("LIMIT");
          index = new SearchIndex({
            maxDocuments: limits.maxDocumentsPerTenant,
          });
          index.addMany(documents);
          indices.set(call.tenant, index);
        } else index.addMany(documents);
        return { state: "completed" };
      },
      async delete(ids, call) {
        check(call);
        for (const id of ids) indices.get(call.tenant)?.remove(id);
        return { state: "completed" };
      },
      async health() {
        return closed ? "unavailable" : "ready";
      },
      close() {
        closed = true;
        indices.clear();
      },
    };
  };
}
