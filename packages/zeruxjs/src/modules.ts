import { ApplicationError } from './exceptions/api-error.js';
import type {
  ZeruxPluginApi,
  ZeruxRequestContext,
  MiddlewareFunction,
} from './bootstrap/types.js';

export interface ProviderToken<T> {
  /** Fresh opaque provider identity; names alone never authorize resolution. */
  readonly key: symbol;
  /** Bounded authored provider/module name. */
  readonly name: string;
  /** Type-only marker retaining provider value inference. */
  readonly valueType?: T;
}
/** Create an opaque typed provider identity from a bounded authored name.
 * @param {string} name - Trusted display/diagnostic name; identity comes from a fresh symbol.
 * @returns {ProviderToken<T>} Immutable unique token, not a string-based service lookup.
 */
export function createProviderToken<T>(name: string): ProviderToken<T> {
  if (typeof name !== 'string' || !/^[A-Za-z][\w.-]{0,63}$/.test(name)) {
    throw new TypeError('Invalid provider name');
  }
  return Object.freeze({ key: Symbol(name), name });
}
type Values<D extends readonly ProviderToken<unknown>[]> = {
  [K in keyof D]: D[K] extends ProviderToken<infer T> ? T : never;
};
export interface ProviderConstruction {
  /** Scope-owned cooperative cancellation signal. */
  readonly signal: AbortSignal;
  /** Borrowed request context only for request/transient scopes. */
  readonly request?: ZeruxRequestContext;
  /** Register bounded construction-time cleanup under the selected provider/request owner.
   * @param {Function} cleanup - Trusted disposer returning actual asynchronous settlement when needed.
   * @returns {void | Promise<void>} Registration or trusted controller cleanup-observation settlement.
   */
  onDispose(cleanup: () => void | Promise<void>): void;
}
export interface ProviderDefinition<T = any> {
  /** Explicit opaque provider registration identity. */
  token: ProviderToken<T>;
  /** Declared singleton/request/transient ownership, validated before construction. */
  scope: 'singleton' | 'request' | 'transient';
  /** Explicit dependency tokens; singleton captive request scopes reject. */
  dependencies: readonly ProviderToken<unknown>[];
  /** Construct an explicitly registered provider under its declared ownership scope.
   * @param {ProviderConstruction} context - Borrowed scope signal, optional request and construction cleanup registrar.
   * @param {any[]} dependencies - Values resolved only from explicit declared tokens.
   * @returns {T | Promise<T>} Provider value whose cleanup remains bound to its scope.
   */
  create(context: ProviderConstruction, ...dependencies: any[]): T | Promise<T>;
  /** Release owned provider resources after actual accepted construction work settles; continue remaining releases on failure.
   * @param {T} value - Constructed provider value when used as a descriptor callback.
   * @returns {void | Promise<void>} Actual provider cleanup settlement; aggregated failures remain observable.
   */
  dispose?(value: T): void | Promise<void>;
  /** Whether an explicit singleton is constructed during module preparation. */
  eager?: boolean;
}
/** Retain explicit constructor metadata with typed dependencies; no decorators, reflection or package discovery execute.
 * @param {{ token: ProviderToken<T>; scope: ProviderDefinition['scope']; dependencies: D; create( context: ProviderConstruction, ...dependencies: Values<D> ): T | Promise<T>; dispose?(value: T): void | Promise<void>; eager?: boolean; }} definition - Authored provider token, scope, dependencies and trusted lifecycle callbacks.
 * @param {ProviderToken<T>} definition.token - Fresh opaque registered provider identity.
 * @param {string} definition.scope - Explicit singleton/request/transient ownership.
 * @param {D} definition.dependencies - Explicit typed dependency token tuple.
 * @param {Function} definition.create - Trusted construction callback; never saved executable text.
 * @param {Function} definition.dispose - Optional owned-value cleanup callback.
 * @param {boolean} definition.eager - Optional singleton preparation flag.
 * @returns {ProviderDefinition<T>} Inert provider descriptor for explicit module registration.
 */
