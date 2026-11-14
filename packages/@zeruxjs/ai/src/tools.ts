import { snapshotAiJson as snapshotToolJson } from './safe-json.js';
export { snapshotAiJson as snapshotToolJson } from './safe-json.js';
/** Server-owned tools. Validation never grants authorization. */
import { randomUUID } from 'node:crypto';
/** Opaque host-verified initiating identity; tool arguments never supply these permissions. */
export interface ToolPrincipal {
  /** Opaque host-verified tenant identifier; never copied from model arguments. */
  tenant: string;
  /** Opaque host-verified initiating subject identifier, not an email inferred by the tool. */
  subject: string;
}
/** Frozen execution identity and cooperative deadline, supplied by the executor to trusted handlers. */
export interface ToolContext {
  /** Frozen authenticated initiating tenant/subject; handlers must use it for service authorization. */
  readonly principal: Readonly<ToolPrincipal>;
  /** One host-generated UUID shared across context, outcome and audit for reconciliation. */
  readonly executionId: string;
  /** Cooperative cancellation only; a timeout cannot force arbitrary JavaScript to stop. */
  readonly signal: AbortSignal;
  /** Absolute epoch-millisecond deadline; host handlers should honor it before committing work. */
  readonly deadline: number;
}
/** Trusted Standard Schema V1 validator; validation/transforms must be pure and bounded. */
export interface ToolSchema<T = unknown> {
  /** Borrowed trusted Standard Schema validation protocol, separate from authorization. */
  readonly '~standard': {
    /** Only Standard Schema protocol version 1 is accepted. */
    readonly version: 1;
    /**
     * Validate inert arguments; schema checks never grant execution authorization.
     * @param {unknown} value - Candidate value; validation failures do not echo private content.
     * @returns {object | PromiseLike<object>} Parsed value or private issues; validation never grants permission.
     */
    validate(value: unknown):
      | {
          /** Parsed/transformed inert data; returned only after successful independent validation. */
          value?: T;
          /** Private validation issues; they are never copied into tool outcomes or audit. */
          issues?: readonly unknown[];
        }
      | PromiseLike<{
          /** Parsed/transformed inert data; returned only after successful independent validation. */
          value?: T;
          /** Private validation issues; they are never copied into tool outcomes or audit. */
          issues?: readonly unknown[];
        }>;
  };
}
/** Explicit trusted registered code with separate schema, authorization and execution contracts. */
export interface ToolDefinition<T = unknown> {
  /** Bounded public inert description, maximum 1024 characters; exclude secrets. */
  description: string;
  /** Bounded model-facing object schema; it does not authorize execution. */
  inputSchema: Record<string, unknown>;
  /** Trusted pure runtime argument validator; transformed values are snapshotted again. */
  schema: ToolSchema<T>;
  /** Truthful declaration determines uncertain outcomes once the handler has entered. */
  sideEffect: boolean;
  /** When true, a separate fresh reauthorization callback is required immediately before execution. */
  privileged?: boolean;
  /**
   * Check current permission for validated arguments using the initiating verified principal.
   * @param {ToolContext} context - Verified initiating principal, execution identity, cancellation and deadline.
   * @param {T} args - Untrusted inert arguments; cannot override the verified initiating principal.
   * @returns {boolean | Promise<boolean>} Only literal true permits handler entry.
   */
  authorize(context: ToolContext, args: T): boolean | Promise<boolean>;
  /**
   * Require fresh privileged authorization immediately before side-effect entry.
   * @param {ToolContext} context - Verified initiating principal, execution identity, cancellation and deadline.
   * @param {T} args - Untrusted inert arguments; cannot override the verified initiating principal.
   * @returns {boolean | Promise<boolean>} Only literal true permits privileged entry after fresh host checks.
   */
  reauthorize?(context: ToolContext, args: T): boolean | Promise<boolean>;
  /**
   * Validate, authorize and execute a captured trusted handler with one stable attempt ID.
   * @param {T} args - Untrusted inert arguments; cannot override the verified initiating principal.
   * @param {ToolContext} context - Verified initiating principal, execution identity, cancellation and deadline.
   * @returns {unknown | Promise<unknown>} Fixed-state receipt; side-effect failure after entry remains uncertain.
   * @throws {TypeError} On invalid policy/input or the documented fixed failure/budget state.
   */
  execute(args: T, context: ToolContext): unknown | Promise<unknown>;
}
/** Honest terminal state; uncertain side effects require host reconciliation rather than replay. */
export type ToolState =
  | 'succeeded'
  | 'denied'
  | 'invalid'
  | 'unknown-tool'
  | 'overloaded'
  | 'cancelled'
  | 'failed'
  | 'uncertain';
