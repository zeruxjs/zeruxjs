import { ServerHookError, createServerActions, type ServerHookLimits, type ServerHookRegistration, type ServerHookToken } from './server-hooks.js';

export interface GenerationHookContext { readonly generationId: string }
/** Contains no raw URL, headers, body, user or tenant claims. Correlation is not authorization. */
export interface RequestHookContext extends GenerationHookContext {
  readonly requestId: string; readonly method: string; readonly signal: AbortSignal;
}
export interface BeforeRequestHookContext extends RequestHookContext {
  /** Register at acquisition; bounded LIFO synchronous teardown at response finish/close. */
  onDispose(cleanup: () => void): void;
}
export interface RouteHookContext extends RequestHookContext { readonly pattern: string | null }
export interface ResponseMutation {
  setStatus(status: number): void;
  setHeader(name: string, value: string): void;
}
export interface BeforeResponseHookContext extends RequestHookContext { readonly response: ResponseMutation }
export interface AfterRequestHookContext extends RequestHookContext { readonly status: number; readonly outcome: 'completed' | 'disconnected' }
export interface RequestErrorHookContext extends RequestHookContext { readonly kind: 'handler' | 'disconnect' | 'hook' }
export interface ServerLifecycleEvents {
  'request:before': [context: BeforeRequestHookContext];
  'route:resolved': [context: RouteHookContext];
  'response:before': [context: BeforeResponseHookContext];
  'request:error': [context: RequestErrorHookContext];
  'response:after': [context: AfterRequestHookContext];
  'request:after': [context: AfterRequestHookContext];
  'generation:prepare': [context: GenerationHookContext];
  'generation:ready': [context: GenerationHookContext];
  'generation:activate': [context: GenerationHookContext];
  'generation:error': [context: GenerationHookContext];
  'generation:close': [context: GenerationHookContext];
  'generation:closed': [context: GenerationHookContext];
}
const phases = new Set<keyof ServerLifecycleEvents>(['request:before','route:resolved','response:before','request:error','response:after','request:after','generation:prepare','generation:ready','generation:activate','generation:error','generation:close','generation:closed']);
/** Host-owned typed synchronous lifecycle bus. Framework bridges own phase ordering and request disposal.
 * Observation events omit mutable HTTP handles; only response:before receives bounded commit-time setters.
 * Host closes the bus after all application generations have drained; framework never owns registrations. */
export class ServerLifecycleHooks {
  readonly #registry;
  constructor(options?: ServerHookLimits) { this.#registry = createServerActions<ServerLifecycleEvents>(options); }
  register<K extends keyof ServerLifecycleEvents>(phase: K, handler: (context: ServerLifecycleEvents[K][0]) => void, options?: ServerHookRegistration): ServerHookToken {
    if (!phases.has(phase) || typeof handler !== 'function') throw new ServerHookError('HOOK_INVALID');
    if (handler.constructor.name === 'AsyncFunction') throw new ServerHookError('HOOK_ASYNC_IN_SYNC');
    return this.#registry.register(phase, (_dispatch, context) => handler(context), options);
  }
  /** Framework integration dispatch. Trusted hosts may also drive these phases in custom runtimes. */
  dispatch<K extends keyof ServerLifecycleEvents>(phase: K, context: ServerLifecycleEvents[K][0]): void {
    if (!phases.has(phase)) throw new ServerHookError('HOOK_INVALID');
    this.#registry.dispatch(phase, [context] as ServerLifecycleEvents[K]);
  }
  dispose(): void { this.#registry.dispose(); }
  getDiagnostics() { return this.#registry.getDiagnostics(); }
}
export function createServerLifecycleHooks(options?: ServerHookLimits): ServerLifecycleHooks { return new ServerLifecycleHooks(options); }