export function defineProvider<
  T,
  const D extends readonly ProviderToken<unknown>[],
>(definition: {
  /** Explicit opaque provider registration identity. */
  token: ProviderToken<T>;
  /** Declared singleton/request/transient ownership, validated before construction. */
  scope: ProviderDefinition['scope'];
  /** Explicit dependency tokens; singleton captive request scopes reject. */
  dependencies: D;
  /** Construct an explicitly registered provider under its declared ownership scope.
   * @param {ProviderConstruction} context - Borrowed scope signal, optional request and construction cleanup registrar.
   * @param {Values<D>} dependencies - Values resolved only from explicit declared tokens.
   * @returns {T | Promise<T>} Provider value whose cleanup remains bound to its scope.
   */
  create(
    context: ProviderConstruction,
    ...dependencies: Values<D>
  ): T | Promise<T>;
  /** Release owned provider resources after actual accepted construction work settles; continue remaining releases on failure.
   * @param {T} value - Constructed provider value when used as a descriptor callback.
   * @returns {void | Promise<void>} Actual provider cleanup settlement; aggregated failures remain observable.
   */
  dispose?(value: T): void | Promise<void>;
  /** Whether an explicit singleton is constructed during module preparation. */
  eager?: boolean;
}): ProviderDefinition<T> {
  return definition;
}
export interface ModuleResolver {
  /** Resolve only an explicitly registered provider token within the active allowed scope.
   * @param {ProviderToken<T>} token - Opaque provider identity; display names cannot impersonate tokens.
   * @returns {Promise<T>} Owned scoped provider value, without transferring disposal responsibility.
   */
  get<T>(token: ProviderToken<T>): Promise<T>;
}
/** Standard Schema v1 structural contract: schema implementation/types remain package-owned. */
export type ModuleInputSchema<T> =
  import('./bootstrap/service-definitions.js').ServiceConfigSchema<T>;
export interface ModuleController<T = any> {
  /** Explicit bounded controller route path. */
  path: string;
  /** Supported controller HTTP method, default GET. */
  method?: string;
  /** Ordered trusted authorization callbacks; only true admits dispatch. */
  guards?: readonly ((
    context: ZeruxRequestContext
  ) => boolean | Promise<boolean>)[];
  /** Optional Standard Schema V1 input validator; schema ownership stays with its package. */
  schema?: ModuleInputSchema<T>;
  /** Explicit trusted middleware chain with single-continuation enforcement. */
  middleware?: readonly MiddlewareFunction[];
  /** Run trusted controller code after guards and schema validation succeed.
   * @param {T} input - Validated schema output or explicit unvalidated input when no schema is configured.
   * @param {ZeruxRequestContext} context - Borrowed authorized request context.
   * @param {ModuleResolver} providers - Request-bound resolver; no browser role claims select scope.
   * @returns {unknown | Promise<unknown>} Controller result consumed by the framework response layer.
   */
  handle(
    input: T,
    context: ZeruxRequestContext,
    providers: ModuleResolver
  ): unknown | Promise<unknown>;
  /** Transform guard/schema/middleware/controller failures without receiving provider disposal failures.
   * @param {unknown} error - Private controller pipeline failure.
   * @param {ZeruxRequestContext} context - Borrowed request context.
   * @returns {unknown | Promise<unknown>} Host-selected safe response result or propagated failure.
   */
  filter?(
    error: unknown,
    context: ZeruxRequestContext
  ): unknown | Promise<unknown>;
  /** Register bounded construction-time cleanup under the selected provider/request owner.
   * @param {ZeruxRequestContext} context - Borrowed request context for controller disposal observation.
   * @param {unknown} error - Optional private provider-cleanup failure observed after settlement.
   * @returns {void | Promise<void>} Registration or trusted controller cleanup-observation settlement.
   */
  onDispose?(
    context: ZeruxRequestContext,
    error?: unknown
  ): void | Promise<void>;
}
/** Preserve schema output inference when describing heterogeneous module controllers.
 * @param {ModuleController<T>} controller - Authored schema/guard/handler descriptor.
 * @returns {ModuleController<T>} Inert typed controller descriptor.
 */
