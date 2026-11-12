import {
  ServerHookError,
  createServerActions,
  type ServerHookLimits,
  type ServerHookRegistration,
  type ServerHookToken,
} from './server-hooks.js';

/** Host-generated generation correlation; never authorization. */
export interface GenerationHookContext {
  /** Host/framework-generated generation correlation, never authorization. */
  readonly generationId: string;
}
/** Contains no raw URL, headers, body, user or tenant claims. Correlation is not authorization. */
export interface RequestHookContext extends GenerationHookContext {
  /** Host/framework-generated request correlation, without URL/body/identity payloads. */
  readonly requestId: string;
  /** Bounded observed method label; not a request body or raw header. */
  readonly method: string;
  /** Borrowed request-lifetime cancellation; terminal disposal aborts it even on success. */
  readonly signal: AbortSignal;
}
/** Framework request-before observation with bounded synchronous cleanup registration. */
export interface BeforeRequestHookContext extends RequestHookContext {
  /** Register synchronous request-owned cleanup through the framework-provided bounded hook context.
   * @param {Function} cleanup - Synchronous disposer; framework rejects async declarations and owns LIFO finish/close teardown.
   * @returns {void} Registration only; this type does not itself implement an HTTP resource owner.
   */
  onDispose(cleanup: () => void): void;
}
/** Declared route-pattern observation, including explicit null bypasses. */
export interface RouteHookContext extends RequestHookContext {
  /** Declared route pattern or null for static/protocol/early/no resolved route. */
  readonly pattern: string | null;
}
/** Bounded framework commit-time setters, not a raw mutable HTTP response. */
export interface ResponseMutation {
  /** Request a bounded final response status during the live response:before callback sequence only.
   * @param {number} status - Safe integer final status from 200–599, enforced by the host bridge.
   * @returns {void} Expired mutation handles reject; no body/routing/authorization mutation is exposed.
   */
  setStatus(status: number): void;
  /** Request one bounded safe response header during the sole mutation phase.
   * @param {string} name - HTTP token header name; framing/hop-by-hop names reject.
   * @param {string} value - Bounded safe header value without controls/CRLF.
   * @returns {void} Host bridge validates budget and commit-time ownership.
   */
  setHeader(name: string, value: string): void;
}
/** Sole framework mutation-phase context; custom hosts own runtime validation. */
export interface BeforeResponseHookContext extends RequestHookContext {
  /** Bounded commit-time mutation facade, exposed only during response:before. */
  readonly response: ResponseMutation;
}
/** Terminal response observation, separate from handler-promise completion. */
export interface AfterRequestHookContext extends RequestHookContext {
  /** Observed final status, or the host diagnostic disconnect status. */
  readonly status: number;
  /** Observed completed/disconnected lifecycle outcome, not handler-promise success. */
  readonly outcome: 'completed' | 'disconnected';
}
/** Fixed error-category observation excluding private causes/payloads. */
export interface RequestErrorHookContext extends RequestHookContext {
  /** Fixed error category; raw exception payloads and stacks remain private. */
  readonly kind: 'handler' | 'disconnect' | 'hook';
}
/** Typed framework phase payload map; the bus does not implement phase ordering by declaration. */
export interface ServerLifecycleEvents {
  /** Before admitted request host validation/routing; supports bounded synchronous disposer registration. */
  'request:before': [context: BeforeRequestHookContext];
  /** One route observation before first commit/error/termination, including null bypass cases. */
  'route:resolved': [context: RouteHookContext];
  /** Sole synchronous mutation phase at first final response commit. */
  'response:before': [context: BeforeResponseHookContext];
  /** First caught handler/hook/disconnect error kind, without private causes. */
  'request:error': [context: RequestErrorHookContext];
  /** Native response finish/close/abort observation, not handler promise completion. */
  'response:after': [context: AfterRequestHookContext];
  /** Once after response observation and before scope/effect/disposer teardown. */
  'request:after': [context: AfterRequestHookContext];
  /** Candidate preparation after core preflight and before runtime/providers. */
  'generation:prepare': [context: GenerationHookContext];
  /** Prepared candidate, not proof of a listening HTTP server. */
  'generation:ready': [context: GenerationHookContext];
  /** Host activation observation; cannot veto or roll back external effects. */
  'generation:activate': [context: GenerationHookContext];
  /** Generation failure correlation without raw provider details. */
  'generation:error': [context: GenerationHookContext];
  /** Generation close observation after host draining policy. */
  'generation:close': [context: GenerationHookContext];
  /** Terminal generation cleanup observation. */
  'generation:closed': [context: GenerationHookContext];
}
/** Explicit supported lifecycle names; declaring a string never implements an HTTP phase. */
const phases = new Set<keyof ServerLifecycleEvents>([
  'request:before',
  'route:resolved',
  'response:before',
  'request:error',
  'response:after',
  'request:after',
  'generation:prepare',
  'generation:ready',
  'generation:activate',
  'generation:error',
  'generation:close',
  'generation:closed',
]);
/** Host-owned typed synchronous lifecycle bus. Framework bridges own phase ordering and request disposal.
 * Observation events omit mutable HTTP handles; only response:before receives bounded commit-time setters.
 * Host closes the bus after all application generations have drained; framework never owns registrations. */
