import {snapshotAiJson as snapshotToolJson} from './safe-json.js';
export {snapshotAiJson as snapshotToolJson} from './safe-json.js';
/** Server-owned tools. Validation never grants authorization. */
import { randomUUID } from 'node:crypto';
export interface ToolPrincipal {
    tenant: string;
    subject: string;
}
export interface ToolContext {
    readonly principal: Readonly<ToolPrincipal>;
    readonly executionId: string;
    readonly signal: AbortSignal;
    readonly deadline: number;
}
export interface ToolSchema<T = unknown> {
    readonly '~standard': {
        readonly version: 1;
        validate(value: unknown): {
            value?: T;
            issues?: readonly unknown[];
        } | PromiseLike<{
            value?: T;
            issues?: readonly unknown[];
        }>;
    };
}
export interface ToolDefinition<T = unknown> {
    description: string;
    inputSchema: Record<string, unknown>;
    schema: ToolSchema<T>;
    sideEffect: boolean;
    privileged?: boolean;
    authorize(context: ToolContext, args: T): boolean | Promise<boolean>;
    reauthorize?(context: ToolContext, args: T): boolean | Promise<boolean>;
    execute(args: T, context: ToolContext): unknown | Promise<unknown>;
}
export type ToolState = 'succeeded' | 'denied' | 'invalid' | 'unknown-tool' | 'overloaded' | 'cancelled' | 'failed' | 'uncertain';
export interface ToolOutcome {
    readonly executionId: string;
    readonly state: ToolState;
    readonly value?: unknown;
}
export class ToolLoopError extends Error {
    readonly executions: readonly {
        executionId: string;
        state: ToolState;
    }[];
    constructor(readonly code: 'budget' | 'cancelled' | 'failed', results: readonly ToolOutcome[]) { super('Tool loop ' + code); this.name = 'ToolLoopError'; this.executions = Object.freeze(results.map(r => Object.freeze({ executionId: r.executionId, state: r.state }))); }
}
export interface ToolAudit {
    executionId: string;
    tool: string;
    phase: 'started' | 'terminal' | 'settled';
    state?: ToolState;
}
export interface ToolExecutorOptions {
    authenticate(context: unknown, signal: AbortSignal): Promise<ToolPrincipal | null>;
    maxTools?: number;
    maxSessions?: number;
    maxConcurrent?: number;
    timeoutMs?: number;
    maxArgumentBytes?: number;
    maxResultBytes?: number;
    audit?(event: Readonly<ToolAudit>): void;
}
export interface ToolPlan {
    usage: {
        totalTokens: number;
    };
    text?: string;
    calls?: readonly {
        name: string;
        arguments: unknown;
    }[];
}
/** Optional explicit host adapter, not implied by string provider capabilities. */
export interface ToolPlanner {
    plan(input: {
        principal: Readonly<ToolPrincipal>;
        tools: readonly {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
        }[];
        results: readonly ToolOutcome[];
        remainingTokens: number;
        signal: AbortSignal;
    }): Promise<ToolPlan>;
}
function budget(value: number, maximum: number) { if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError('Invalid tool budget'); return value; }
function label(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
    throw new TypeError('Invalid tool identity'); }