export function defineController<T>(
  controller: ModuleController<T>
): ModuleController<T> {
  return controller;
}
export interface ModuleDefinition {
  /** Bounded authored provider/module name. */
  name: string;
  /** Explicit private provider definitions, never discovered executable packages. */
  providers?: readonly ProviderDefinition[];
  /** Explicit controller definitions, never saved JavaScript expressions. */
  controllers?: readonly ModuleController[];
}
/** Module/controller failure retaining private causes behind the framework response boundary. */
export class ModuleError extends ApplicationError {
  /** Classify module failures while retaining private internal causes in the application error boundary.
   * @param {string} code - Internal module classification.
   * @param {number} statusCode - Explicit safe HTTP failure status, default 500.
   * @param {ErrorOptions} options - Optional private cause.
   */
  constructor(
    readonly code: string,
    readonly statusCode = 500,
    options?: ErrorOptions
  ) {
    super(statusCode, options?.cause);
    this.name = 'ModuleError';
  }
}
/** Validate and register explicit private providers/controllers for one generation with rollback on partial preparation failure.
 * @param {ZeruxPluginApi} api - Trusted generation plugin authority owning route and disposer registration.
 * @param {ModuleDefinition} definition - Explicit authored module definition.
 * @returns {Promise<{close(): Promise<void>}>} Owned module handle also attached to generation cleanup.
 */
