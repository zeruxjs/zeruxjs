import { createHash } from "node:crypto";
import type * as estypes from "@elastic/elasticsearch/lib/api/types";
export interface ElasticRequestOptions {
  signal: AbortSignal;
  requestTimeout: number;
  maxRetries: number;
  retryOnTimeout?: boolean;
}
/** Narrow injected-client surface; does not import optional ES|QL/Arrow helpers. */
export interface ElasticClient {
  info(
    params: estypes.InfoRequest,
    options: ElasticRequestOptions,
  ): Promise<estypes.InfoResponse>;
  search<T>(
    params: estypes.SearchRequest,
    options: ElasticRequestOptions,
  ): Promise<estypes.SearchResponse<T>>;
  bulk(
    params: estypes.BulkRequest,
    options: ElasticRequestOptions,
  ): Promise<estypes.BulkResponse>;
  index(
    params: estypes.IndexRequest,
    options: ElasticRequestOptions,
  ): Promise<estypes.IndexResponse>;
  get<T>(
    params: estypes.GetRequest,
    options: ElasticRequestOptions,
  ): Promise<estypes.GetResponse<T>>;
  indices: {
    create(
      params: estypes.IndicesCreateRequest,
      options: ElasticRequestOptions,
    ): Promise<estypes.IndicesCreateResponse>;
    getMapping(
      params: estypes.IndicesGetMappingRequest,
      options: ElasticRequestOptions,
    ): Promise<estypes.IndicesGetMappingResponse>;
  };
  close(): Promise<void>;
}
import {
  SearchAdapterError,
  type SearchAdapter,
  type SearchCall,
  type SearchFactory,
  type ExternalSearchQuery,
  type ExternalSearchPage,
} from "@zeruxjs/search/adapters";
import {
  validateSearchFilters,
  type SearchDocument,
  type SearchFilter,
} from "@zeruxjs/search";

export type ElasticField = "keyword" | "double" | "boolean";
export type ElasticAuth =
  | { apiKey: string }
  | { username: string; password: string };
export interface ElasticSearchOptions {
  index: string;
  fields?: Readonly<Record<string, ElasticField>>;
  endpoint?: string;
  allowedEndpoints?: readonly string[];
  auth?: ElasticAuth;
  ca?: string;
  /** Injected clients are borrowed; the host owns their TLS, retries and endpoint policy. */
  client?: ElasticClient;
  timeoutMs?: number;
  maxPending?: number;
}
export interface ElasticVersion {
  seqNo: number;
  primaryTerm: number;
}
export interface ElasticBulkFailure {
  position: number;
  status: number;
}
/** Partial success is not atomic and is never replayed automatically. No bodies or backend reason strings. */
export class ElasticBulkError extends SearchAdapterError {
  constructor(
    readonly failures: readonly ElasticBulkFailure[],
    readonly succeeded: number,
  ) {
    super("UNAVAILABLE", "unknown");
    this.name = "ElasticBulkError";
  }
}
export class ElasticConflictError extends SearchAdapterError {
  constructor() {
    super("INVALID");
    this.name = "ElasticConflictError";
  }
}
const invalid = (): never => {
  throw new SearchAdapterError("INVALID");
};
function record(
  value: unknown,
  allowed?: readonly string[],
): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(k) ||
        (allowed && !allowed.includes(k)) ||
        !("value" in Object.getOwnPropertyDescriptor(value, k)!),
    )
  )
    invalid();
}
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const fieldName = (v: string) =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) &&
  !["id", "text", "constructor", "prototype"].includes(v);