/** Fixed execution receipt; only succeeded outcomes carry a bounded private value. */
export interface ToolOutcome {
  /** One host-generated UUID shared across context, outcome and audit for reconciliation. */
  readonly executionId: string;
  /** Explicit terminal delivery state; uncertain never means rollback or safe automatic retry. */
  readonly state: ToolState;
  /** Parsed/transformed inert data; returned only after successful independent validation. */
  readonly value?: unknown;
}
/** Redacted loop failure preserves reconciliation IDs/states, never prior private values. */
export class ToolLoopError extends Error {
  readonly executions: readonly {
    /** One host-generated UUID shared across context, outcome and audit for reconciliation. */
    executionId: string;
    /** Explicit terminal delivery state; uncertain never means rollback or safe automatic retry. */
    state: ToolState;
  }[];
  /**
   * Retain redacted execution ID/state receipts when a bounded planning loop fails.
   * @param {'budget' | 'cancelled' | 'failed'} code - Fixed public failure category, never raw transport error text.
   * @param {readonly ToolOutcome[]} results - Prior receipts; error objects retain only IDs/states, not private result bodies.
   */
  constructor(
    readonly code: 'budget' | 'cancelled' | 'failed',
    results: readonly ToolOutcome[]
  ) {
    super('Tool loop ' + code);
    this.name = 'ToolLoopError';
    this.executions = Object.freeze(
      results.map((r) =>
        Object.freeze({ executionId: r.executionId, state: r.state })
      )
    );
  }
}
/** Best-effort fixed-field observation, not a durable authorization/commit journal. */
export interface ToolAudit {
  /** One host-generated UUID shared across context, outcome and audit for reconciliation. */
  executionId: string;
  /** Registered public tool name only; no arguments, URLs or tenant traits enter audit. */
  tool: string;
  /** Started, caller-terminal or late-settled observation; not a durable commit journal. */
  phase: 'started' | 'terminal' | 'settled';
  /** Explicit terminal delivery state; uncertain never means rollback or safe automatic retry. */
  state?: ToolState;
}
/** Application-owned callbacks and budgets; no operation begins just by importing this module. */
export interface ToolExecutorOptions {
  /**
   * Verify initiating host context under the supplied cooperative cancellation signal.
   * @param {unknown} context - Verified initiating principal, execution identity, cancellation and deadline.
   * @param {AbortSignal} signal - Optional initiating cancellation propagated to owned work.
   * @returns {Promise<ToolPrincipal | null>} Verified opaque principal or null denial; host owns its authentication store.
   */
  authenticate(
    context: unknown,
    signal: AbortSignal
  ): Promise<ToolPrincipal | null>;
  /** Registered trusted-handler capacity, default 64, maximum 256. */
  maxTools?: number;
  /** Session plus pending-authentication capacity, default 32, maximum 256. */
  maxSessions?: number;
  /** Maximum unsettled jobs across sessions, default 8, maximum 128; no queue. */
  maxConcurrent?: number;
  /** Cooperative stage deadline in milliseconds, default 5000, maximum 60000. */
  timeoutMs?: number;
  /** Raw/transformed JSON argument ceiling, default 65536, maximum 1048576. */
  maxArgumentBytes?: number;
  /** Result/planner-history JSON ceiling, default 65536, maximum 1048576. */
  maxResultBytes?: number;
  /**
   * Emit best-effort fixed-field observation without leaking arguments or result bodies.
   * @param {Readonly<ToolAudit>} event - Fixed-label audit event without prompts, URLs, credentials or arguments.
   * @returns {void} No value; observer failures are isolated and never become authorization.
   */
  audit?(event: Readonly<ToolAudit>): void;
}
/** Inert bounded planning response; requested calls still pass executor authorization independently. */
export interface ToolPlan {
  /** Planner-reported usage; the host must enforce upstream model limits truthfully. */
  usage: {
    /** Reported total prompt/output tokens for this planning step; overruns stop further work. */
    totalTokens: number;
  };
  /** Optional final inert text, never executable source or automatically rendered HTML. */
  text?: string;
  /** Optional bounded ordered call list; every call is reauthorized by the executor. */
  calls?: readonly {
    /** Explicit registered name; unknown names never trigger imports or remote discovery. */
    name: string;
    /** Untrusted inert arguments; cannot replace the initiating principal. */
    arguments: unknown;
  }[];
}
/** Optional explicit host adapter, not implied by string provider capabilities. */
export interface ToolPlanner {
  /**
   * Plan within remaining usage limits using authorized tools and bounded prior outcomes.
   * @param {object} input - Authorized planning context; every requested call is separately checked.
   * @param {Readonly<ToolPrincipal>} input.principal - Verified initiating tenant/subject.
   * @param {readonly object[]} input.tools - Detached public names/descriptions/schemas.
   * @param {readonly ToolOutcome[]} input.results - Bounded prior outcomes for this session only.
   * @param {number} input.remainingTokens - Host must cap upstream work to this remaining allowance.
   * @param {AbortSignal} input.signal - Cooperative planning cancellation.
   * @returns {Promise<ToolPlan>} Bounded plan with truthful reported usage; its calls still require authorization.
   */
  plan(input: {
    /** Frozen authenticated initiating tenant/subject; handlers must use it for service authorization. */
    principal: Readonly<ToolPrincipal>;
    /** Detached public schema/description descriptors for currently registered trusted handlers. */
    tools: readonly {
      /** Explicit registered name; unknown names never trigger imports or remote discovery. */
      name: string;
      /** Bounded public inert description, maximum 1024 characters; exclude secrets. */
      description: string;
      /** Bounded model-facing object schema; it does not authorize execution. */
      inputSchema: Record<string, unknown>;
    }[];
    /** Detached prior outcomes; private successful results remain scoped to this planner call. */
    results: readonly ToolOutcome[];
    /** Remaining declared planning budget; the host must cap upstream generation before dispatch. */
    remainingTokens: number;
    /** Cooperative cancellation only; a timeout cannot force arbitrary JavaScript to stop. */
    signal: AbortSignal;
  }): Promise<ToolPlan>;
}
/**
 * Validate a positive bounded integer before admitting tool work.
 * @param {number} value - Candidate value; validation failures do not echo private content.
 * @param {number} maximum - Inclusive configured budget ceiling.
 * @returns {number} Validated positive budget, unchanged; invalid values throw TypeError.
 */
