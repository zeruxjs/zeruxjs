import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type { Meilisearch } from "meilisearch";
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

export interface MilleSearchOptions {
  index: string;
  fields?: Readonly<Record<string, "string" | "number" | "boolean">>;
  searchable?: readonly string[];
  filterable?: readonly string[];
  sortable?: readonly string[];
  /** Private stable host key for tenant/index/task-bound references. Never browser configuration. */
  taskKey: Uint8Array;
  /** Stable engine/deployment namespace, distinct across independently numbered task queues. */
  taskScope: string;
  endpoint?: string;
  allowedEndpoints?: readonly string[];
  apiKey?: string;
  /** Trusted server transport, e.g. for host CA policy; borrowed, never globally closed. */
  fetch?: typeof fetch;
  /** Borrowed official-client HTTP surface; must bound responses and honor extraRequestInit.signal. */
  client?: Pick<Meilisearch, "httpRequest">;
  timeoutMs?: number;
  maxPending?: number;
}
export type MilleTaskState =
  | "enqueued"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";
export interface MilleTaskStatus {
  taskId: string;
  state: MilleTaskState;
  failureCode?: string;
  receivedDocuments?: number;
  indexedDocuments?: number;
}
const bad = (): never => {
  throw new SearchAdapterError("INVALID");
};
function record(
  v: unknown,
  allowed?: readonly string[],
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).some(
      (k) =>
        typeof k !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(k) ||
        (allowed && !allowed.includes(k)) ||
        !("value" in Object.getOwnPropertyDescriptor(v, k)!),
    )
  )
    bad();
}
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const allowedField = (v: string) =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) &&
  !["id", "text", "constructor", "prototype"].includes(v);