export async function registerModule(
  api: ZeruxPluginApi,
  definition: ModuleDefinition
) {
  if (
    !api ||
    typeof api.onDispose !== 'function' ||
    typeof api.hasRoute !== 'function' ||
    !definition ||
    !/^[A-Za-z][\w.-]{0,63}$/.test(definition.name)
  ) {
    throw new ModuleError('MODULE_INVALID');
  }
  if (
    (definition.providers !== undefined &&
      !Array.isArray(definition.providers)) ||
    (definition.controllers !== undefined &&
      !Array.isArray(definition.controllers))
  ) {
    throw new ModuleError('MODULE_INVALID');
  }
  /** Explicit generation-local provider definitions, keyed by opaque token identity. */
  const providers = new Map<symbol, ProviderDefinition>();
  /** Captured controller descriptors with independent guard/middleware arrays. */
  const controllers = (definition.controllers ?? []).map(
    (item: ModuleController) => ({
      ...item,
      guards: [...(item.guards ?? [])],
      middleware: [...(item.middleware ?? [])],
    })
  );
  if ((definition.providers?.length ?? 0) > 128 || controllers.length > 128) {
    throw new ModuleError('MODULE_LIMIT');
  }
  for (const item of definition.providers ?? []) {
    if (
      !item ||
      !item.token ||
      typeof item.token.key !== 'symbol' ||
      !['singleton', 'request', 'transient'].includes(item.scope) ||
      !Array.isArray(item.dependencies) ||
      item.dependencies.length > 32 ||
      typeof item.create !== 'function' ||
      (item.dispose !== undefined && typeof item.dispose !== 'function') ||
      (item.eager !== undefined && typeof item.eager !== 'boolean') ||
      (item.eager && item.scope !== 'singleton') ||
      providers.has(item.token.key)
    ) {
      throw new ModuleError('PROVIDER_INVALID');
    }
    providers.set(item.token.key, {
      ...item,
      dependencies: [...item.dependencies],
    });
  }
  /** Current dependency traversal stack for cycle rejection. */
  const visiting = new Set<symbol>();
  /** Validated provider dependency identities. */
  const visited = new Set<symbol>();
  /** Validate explicit dependency existence, cycles and singleton captive-scope constraints before any factory executes.
   * @param {symbol} key - Opaque provider token identity.
   * @param {string[]} chain - Private authored provider names for cycle diagnostics.
   * @returns {void} Dependency graph validation completion.
   */
  function visit(key: symbol, chain: string[]) {
    /** Registered trusted provider definition selected by token identity. */
    const p = providers.get(key);
    if (!p) {
      throw new ModuleError('PROVIDER_DEPENDENCY_MISSING');
    }
    if (visiting.has(key)) {
      throw new ModuleError(
        `PROVIDER_CYCLE:${[...chain, p.token.name].join(' -> ')}`
      );
    }
    if (visited.has(key)) {
      return;
    }
    visiting.add(key);
    for (const dep of p.dependencies) {
      if (!dep || typeof dep.key !== 'symbol') {
        throw new ModuleError('PROVIDER_INVALID');
      }
      /** Declared dependency definition checked against singleton captive-scope policy. */
      const target = providers.get(dep.key);
      if (p.scope === 'singleton' && target && target.scope !== 'singleton') {
        throw new ModuleError('PROVIDER_CAPTIVE_SCOPE');
      }
      visit(dep.key, [...chain, p.token.name]);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of providers.keys()) {
    visit(key, []);
  }
  /** Registered method/path pairs used to reject module and runtime route collisions. */
  const paths = new Set<string>();
  for (const route of controllers) {
    /** Explicit supported controller method, default GET. */
    const method = route.method ?? 'GET';
    /** Exact method/path registration identity. */
    const key = `${method}:${route.path}`;
    if (
      typeof route.path !== 'string' ||
      !/^\/[A-Za-z0-9/_-]{0,255}$/.test(route.path) ||
      (route.path !== '/' &&
        (route.path.endsWith('/') || route.path.includes('//'))) ||
      !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(
        method
      ) ||
      typeof route.handle !== 'function' ||
      route.guards.length > 32 ||
      route.guards.some((f) => typeof f !== 'function') ||
      route.middleware.length > 32 ||
      route.middleware.some((f) => typeof f !== 'function') ||
      (route.onDispose !== undefined &&
        typeof route.onDispose !== 'function') ||
      (route.filter !== undefined && typeof route.filter !== 'function') ||
      (route.schema !== undefined &&
        (route.schema?.['~standard']?.version !== 1 ||
          typeof route.schema['~standard'].validate !== 'function')) ||
      paths.has(key) ||
      api.hasRoute(route.path, method)
    ) {
      throw new ModuleError('MODULE_ROUTE_CONFLICT');
    }
    paths.add(key);
  }
  type Owned = {
    /** Actual owned provider value. */
    value: any;
    /** Captured trusted provider definition used for disposal. */
    definition: ProviderDefinition;
    /** Construction-time owned cleanup callbacks executed in reverse order. */
    cleanups: (() => void | Promise<void>)[];
  };
  type Scope = {
    /** Scope-local nontransient construction promises, invalidated after failed construction. */
    cache: Map<symbol, Promise<any>>;
    /** Successfully constructed values retained in acquisition order. */
    owned: Owned[];
    /** Actual construction work retained until settlement. */
    jobs: Set<Promise<any>>;
    /** Scope-owned cooperative cancellation controller. */
    controller: AbortController;
    /** Whether the scope rejects new provider acquisition. */
    closed: boolean;
    /** Lifetime per-scope acquisition count enforcing the provider construction ceiling. */
    count: number;
  };
  /** Allocate independent provider ownership without acquiring values.
   * @returns {Scope} Fresh cache, construction tracking and cooperative cancellation owner.
   */
  const scope = (): Scope => ({
    cache: new Map(),
    owned: [],
    jobs: new Set(),
    controller: new AbortController(),
    closed: false,
    count: 0,
  });
  /** Generation-owned singleton scope; request/transient values never enter this cache. */
  const generation = scope();
  /** Retained request cleanup receipts for actual response/handler settlement. */
  const requests = new Set<{
    /** Abort this request owner and destroy its unfinished native response before scheduling cleanup.
     * @returns {void} Cancellation/cleanup scheduling; retained done represents actual completion.
     */
    cancel(): void;
    done: Promise<void>;
  }>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Release owned provider resources after actual accepted construction work settles; continue remaining releases on failure.
   * @param {Scope} owner - Explicit internal provider ownership scope.
   * @returns {void | Promise<void>} Actual provider cleanup settlement; aggregated failures remain observable.
   */
  async function dispose(owner: Scope) {
    owner.closed = true;
    owner.controller.abort();
    await Promise.allSettled([...owner.jobs]);
    /** Collected cleanup failures; remaining owned disposers still run. */
    const errors: unknown[] = [];
    for (const item of owner.owned.reverse()) {
      try {
        await item.definition.dispose?.(item.value);
      } catch (error) {
        errors.push(error);
      }
      for (const cleanup of item.cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
    }
    owner.owned.length = 0;
    owner.cache.clear();
    if (errors.length) {
      throw new AggregateError(errors, 'Provider disposal failed');
    }
  }
  /** Resolve explicit dependencies within their declared scope while retaining actual construction settlement and cleanup.
   * @param {ProviderToken<T>} token - Opaque provider identity.
   * @param {Scope} requestScope - Optional active request ownership scope.
   * @param {ZeruxRequestContext} request - Optional borrowed request context; omitted for singletons.
   * @returns {Promise<T>} Scoped provider value or explicit unavailable/closed/budget failure.
   */
  function resolve<T>(
    token: ProviderToken<T>,
    requestScope?: Scope,
    request?: ZeruxRequestContext
  ): Promise<T> {
    /** Registered trusted provider definition selected by token identity. */
    const p = providers.get(token?.key);
    if (closed || !p) {
      return Promise.reject(new ModuleError('PROVIDER_UNAVAILABLE'));
    }
    /** Explicit singleton or request owner selected by the provider’s declared scope. */
    const owner = p.scope === 'singleton' ? generation : requestScope;
    if (!owner || owner.closed || owner.controller.signal.aborted) {
      return Promise.reject(new ModuleError('PROVIDER_SCOPE_CLOSED'));
    }
    if (p.scope !== 'transient' && owner.cache.has(token.key)) {
      return owner.cache.get(token.key)!;
    }
    if (++owner.count > 256) {
      return Promise.reject(new ModuleError('PROVIDER_LIMIT'));
    }
    /** Actual provider construction settlement retained until completion, including cancellation-ignoring factories. */
    const job = Promise.resolve().then(async () => {
      /** Resolved explicit provider dependencies; singleton construction cannot capture request scope. */
      const dependencies = await Promise.all(
        p.dependencies.map((dep) =>
          resolve(
            dep,
            p.scope === 'singleton' ? undefined : requestScope,
            p.scope === 'singleton' ? undefined : request
          )
        )
      );
      owner.controller.signal.throwIfAborted();
      /** Bounded construction-time cleanup registrations retained even on constructor failure. */
      const cleanups: (() => void | Promise<void>)[] = [];
      let constructing = true;
      try {
        /** Actual constructed provider value whose lifetime belongs to the selected owner. */
        const value = await p.create(
          {
            signal: owner.controller.signal,
            request: p.scope === 'singleton' ? undefined : request,
            /** Register bounded construction-time cleanup under the selected provider/request owner.
             * @param {Function} cleanup - Trusted disposer returning actual asynchronous settlement when needed.
             * @returns {void | Promise<void>} Registration or trusted controller cleanup-observation settlement.
             */
            onDispose(cleanup) {
              if (
                !constructing ||
                typeof cleanup !== 'function' ||
                cleanups.length >= 32
              ) {
                throw new ModuleError('PROVIDER_CLEANUP_INVALID');
              }
              cleanups.push(cleanup);
            },
          },
          ...dependencies
        );
        owner.owned.push({ value, definition: p, cleanups });
        return value;
      } catch (error) {
        /** Collected cleanup failures; remaining owned disposers still run. */
        const errors = [error];
        for (const cleanup of cleanups.reverse()) {
          try {
            await cleanup();
          } catch (failure) {
            errors.push(failure);
          }
        }
        if (errors.length > 1) {
          throw new AggregateError(
            errors,
            'Provider construction cleanup failed'
          );
        }
        throw error;
      } finally {
        constructing = false;
      }
    });
    owner.jobs.add(job);
    void job.then(
      () => owner.jobs.delete(job),
      () => {
        owner.jobs.delete(job);
        if (p.scope !== 'transient') {
          owner.cache.delete(token.key);
        }
      }
    );
    if (p.scope !== 'transient') {
      owner.cache.set(token.key, job);
    }
    return job;
  }
  /** Stop new resolution, terminate request observations and drain actual cleanup before singleton disposal.
   * @returns {Promise<void>} Idempotent module-owner shutdown with aggregated failures.
   */
  const close = () =>
    (closing ??= (async () => {
      closed = true;
      for (const r of requests) {
        r.cancel();
      }
      /** Actual request cleanup settlements retained across generation shutdown. */
      const outcomes = await Promise.allSettled(
        [...requests].map((r) => r.done)
      );
      /** Collected cleanup failures; remaining owned disposers still run. */
      const errors = outcomes
        .filter((x): x is PromiseRejectedResult => x.status === 'rejected')
        .map((x) => x.reason);
      try {
        await dispose(generation);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) {
        throw new AggregateError(errors, 'Module cleanup failed');
      }
    })());
  /** Successfully registered controller routes removed if later module registration fails. */
  const added: ModuleController[] = [];
  try {
    for (const p of providers.values()) {
      if (p.eager) {
        await resolve(p.token);
      }
    }
    api.onDispose(close);
    for (const route of controllers) {
      api.addRoute({
        pattern: route.path,
        method: route.method ?? 'GET',
        source: `module:${definition.name}`,
        meta: { api: true },
        handler: async (context) => {
          if (closed) {
            throw new ModuleError('MODULE_CLOSED', 503);
          }
          // Guards/pipes cannot resolve controller providers; denial never constructs them.
          try {
            for (const guard of route.guards) {
              if ((await guard(context)) !== true) {
                throw new ModuleError('MODULE_FORBIDDEN', 403);
              }
            }
            context.requestLifecycle?.signal.throwIfAborted();
            let input = context.body;
            if (route.schema) {
              /** Validated schema or middleware receipt used by this explicit controller dispatch. */
              const result = await route.schema['~standard'].validate(input);
              if (result.issues) {
                throw new ModuleError('MODULE_INPUT_INVALID', 400);
              }
              input = result.value;
            }
            context.requestLifecycle?.signal.throwIfAborted();
            if (context.res.destroyed || context.res.writableEnded) {
              return;
            }
            /** Explicit singleton or request owner selected by the provider’s declared scope. */
            const owner = scope();
            let finish!: () => void;
            /** Handler settlement fence preventing request-provider disposal while accepted work remains active. */
            const settled = new Promise<void>((r) => (finish = r));
            let cleanup: Promise<void> | undefined;
            let resolveDone!: () => void, rejectDone!: (e: unknown) => void;
            /** Request cleanup completion retained by module shutdown. */
            const done = new Promise<void>((resolve, reject) => {
              resolveDone = resolve;
              rejectDone = reject;
            });
            void done.catch(() => {});
            /** Borrowed request lifecycle signal, with native response events as the compatibility fallback. */
            const terminalSignal = context.requestLifecycle?.signal;
            /** Release request-owned providers only after native termination and actual handler settlement.
             * @returns {void} Cleanup scheduling completion; retained done tracks actual release.
             */
            const complete = () => {
              if (cleanup) {
                return;
              }
              terminalSignal?.removeEventListener('abort', complete);
              context.res.off('finish', complete);
              context.res.off('close', complete);
              owner.controller.abort();
              cleanup = (async () => {
                await settled;
                /** Collected cleanup failures; remaining owned disposers still run. */
                const errors: unknown[] = [];
                try {
                  await dispose(owner);
                } catch (error) {
                  errors.push(error);
                }
                try {
                  await route.onDispose?.(
                    context,
                    errors.length
                      ? new AggregateError(errors, 'Provider cleanup failed')
                      : undefined
                  );
                } catch (error) {
                  errors.push(error);
                }
                if (errors.length) {
                  throw new AggregateError(errors, 'Controller cleanup failed');
                }
              })();
              void cleanup.then(resolveDone, (error) => {
                context.logger.error('Module provider cleanup failed');
                rejectDone(error);
              });
            };
            /** Request cancellation and actual cleanup completion pair. */
            const terminal = {
              /** Abort this request owner and destroy its unfinished native response before scheduling cleanup.
               * @returns {void} Cancellation/cleanup scheduling; retained done represents actual completion.
               */
              cancel() {
                owner.controller.abort();
                context.res.destroy();
                complete();
              },
              done,
            };
            requests.add(terminal);
            void done.then(
              () => requests.delete(terminal),
              () => requests.delete(terminal)
            );
            // Keep resources through actual response completion, including streamed results.
            if (terminalSignal) {
              terminalSignal.addEventListener('abort', complete, {
                once: true,
              });
              if (terminalSignal.aborted) {
                complete();
              }
            } else {
              context.res.once('finish', complete);
              context.res.once('close', complete);
            }
            try {
              let cursor = -1;
              /** Execute the explicit middleware chain once per continuation and resolve controller providers only after guards/schema pass.
               * @param {number} index - Next authored middleware position.
               * @returns {Promise<unknown>} Controller or middleware result after downstream settlement.
               */
              const dispatch = async (index: number): Promise<unknown> => {
                if (index <= cursor) {
                  throw new ModuleError('MODULE_NEXT_REPEATED');
                }
                cursor = index;
                /** Next trusted middleware callback, absent when the controller should run. */
                const middleware = route.middleware[index];
                if (!middleware) {
                  return route.handle(input, context, {
                    get: <T>(token: ProviderToken<T>) =>
                      resolve(token, owner, context),
                  });
                }
                let continuation: Promise<unknown> | undefined;
                /** Validated schema or middleware receipt used by this explicit controller dispatch. */
                const result = await middleware(context, () => {
                  if (continuation) {
                    throw new ModuleError('MODULE_NEXT_REPEATED');
                  }
                  continuation = dispatch(index + 1);
                  return continuation.then(() => {});
                });
                /** Actual continuation result, awaited even if middleware returns its own value. */
                const downstream = continuation
                  ? await continuation
                  : undefined;
                return result === undefined ? downstream : result;
              };
              return await dispatch(0);
            } finally {
              finish();
              if (context.res.destroyed || context.res.writableFinished) {
                complete();
              }
            }
          } catch (error) {
            if (route.filter) {
              return route.filter(error, context);
            }
            throw error;
          }
        },
      });
      added.push(route);
    }
    return Object.freeze({ close });
  } catch (error) {
    /** Registration/rollback failures retained without discarding the initiating cause. */
    const failures: unknown[] = [error];
    for (const route of added) {
      try {
        api.removeRoute(route.path, route.method ?? 'GET');
      } catch (cleanup) {
        failures.push(cleanup);
      }
    }
    try {
      await close();
    } catch (cleanup) {
      failures.push(cleanup);
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Module registration rollback failed');
    }
    throw error;
  }
}