function budget(value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError('Invalid tool budget');
  }
  return value;
}
/**
 * Assert a safe opaque identity label without inferring identity from model input.
 * @param {unknown} value - Candidate value; validation failures do not echo private content.
 * @returns {asserts value is string} No value; invalid labels throw TypeError.
 */
function label(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  ) {
    throw new TypeError('Invalid tool identity');
  }
}
/**
 * Own explicitly registered trusted tools and authenticated initiating sessions.
 * @param {ToolExecutorOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
 * @returns {object} Explicit registry/session owner with close/drain and fixed-label status.
 * @throws {TypeError} On invalid policy/input or the documented fixed failure/budget state.
 */
export function createToolExecutor(options: ToolExecutorOptions) {
  if (
    !options ||
    typeof options.authenticate !== 'function' ||
    (options.audit !== undefined && typeof options.audit !== 'function')
  ) {
    throw new TypeError('Tool authentication required');
  }
  /** Registered trusted-handler ceiling; no disk discovery or generated imports exist. */
  const maxTools = budget(options.maxTools ?? 64, 256);
  /** Authenticated-session ceiling includes authentication still in progress. */
  const maxSessions = budget(options.maxSessions ?? 32, 256);
  /** Global unsettled authentication/handler/planner ceiling; there is no hidden queue. */
  const maxConcurrent = budget(options.maxConcurrent ?? 8, 128);
  /** Cooperative per-stage deadline in milliseconds; arbitrary JavaScript is not force-stopped. */
  const timeout = budget(options.timeoutMs ?? 5000, 60000);
  /** Inert argument snapshot ceiling, checked before and after schema transformation. */
  const maxArgs = budget(options.maxArgumentBytes ?? 65536, 1048576);
  /** Result/planner-history snapshot ceiling; oversized side-effect results remain uncertain. */
  const maxResult = budget(options.maxResultBytes ?? 65536, 1048576);
  /** Application-local explicit handler table; selected entries are captured by admitted calls. */
  const tools = new Map<string, ToolDefinition<any>>();
  /** Owned authenticated sessions; shutdown closes each before draining remaining native work. */
  const sessions = new Set<{
    /**
     * Stop admission, abort owned work and await actual settlement before releasing listeners.
     * @returns {Promise<void>} Resolves after owned work settles; borrowed providers/transports stay host-owned.
     */
    close(): Promise<void>;
  }>();
  /** Executor-wide cancellation signal shared by owned sessions, not global application state. */
  const lifetime = new AbortController();
  /** Tracks actual native settlement across authentication, execution and planner calls. */
  const allWork = new Set<Promise<unknown>>();
  let closed = false,
    authenticating = 0;
  /**
   * Emit best-effort fixed-field observation without leaking arguments or result bodies.
   * @param {ToolAudit} event - Fixed-label audit event without prompts, URLs, credentials or arguments.
   * @returns {void} No value; observer failures are isolated and never become authorization.
   */
  const audit = (event: ToolAudit) => {
    try {
      /** Terminal result/receipt retained without treating timeout as proof of rollback. */
      const result: unknown = options.audit?.(Object.freeze(event));
      if (
        result &&
        typeof (result as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(result).catch(() => {});
      }
    } catch {
      /* Best-effort diagnostics; durable authorization journals belong to host. */
    }
  };
  /**
   * Validate a trusted handler contract and detach its public schema before registration.
   * @param {string} name - Explicit registered name, not a package/URL or model-provided identity.
   * @param {ToolDefinition<any>} definition - Trusted handler and schema callbacks; registration is not a sandbox.
   * @returns {Readonly<ToolDefinition<any>>} Frozen handler envelope with a detached bounded public schema.
   */
  function prepare(name: string, definition: ToolDefinition<any>) {
    label(name);
    if (
      !definition ||
      typeof definition.description !== 'string' ||
      definition.description.length > 1024 ||
      typeof definition.sideEffect !== 'boolean' ||
      (definition.privileged !== undefined &&
        typeof definition.privileged !== 'boolean') ||
      typeof definition.authorize !== 'function' ||
      typeof definition.execute !== 'function' ||
      (definition.privileged && typeof definition.reauthorize !== 'function') ||
      definition.schema?.['~standard']?.version !== 1 ||
      typeof definition.schema['~standard'].validate !== 'function'
    ) {
      throw new TypeError('Invalid tool definition');
    }
    /** Detached bounded model-facing object schema; authorization and runtime validation are separate. */
    const inputSchema = snapshotToolJson(definition.inputSchema, 65536);
    if (
      !inputSchema ||
      typeof inputSchema !== 'object' ||
      Array.isArray(inputSchema) ||
      (inputSchema as any).type !== 'object'
    ) {
      throw new TypeError('Object tool schema required');
    }
    return Object.freeze({
      ...definition,
      inputSchema: inputSchema as Record<string, unknown>,
    });
  }
  return {
    /**
     * Register one trusted tool under an exclusive name and return an identity-fenced lease.
     * @template T
     * @param {string} name - Explicit registered name, not a package/URL or model-provided identity.
     * @param {ToolDefinition<T>} definition - Trusted handler and schema callbacks; registration is not a sandbox.
     * @returns {object} Idempotent identity-fenced disposal lease; existing invocations keep captured handlers.
     * @throws {Error | TypeError} On invalid policy/input or the documented fixed failure/budget state.
     */
    register<T>(name: string, definition: ToolDefinition<T>) {
      if (closed || tools.size >= maxTools || tools.has(name)) {
        throw new Error('Tool registry unavailable/duplicate');
      }
      /** Captured registration identity; disposing its lease cannot remove a later replacement. */
      const entry = prepare(name, definition);
      tools.set(name, entry);
      return Object.freeze({
        /**
         * Remove only this captured registration; already admitted handlers keep their entry.
         * @returns {void} No value; removes only this still-current registration.
         */
        dispose() {
          if (tools.get(name) === entry) {
            tools.delete(name);
          }
        },
      });
    },
    /**
     * Authenticate and freeze a host principal before exposing any tool invocation.
     * @param {unknown} hostContext - Host-supplied authentication context; never trusted solely from model arguments.
     * @param {AbortSignal | undefined} signal - Optional initiating cancellation propagated to owned work.
     * @returns {Promise<object>} Principal-bound execution/planning owner, or rejection without private identity details.
     * @throws {Error | TypeError} On invalid policy/input or the documented fixed failure/budget state.
     */
    async session(hostContext: unknown, signal?: AbortSignal) {
      if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw new TypeError('Invalid tool signal');
      }
      if (
        closed ||
        sessions.size + authenticating >= maxSessions ||
        allWork.size >= maxConcurrent
      ) {
        throw new Error('Tool session capacity exceeded');
      }
      signal?.throwIfAborted();
      authenticating++;
      /**
       * Request cancellation for this owner without force-stopping host JavaScript.
       * @returns {void} Completes without returning private input; validation/cancellation failures remain observable.
       */
      /** Session cancellation owner joins executor shutdown and optional initiating cancellation. */
      const controller = new AbortController();
      /**
       * Request cancellation for this owner without force-stopping host JavaScript.
       * @returns {void} No value; only requests cancellation and never forces native settlement.
       */
      const abort = () => controller.abort();
      lifetime.signal.addEventListener('abort', abort, { once: true });
      signal?.addEventListener('abort', abort, { once: true });
      /** Authentication deadline owns only its cancellation request, not forced callback termination. */
      const authTimer = setTimeout(abort, timeout);
      let principal: Readonly<ToolPrincipal>;
      /** Authentication promise retains an unsettled slot until the host callback really completes. */
      const authentication = Promise.resolve().then(() =>
        options.authenticate(hostContext, controller.signal)
      );
      allWork.add(authentication);
      try {
        /** Host-returned value is validated/snapshotted before it can cross the tool boundary. */
        const value = await authentication;
        controller.signal.throwIfAborted();
        if (!value) {
          throw new Error('Tool session denied');
        }
        label(value.tenant);
        label(value.subject);
        principal = Object.freeze({
          tenant: value.tenant,
          subject: value.subject,
        });
      } catch {
        lifetime.signal.removeEventListener('abort', abort);
        signal?.removeEventListener('abort', abort);
        throw new Error('Tool session denied');
      } finally {
        clearTimeout(authTimer);
        authenticating--;
        allWork.delete(authentication);
      }
      /** Session-local native settlement set; close waits even when caller outcomes returned earlier. */
      const work = new Set<Promise<unknown>>();
      let stopped = false;
      /** Owned principal-bound execution interface; model arguments cannot change its frozen principal. */
      const session = {
        /**
         * Validate, authorize and execute a captured trusted handler with one stable attempt ID.
         * @param {string} name - Explicit registered name, not a package/URL or model-provided identity.
         * @param {unknown} args - Untrusted inert arguments; cannot override the verified initiating principal.
         * @param {AbortSignal | undefined} callSignal - Optional cancellation for this single attempt.
         * @returns {Promise<ToolOutcome>} Fixed-state receipt; side-effect failure after entry remains uncertain.
         * @throws {TypeError} On invalid policy/input or the documented fixed failure/budget state.
         */
        async execute(
          name: string,
          args: unknown,
          callSignal?: AbortSignal
        ): Promise<ToolOutcome> {
          if (
            callSignal !== undefined &&
            !(callSignal instanceof AbortSignal)
          ) {
            throw new TypeError('Invalid tool signal');
          }
          /**
           * Build a fixed-state receipt, exposing a value only after successful validation.
           * @param {ToolState} state - Explicit terminal state, with uncertain preserving possible side-effect commit.
           * @param {unknown | undefined} value - Candidate value; validation failures do not echo private content.
           * @returns {ToolOutcome} Result stays within the declared ownership and validation contract.
           */
          /** Fresh host-generated UUID shared by context, outcome and redacted audit phases. */
          const executionId = randomUUID();
          /** Captured registration identity; disposing its lease cannot remove a later replacement. */
          const entry = tools.get(name);
          /**
           * Build a fixed-state receipt, exposing a value only after successful validation.
           * @param {ToolState} state - Explicit terminal state, with uncertain preserving possible side-effect commit.
           * @param {unknown | undefined} value - Candidate value; validation failures do not echo private content.
           * @returns {ToolOutcome} Frozen execution receipt; only succeeded outcomes contain a private value.
           */
          const out = (state: ToolState, value?: unknown): ToolOutcome =>
            Object.freeze({
              executionId,
              state,
              ...(state === 'succeeded' ? { value } : {}),
            });
          if (stopped || controller.signal.aborted || callSignal?.aborted) {
            return out('cancelled');
          }
          if (!entry) {
            return out('unknown-tool');
          }
          if (allWork.size >= maxConcurrent) {
            return out('overloaded');
          }
          /**
           * Forward parent/deadline cancellation while preserving execution identity.
           * @returns {void} Completes without returning private input; validation/cancellation failures remain observable.
           */
          /** Per-invocation cancellation owner, separate from the resumable identity of any side effect. */
          const call = new AbortController();
          /**
           * Forward parent/deadline cancellation while preserving execution identity.
           * @returns {void} No value; requests cancellation without changing execution identity.
           */
          const cancel = () => call.abort();
          controller.signal.addEventListener('abort', cancel, { once: true });
          callSignal?.addEventListener('abort', cancel, { once: true });
          /** Absolute cooperative execution deadline, exposed to trusted host handlers. */
          const deadline = Date.now() + timeout;
          /** Frozen verified principal and execution identity; no caller-supplied tenant is trusted. */
          const context = Object.freeze({
            principal,
            executionId,
            signal: call.signal,
            deadline,
          });
          let entered = false,
            terminal = false;
          /**
           * Fence privileged entry and post-handler processing against elapsed deadline/cancellation.
           * @returns {void} No value; abort/deadline failures stop further work.
           */
          const check = () => {
            if (Date.now() >= deadline) {
              call.abort();
            }
            call.signal.throwIfAborted();
          };
          let stop!: (value: ToolOutcome) => void;
          /**
           * Return uncertain after side-effect entry; cancellation never proves rollback.
           * @returns {void} Completes without returning private input; validation/cancellation failures remain observable.
           */
          /** Caller cancellation race does not remove the still-running native handler from ownership. */
          const interrupted = new Promise<ToolOutcome>(
            (resolve) => (stop = resolve)
          );
          /**
           * Return uncertain after side-effect entry; cancellation never proves rollback.
           * @returns {void} No value; resolves the caller-facing cancellation/uncertain race.
           */
          const onAbort = () =>
            stop(out(entered && entry.sideEffect ? 'uncertain' : 'cancelled'));
          call.signal.addEventListener('abort', onAbort, { once: true });
          /** Owned cancellation timer remains until native work settles; signals cannot stop arbitrary code. */
          const timer = setTimeout(cancel, timeout);
          /** Actual handler/planner promise is tracked separately from the caller-facing timeout outcome. */
          const job = (async () => {
            try {
              let input: unknown;
              try {
                input = snapshotToolJson(args, maxArgs);
                if (
                  !input ||
                  typeof input !== 'object' ||
                  Array.isArray(input)
                ) {
                  return out('invalid');
                }
                /** Host schema result; transformed values must pass another inert bounded snapshot. */
                const parsed = await entry.schema['~standard'].validate(input);
                if (parsed.issues || !Object.hasOwn(parsed, 'value')) {
                  return out('invalid');
                }
                input = snapshotToolJson(parsed.value, maxArgs);
              } catch {
                return out(call.signal.aborted ? 'cancelled' : 'invalid');
              }
              check();
              if ((await entry.authorize(context, input)) !== true) {
                return out('denied');
              }
              check();
              if (
                entry.privileged &&
                (await entry.reauthorize!(context, input)) !== true
              ) {
                return out('denied');
              }
              check();
              audit({ executionId, tool: name, phase: 'started' });
              check();
              entered = true;
              /** Host-returned value is validated/snapshotted before it can cross the tool boundary. */
              const value = await entry.execute(input, context);
              check();
              return out('succeeded', snapshotToolJson(value, maxResult));
            } catch {
              // Once a side-effect handler entered, even result/cleanup failure can hide a commit.
              if (entered && entry.sideEffect) {
                return out('uncertain');
              }
              if (call.signal.aborted) {
                return out('cancelled');
              }
              return out('failed');
            }
          })();
          work.add(job);
          allWork.add(job);
          void job
            .finally(() => {
              clearTimeout(timer);
              call.signal.removeEventListener('abort', onAbort);
              controller.signal.removeEventListener('abort', cancel);
              callSignal?.removeEventListener('abort', cancel);
              work.delete(job);
              allWork.delete(job);
              if (terminal) {
                audit({
                  executionId,
                  tool: name,
                  phase: 'settled',
                  state:
                    call.signal.aborted && entered && entry.sideEffect
                      ? 'uncertain'
                      : undefined,
                });
              }
            })
            .catch(() => {});
          /** Terminal result/receipt retained without treating timeout as proof of rollback. */
          const result = await Promise.race([job, interrupted]);
          terminal = true;
          audit({
            executionId,
            tool: name,
            phase: 'terminal',
            state: result.state,
          });
          return result;
        },
        /**
         * Run a bounded sequential planning loop without automatically replaying failed side effects.
         * @param {ToolPlanner} planner - Explicit trusted planning adapter; must truthfully enforce upstream token limits.
         * @param {object} limits - Finite step/call/token ceilings; no automatic retries or side-effect replay.
         * @param {number} [limits.maxSteps=4] - Total iterations, maximum 16.
         * @param {number} [limits.maxCalls=8] - Calls across iterations, maximum 64.
         * @param {number} [limits.maxTokens=4096] - Reported planner tokens, maximum 1000000.
         * @returns {Promise<object>} Final inert text, bounded outcomes and reported token usage, or redacted ToolLoopError.
         * @throws {ToolLoopError | TypeError} On invalid policy/input or the documented fixed failure/budget state.
         */
        async run(
          planner: ToolPlanner,
          limits: {
            /** Finite planning iterations, default 4, maximum 16. */
            maxSteps?: number;
            /** Total tool calls across steps, default 8, maximum 64. */
            maxCalls?: number;
            /** Reported planner token budget, default 4096, maximum 1000000. */
            maxTokens?: number;
          } = {}
        ) {
          /** Finite planner iterations; exhaustion returns reconciliation receipts without replay. */
          const steps = budget(limits.maxSteps ?? 4, 16);
          /** Finite total tool-call count across all planner steps, not a per-step allowance. */
          const calls = budget(limits.maxCalls ?? 8, 64);
          /** Reported planner-token ceiling; the host must enforce the upstream model cap truthfully. */
          const tokens = budget(limits.maxTokens ?? 4096, 1000000);
          let remaining = tokens,
            used = 0;
          /** Bounded accumulated outcomes passed as inert snapshots to the trusted planner. */
          const results: ToolOutcome[] = [];
          if (!planner || typeof planner.plan !== 'function') {
            throw new TypeError('Explicit tool planner required');
          }
          try {
            for (let step = 0; step < steps; step++) {
              if (stopped || controller.signal.aborted) {
                throw new Error('Tool loop cancelled');
              }
              if (allWork.size >= maxConcurrent) {
                throw new Error('Tool loop capacity exceeded');
              }
              /**
               * Forward parent/deadline cancellation while preserving execution identity.
               * @returns {void} Completes without returning private input; validation/cancellation failures remain observable.
               */
              /** One planner-call cancellation owner; it never changes session assignment or permissions. */
              const planController = new AbortController();
              /**
               * Forward parent/deadline cancellation while preserving execution identity.
               * @returns {void} No value; requests cancellation without changing execution identity.
               */
              const cancel = () => planController.abort();
              controller.signal.addEventListener('abort', cancel, {
                once: true,
              });
              /** Owned cancellation timer remains until native work settles; signals cannot stop arbitrary code. */
              const timer = setTimeout(cancel, timeout);
              /** Actual handler/planner promise is tracked separately from the caller-facing timeout outcome. */
              const job = Promise.resolve().then(() =>
                planner.plan({
                  principal,
                  tools: [...tools].map(([name, t]) => ({
                    name,
                    description: t.description,
                    inputSchema: snapshotToolJson(
                      t.inputSchema,
                      65536
                    ) as Record<string, unknown>,
                  })),
                  results: snapshotToolJson(
                    results,
                    maxResult
                  ) as ToolOutcome[],
                  remainingTokens: remaining,
                  signal: planController.signal,
                })
              );
              work.add(job);
              allWork.add(job);
              void job
                .finally(() => {
                  clearTimeout(timer);
                  controller.signal.removeEventListener('abort', cancel);
                  work.delete(job);
                  allWork.delete(job);
                })
                .catch(() => {});
              /** Detached planner response whose usage/call fields are checked before any tool dispatch. */
              const plan = snapshotToolJson(
                await new Promise<ToolPlan>((resolve, reject) => {
                  /**
                   * Request cancellation for this owner without force-stopping host JavaScript.
                   * @returns {void} No value; only requests cancellation and never forces native settlement.
                   */
                  const abort = () =>
                    reject(new Error('Tool planner budget cancelled'));
                  planController.signal.addEventListener('abort', abort, {
                    once: true,
                  });
                  if (planController.signal.aborted) {
                    abort();
                  }
                  job
                    .then(resolve, reject)
                    .finally(() =>
                      planController.signal.removeEventListener('abort', abort)
                    )
                    .catch(() => {});
                }),
                maxResult
              ) as ToolPlan;
              planController.signal.throwIfAborted();
              if (
                !plan ||
                !Number.isSafeInteger(plan.usage?.totalTokens) ||
                plan.usage.totalTokens < 0 ||
                plan.usage.totalTokens > remaining
              ) {
                throw new Error('Tool token budget exceeded');
              }
              remaining -= plan.usage.totalTokens;
              if (plan.text !== undefined) {
                if (typeof plan.text !== 'string') {
                  throw new Error('Invalid tool plan');
                }
                snapshotToolJson(plan.text, maxResult);
              }
              if (!plan.calls?.length) {
                if (!plan.text) {
                  throw new Error('Invalid tool plan');
                }
                return {
                  text: plan.text,
                  results,
                  usedTokens: tokens - remaining,
                };
              }
              if (
                !Array.isArray(plan.calls) ||
                plan.calls.length > calls - used ||
                remaining === 0
              ) {
                throw new Error('Tool call budget exceeded');
              }
              // Sequential dispatch preserves per-call authorization and stops after any nonsuccess receipt.
              for (const request of plan.calls) {
                used++;
                /** Terminal result/receipt retained without treating timeout as proof of rollback. */
                const result = await session.execute(
                  request.name,
                  request.arguments
                );
                results.push(result);
                if (result.state !== 'succeeded') {
                  return { text: '', results, usedTokens: tokens - remaining };
                }
              }
            }
            throw new Error('Tool step budget exceeded');
          } catch (error) {
            let code: ToolLoopError['code'] = 'failed';
            if (controller.signal.aborted) {
              code = 'cancelled';
            } else if (error instanceof Error && /budget/.test(error.message)) {
              code = 'budget';
            }
            throw new ToolLoopError(code, results);
          }
        },
        /**
         * Stop admission, abort owned work and await actual settlement before releasing listeners.
         * @returns {Promise<void>} Resolves after owned work settles; borrowed providers/transports stay host-owned.
         */
        async close() {
          stopped = true;
          controller.abort();
          await Promise.allSettled([...work]);
          sessions.delete(session);
          lifetime.signal.removeEventListener('abort', abort);
          signal?.removeEventListener('abort', abort);
        },
      };
      sessions.add(session);
      return session;
    },
    /**
     * Read path-free registration, session and unsettled-work counters.
     * @returns {{tools: number, sessions: number, pending: number}} Current fixed-label ownership counters, without request or principal values.
     */
    status() {
      return {
        tools: tools.size,
        sessions: sessions.size,
        pending: allWork.size,
      };
    },
    /**
     * Stop admission, abort owned work and await actual settlement before releasing listeners.
     * @returns {Promise<void>} Resolves after owned work settles; borrowed providers/transports stay host-owned.
     */
    async close() {
      closed = true;
      lifetime.abort();
      await Promise.allSettled([...sessions].map((s) => s.close()));
      await Promise.allSettled([...allWork]);
      tools.clear();
    },
  };
}
export { createZhostToolHandler } from './tool-transports.js';
export type { ZhostToolClientOptions } from './tool-transports.js';
export { approvedOpenApiToolOperations } from './tool-openapi.js';
export type { ApprovedToolOperation } from './tool-openapi.js';