const errors = new Set([
  "index_not_found",
  "index_already_exists",
  "invalid_document_id",
  "missing_document_id",
  "primary_key_inference_failed",
  "invalid_search_filter",
  "invalid_search_sort",
  "invalid_api_key",
  "missing_authorization_header",
  "document_not_found",
  "invalid_settings_filterable_attributes",
  "invalid_settings_sortable_attributes",
]);
export class MilleBackendError extends SearchAdapterError {
  constructor(
    readonly status: number,
    readonly backendCode: string,
  ) {
    super("UNAVAILABLE", "unknown");
    this.name = "MilleBackendError";
  }
}
function endpoint(v: unknown): string {
  if (typeof v !== "string" || v.length > 2048) return bad();
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return bad();
  }
  if (
    u.protocol !== "https:" ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  )
    return bad();
  return u.href;
}
function policy(input: MilleSearchOptions) {
  record(input, [
    "index",
    "fields",
    "searchable",
    "filterable",
    "sortable",
    "taskKey",
    "taskScope",
    "endpoint",
    "allowedEndpoints",
    "apiKey",
    "fetch",
    "client",
    "timeoutMs",
    "maxPending",
  ]);
  if (
    typeof input.index !== "string" ||
    !/^[a-z][a-z0-9_-]{0,127}$/.test(input.index) ||
    !(input.taskKey instanceof Uint8Array) ||
    input.taskKey.byteLength !== 32 ||
    typeof input.taskScope !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.taskScope) ||
    !integer(input.timeoutMs ?? 5000, 1, 60000) ||
    !integer(input.maxPending ?? 32, 1, 128)
  )
    bad();
  const fields = input.fields ?? {};
  record(fields);
  if (
    Object.keys(fields).length > 32 ||
    Object.entries(fields).some(
      ([k, v]) =>
        !allowedField(k) || !["string", "number", "boolean"].includes(v),
    )
  )
    bad();
  const types = { id: "string", text: "string", ...fields };
  const list = (v: readonly string[], kind: "search" | "filter" | "sort") => {
    if (
      !Array.isArray(v) ||
      v.length > 34 ||
      new Set(v).size !== v.length ||
      v.some(
        (k) =>
          !Object.hasOwn(types, k) ||
          (kind !== "search" && k === "text") ||
          (kind === "search" && types[k as keyof typeof types] !== "string"),
      )
    )
      bad();
    return [...v];
  };
  const searchable = list(input.searchable ?? ["text"], "search");
  if (!searchable.length) bad();
  const filterable = list(input.filterable ?? [], "filter"),
    sortable = list(input.sortable ?? ["id"], "sort");
  if (!sortable.includes("id")) bad();
  if (input.client) {
    if (
      !input.client.httpRequest ||
      ["get", "post", "put", "patch"].some(
        (k) => typeof (input.client!.httpRequest as any)[k] !== "function",
      ) ||
      input.endpoint !== undefined ||
      input.allowedEndpoints !== undefined ||
      input.apiKey !== undefined ||
      input.fetch !== undefined
    )
      bad();
  } else {
    const node = endpoint(input.endpoint);
    if (
      !Array.isArray(input.allowedEndpoints) ||
      !input.allowedEndpoints.length ||
      input.allowedEndpoints.length > 16 ||
      !input.allowedEndpoints.map(endpoint).includes(node)
    )
      throw new SearchAdapterError("DENIED");
    if (
      typeof input.apiKey !== "string" ||
      !input.apiKey ||
      input.apiKey.length > 8192 ||
      (input.fetch !== undefined && typeof input.fetch !== "function")
    )
      bad();
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
export async function createMilleSearchAdapter(
  input: MilleSearchOptions,
  startupSignal?: AbortSignal,
) {
  const options = policy(input),
    timeout = options.timeoutMs ?? 5000,
    maxPending = options.maxPending ?? 32;
  const lifetime = new AbortController(),
    pending = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  let client = options.client;
  if (!client) {
    try {
      const { Meilisearch } = await import("meilisearch");
      const origin = new URL(endpoint(options.endpoint)).origin;
      client = new Meilisearch({
        host: options.endpoint!,
        apiKey: options.apiKey,
        timeout,
        requestInit: { redirect: "error", cache: "no-store" },
        // Pinned SDK's public hook (deprecated upstream): bound bytes before JSON decoding.
        httpClient: async (url, init) => {
          if (new URL(String(url)).origin !== origin)
            throw new SearchAdapterError("DENIED");
          const response = await (options.fetch ?? fetch)(url, {
            ...init,
            redirect: "error",
            cache: "no-store",
          });
          const reader = response.body?.getReader();
          let size = 0;
          const chunks: Uint8Array[] = [];
          try {
            if (reader)
              while (true) {
                const next = await reader.read();
                if (next.done) break;
                size += next.value.byteLength;
                if (size > 1024 * 1024) throw new SearchAdapterError("LIMIT");
                chunks.push(next.value);
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
              ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
              : undefined;
          } catch {
            throw new SearchAdapterError("UNAVAILABLE");
          }
          if (!response.ok)
            throw new MilleBackendError(
              response.status,
              errors.has(body?.code) ? body.code : "backend_error",
            );
          return body;
        },
      });
    } catch (cause) {
      throw new SearchAdapterError("UNAVAILABLE", "not-started", cause);
    }
  }
  const http = client.httpRequest;
  const base = `indexes/${options.index}`;
  const expected = {
    searchableAttributes: options.searchable,
    filterableAttributes: ["_zxTenant", ...options.filterable],
    sortableAttributes: options.sortable,
    displayedAttributes: [
      "_zxId",
      "_zxTenant",
      "id",
      "text",
      ...Object.keys(options.fields),
    ],
    distinctAttribute: null,
    pagination: { maxTotalHits: 10000 },
  };
  function scope(call: SearchCall) {
    if (closed) throw new SearchAdapterError("CLOSED");
    record(call, ["tenant", "signal", "deadline"]);
    if (
      typeof call.tenant !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(call.tenant)
    )
      bad();
    return hash(call.tenant);
  }
  async function run<T>(
    call: Omit<SearchCall, "tenant">,
    work: (signal: AbortSignal) => Promise<T>,
    write = false,
  ): Promise<T> {
    record(call, ["tenant", "signal", "deadline"]);
    if (
      !(call.signal instanceof AbortSignal) ||
      !Number.isSafeInteger(call.deadline)
    )
      bad();
    if (closed) throw new SearchAdapterError("CLOSED");
    if (call.signal.aborted) throw new SearchAdapterError("CANCELLED");
    if (call.deadline <= Date.now()) throw new SearchAdapterError("DEADLINE");
    if (pending.size >= maxPending) throw new SearchAdapterError("LIMIT");
    const signal = AbortSignal.any([
      call.signal,
      lifetime.signal,
      AbortSignal.timeout(
        Math.min(timeout, Math.max(1, call.deadline - Date.now())),
      ),
    ]);
    const job = Promise.resolve().then(() => {
      if (signal.aborted) throw new SearchAdapterError("CANCELLED");
      return work(signal);
    });
    pending.add(job);
    try {
      const result = await job;
      if (signal.aborted)
        throw new SearchAdapterError(
          call.signal.aborted || lifetime.signal.aborted
            ? "CANCELLED"
            : "DEADLINE",
          write ? "unknown" : "not-started",
        );
      return result;
    } catch (cause) {
      if (cause instanceof SearchAdapterError) throw cause;
      if ((cause as { cause?: unknown })?.cause instanceof SearchAdapterError)
        throw (cause as { cause: SearchAdapterError }).cause;
      throw new SearchAdapterError(
        signal.aborted
          ? call.signal.aborted || lifetime.signal.aborted
            ? "CANCELLED"
            : "DEADLINE"
          : "UNAVAILABLE",
        write ? "unknown" : "not-started",
        cause,
      );
    } finally {
      pending.delete(job);
    }
  }
  async function verify(signal: AbortSignal) {
    const info = await http.get<any>({
      path: base,
      extraRequestInit: { signal },
    });
    if (info?.uid !== options.index || info.primaryKey !== "_zxId")
      throw new SearchAdapterError("UNSUPPORTED");
    const actual = await http.get<any>({
      path: base + "/settings",
      extraRequestInit: { signal },
    });
    for (const key of [
      "searchableAttributes",
      "filterableAttributes",
      "sortableAttributes",
      "displayedAttributes",
    ] as const) {
      const values = actual?.[key];
      if (
        !Array.isArray(values) ||
        values.some((v) => typeof v !== "string") ||
        values.length !== expected[key].length ||
        (key === "searchableAttributes" ? values : [...values].sort()).some(
          (v, i) =>
            v !==
            (key === "searchableAttributes"
              ? expected[key]
              : [...expected[key]].sort())[i],
        )
      )
        throw new SearchAdapterError("UNSUPPORTED");
    }
    if (
      actual.distinctAttribute !== null ||
      actual.pagination?.maxTotalHits !== 10000
    )
      throw new SearchAdapterError("UNSUPPORTED");
  }
  const idFor = (tenant: string, id: string) =>
    hash(JSON.stringify([tenant, id]));
  function document(value: unknown): SearchDocument {
    record(value, ["id", "text", ...Object.keys(options.fields)]);
    if (
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 512 ||
      typeof value.text !== "string" ||
      value.text.length > 65536
    )
      bad();
    for (const [key, v] of Object.entries(value))
      if (key !== "id" && key !== "text") {
        const type = options.fields[key];
        if (
          typeof v !== type ||
          (type === "string" && (v as string).length > 4096) ||
          (type === "number" &&
            (!Number.isFinite(v) ||
              (Number.isInteger(v) && !Number.isSafeInteger(v))))
        )
          bad();
      }
    if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024)
      throw new SearchAdapterError("LIMIT");
    return { ...value } as SearchDocument;
  }
  const mac = (uid: number, tenant: string) =>
    createHmac("sha256", options.taskKey)
      .update(
        JSON.stringify([
          "mille-task-v1",
          options.taskScope,
          options.index,
          uid,
          tenant,
        ]),
      )
      .digest("base64url");
  function taskToken(uid: number, tenant: string) {
    return `m1.${uid}.${mac(uid, tenant)}`;
  }
  function taskUid(token: string, tenant: string) {
    if (typeof token !== "string" || token.length > 128)
      throw new SearchAdapterError("DENIED");
    const m = /^m1\.(0|[1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m || !integer(Number(m[1]), 0, Number.MAX_SAFE_INTEGER))
      throw new SearchAdapterError("DENIED");
    const actual = Buffer.from(m[2]),
      expected = Buffer.from(mac(Number(m[1]), tenant));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new SearchAdapterError("DENIED");
    return Number(m[1]);
  }
  function receipt(task: any, tenant: string) {
    if (
      !task ||
      !integer(task.taskUid, 0, Number.MAX_SAFE_INTEGER) ||
      task.indexUid !== options.index ||
      !["enqueued", "processing", "succeeded"].includes(task.status)
    )
      throw new SearchAdapterError("UNAVAILABLE", "unknown");
    return {
      state: "accepted" as const,
      taskId: taskToken(task.taskUid, tenant),
    };
  }
  async function status(
    token: string,
    uid: number,
    signal: AbortSignal,
  ): Promise<MilleTaskStatus> {
    const task = await http.get<any>({
      path: `tasks/${uid}`,
      extraRequestInit: { signal },
    });
    if (
      !task ||
      task.uid !== uid ||
      task.indexUid !== options.index ||
      !["enqueued", "processing", "succeeded", "failed", "canceled"].includes(
        task.status,
      )
    )
      throw new SearchAdapterError("DENIED");
    const result: MilleTaskStatus = { taskId: token, state: task.status };
    if (task.status === "failed")
      result.failureCode = errors.has(task.error?.code)
        ? task.error.code
        : "task_failed";
    for (const key of ["receivedDocuments", "indexedDocuments"] as const)
      if (integer(task.details?.[key], 0, Number.MAX_SAFE_INTEGER))
        result[key] = task.details[key];
    return result;
  }
  function filters(input: readonly SearchFilter[] = []) {
    if (!Array.isArray(input) || input.length > 16) bad();
    for (const f of input)
      record(f, ["field", "operator", "value", "caseSensitive"]);
    return validateSearchFilters(input).map((f) => {
      if (
        !options.filterable.includes(f.field) ||
        !["eq", "neq", "in", "exists", "gte", "lte"].includes(f.operator)
      )
        throw new SearchAdapterError("UNSUPPORTED");
      const type = f.field === "id" ? "string" : options.fields[f.field];
      if (
        type === "string" &&
        f.operator !== "exists" &&
        f.caseSensitive !== false
      )
        throw new SearchAdapterError("UNSUPPORTED");
      const values =
        f.operator === "exists"
          ? []
          : f.operator === "in"
            ? (f.value as unknown[])
            : [f.value];
      for (const v of values)
        if (
          v === null ||
          typeof v !== type ||
          (typeof v === "number" &&
            (!Number.isFinite(v) ||
              (Number.isInteger(v) && !Number.isSafeInteger(v)))) ||
          // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
          (typeof v === "string" && /[\x00-\x1f\x7f]/.test(v))
        )
          bad();
      if (f.operator === "exists") return `${f.field} EXISTS`;
      if (f.operator === "in")
        return values.length
          ? `${f.field} IN ${JSON.stringify(values)}`
          : '_zxTenant = "impossible-non-hash-tenant"';
      if (["gte", "lte"].includes(f.operator) && type !== "number")
        throw new SearchAdapterError("UNSUPPORTED");
      return `${f.field} ${{ eq: "=", neq: "!=", gte: ">=", lte: "<=" }[f.operator as "eq"]} ${JSON.stringify(f.value)}`;
    });
  }
  async function mutate(
    values: readonly SearchDocument[] | readonly string[],
    call: SearchCall,
    remove: boolean,
  ) {
    const tenant = scope(call);
    if (!Array.isArray(values) || !values.length || values.length > 100)
      throw new SearchAdapterError("LIMIT");
    const seen = new Set<string>(),
      data = values.map((value) => {
        const doc = remove ? undefined : document(value),
          id = remove ? value : doc!.id;
        if (typeof id !== "string" || !id || id.length > 512 || seen.has(id))
          bad();
        seen.add(id);
        const key = idFor(tenant, id);
        return remove ? key : { ...doc, _zxId: key, _zxTenant: tenant };
      });
    if (Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024)
      throw new SearchAdapterError("LIMIT");
    return run(
      call,
      async (signal) => {
        await verify(signal);
        const task = await http.post<any>({
          path: remove ? base + "/documents/delete-batch" : base + "/documents",
          body: data,
          extraRequestInit: { signal },
        });
        return receipt(task, tenant);
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
      sort: Object.freeze([...options.sortable]),
      mutations: Object.freeze(["index", "delete"] as const),
      pagination: "offset" as const,
    }),
    async search(
      query: ExternalSearchQuery,
      call: SearchCall,
    ): Promise<ExternalSearchPage> {
      const tenant = scope(call);
      record(query, ["text", "limit", "offset", "filters", "sort"]);
      if (
        typeof query.text !== "string" ||
        query.text.length > 4096 ||
        !integer(query.limit ?? 20, 1, 100) ||
        !integer(query.offset ?? 0, 0, 10000) ||
        (query.offset ?? 0) + (query.limit ?? 20) > 10000
      )
        bad();
      const translated = filters(query.filters),
        text = query.text,
        limit = query.limit ?? 20,
        offset = query.offset ?? 0;
      if (query.sort) {
        record(query.sort, ["field", "direction"]);
        if (
          !options.sortable.includes(query.sort.field) ||
          !["asc", "desc"].includes(query.sort.direction)
        )
          throw new SearchAdapterError("UNSUPPORTED");
      }
      const sort = query.sort
        ? [
            query.sort.field + ":" + query.sort.direction,
            ...(query.sort.field === "id" ? [] : ["id:asc"]),
          ]
        : undefined;
      return run(call, async (signal) => {
        await verify(signal);
        const result = await http.post<any>({
          path: base + "/search",
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
        )
          throw new SearchAdapterError("UNAVAILABLE");
        const hits = result.hits.map((hit: any) => {
          record(hit);
          if (
            hit._zxTenant !== tenant ||
            typeof hit.id !== "string" ||
            hit._zxId !== idFor(tenant, hit.id)
          )
            throw new SearchAdapterError("DENIED");
          const { _zxTenant: _, _zxId: __, ...doc } = hit;
          return { document: document(doc) };
        });
        return {
          hits,
          ...(integer(result.estimatedTotalHits, 0, Number.MAX_SAFE_INTEGER)
            ? { total: result.estimatedTotalHits }
            : {}),
          coverage: "partial" as const,
        };
      });
    },
    index: (values: readonly SearchDocument[], call: SearchCall) =>
      mutate(values, call, false),
    delete: (values: readonly string[], call: SearchCall) =>
      mutate(values, call, true),
    /** Privileged setup only. Await this task before configuring the new index. */
    createIndex(call: SearchCall) {
      const tenant = scope(call);
      return run(
        call,
        async (signal) =>
          receipt(
            await http.post<any>({
              path: "indexes",
              body: { uid: options.index, primaryKey: "_zxId" },
              extraRequestInit: { signal },
            }),
            tenant,
          ),
        true,
      );
    },
    /** Explicit settings replacement for this adapter's supported attribute subset. */
    configureIndex(call: SearchCall) {
      const tenant = scope(call);
      return run(
        call,
        async (signal) =>
          receipt(
            await http.patch<any>({
              path: base + "/settings",
              body: expected,
              extraRequestInit: { signal },
            }),
            tenant,
          ),
        true,
      );
    },
    taskStatus(token: string, call: SearchCall) {
      const tenant = scope(call),
        uid = taskUid(token, tenant);
      return run(call, (signal) => status(token, uid, signal));
    },
    waitForTask(
      token: string,
      call: SearchCall,
      wait: { intervalMs?: number; maxPolls?: number } = {},
    ) {
      const tenant = scope(call),
        uid = taskUid(token, tenant);
      record(wait, ["intervalMs", "maxPolls"]);
      const interval = wait.intervalMs ?? 100,
        max = wait.maxPolls ?? 50;
      if (!integer(interval, 10, 1000) || !integer(max, 1, 100)) bad();
      return run(call, async (signal) => {
        for (let i = 0; i < max; i++) {
          const result = await status(token, uid, signal);
          if (["succeeded", "failed", "canceled"].includes(result.state))
            return result;
          if (i + 1 < max) await pause(interval, undefined, { signal });
        }
        throw new SearchAdapterError("DEADLINE");
      });
    },
    health(call: Omit<SearchCall, "tenant">) {
      return run(call, async (signal) => {
        const result = await http.get<any>({
          path: "version",
          extraRequestInit: { signal },
        });
        if (
          typeof result?.pkgVersion !== "string" ||
          !/^1\.[0-9]+\.[0-9]+(?:[-+].*)?$/.test(result.pkgVersion)
        )
          throw new SearchAdapterError("UNSUPPORTED");
        return "ready" as const;
      });
    },
    close() {
      if (closing) return closing;
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
export function createMilleSearchFactory(
  options: Omit<
    MilleSearchOptions,
    "endpoint" | "allowedEndpoints" | "apiKey" | "client" | "fetch"
  >,
): SearchFactory {
  record(options, [
    "index",
    "fields",
    "searchable",
    "filterable",
    "sortable",
    "taskKey",
    "taskScope",
    "timeoutMs",
    "maxPending",
  ]);
  if (options.fields !== undefined) {
    record(options.fields);
    if (Object.keys(options.fields).length > 32) bad();
  }
  if (
    !(options.taskKey instanceof Uint8Array) ||
    options.taskKey.byteLength !== 32
  )
    bad();
  for (const values of [
    options.searchable,
    options.filterable,
    options.sortable,
  ])
    if (values !== undefined && (!Array.isArray(values) || values.length > 34))
      bad();
  const config = {
    ...options,
    fields: options.fields && { ...options.fields },
    searchable: options.searchable && [...options.searchable],
    filterable: options.filterable && [...options.filterable],
    sortable: options.sortable && [...options.sortable],
    taskKey: Buffer.from(options.taskKey),
  };
  return (connection, signal) => {
    record(connection.credentials, ["apiKey"]);
    return createMilleSearchAdapter(
      {
        ...config,
        endpoint: connection.endpoint,
        allowedEndpoints: connection.allowedEndpoints,
        apiKey: connection.credentials.apiKey,
      },
      signal,
    );
  };
}