function endpoint(v: unknown): string {
  if (typeof v !== "string" || v.length > 2048) return invalid();
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return invalid();
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    return invalid();
  return u.href;
}
function configuration(options: ElasticSearchOptions) {
  record(options, [
    "index",
    "fields",
    "endpoint",
    "allowedEndpoints",
    "auth",
    "ca",
    "client",
    "timeoutMs",
    "maxPending",
  ]);
  if (
    typeof options.index !== "string" ||
    !/^[a-z][a-z0-9_-]{0,127}$/.test(options.index) ||
    !integer(options.timeoutMs ?? 5000, 1, 60000) ||
    !integer(options.maxPending ?? 32, 1, 128)
  )
    invalid();
  const fields = options.fields ?? {};
  record(fields);
  if (
    Object.keys(fields).length > 32 ||
    Object.entries(fields).some(
      ([k, v]) =>
        !fieldName(k) || !["keyword", "double", "boolean"].includes(v),
    )
  )
    invalid();
  if (options.client) {
    if (
      ["info", "search", "bulk", "index", "get", "close"].some(
        (k) => typeof (options.client as any)[k] !== "function",
      ) ||
      !options.client.indices ||
      typeof options.client.indices.create !== "function" ||
      typeof options.client.indices.getMapping !== "function" ||
      options.endpoint !== undefined ||
      options.allowedEndpoints !== undefined ||
      options.auth !== undefined ||
      options.ca !== undefined
    )
      invalid();
  } else {
    const node = endpoint(options.endpoint);
    if (
      !Array.isArray(options.allowedEndpoints) ||
      !options.allowedEndpoints.length ||
      options.allowedEndpoints.length > 16 ||
      !options.allowedEndpoints.map(endpoint).includes(node)
    )
      throw new SearchAdapterError("DENIED");
    record(options.auth, ["apiKey", "username", "password"]);
    const a = options.auth;
    if (
      "apiKey" in a
        ? Object.keys(a).length !== 1 ||
          typeof a.apiKey !== "string" ||
          !a.apiKey ||
          a.apiKey.length > 8192
        : Object.keys(a).length !== 2 ||
          typeof a.username !== "string" ||
          !a.username ||
          typeof a.password !== "string" ||
          !a.password ||
          a.username.length > 256 ||
          a.password.length > 8192
    )
      invalid();
    if (
      options.ca !== undefined &&
      (typeof options.ca !== "string" ||
        !options.ca ||
        options.ca.length > 65536)
    )
      invalid();
  }
  return {
    ...options,
    fields: Object.freeze({ ...fields }),
    auth: options.auth && { ...options.auth },
  };
}
function checkVersion(info: { version: { number: string } }) {
  if (!/^9\.5\.\d+(?:[-+].*)?$/.test(info?.version?.number))
    throw new SearchAdapterError("UNSUPPORTED");
}
/** Creates/probes a client only when explicitly invoked. Never provisions or changes an index automatically. */
export async function createElasticSearchAdapter(
  input: ElasticSearchOptions,
  startupSignal?: AbortSignal,
) {
  const options = configuration(input),
    own = !options.client;
  let client = options.client;
  if (!client) {
    try {
      const moduleId = "@elastic/elasticsearch";
      const { Client } = (await import(moduleId)) as {
        Client: new (options: Record<string, unknown>) => ElasticClient;
      };
      client = new Client({
        node: endpoint(options.endpoint),
        auth: options.auth,
        tls: {
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
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
      throw new SearchAdapterError("UNAVAILABLE", "not-started", cause);
    }
  }
  const native = client;
  let closed = false,
    closing: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>(),
    controllers = new Set<AbortController>();
  const timeout = options.timeoutMs ?? 5000,
    maxPending = options.maxPending ?? 32;
  const fields: Record<string, ElasticField> = {
    id: "keyword",
    ...options.fields,
  };
  const mappings = {
    dynamic: "strict" as const,
    properties: {
      _zxTenant: { type: "keyword" as const },
      id: { type: "keyword" as const },
      text: { type: "text" as const },
      ...Object.fromEntries(
        Object.entries(options.fields).map(([k, type]) => [k, { type }]),
      ),
    },
  };
  function callScope(
    call: Omit<SearchCall, "tenant"> & { tenant?: string },
    tenant: boolean,
  ) {
    record(call, ["signal", "deadline", "tenant"]);
    if (
      !(call.signal instanceof AbortSignal) ||
      !Number.isSafeInteger(call.deadline) ||
      (tenant &&
        (typeof call.tenant !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(call.tenant)))
    )
      invalid();
    if (call.signal.aborted) throw new SearchAdapterError("CANCELLED");
    if (call.deadline <= Date.now()) throw new SearchAdapterError("DEADLINE");
    return tenant ? digest(call.tenant!) : "";
  }
  async function run<T>(
    call: Omit<SearchCall, "tenant">,
    work: (request: {
      signal: AbortSignal;
      requestTimeout: number;
      maxRetries: number;
      retryOnTimeout: boolean;
    }) => Promise<T>,
    write = false,
  ): Promise<T> {
    callScope(call, false);
    if (closed) throw new SearchAdapterError("CLOSED");
    if (pending.size >= maxPending) throw new SearchAdapterError("LIMIT");
    const controller = new AbortController();
    controllers.add(controller);
    const signal = AbortSignal.any([
      call.signal,
      controller.signal,
      AbortSignal.timeout(
        Math.min(timeout, Math.max(1, call.deadline - Date.now())),
      ),
    ]);
    const task = Promise.resolve().then(() => {
      if (signal.aborted) throw new SearchAdapterError("CANCELLED");
      return work({
        signal,
        requestTimeout: Math.min(
          timeout,
          Math.max(1, call.deadline - Date.now()),
        ),
        maxRetries: 0,
        retryOnTimeout: false,
      });
    });
    pending.add(task);
    try {
      const result = await task;
      if (signal.aborted)
        throw new SearchAdapterError(
          call.signal.aborted || controller.signal.aborted
            ? "CANCELLED"
            : "DEADLINE",
          write ? "unknown" : "not-started",
        );
      return result;
    } catch (e) {
      if (e instanceof SearchAdapterError) throw e;
      if ((e as any)?.meta?.statusCode === 409)
        throw new ElasticConflictError();
      throw new SearchAdapterError(
        signal.aborted
          ? call.signal.aborted || controller.signal.aborted
            ? "CANCELLED"
            : "DEADLINE"
          : "UNAVAILABLE",
        write ? "unknown" : "not-started",
        e,
      );
    } finally {
      pending.delete(task);
      controllers.delete(controller);
    }
  }
  async function verifyMapping(request: ElasticRequestOptions) {
    const result = await native.indices.getMapping(
      { index: options.index },
      request,
    );
    const entries = Object.values(result);
    if (entries.length !== 1) throw new SearchAdapterError("UNSUPPORTED");
    const actual = entries[0].mappings;
    if (
      actual.dynamic !== "strict" ||
      !actual.properties ||
      Object.keys(actual.properties).length !==
        Object.keys(mappings.properties).length ||
      Object.entries(mappings.properties).some(([key, property]) => {
        const mapped = actual.properties![key];
        return (
          !mapped ||
          Object.keys(mapped).length !== 1 ||
          !("type" in mapped) ||
          mapped.type !== property.type
        );
      })
    )
      throw new SearchAdapterError("UNSUPPORTED");
  }
  function document(value: unknown): SearchDocument {
    record(value, ["id", "text", ...Object.keys(options.fields)]);
    if (
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 512 ||
      typeof value.text !== "string" ||
      value.text.length > 65536
    )
      invalid();
    for (const [key, v] of Object.entries(value)) {
      if (key === "id" || key === "text") continue;
      const type = options.fields[key];
      if (
        type === "keyword"
          ? typeof v !== "string" || v.length > 4096
          : type === "boolean"
            ? typeof v !== "boolean"
            : typeof v !== "number" ||
              !Number.isFinite(v) ||
              (Number.isInteger(v) && !Number.isSafeInteger(v))
      )
        invalid();
    }
    if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024)
      throw new SearchAdapterError("LIMIT");
    return { ...value } as SearchDocument;
  }
  const identifier = (tenant: string, id: string) =>
    digest(JSON.stringify([tenant, id]));
  function filters(
    input: readonly SearchFilter[] = [],
  ): estypes.QueryDslQueryContainer[] {
    if (!Array.isArray(input) || input.length > 16) invalid();
    for (const f of input)
      record(f, ["field", "operator", "value", "caseSensitive"]);
    const validated = validateSearchFilters(input);
    return validated.map((f) => {
      if (
        !Object.hasOwn(fields, f.field) ||
        f.caseSensitive === false ||
        !["eq", "neq", "in", "exists", "gte", "lte"].includes(f.operator)
      )
        throw new SearchAdapterError("UNSUPPORTED");
      const expected =
        fields[f.field] === "keyword"
          ? "string"
          : fields[f.field] === "double"
            ? "number"
            : "boolean";
      if (f.operator !== "exists")
        for (const value of f.operator === "in"
          ? (f.value as unknown[])
          : [f.value])
          if (
            value === null ||
            typeof value !== expected ||
            (typeof value === "number" &&
              Number.isInteger(value) &&
              !Number.isSafeInteger(value))
          )
            invalid();
      if (f.operator === "exists") return { exists: { field: f.field } };
      if (f.operator === "in")
        return (f.value as unknown[]).length
          ? { terms: { [f.field]: f.value as string[] } }
          : { match_none: {} };
      if (f.operator === "gte" || f.operator === "lte") {
        if (fields[f.field] !== "double")
          throw new SearchAdapterError("UNSUPPORTED");
        return { range: { [f.field]: { [f.operator]: f.value } } };
      }
      const term = { term: { [f.field]: f.value as string } };
      return f.operator === "neq" ? { bool: { must_not: [term] } } : term;
    });
  }
  async function bulk(
    values: readonly SearchDocument[] | readonly string[],
    call: SearchCall,
    remove: boolean,
  ) {
    const tenant = callScope(call, true);
    if (!Array.isArray(values) || !values.length || values.length > 100)
      throw new SearchAdapterError("LIMIT");
    const operations: any[] = [],
      ids = new Set<string>();
    for (const value of values) {
      const doc = remove ? undefined : document(value),
        id = remove ? value : doc!.id;
      if (typeof id !== "string" || !id || id.length > 512 || ids.has(id))
        invalid();
      ids.add(id);
      operations.push({
        [remove ? "delete" : "index"]: {
          _index: options.index,
          _id: identifier(tenant, id),
        },
      });
      if (doc) operations.push({ ...doc, _zxTenant: tenant });
    }
    if (
      operations.reduce(
        (n, v) => n + Buffer.byteLength(JSON.stringify(v)) + 1,
        0,
      ) >
      1024 * 1024
    )
      throw new SearchAdapterError("LIMIT");
    return run(
      call,
      async (request) => {
        await verifyMapping(request);
        const result = await native.bulk(
          {
            operations,
            refresh: false,
            timeout: `${request.requestTimeout}ms`,
          },
          request,
        );
        if (
          !Array.isArray(result.items) ||
          result.items.length !== values.length
        )
          throw new SearchAdapterError("UNAVAILABLE", "unknown");
        const failures: ElasticBulkFailure[] = [];
        result.items.forEach((item, position) => {
          const outcome = remove ? item.delete : item.index;
          if (
            !outcome ||
            !integer(outcome.status, 100, 599) ||
            outcome.error ||
            (outcome.status >= 300 && !(remove && outcome.status === 404))
          )
            failures.push({ position, status: outcome?.status ?? 0 });
        });
        if (failures.length || result.errors)
          throw new ElasticBulkError(
            Object.freeze(failures),
            values.length - failures.length,
          );
        return { state: "completed" as const };
      },
      true,
    );
  }
  const adapter = {
    capabilities: Object.freeze({
      tenantIsolation: true as const,
      durability: "persistent" as const,
      consistency: "eventual" as const,
      filters: Object.freeze([
        "eq",
        "neq",
        "in",
        "exists",
        "gte",
        "lte",
      ] as const),
      sort: Object.freeze(Object.keys(fields)),
      mutations: Object.freeze(["index", "delete"] as const),
      pagination: "offset" as const,
    }),
    async search(
      query: ExternalSearchQuery,
      call: SearchCall,
    ): Promise<ExternalSearchPage> {
      const tenant = callScope(call, true);
      record(query, ["text", "limit", "offset", "filters", "sort"]);
      if (
        typeof query.text !== "string" ||
        query.text.length > 4096 ||
        !integer(query.limit ?? 20, 1, 100) ||
        !integer(query.offset ?? 0, 0, 10000) ||
        (query.offset ?? 0) + (query.limit ?? 20) > 10000
      )
        invalid();
      const translated = filters(query.filters);
      const text = query.text,
        limit = query.limit ?? 20,
        offset = query.offset ?? 0;
      if (query.sort) {
        record(query.sort, ["field", "direction"]);
        if (
          !Object.hasOwn(fields, query.sort.field) ||
          !["asc", "desc"].includes(query.sort.direction)
        )
          throw new SearchAdapterError("UNSUPPORTED");
      }
      const sort: estypes.Sort = query.sort
        ? [
            { [query.sort.field]: query.sort.direction },
            ...(query.sort.field === "id" ? [] : [{ id: "asc" as const }]),
          ]
        : [{ _score: { order: "desc" } }, { id: "asc" }];
      return run(call, async (request) => {
        await verifyMapping(request);
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
                    ? { match: { text: { query: text, operator: "and" } } }
                    : { match_all: {} },
                ],
              },
            },
          },
          request,
        );
        if (
          !Array.isArray(result.hits?.hits) ||
          result.hits.hits.length > limit
        )
          throw new SearchAdapterError("UNAVAILABLE");
        const hits = result.hits.hits.map((hit) => {
          if (!hit._source || hit._source._zxTenant !== tenant)
            throw new SearchAdapterError("DENIED");
          const { _zxTenant: _, ...source } = hit._source;
          return {
            document: document(source),
            ...(typeof hit._score === "number" && Number.isFinite(hit._score)
              ? { score: hit._score }
              : {}),
          };
        });
        const total = result.hits.total;
        if (
          (typeof total === "object" &&
            !integer(total.value, 0, Number.MAX_SAFE_INTEGER)) ||
          Buffer.byteLength(JSON.stringify(hits)) > 1024 * 1024
        )
          throw new SearchAdapterError("UNAVAILABLE");
        return {
          hits,
          ...(typeof total === "object" ? { total: total.value } : {}),
          coverage:
            result.timed_out ||
            result._shards.failed ||
            typeof total !== "object" ||
            total.relation !== "eq"
              ? "partial"
              : "exact",
        };
      });
    },
    index: (documents: readonly SearchDocument[], call: SearchCall) =>
      bulk(documents, call, false),
    delete: (ids: readonly string[], call: SearchCall) => bulk(ids, call, true),
    /** Explicit privileged provisioning. A conflict never triggers putMapping or alias changes. */
    ensureIndex(call: Omit<SearchCall, "tenant">) {
      return run(
        call,
        async (request) => {
          await native.indices.create(
            { index: options.index, mappings },
            request,
          );
        },
        true,
      );
    },
    async getVersion(id: string, call: SearchCall) {
      const tenant = callScope(call, true);
      if (typeof id !== "string" || !id || id.length > 512) invalid();
      return run(call, async (request) => {
        await verifyMapping(request);
        const hit = await native.get<SearchDocument & { _zxTenant: string }>(
          { index: options.index, id: identifier(tenant, id) },
          request,
        );
        if (
          !hit._source ||
          hit._source._zxTenant !== tenant ||
          hit._source.id !== id
        )
          throw new SearchAdapterError("DENIED");
        const { _zxTenant: _, ...source } = hit._source;
        if (
          !integer(hit._seq_no, 0, Number.MAX_SAFE_INTEGER) ||
          !integer(hit._primary_term, 1, Number.MAX_SAFE_INTEGER)
        )
          throw new SearchAdapterError("UNAVAILABLE");
        return {
          document: document(source),
          version: { seqNo: hit._seq_no!, primaryTerm: hit._primary_term! },
        };
      });
    },
    replaceIfVersion(
      value: SearchDocument,
      version: ElasticVersion,
      call: SearchCall,
    ) {
      const tenant = callScope(call, true),
        doc = document(value);
      record(version, ["seqNo", "primaryTerm"]);
      if (
        !integer(version.seqNo, 0, Number.MAX_SAFE_INTEGER) ||
        !integer(version.primaryTerm, 1, Number.MAX_SAFE_INTEGER)
      )
        invalid();
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
            request,
          );
          return { state: "completed" as const };
        },
        true,
      );
    },
    health(call: Omit<SearchCall, "tenant">) {
      return run(call, async (request) => {
        checkVersion(await native.info({}, request));
        return "ready" as const;
      });
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const c of controllers) c.abort();
      return (closing = (async () => {
        await Promise.allSettled([...pending]);
        if (own)
          try {
            await native.close();
          } catch (e) {
            throw new SearchAdapterError("UNAVAILABLE", "unknown", e);
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
        "UNAVAILABLE",
        "unknown",
        new AggregateError([e, cleanup]),
      );
    }
    throw e;
  }
  return adapter;
}
export type ElasticSearchAdapter = Awaited<
  ReturnType<typeof createElasticSearchAdapter>
>;
/** Endpoint/credentials stay in named private shared-search configuration. Factory options contain only adapter policy. */
export function createElasticSearchFactory(
  options: Pick<
    ElasticSearchOptions,
    "index" | "fields" | "timeoutMs" | "maxPending" | "ca"
  >,
): SearchFactory {
  record(options, ["index", "fields", "timeoutMs", "maxPending", "ca"]);
  if (options.fields !== undefined) record(options.fields);
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
      signal,
    );
}