export function createToolExecutor(options: ToolExecutorOptions) {
    if (!options || typeof options.authenticate !== 'function' || options.audit !== undefined && typeof options.audit !== 'function')
        throw new TypeError('Tool authentication required');
    const maxTools = budget(options.maxTools ?? 64, 256), maxSessions = budget(options.maxSessions ?? 32, 256), maxConcurrent = budget(options.maxConcurrent ?? 8, 128), timeout = budget(options.timeoutMs ?? 5000, 60000), maxArgs = budget(options.maxArgumentBytes ?? 65536, 1048576), maxResult = budget(options.maxResultBytes ?? 65536, 1048576);
    const tools = new Map<string, ToolDefinition<any>>(), sessions = new Set<{
        close(): Promise<void>;
    }>(), lifetime = new AbortController(), allWork = new Set<Promise<unknown>>();
    let closed = false, authenticating = 0;
    const audit = (event: ToolAudit) => { try {
        const result: unknown = options.audit?.(Object.freeze(event));
        if (result && typeof (result as PromiseLike<unknown>).then === 'function')
            void Promise.resolve(result).catch(() => { });
    }
    catch { /* Best-effort diagnostics; durable authorization journals belong to host. */ } };
    function prepare(name: string, definition: ToolDefinition<any>) { label(name); if (!definition || typeof definition.description !== 'string' || definition.description.length > 1024 || typeof definition.sideEffect !== 'boolean' || definition.privileged !== undefined && typeof definition.privileged !== 'boolean' || typeof definition.authorize !== 'function' || typeof definition.execute !== 'function' || definition.privileged && typeof definition.reauthorize !== 'function' || definition.schema?.['~standard']?.version !== 1 || typeof definition.schema['~standard'].validate !== 'function')
        throw new TypeError('Invalid tool definition'); const inputSchema = snapshotToolJson(definition.inputSchema, 65536); if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema) || (inputSchema as any).type !== 'object')
        throw new TypeError('Object tool schema required'); return Object.freeze({ ...definition, inputSchema: inputSchema as Record<string, unknown> }); }
    return {
        register<T>(name: string, definition: ToolDefinition<T>) { if (closed || tools.size >= maxTools || tools.has(name))
            throw new Error('Tool registry unavailable/duplicate'); const entry = prepare(name, definition); tools.set(name, entry); return Object.freeze({ dispose() { if (tools.get(name) === entry)
                tools.delete(name); } }); },
        async session(hostContext: unknown, signal?: AbortSignal) {
            if(signal!==undefined&&!(signal instanceof AbortSignal))throw new TypeError('Invalid tool signal');
            if (closed || sessions.size + authenticating >= maxSessions || allWork.size >= maxConcurrent)
                throw new Error('Tool session capacity exceeded');
            signal?.throwIfAborted();
            authenticating++;
            const controller = new AbortController(), abort = () => controller.abort();
            lifetime.signal.addEventListener('abort', abort, { once: true });
            signal?.addEventListener('abort', abort, { once: true });
            const authTimer = setTimeout(abort, timeout);
            let principal: Readonly<ToolPrincipal>;
            const authentication = Promise.resolve().then(() => options.authenticate(hostContext, controller.signal));
            allWork.add(authentication);
            try {
                const value = await authentication;
                controller.signal.throwIfAborted();
                if (!value)
                    throw new Error('Tool session denied');
                label(value.tenant);
                label(value.subject);
                principal = Object.freeze({ tenant: value.tenant, subject: value.subject });
            }
            catch {
                lifetime.signal.removeEventListener('abort', abort);
                signal?.removeEventListener('abort', abort);
                throw new Error('Tool session denied');
            }
            finally {
                clearTimeout(authTimer);
                authenticating--;
                allWork.delete(authentication);
            }
            const work = new Set<Promise<unknown>>();
            let stopped = false;
            const session = {
                async execute(name: string, args: unknown, callSignal?: AbortSignal): Promise<ToolOutcome> {
                    if(callSignal!==undefined&&!(callSignal instanceof AbortSignal))throw new TypeError('Invalid tool signal');
                    const executionId = randomUUID(), entry = tools.get(name), out = (state: ToolState, value?: unknown): ToolOutcome => Object.freeze({ executionId, state, ...(state === 'succeeded' ? { value } : {}) });
                    if (stopped || controller.signal.aborted || callSignal?.aborted)
                        return out('cancelled');
                    if (!entry)
                        return out('unknown-tool');
                    if (allWork.size >= maxConcurrent)
                        return out('overloaded');
                    const call = new AbortController(), cancel = () => call.abort();
                    controller.signal.addEventListener('abort', cancel, { once: true });
                    callSignal?.addEventListener('abort', cancel, { once: true });
                    const deadline = Date.now() + timeout, context = Object.freeze({ principal, executionId, signal: call.signal, deadline });
                    let entered = false, terminal = false;
                    const check=()=>{if(Date.now()>=deadline)call.abort();call.signal.throwIfAborted();};
                    let stop!: (value: ToolOutcome) => void;
                    const interrupted = new Promise<ToolOutcome>(resolve => stop = resolve), onAbort = () => stop(out(entered && entry.sideEffect ? 'uncertain' : 'cancelled'));
                    call.signal.addEventListener('abort', onAbort, { once: true });
                    const timer = setTimeout(cancel, timeout);
                    const job = (async () => { try {
                        let input: unknown;
                        try {
                            input = snapshotToolJson(args, maxArgs);
                            if (!input || typeof input !== 'object' || Array.isArray(input))
                                return out('invalid');
                            const parsed = await entry.schema['~standard'].validate(input);
                            if (parsed.issues || !Object.hasOwn(parsed, 'value'))
                                return out('invalid');
                            input = snapshotToolJson(parsed.value, maxArgs);
                        }
                        catch {
                            return out(call.signal.aborted ? 'cancelled' : 'invalid');
                        }
                        check();
                        if (await entry.authorize(context, input) !== true)
                            return out('denied');
                        check();
                        if (entry.privileged && await entry.reauthorize!(context, input) !== true)
                            return out('denied');
                        check();
                        audit({ executionId, tool: name, phase: 'started' });
                        check();
                        entered = true;
                        const value = await entry.execute(input, context);
                        check();
                        return out('succeeded', snapshotToolJson(value, maxResult));
                    }
                    catch {
                        return out(entered && entry.sideEffect ? 'uncertain' : call.signal.aborted ? 'cancelled' : 'failed');
                    } })();
                    work.add(job);
                    allWork.add(job);
                    void job.finally(() => { clearTimeout(timer); call.signal.removeEventListener('abort', onAbort); controller.signal.removeEventListener('abort', cancel); callSignal?.removeEventListener('abort', cancel); work.delete(job); allWork.delete(job); if (terminal)
                        audit({ executionId, tool: name, phase: 'settled', state: call.signal.aborted && entered && entry.sideEffect ? 'uncertain' : undefined }); }).catch(() => { });
                    const result = await Promise.race([job, interrupted]);
                    terminal = true;
                    audit({ executionId, tool: name, phase: 'terminal', state: result.state });
                    return result;
                },
                async run(planner: ToolPlanner, limits: {
                    maxSteps?: number;
                    maxCalls?: number;
                    maxTokens?: number;
                } = {}) {
                    const steps = budget(limits.maxSteps ?? 4, 16), calls = budget(limits.maxCalls ?? 8, 64), tokens = budget(limits.maxTokens ?? 4096, 1000000);
                    let remaining = tokens, used = 0;
                    const results: ToolOutcome[] = [];
                    if (!planner || typeof planner.plan !== 'function')
                        throw new TypeError('Explicit tool planner required');
                    try {
                        for (let step = 0; step < steps; step++) {
                            if (stopped || controller.signal.aborted)
                                throw new Error('Tool loop cancelled');
                            if (allWork.size >= maxConcurrent)
                                throw new Error('Tool loop capacity exceeded');
                            const planController = new AbortController(), cancel = () => planController.abort();
                            controller.signal.addEventListener('abort', cancel, { once: true });
                            const timer = setTimeout(cancel, timeout);
                            const job = Promise.resolve().then(() => planner.plan({ principal, tools: [...tools].map(([name, t]) => ({ name, description: t.description, inputSchema: snapshotToolJson(t.inputSchema, 65536) as Record<string, unknown> })), results: snapshotToolJson(results, maxResult) as ToolOutcome[], remainingTokens: remaining, signal: planController.signal }));
                            work.add(job);
                            allWork.add(job);
                            void job.finally(()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);work.delete(job);allWork.delete(job);}).catch(()=>{});
                            const plan= snapshotToolJson(await new Promise<ToolPlan>((resolve,reject)=>{
                                const abort=()=>reject(new Error('Tool planner budget cancelled'));
                                planController.signal.addEventListener('abort',abort,{once:true});
                                if(planController.signal.aborted)abort();
                                job.then(resolve,reject).finally(()=>planController.signal.removeEventListener('abort',abort)).catch(()=>{});
                            }),maxResult) as ToolPlan;
                            planController.signal.throwIfAborted();
                            if (!plan || !Number.isSafeInteger(plan.usage?.totalTokens) || plan.usage.totalTokens < 0 || plan.usage.totalTokens > remaining)
                                throw new Error('Tool token budget exceeded');
                            remaining -= plan.usage.totalTokens;
                            if (plan.text !== undefined) {
                                if (typeof plan.text !== 'string')
                                    throw new Error('Invalid tool plan');
                                snapshotToolJson(plan.text, maxResult);
                            }
                            if (!plan.calls?.length) {
                                if (!plan.text)
                                    throw new Error('Invalid tool plan');
                                return { text: plan.text, results, usedTokens: tokens - remaining };
                            }
                            if (!Array.isArray(plan.calls) || plan.calls.length > calls - used || remaining === 0)
                                throw new Error('Tool call budget exceeded');
                            for (const request of plan.calls) {
                                used++;
                                const result = await session.execute(request.name, request.arguments);
                                results.push(result);
                                if (result.state !== 'succeeded')
                                    return { text: '', results, usedTokens: tokens - remaining };
                            }
                        }
                        throw new Error('Tool step budget exceeded');
                    }
                    catch (error) {
                        throw new ToolLoopError(controller.signal.aborted ? 'cancelled' : error instanceof Error && /budget/.test(error.message) ? 'budget' : 'failed', results);
                    }
                },
                async close() { stopped = true; controller.abort(); await Promise.allSettled([...work]); sessions.delete(session); lifetime.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort); }
            };
            sessions.add(session);
            return session;
        },
        status() { return { tools: tools.size, sessions: sessions.size, pending: allWork.size }; },
        async close() { closed = true; lifetime.abort(); await Promise.allSettled([...sessions].map(s => s.close())); await Promise.allSettled([...allWork]); tools.clear(); }
    };
}
export { createZhostToolHandler } from './tool-transports.js';
export type { ZhostToolClientOptions } from './tool-transports.js';
export { approvedOpenApiToolOperations } from './tool-openapi.js';
export type { ApprovedToolOperation } from './tool-openapi.js';
