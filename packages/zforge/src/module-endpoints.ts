import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import type { McpTool, TransportAdapter, TransportLimits } from 'zhost/protocols';
import type { DevtoolsModuleDefinition } from './module-registry.js';
export type DevtoolsTransportKit = Pick<typeof import('zhost/protocols'), 'createTransportRegistry' | 'createHttpTransportAdapter' | 'createProtocolGateway' | 'createMcpServer' | 'ToolRegistry' | 'SseHub'>;
export interface DevtoolsEndpointPrincipal {
    subject: string;
    expiresAt: number;
}
export interface DevtoolsEndpointContext {
    /** Actual authenticated request; never include it in public tool output. */
    request: IncomingMessage;
    appId: string;
    generationId: string;
    moduleId: string;
    moduleEpoch: number;
    principal: Readonly<DevtoolsEndpointPrincipal>;
    signal: AbortSignal;
    deadline: number;
}
export interface DevtoolsEndpointTool extends Pick<McpTool, 'name' | 'description' | 'inputSchema'> {
    authorize(args: Record<string, unknown>, context: DevtoolsEndpointContext): boolean | Promise<boolean>;
    handle(args: Record<string, unknown>, context: DevtoolsEndpointContext): unknown | Promise<unknown>;
}
interface EndpointBase {
    id: string;
    bind?: {
        host: string;
        port: number;
    };
    publicOrigin?: string;
    allowedOrigins: readonly string[];
    limits: TransportLimits;
    publicFields?: readonly string[];
}
export type DevtoolsModuleEndpoint = (EndpointBase & {
    kind: 'sse';
    backlog?: number;
}) | (EndpointBase & {
    kind: 'mcp';
    tools: readonly DevtoolsEndpointTool[];
}) | (EndpointBase & {
    kind: 'grpc';
});
export interface TransportDevtoolsModule extends Pick<DevtoolsModuleDefinition, 'id' | 'title'> {
    endpoints: readonly DevtoolsModuleEndpoint[];
    setup?(context: {
        onDispose(callback: () => void | Promise<void>): void;
    }): void | Promise<void>;
}
const sensitive = /password|secret|token|cookie|authorization|credential|api.?key|session|email|stack/i;
function name(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value))
    throw new TypeError('Invalid devtools identifier'); }
function origins(values: readonly string[]) { if (!Array.isArray(values) || values.length > 16 || values.some(v => { try {
    const u = new URL(v);
    return !['http:', 'https:'].includes(u.protocol) || u.origin !== v;
}
catch {
    return true;
} }))
    throw new TypeError('Exact devtools origins required'); return [...values]; }
/** Default-deny projection, not a detector for secrets hidden in explicitly approved values. */
function project(input: unknown, allowed: ReadonlySet<string>, limit: number) { let nodes = 0; const visit = (value: unknown, depth: number, approved = false): unknown => { if (++nodes > 2048 || depth > 4)
    throw new RangeError('Devtools result complexity exceeded'); if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
    return approved ? value : null; if (typeof value === 'string')
    return approved ? value.slice(0, 256) : null; if (Array.isArray(value)) {
    if (value.length > 256)
        throw new RangeError('Devtools result list exceeded');
    return value.map(v => visit(v, depth + 1, approved));
} if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Devtools result must be JSON'); const result: Record<string, unknown> = Object.create(null); if (Object.keys(value).length > 128)
    throw new RangeError('Devtools fields exceeded'); for (const key of Object.keys(value)) {
    if (sensitive.test(key) || !allowed.has(key))
        continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !('value' in d))
        throw new TypeError('Devtools accessors denied');
    result[key] = visit(d.value, depth + 1, true);
} return result; }; const data = visit(input, 0); if (Buffer.byteLength(JSON.stringify(data)) > limit)
    throw new RangeError('Devtools result budget exceeded'); return data; }
