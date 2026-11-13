import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import type {
  McpTool,
  TransportAdapter,
  TransportLimits,
} from 'zhost/protocols';
import type { DevtoolsModuleDefinition } from './module-registry.js';
export type DevtoolsTransportKit = Pick<
  typeof import('zhost/protocols'),
  | 'createTransportRegistry'
  | 'createHttpTransportAdapter'
  | 'createProtocolGateway'
  | 'createMcpServer'
  | 'ToolRegistry'
  | 'SseHub'
>;
export interface DevtoolsEndpointPrincipal {
  /** Fresh host-verified operator reference; never returned as public tool data. */
  subject: string;
  /** Host credential expiry checked before admission and during response ownership. */
  expiresAt: number;
}
export interface DevtoolsEndpointContext {
  /** Actual authenticated request; never include it in public tool output. */
  request: IncomingMessage;
  /** Fixed explicit application identity. */
  appId: string;
  /** Fixed framework generation identity. */
  generationId: string;
  /** Current scoped module identifier. */
  moduleId: string;
  /** Monotonic load epoch fencing stale module controls. */
  moduleEpoch: number;
  /** Frozen host-authenticated principal for this actual request. */
  principal: Readonly<DevtoolsEndpointPrincipal>;
  /** Owned cooperative cancellation signal; it cannot terminate arbitrary handlers. */
  signal: AbortSignal;
  /** Absolute operation deadline bounded by credential expiry and endpoint policy. */
  deadline: number;
}
export interface DevtoolsEndpointTool extends Pick<
  McpTool,
  'name' | 'description' | 'inputSchema'
> {
  /** Apply the declared host request or tool-action authorization boundary.
   * @param {Record<string, unknown>} args - Validated structured tool input; schemas alone never grant access.
   * @param {object} context - Host-bound request/action context carrying scope and cancellation.
   * @returns {boolean | Promise<boolean> | Promise<DevtoolsEndpointPrincipal | null>} Tool permission decision or host-verified expiring principal, according to this declared callback.
   */
  authorize(
    args: Record<string, unknown>,
    context: DevtoolsEndpointContext
  ): boolean | Promise<boolean>;
  /** Execute only an explicitly registered trusted tool after current authorization succeeds.
   * @param {Record<string, unknown>} args - Validated structured arguments, never executable source.
   * @param {DevtoolsEndpointContext} context - Verified initiating scope with bounded deadline and cancellation.
   * @returns {unknown | Promise<unknown>} Handler data independently projected through the public output budget.
   */
  handle(
    args: Record<string, unknown>,
    context: DevtoolsEndpointContext
  ): unknown | Promise<unknown>;
}
interface EndpointBase {
  /** Explicit stable module/endpoint identifier. */
  id: string;
  /** Explicit native listener bind; private loopback and ephemeral port are defaults. */
  bind?: {
    /** Configured native bind host or actual listener address. */
    host: string;
    /** Configured/native listener port. */
    port: number;
  };
  /** Required explicit canonical origin for a nonloopback bind. */
  publicOrigin?: string;
  /** Copied exact browser Origin allowlist; nonbrowser callers still authenticate. */
  allowedOrigins: readonly string[];
  /** Required message/concurrency/time budgets enforced by the injected adapter. */
  limits: TransportLimits;
  /** Explicit public result field names with independent sensitive-name denial. */
  publicFields?: readonly string[];
}
export type DevtoolsModuleEndpoint =
  | (EndpointBase & {
      /** Declared endpoint implementation; unavailable native gRPC rejects before startup. */
      kind: 'sse';
      /** Bounded SSE replay count; defaults to eight and cannot exceed thirty-two. */
      backlog?: number;
    })
  | (EndpointBase & {
      /** Declared endpoint implementation; unavailable native gRPC rejects before startup. */
      kind: 'mcp';
      /** Explicit trusted authorized MCP tool declarations, capped at configuration validation. */
      tools: readonly DevtoolsEndpointTool[];
    })
  | (EndpointBase & {
      /** Declared endpoint implementation; unavailable native gRPC rejects before startup. */
      kind: 'grpc';
    });
export interface TransportDevtoolsModule extends Pick<
  DevtoolsModuleDefinition,
  'id' | 'title'