export class ServerLifecycleHooks {
  /** Owned synchronous registry; host bus disposal removes every remaining registration. */
  readonly #registry;
  /** Own a typed synchronous action registry; no HTTP bridge, server or automatic phase scheduling is created.
   * @param {ServerHookLimits | undefined} options - Optional validated handler/depth/pending limits forwarded to the owned registry.
   */
  constructor(options?: ServerHookLimits) {
    this.#registry = createServerActions<ServerLifecycleEvents>(options);
  }
  /** Register one explicit synchronous phase handler. Framework callers supply frozen observations; custom hosts remain responsible for context validation and authorization.
   * @param {K} phase - Explicit supported lifecycle phase.
   * @param {Function} handler - Borrowed synchronous callback; async declarations reject before wrapping.
   * @param {ServerHookRegistration | undefined} options - Optional priority, once and exact-registration abort signal.
   * @returns {ServerHookToken} Frozen exact-registration removal handle, not ownership of the whole host bus.
   */
  register<K extends keyof ServerLifecycleEvents>(
    phase: K,
    handler: (context: ServerLifecycleEvents[K][0]) => void,
    options?: ServerHookRegistration
  ): ServerHookToken {
    if (!phases.has(phase) || typeof handler !== 'function') {
      throw new ServerHookError('HOOK_INVALID');
    }
    if (handler.constructor.name === 'AsyncFunction') {
      throw new ServerHookError('HOOK_ASYNC_IN_SYNC');
    }
    return this.#registry.register(
      phase,
      (_dispatch, context) => handler(context),
      options
    );
  }
  /** Dispatch a typed supported phase through the owned synchronous registry. Host/framework code owns phase ordering, snapshot construction and security.
   * @param {K} phase - Explicit supported lifecycle phase.
   * @param {ServerLifecycleEvents[K][0]} context - Borrowed host-created context; this bus does not derive identity or freeze arbitrary supplied objects.
   * @returns {void} Synchronous handler observation; failures propagate to the trusted integration owner.
   */
  dispatch<K extends keyof ServerLifecycleEvents>(
    phase: K,
    context: ServerLifecycleEvents[K][0]
  ): void {
    if (!phases.has(phase)) {
      throw new ServerHookError('HOOK_INVALID');
    }
    this.#registry.dispatch(phase, [context] as ServerLifecycleEvents[K]);
  }
  /** Idempotently dispose the owned registry and remove all registrations; hosts close it after application generations drain.
   * @returns {void} Bus admission stops; no HTTP or arbitrary asynchronous resource is forcibly terminated.
   */
  dispose(): void {
    this.#registry.dispose();
  }
  /** Project only disposal/handler/pending counters from the owned registry.
   * @returns {object} Frozen bounded counters without event names, payloads or private context.
   */
  getDiagnostics() {
    return this.#registry.getDiagnostics();
  }
}
/** Create a host-owned typed synchronous lifecycle bus, separate from framework HTTP phase ownership.
 * @param {ServerHookLimits | undefined} options - Optional validated registry resource limits.
 * @returns {ServerLifecycleHooks} Explicit dispose owner; no global registry or framework auto-registration.
 */
export function createServerLifecycleHooks(
  options?: ServerHookLimits
): ServerLifecycleHooks {
  return new ServerLifecycleHooks(options);
}