export function defineTransportDevtoolsModule<T extends TransportDevtoolsModule>(definition: T): T { return definition; }
/** Scoped opt-in module host. Legacy shared UI/HTTP/WS registries remain independent. */
export function createDevtoolsModuleHost(options: {
    appId: string;
    generationId: string;
    transports: DevtoolsTransportKit;
    authorize(request: IncomingMessage, context: {
        appId: string;
        generationId: string;
        moduleId: string;
        endpointId: string;
        signal: AbortSignal;
    }): Promise<DevtoolsEndpointPrincipal | null>;
    maxModules?: number;
}) {
    name(options.appId);
    name(options.generationId);
    if (typeof options.authorize !== 'function' || !options.transports || ['createTransportRegistry', 'createHttpTransportAdapter', 'createProtocolGateway', 'createMcpServer', 'ToolRegistry', 'SseHub'].some(k => typeof (options.transports as any)[k] !== 'function'))
        throw new TypeError('Explicit zhost kit and host authorization required');
    const kit = options.transports, appId = options.appId, generationId = options.generationId, authorize = options.authorize, max = options.maxModules ?? 8;
    if (!Number.isSafeInteger(max) || max < 1 || max > 16)
        throw new TypeError('Invalid module budget');
    type Entry = {
        id: string;
        epoch: number;
        open: boolean;
        registry: ReturnType<DevtoolsTransportKit['createTransportRegistry']>;
        cleanups: (() => void | Promise<void>)[];
        endpoints: Map<string, {
            spec: DevtoolsModuleEndpoint;
            hub?: InstanceType<DevtoolsTransportKit['SseHub']>;
            adapter?: TransportAdapter & {
                address(): {
                    host: string;
                    port: number;
                } | null;
            };
            fields: Set<string>;
        }>;
    };
    const entries = new Map<string, Entry>(), storage = new AsyncLocalStorage<Readonly<DevtoolsEndpointContext>>();
    let closed = false, epoch = 0, queued = 0, tail: Promise<unknown> = Promise.resolve(), closing: Promise<void> | undefined;
    const serial = <T>(run: () => Promise<T>): Promise<T> => { if (queued >= 16)
        return Promise.reject(new Error('Devtools mutation capacity exceeded')); queued++; const task = tail.then(run); tail = task.catch(() => { }); return task.finally(() => queued--); };
    const stop = async (entry: Entry) => { entry.open = false; if (entries.get(entry.id) === entry)
        entries.delete(entry.id); const errors: unknown[] = []; try {
        await entry.registry.stop();
    }
    catch (e) {
        errors.push(e);
    } for (const dispose of entry.cleanups.reverse())
        try {
            await dispose();
        }
        catch (e) {
            errors.push(e);
        } entry.cleanups.length = 0; entry.endpoints.clear(); if (errors.length)
        throw new AggregateError(errors, 'Devtools module teardown failed'); };
    function validate(definition: TransportDevtoolsModule) { name(definition.id); if (definition.setup !== undefined && typeof definition.setup !== 'function' || typeof definition.title !== 'string' || definition.title.length > 128 || !Array.isArray(definition.endpoints) || !definition.endpoints.length || definition.endpoints.length > 4)
        throw new TypeError('Invalid module endpoints'); const seen = new Set<string>(); return definition.endpoints.map((raw: DevtoolsModuleEndpoint) => { name(raw.id); if (seen.has(raw.id))
        throw new TypeError('Duplicate module endpoint'); seen.add(raw.id); if (raw.kind === 'grpc')
        throw new Error('Native gRPC transport unavailable in zhost'); if (!['sse', 'mcp'].includes(raw.kind))
        throw new TypeError('Unsupported module transport'); const allowedOrigins = origins(raw.allowedOrigins), bind = { host: '127.0.0.1', port: 0, ...raw.bind }; if (!raw.limits || !Number.isSafeInteger(raw.limits.maxMessageBytes) || raw.limits.maxMessageBytes < 1 || raw.limits.maxMessageBytes > 65536 || !Number.isSafeInteger(raw.limits.maxConcurrent) || raw.limits.maxConcurrent < 1 || raw.limits.maxConcurrent > 32 || !Number.isSafeInteger(raw.limits.timeoutMs) || raw.limits.timeoutMs < 10 || raw.limits.timeoutMs > 60000)
        throw new TypeError('Explicit bounded endpoint limits required'); if (!['127.0.0.1', '::1'].includes(bind.host) && !raw.publicOrigin)
        throw new TypeError('Remote bind requires explicit public origin'); if (raw.publicOrigin)
        origins([raw.publicOrigin]); const fields = new Set(raw.publicFields ?? []); if (fields.size > 64 || [...fields].some(v => typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(v)))
        throw new TypeError('Invalid public projection fields'); if (raw.kind === 'sse' && (!Number.isSafeInteger(raw.backlog ?? 8) || (raw.backlog ?? 8) < 0 || (raw.backlog ?? 8) > 32))
        throw new TypeError('Invalid event backlog'); if (raw.kind === 'mcp' && (!Array.isArray(raw.tools) || raw.tools.length > 32 || raw.tools.some((t: DevtoolsEndpointTool) => typeof t.authorize !== 'function' || typeof t.handle !== 'function')))
        throw new TypeError('Authorized MCP tools required'); return { spec: { ...raw, bind, allowedOrigins, limits: { ...raw.limits } } as DevtoolsModuleEndpoint, fields }; }); }
    return {
        capabilities: Object.freeze({ sse: true, mcp: 'stateless-json-subset', grpc: false }),
        load(definition: TransportDevtoolsModule) {
            return serial(async () => {
                if (closed)
                    throw new Error('Devtools module host closed');
                const prepared = validate(definition);
                const old = entries.get(definition.id);
                if (old)
                    await stop(old);
                if (entries.size >= max)
                    throw new Error('Devtools module capacity exceeded');
                const entry: Entry = { id: definition.id, epoch: ++epoch, open: false, registry: kit.createTransportRegistry({ maxTransports: 4 }), cleanups: [], endpoints: new Map() };
                entries.set(entry.id, entry);
                try {
                    for (const { spec, fields } of prepared) {
                        const endpoint: Entry['endpoints'] extends Map<string, infer E> ? E : never = { spec, fields };
                        entry.endpoints.set(spec.id, endpoint);
                        const identities = new WeakMap<IncomingMessage, Readonly<DevtoolsEndpointPrincipal>>();
                        const hub = new kit.SseHub({ maxClients: spec.limits.maxConcurrent, historySize: spec.kind === 'sse' ? spec.backlog ?? 8 : 0 });
                        endpoint.hub = hub;
                        const gateway = kit.createProtocolGateway({ events: hub, allowedOrigins: [...spec.allowedOrigins], maxBodyBytes: spec.limits.maxMessageBytes, maxConcurrentRequests: spec.limits.maxConcurrent, requestTimeoutMs: spec.limits.timeoutMs, authorize: async (req) => entry.open && identities.has(req), authorizeEndpoint: async (_req, target) => entry.open && target.kind === (spec.kind === 'sse' ? 'sse' : 'mcp') });
                        if (spec.kind === 'mcp') {
                            const tools = new kit.ToolRegistry();
                            for (const tool of spec.tools)
                                tools.register({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, handler: async (args, rpc) => { const ctx = storage.getStore(); if (closed || !ctx || !entry.open || !rpc?.signal || rpc.signal.aborted)
                                        throw new Error('Devtools module inactive'); const context = Object.freeze({ ...ctx, signal: rpc.signal, deadline: Math.min(ctx.deadline, Date.now() + spec.limits.timeoutMs) }); if (await tool.authorize(args, context) !== true)
                                        throw new Error('Devtools tool denied'); context.signal.throwIfAborted(); if (!entry.open)
                                        throw new Error('Devtools module inactive'); return project(await tool.handle(args, context), fields, spec.limits.maxMessageBytes); } });
                            gateway.mcp = kit.createMcpServer({ name: entry.id, version: '1', tools });
                        }
                        const handle = gateway.handle.bind(gateway);
                        gateway.handle = async (req, res) => { const principal = identities.get(req); if (closed || !principal || !entry.open)
                            return false; res.setHeader('Cache-Control', 'private, no-store'); const timer = setTimeout(() => res.destroy(), Math.max(1, Math.min(principal.expiresAt - Date.now(), spec.limits.timeoutMs))); const release = () => { clearTimeout(timer); res.off('close', release); res.off('finish', release); }; res.once('close', release); res.once('finish', release); return storage.run(Object.freeze({ request: req, appId, generationId, moduleId: entry.id, moduleEpoch: entry.epoch, principal, signal: new AbortController().signal, deadline: Math.min(principal.expiresAt, Date.now() + spec.limits.timeoutMs) }), () => handle(req, res)); };
                        const adapter = kit.createHttpTransportAdapter({ gateway, authorize: async (req, context) => { if (closed || !entry.open || context.signal.aborted || req.headers.origin !== undefined && !spec.allowedOrigins.includes(String(req.headers.origin)))
                                return false; let host: URL; try {
                                host = new URL('http://' + req.headers.host);
                            }
                            catch {
                                return false;
                            } const address = endpoint.adapter?.address(); if (spec.publicOrigin ? host.host !== new URL(spec.publicOrigin).host : !address || !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || Number(host.port || 80) !== address.port)
                                return false; const principal = await authorize(req, { appId, generationId, moduleId: entry.id, endpointId: spec.id, signal: context.signal }); if (closed || !entry.open || context.signal.aborted || !principal || typeof principal.subject !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(principal.subject) || !Number.isSafeInteger(principal.expiresAt) || principal.expiresAt <= Date.now() || principal.expiresAt > Date.now() + 300000)
                                return false; identities.set(req, Object.freeze({ subject: principal.subject, expiresAt: principal.expiresAt })); return true; } });
                        endpoint.adapter = adapter;
                        entry.cleanups.push(() => adapter.stop());
                        entry.registry.registerAdapter(spec.id, () => adapter);
                        entry.registry.register({ id: spec.id, type: spec.id, bind: spec.bind!, limits: spec.limits });
                    }
                    if (definition.setup)
                        await definition.setup({ onDispose(callback) { if (typeof callback !== 'function' || entry.cleanups.length >= 32)
                                throw new TypeError('Invalid module cleanup'); entry.cleanups.push(callback); } });
                    await entry.registry.start();
                    if (closed)
                        throw new Error('Host closed during startup');
                    entry.open = true;
                }
                catch (error) {
                    try {
                        await stop(entry);
                    }
                    catch { /* Original startup failure remains primary. */ }
                    throw new Error('Devtools module startup failed', { cause: error });
                }
                return Object.freeze({ id: entry.id, epoch: entry.epoch, endpoints: () => [...entry.endpoints].map(([id, e]) => ({ id, kind: e.spec.kind, address: e.adapter?.address() ?? null, path: e.spec.kind === 'sse' ? '/events' : '/mcp' })), publish(endpointId: string, value: unknown) { const endpoint = entry.endpoints.get(endpointId); if (closed || !entry.open || endpoint?.spec.kind !== 'sse')
                        throw new Error('Devtools event endpoint unavailable'); return endpoint.hub!.publish('update', project(value, endpoint.fields, endpoint.spec.limits.maxMessageBytes)); }, dispose() { return serial(async () => { if (entries.get(entry.id) === entry)
                        await stop(entry); }); } });
            });
        },
        unload(id: string) { return serial(async () => { const entry = entries.get(id); if (entry)
            await stop(entry); }); },
        status() { return { modules: entries.size, queued }; },
        close() { if (closing)
            return closing; closed = true; return closing = tail.then(async () => { const errors = []; for (const e of [...entries.values()].reverse())
            try {
                await stop(e);
            }
            catch (error) {
                errors.push(error);
            } if (errors.length)
            throw new AggregateError(errors, 'Devtools host teardown failed'); }); }
    };
}