> {
  /** Finite endpoint descriptions/state belonging to this module owner. */
  endpoints: readonly DevtoolsModuleEndpoint[];
  /** Acquire only explicit module resources and transfer their cleanup to this host.
   * @param {{onDispose: (callback: () => void | Promise<void>) => void}} context - Bounded LIFO cleanup registrar supplied by the module host.
   * @returns {void | Promise<void>} Setup settlement before listeners are marked active.
   */
  setup?(context: {
    /** Register acquired module cleanup for reverse-order startup rollback and teardown.
     * @param {() => void | Promise<void>} callback - Trusted disposer; registration rejects invalid callbacks or exhausted cleanup capacity.
     * @returns {void} Retains the callback until actual owned teardown.
     */
    onDispose(callback: () => void | Promise<void>): void;
  }): void | Promise<void>;
}
/** Field-name denylist applied independently of explicit public output approvals. */
const sensitive =
  /password|secret|token|cookie|authorization|credential|api.?key|session|email|stack/i;
/** Assert one bounded explicit module/endpoint identity before allocating resources.
 * @param {unknown} value - Candidate trusted configuration identifier.
 * @returns {void} Returns only for the implemented identifier grammar, otherwise throws.
 */
function name(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new TypeError('Invalid devtools identifier');
  }
}
/** Validate and copy a finite list of exact canonical HTTP(S) origins.
 * @param {readonly string[]} values - Explicit host allowlist; paths, credentials, wildcard forms and malformed URLs reject.
 * @returns {string[]} Fresh validated origin list; it does not authenticate a request.
 */
function origins(values: readonly string[]) {
  if (
    !Array.isArray(values) ||
    values.length > 16 ||
    values.some((v) => {
      try {
        /** Parsed configured origin required to equal its canonical HTTP(S) origin exactly. */
        const u = new URL(v);
        return !['http:', 'https:'].includes(u.protocol) || u.origin !== v;
      } catch {
        return true;
      }
    })
  ) {
    throw new TypeError('Exact devtools origins required');
  }
  return [...values];
}
/** Produce default-deny bounded JSON output; approved field values must already be public.
 * @param {unknown} input - Trusted handler output still subject to structural/data-property checks.
 * @param {ReadonlySet<string>} allowed - Explicit public field-name allowlist.
 * @param {number} limit - Maximum serialized UTF-8 output bytes.
 * @returns {unknown} Detached projection after complexity and byte checks.
 */
function project(input: unknown, allowed: ReadonlySet<string>, limit: number) {
  let nodes = 0;
  /** Project approved own JSON data with explicit node/depth/list limits.
   * @param {unknown} value - Candidate result value.
   * @param {number} depth - Current bounded traversal depth.
   * @param {boolean} [approved] - Whether an enclosing approved field permits primitive values.
   * @returns {unknown} Detached bounded public projection; accessors and unsupported objects reject.
   */
  const visit = (value: unknown, depth: number, approved = false): unknown => {
    if (++nodes > 2048 || depth > 4) {
      throw new RangeError('Devtools result complexity exceeded');
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return approved ? value : null;
    }
    if (typeof value === 'string') {
      return approved ? value.slice(0, 256) : null;
    }
    if (Array.isArray(value)) {
      if (value.length > 256) {
        throw new RangeError('Devtools result list exceeded');
      }
      return value.map((v) => visit(v, depth + 1, approved));
    }
    if (
      !value ||
      typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      throw new TypeError('Devtools result must be JSON');
    }
    /** Null-prototype public projection populated only from approved own data fields. */
    const result: Record<string, unknown> = Object.create(null);
    if (Object.keys(value).length > 128) {
      throw new RangeError('Devtools fields exceeded');
    }
    for (const key of Object.keys(value)) {
      if (sensitive.test(key) || !allowed.has(key)) {
        continue;
      }
      /** Own descriptor inspected without executing an output accessor. */
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !('value' in d)) {
        throw new TypeError('Devtools accessors denied');
      }
      result[key] = visit(d.value, depth + 1, true);
    }
    return result;
  };
  /** Complete bounded projection checked for serialized bytes before publication. */
  const data = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(data)) > limit) {
    throw new RangeError('Devtools result budget exceeded');
  }
  return data;
}
/** Preserve an explicit trusted transport module definition without setup or listener startup.
 * @param {T} definition - Authored module with supported endpoint declarations.
 * @returns {T} The same caller-owned inert definition.
 */
export function defineTransportDevtoolsModule<
  T extends TransportDevtoolsModule,
>(definition: T): T {
  return definition;
}
/** Create an opt-in scoped host for actual injected zhost SSE/MCP implementations.
 * @param {{appId: string, generationId: string, transports: DevtoolsTransportKit, authorize: Function, maxModules?: number}} options - Explicit host identity, real transport kit, authentication callback and module budget.
 * @param {string} options.appId - Fixed host application identity.
 * @param {string} options.generationId - Fixed runtime generation identity.
 * @param {DevtoolsTransportKit} options.transports - Actual explicitly injected zhost implementations.
 * @param {Function} options.authorize - Fresh native-request authentication returning an expiring principal or null.
 * @param {number} [options.maxModules] - Bounded module count, defaulting to eight.
 * @returns {object} Host owner with serialized load/unload and awaited close; no listener starts on creation.
 */
export function createDevtoolsModuleHost(options: {
  /** Fixed explicit application identity. */
  appId: string;
  /** Fixed framework generation identity. */
  generationId: string;
  /** Explicit actual zhost implementation kit; imports remain optional/type-only. */
  transports: DevtoolsTransportKit;
  /** Authenticate the actual request under the fixed host application/module scope.
   * @param {IncomingMessage} request - Native request whose credentials the host verifies.
   * @param {object} context - Fixed initiating host scope and cancellation.
   * @param {string} context.appId - Explicit application identity.
   * @param {string} context.generationId - Current runtime generation identity.
   * @param {string} context.moduleId - Current scoped module identity.
   * @param {string} context.endpointId - Exact endpoint identity being entered.
   * @param {AbortSignal} context.signal - Native transport cancellation signal.
   * @returns {Promise<DevtoolsEndpointPrincipal | null>} Fresh expiring verified principal, or null for denial.
   */
  authorize(
    request: IncomingMessage,
    context: {
      /** Fixed explicit application identity. */
      appId: string;
      /** Fixed framework generation identity. */
      generationId: string;
      /** Current scoped module identifier. */
      moduleId: string;
      /** Exact current endpoint identity in the verified host context. */
      endpointId: string;
      /** Owned cooperative cancellation signal; it cannot terminate arbitrary handlers. */
      signal: AbortSignal;
    }
  ): Promise<DevtoolsEndpointPrincipal | null>;
  /** Explicit scoped module count cap; defaults to eight. */
  maxModules?: number;
}) {
  name(options.appId);
  name(options.generationId);
  if (
    typeof options.authorize !== 'function' ||
    !options.transports ||
    [
      'createTransportRegistry',
      'createHttpTransportAdapter',
      'createProtocolGateway',
      'createMcpServer',
      'ToolRegistry',
      'SseHub',
    ].some((k) => typeof (options.transports as any)[k] !== 'function')
  ) {
    throw new TypeError('Explicit zhost kit and host authorization required');
  }
  /** Explicit injected zhost implementation kit; declaring a transport name alone provides no runtime. */
  const kit = options.transports;
  /** Fixed host application identity captured separately from model/client arguments. */
  const appId = options.appId;
  /** Fixed host generation identity used to fence endpoint controls. */
  const generationId = options.generationId;
  /** Borrowed mandatory host authentication callback, separate from per-tool authorization. */
  const authorize = options.authorize;
  /** Validated maximum active module count for this scoped host. */
  const max = options.maxModules ?? 8;
  if (!Number.isSafeInteger(max) || max < 1 || max > 16) {
    throw new TypeError('Invalid module budget');
  }
  type Entry = {
    /** Explicit stable module/endpoint identifier. */
    id: string;
    /** Load identity used to prevent stale handles affecting replacements. */
    epoch: number;
    /** Whether this exact module generation currently admits dispatch. */
    open: boolean;
    /** Owned injected transport registry coordinating native startup/rollback/drain. */
    registry: ReturnType<DevtoolsTransportKit['createTransportRegistry']>;
    /** Bounded acquired disposers invoked in reverse order after transport drain. */
    cleanups: (() => void | Promise<void>)[];
    /** Finite endpoint descriptions/state belonging to this module owner. */
    endpoints: Map<
      string,
      {
        /** Copied validated endpoint settings for this generation. */
        spec: DevtoolsModuleEndpoint;
        /** Owned bounded SSE history/client hub. */
        hub?: InstanceType<DevtoolsTransportKit['SseHub']>;
        /** Owned injected native transport adapter. */
        adapter?: TransportAdapter & {
          /** Read the actual bound native address from the injected transport owner.
           * @returns {{host: string, port: number} | null} Listener address after startup, otherwise null.
           */
          address(): {
            /** Configured native bind host or actual listener address. */
            host: string;
            /** Configured/native listener port. */
            port: number;
          } | null;
        };
        /** Approved public field-name set used by result projection. */
        fields: Set<string>;
      }
    >;
  };
  /** Current scoped module generations; identity comparisons fence stale handles. */
  const entries = new Map<string, Entry>();
  /** Request-local verified endpoint context used only during explicit trusted tool dispatch. */
  const storage = new AsyncLocalStorage<Readonly<DevtoolsEndpointContext>>();
  let closed = false,
    epoch = 0,
    queued = 0,
    tail: Promise<unknown> = Promise.resolve(),
    closing: Promise<void> | undefined;
  /** Serialize bounded module mutations while retaining their actual settlement.
   * @template T
   * @param {() => Promise<T>} run - Explicit trusted mutation callback.
   * @returns {Promise<T>} Its outcome after queued execution; rejection does not strand later mutations.
   */
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    if (queued >= 16) {
      return Promise.reject(new Error('Devtools mutation capacity exceeded'));
    }
    queued++;
    /** Queued mutation promise retained through its final capacity release. */
    const task = tail.then(run);
    tail = task.catch(() => {});
    return task.finally(() => queued--);
  };
  /** Disable a module before draining transports and reversing acquired cleanups.
   * @param {Entry} entry - Exact scoped module generation to release.
   * @returns {Promise<void>} Actual teardown settlement; independent cleanup failures aggregate.
   */
  const stop = async (entry: Entry) => {
    entry.open = false;
    if (entries.get(entry.id) === entry) {
      entries.delete(entry.id);
    }
    /** Teardown failures collected without skipping later owned resources. */
    const errors: unknown[] = [];
    try {
      await entry.registry.stop();
    } catch (e) {
      errors.push(e);
    }
    for (const dispose of entry.cleanups.reverse()) {
      try {
        await dispose();
      } catch (e) {
        errors.push(e);
      }
    }
    entry.cleanups.length = 0;
    entry.endpoints.clear();
    if (errors.length) {
      throw new AggregateError(errors, 'Devtools module teardown failed');
    }
  };
  /** Validate complete endpoint configuration and reject unavailable native gRPC before resource acquisition.
   * @param {TransportDevtoolsModule} definition - Explicit module identity/title/setup and finite endpoint declarations.
   * @returns {object[]} Copied supported endpoint descriptions and approved output-field sets.
   */
  function validate(definition: TransportDevtoolsModule) {
    name(definition.id);
    if (
      (definition.setup !== undefined &&
        typeof definition.setup !== 'function') ||
      typeof definition.title !== 'string' ||
      definition.title.length > 128 ||
      !Array.isArray(definition.endpoints) ||
      !definition.endpoints.length ||
      definition.endpoints.length > 4
    ) {
      throw new TypeError('Invalid module endpoints');
    }
    /** Endpoint identifiers reserved during complete preflight validation. */
    const seen = new Set<string>();
    return definition.endpoints.map((raw: DevtoolsModuleEndpoint) => {
      name(raw.id);
      if (seen.has(raw.id)) {
        throw new TypeError('Duplicate module endpoint');
      }
      seen.add(raw.id);
      if (raw.kind === 'grpc') {
        throw new Error('Native gRPC transport unavailable in zhost');
      }
      if (!['sse', 'mcp'].includes(raw.kind)) {
        throw new TypeError('Unsupported module transport');
      }
      /** Copied canonical exact origin allowlist; loopback does not bypass authentication. */
      const allowedOrigins = origins(raw.allowedOrigins);
      /** Explicit endpoint bind settings with private loopback/ephemeral defaults. */
      const bind = { host: '127.0.0.1', port: 0, ...raw.bind };
      if (
        !raw.limits ||
        !Number.isSafeInteger(raw.limits.maxMessageBytes) ||
        raw.limits.maxMessageBytes < 1 ||
        raw.limits.maxMessageBytes > 65536 ||
        !Number.isSafeInteger(raw.limits.maxConcurrent) ||
        raw.limits.maxConcurrent < 1 ||
        raw.limits.maxConcurrent > 32 ||
        !Number.isSafeInteger(raw.limits.timeoutMs) ||
        raw.limits.timeoutMs < 10 ||
        raw.limits.timeoutMs > 60000
      ) {
        throw new TypeError('Explicit bounded endpoint limits required');
      }
      if (!['127.0.0.1', '::1'].includes(bind.host) && !raw.publicOrigin) {
        throw new TypeError('Remote bind requires explicit public origin');
      }
      if (raw.publicOrigin) {
        origins([raw.publicOrigin]);
      }
      /** Explicit public result field allowlist; sensitive names remain denied. */
      const fields = new Set(raw.publicFields ?? []);
      if (
        fields.size > 64 ||
        [...fields].some(
          (v) =>
            typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(v)
        )
      ) {
        throw new TypeError('Invalid public projection fields');
      }
      if (
        raw.kind === 'sse' &&
        (!Number.isSafeInteger(raw.backlog ?? 8) ||
          (raw.backlog ?? 8) < 0 ||
          (raw.backlog ?? 8) > 32)
      ) {
        throw new TypeError('Invalid event backlog');
      }
      if (
        raw.kind === 'mcp' &&
        (!Array.isArray(raw.tools) ||
          raw.tools.length > 32 ||
          raw.tools.some(
            (t: DevtoolsEndpointTool) =>
              typeof t.authorize !== 'function' ||
              typeof t.handle !== 'function'
          ))
      ) {
        throw new TypeError('Authorized MCP tools required');
      }
      return {
        spec: {
          ...raw,
          bind,
          allowedOrigins,
          limits: { ...raw.limits },
        } as DevtoolsModuleEndpoint,
        fields,
      };
    });
  }
  return {
    capabilities: Object.freeze({
      sse: true,
      mcp: 'stateless-json-subset',
      grpc: false,
    }),
    /** Validate a candidate, drain any prior module, then acquire/start the replacement once.
     * @param {TransportDevtoolsModule} definition - Explicit trusted module definition; failed replacement does not resurrect old privileges.
     * @returns {Promise<Readonly<object>>} Generation-fenced address/publish/dispose handle after actual startup.
     */
    load(definition: TransportDevtoolsModule) {
      return serial(async () => {
        if (closed) {
          throw new Error('Devtools module host closed');
        }
        /** Fully validated endpoint descriptions before replacement disables an existing module. */
        const prepared = validate(definition);
        /** Existing exact module generation drained before replacement acquisition. */
        const old = entries.get(definition.id);
        if (old) {
          await stop(old);
        }
        if (entries.size >= max) {
          throw new Error('Devtools module capacity exceeded');
        }
        /** New scoped module generation whose registry and cleanup stack share one owner. */
        const entry: Entry = {
          id: definition.id,
          epoch: ++epoch,
          open: false,
          registry: kit.createTransportRegistry({ maxTransports: 4 }),
          cleanups: [],
          endpoints: new Map(),
        };
        entries.set(entry.id, entry);
        try {
          for (const { spec, fields } of prepared) {
            /** Endpoint state belonging to this exact module generation. */
            const endpoint: Entry['endpoints'] extends Map<string, infer E>
              ? E
              : never = { spec, fields };
            entry.endpoints.set(spec.id, endpoint);
            /** Verified principals bound to actual native request objects, never caller role strings. */
            const identities = new WeakMap<
              IncomingMessage,
              Readonly<DevtoolsEndpointPrincipal>
            >();
            /** Bounded endpoint SSE replay/client owner, including MCP gateway event plumbing. */
            const hub = new kit.SseHub({
              maxClients: spec.limits.maxConcurrent,
              historySize: spec.kind === 'sse' ? (spec.backlog ?? 8) : 0,
            });
            endpoint.hub = hub;
            /** Actual injected protocol gateway enforcing the selected endpoint kind and budgets. */
            const gateway = kit.createProtocolGateway({
              events: hub,
              allowedOrigins: [...spec.allowedOrigins],
              maxBodyBytes: spec.limits.maxMessageBytes,
              maxConcurrentRequests: spec.limits.maxConcurrent,
              requestTimeoutMs: spec.limits.timeoutMs,
              authorize: async (req) => entry.open && identities.has(req),
              authorizeEndpoint: async (_req, target) =>
                entry.open &&
                target.kind === (spec.kind === 'sse' ? 'sse' : 'mcp'),
            });
            if (spec.kind === 'mcp') {
              /** Explicit allowlisted trusted MCP handlers; no arbitrary URL/code/import dispatch is inferred. */
              const tools = new kit.ToolRegistry();
              for (const tool of spec.tools) {
                tools.register({
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.inputSchema,
                  handler: async (args, rpc) => {
                    /** Request-local verified context fetched only inside a host-authorized tool call. */
                    const ctx = storage.getStore();
                    if (
                      closed ||
                      !ctx ||
                      !entry.open ||
                      !rpc?.signal ||
                      rpc.signal.aborted
                    ) {
                      throw new Error('Devtools module inactive');
                    }
                    /** Frozen tool context combining host identity with native RPC cancellation and bounded deadline. */
                    const context = Object.freeze({
                      ...ctx,
                      signal: rpc.signal,
                      deadline: Math.min(
                        ctx.deadline,
                        Date.now() + spec.limits.timeoutMs
                      ),
                    });
                    if ((await tool.authorize(args, context)) !== true) {
                      throw new Error('Devtools tool denied');
                    }
                    context.signal.throwIfAborted();
                    if (!entry.open) {
                      throw new Error('Devtools module inactive');
                    }
                    return project(
                      await tool.handle(args, context),
                      fields,
                      spec.limits.maxMessageBytes
                    );
                  },
                });
              }
              gateway.mcp = kit.createMcpServer({
                name: entry.id,
                version: '1',
                tools,
              });
            }
            /** Original bound gateway handler borrowed before wrapping request context and expiry. */
            const handle = gateway.handle.bind(gateway);
            gateway.handle = async (req, res) => {
              /** Fresh host-verified request principal checked again against module state and expiry. */
              const principal = identities.get(req);
              if (closed || !principal || !entry.open) {
                return false;
              }
              res.setHeader('Cache-Control', 'private, no-store');
              /** Owned credential/request expiry timer destroyed on response finish or close. */
              const timer = setTimeout(
                () => res.destroy(),
                Math.max(
                  1,
                  Math.min(
                    principal.expiresAt - Date.now(),
                    spec.limits.timeoutMs
                  )
                )
              );
              /** Release only this response expiry timer and its terminal listeners.
               * @returns {void} Leaves transport handler drain to its actual owner.
               */
              const release = () => {
                clearTimeout(timer);
                res.off('close', release);
                res.off('finish', release);
              };
              res.once('close', release);
              res.once('finish', release);
              return storage.run(
                Object.freeze({
                  request: req,
                  appId,
                  generationId,
                  moduleId: entry.id,
                  moduleEpoch: entry.epoch,
                  principal,
                  signal: new AbortController().signal,
                  deadline: Math.min(
                    principal.expiresAt,
                    Date.now() + spec.limits.timeoutMs
                  ),
                }),
                () => handle(req, res)
              );
            };
            /** Actual injected HTTP transport owner registered for startup/rollback/close. */
            const adapter = kit.createHttpTransportAdapter({
              gateway,
              authorize: async (req, context) => {
                if (
                  closed ||
                  !entry.open ||
                  context.signal.aborted ||
                  (req.headers.origin !== undefined &&
                    !spec.allowedOrigins.includes(String(req.headers.origin)))
                ) {
                  return false;
                }
                let host: URL;
                try {
                  host = new URL('http://' + req.headers.host);
                } catch {
                  return false;
                }
                /** Bound listener address used to validate direct Host when no explicit public origin is configured. */
                const address = endpoint.adapter?.address();
                if (
                  spec.publicOrigin
                    ? host.host !== new URL(spec.publicOrigin).host
                    : !address ||
                      !['127.0.0.1', 'localhost', '[::1]'].includes(
                        host.hostname
                      ) ||
                      Number(host.port || 80) !== address.port
                ) {
                  return false;
                }
                /** Fresh host-verified request principal checked again against module state and expiry. */
                const principal = await authorize(req, {
                  appId,
                  generationId,
                  moduleId: entry.id,
                  endpointId: spec.id,
                  signal: context.signal,
                });
                if (
                  closed ||
                  !entry.open ||
                  context.signal.aborted ||
                  !principal ||
                  typeof principal.subject !== 'string' ||
                  !/^[A-Za-z0-9_.:-]{1,128}$/.test(principal.subject) ||
                  !Number.isSafeInteger(principal.expiresAt) ||
                  principal.expiresAt <= Date.now() ||
                  principal.expiresAt > Date.now() + 300000
                ) {
                  return false;
                }
                identities.set(
                  req,
                  Object.freeze({
                    subject: principal.subject,
                    expiresAt: principal.expiresAt,
                  })
                );
                return true;
              },
            });
            endpoint.adapter = adapter;
            entry.cleanups.push(() => adapter.stop());
            entry.registry.registerAdapter(spec.id, () => adapter);
            entry.registry.register({
              id: spec.id,
              type: spec.id,
              bind: spec.bind!,
              limits: spec.limits,
            });
          }
          if (definition.setup) {
            await definition.setup({
              /** Register acquired module cleanup for reverse-order startup rollback and teardown.
               * @param {() => void | Promise<void>} callback - Trusted disposer; registration rejects invalid callbacks or exhausted cleanup capacity.
               * @returns {void} Retains the callback until actual owned teardown.
               */
              onDispose(callback) {
                if (
                  typeof callback !== 'function' ||
                  entry.cleanups.length >= 32
                ) {
                  throw new TypeError('Invalid module cleanup');
                }
                entry.cleanups.push(callback);
              },
            });
          }
          await entry.registry.start();
          if (closed) {
            throw new Error('Host closed during startup');
          }
          entry.open = true;
        } catch (error) {
          try {
            await stop(entry);
          } catch {
            /* Original startup failure remains primary. */
          }
          throw new Error('Devtools module startup failed', { cause: error });
        }
        return Object.freeze({
          id: entry.id,
          epoch: entry.epoch,
          endpoints: () =>
            [...entry.endpoints].map(([id, e]) => ({
              id,
              kind: e.spec.kind,
              address: e.adapter?.address() ?? null,
              path: e.spec.kind === 'sse' ? '/events' : '/mcp',
            })),
          /** Publish bounded redacted data only to an active SSE endpoint owned by this generation.
           * @param {string} endpointId - Exact registered SSE endpoint identifier.
           * @param {unknown} value - Trusted handler data still subject to default-deny output projection.
           * @returns {unknown} Native bounded hub publication receipt; inactive/non-SSE endpoints reject.
           */
          publish(endpointId: string, value: unknown) {
            /** Endpoint state belonging to this exact module generation. */
            const endpoint = entry.endpoints.get(endpointId);
            if (closed || !entry.open || endpoint?.spec.kind !== 'sse') {
              throw new Error('Devtools event endpoint unavailable');
            }
            return endpoint.hub!.publish(
              'update',
              project(
                value,
                endpoint.fields,
                endpoint.spec.limits.maxMessageBytes
              )
            );
          },
          /** Queue disposal only while this handle still owns the current module generation.
           * @returns {Promise<void>} Actual registry and LIFO cleanup settlement; stale handles cannot stop replacements.
           */
          dispose() {
            return serial(async () => {
              if (entries.get(entry.id) === entry) {
                await stop(entry);
              }
            });
          },
        });
      });
    },
    /** Queue disable/drain for the currently registered module by explicit identity.
     * @param {string} id - Exact module registration identifier.
     * @returns {Promise<void>} Actual transport/cleanup settlement, or completion when already absent.
     */
    unload(id: string) {
      return serial(async () => {
        /** New scoped module generation whose registry and cleanup stack share one owner. */
        const entry = entries.get(id);
        if (entry) {
          await stop(entry);
        }
      });
    },
    /** Read bounded fixed-label scoped-host capacity counters.
     * @returns {{modules: number, queued: number}} Active module and queued mutation counts only.
     */
    status() {
      return { modules: entries.size, queued };
    },
    /** Fence new work, finish queued mutations and drain modules in reverse acquisition order.
     * @returns {Promise<void>} Shared close receipt; signals do not force-cancel arbitrary JavaScript.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      return (closing = tail.then(async () => {
        /** Teardown failures collected without skipping later owned resources. */
        const errors = [];
        for (const e of [...entries.values()].reverse()) {
          try {
            await stop(e);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) {
          throw new AggregateError(errors, 'Devtools host teardown failed');
        }
      }));
    },
  };
}
