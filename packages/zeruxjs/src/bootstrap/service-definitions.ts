import type {
  RuntimeServiceScope,
  ServiceHttpRoute,
  ServiceName,
} from './services.js';
export type RuntimeServiceName = ServiceName | `custom:${string}`;
/** Structural Standard Schema v1 contract; schema/input/output types remain package-owned. */
export interface ServiceConfigSchema<T = Record<string, unknown>> {
  /** Borrowed Standard Schema validation descriptor; it does not authorize startup. */
  readonly '~standard': {
    /** Required Standard Schema contract version. */
    readonly version: 1;
    /** Apply the host-supplied Standard Schema contract; schema implementation and inferred types remain package-owned.
     * @param {unknown} value - Candidate service settings.
     * @returns {unknown} Synchronous or asynchronous schema value/issues result.
     */
    validate(value: unknown):
      | {
          /** Owned instance value registered in the generation scope. */
          value: T;
          issues?: undefined;
        }
      | { issues: readonly unknown[] }
      | Promise<
          | {
              /** Owned instance value registered in the generation scope. */
              value: T;
              issues?: undefined;
            }
          | { issues: readonly unknown[] }
        >;
  };
}
export interface CustomServiceConfig {
  /** Explicit configured enablement; absent namespaces remain disabled. */
  enabled?: boolean;
  /** Validated application settings; public fields require a separate projection. */
  settings?: Record<string, unknown>;
  /** Borrowed host-only clients/credentials/callbacks excluded from public manifests. */
  privateOptions?: unknown;
}
export interface ServiceInstance<T = unknown> {
  /** Owned instance value registered in the generation scope. */
  value: T;
  /** Explicit instance cleanup; otherwise a value close method is used when present. */
  dispose?: () => void | Promise<void>;
  /** Explicit service HTTP endpoints subject to collision validation. */
  routes?: readonly ServiceHttpRoute[];
}
export interface ServiceStartContext<T = Record<string, unknown>> {
  /** Validated application settings; public fields require a separate projection. */
  settings: T;
  /** Borrowed host-only clients/credentials/callbacks excluded from public manifests. */
  privateOptions: unknown;
  /** Trusted application project root. */
  rootDir: string;
  /** Instance cancellation aborted before cleanup; no forced JavaScript cancellation. */
  signal: AbortSignal;
  /** Borrow only an explicitly declared ready dependency; the service does not acquire its lifecycle ownership.
   * @param {RuntimeServiceName} name - Declared dependency runtime name.
   * @returns {unknown} Scoped dependency or undefined; undeclared access throws.
   */
  get<TValue = unknown>(name: RuntimeServiceName): TValue | undefined;
  /** Register bounded partial-acquisition cleanup immediately after acquiring a resource.
   * @param {() => void | Promise<void>} dispose - Owned cleanup callback.
   * @returns {void} Callback runs in reverse registration order after instance disposal.
   */
  onDispose(dispose: () => void | Promise<void>): void;
}
export interface ServiceDefinition<T = any> {
  /** Unique custom-prefixed runtime service name. */
  name: `custom:${string}`;
  /** Unique validated configuration namespace. */
  namespace: string;
  /** Trusted Standard Schema v1 validator, not authorization. */
  schema: ServiceConfigSchema<T>;
  /** Explicit builtin/custom runtime dependencies, initialized before this service. */
  dependencies?: readonly RuntimeServiceName[];
  /** Failure rejects startup unless explicitly false. */
  required?: boolean;
  /** Top-level settings fields allowed to change through staged reload. */
  reloadable?: readonly string[];
  /** Explicit settings projection; private options never become public. */
  publicFields?: readonly string[];
  /** Acquire one explicitly configured custom service instance.
   * @param {ServiceStartContext<T>} context - Validated settings, private options, cancellation and dependency-only access.
   * @returns {ServiceInstance | Promise<ServiceInstance>} Owned value with optional explicit disposer and protected routes.
   */
  start(
    context: ServiceStartContext<T>
  ): ServiceInstance | Promise<ServiceInstance>;
}
export interface PreparedService {
  /** Validated trusted factory declaration. */
  definition: ServiceDefinition;
  /** Validated application settings; public fields require a separate projection. */
  settings: unknown;
  /** Borrowed host-only clients/credentials/callbacks excluded from public manifests. */
  privateOptions: unknown;
  /** Explicit configured enablement; absent namespaces remain disabled. */
  enabled: boolean;
}
/** Declared framework service names allowed as explicit custom-service dependencies. */
const builtins = new Set([
  'database',
  'cache',
  'files',
  'analytics',
  'email',
  'tags',
  'reports',
  'queue',
  'search',
]);
/** Validate one explicit declaration and freeze its dependency/reload/public-field lists.
 * @param {ServiceDefinition<T>} definition - Trusted registered schema/factory definition.
 * @returns {ServiceDefinition<T>} Shallow-frozen declaration retaining host-owned executable code.
 */
export function defineService<T>(
  definition: ServiceDefinition<T>
): ServiceDefinition<T> {
  orderServices([definition], true);
  return Object.freeze({
    ...definition,
    dependencies: Object.freeze([...(definition.dependencies ?? [])]),
    reloadable: Object.freeze([...(definition.reloadable ?? [])]),
    publicFields: Object.freeze([...(definition.publicFields ?? [])]),
  });
}
/** Validate bounded unique declarations and return dependency-before-dependent order.
 * @param {readonly ServiceDefinition[]} definitions - Explicit host registry, at most sixty-four services.
 * @param {boolean} allowExternal - Single-definition validation may defer external dependency membership.
 * @returns {ServiceDefinition[]} Topological order or a declared configuration/dependency error.
 */
export function orderServices(
  definitions: readonly ServiceDefinition[],
  allowExternal = false
): ServiceDefinition[] {
  if (!Array.isArray(definitions) || definitions.length > 64) {
    throw new TypeError('Invalid service definitions');
  }
  /** Validated unique custom service definitions keyed by their explicit runtime names. */
  const names = new Map<string, ServiceDefinition>();
  /** Unique config namespaces preventing two services from sharing mutable settings. */
  const namespaces = new Set<string>();
  for (const definition of definitions) {
    if (
      !definition ||
      !/^custom:[a-z][a-z0-9-]{0,63}$/.test(definition.name) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(definition.namespace) ||
      ['constructor', 'prototype', '__proto__'].includes(
        definition.namespace
      ) ||
      names.has(definition.name) ||
      namespaces.has(definition.namespace) ||
      typeof definition.start !== 'function' ||
      definition.schema?.['~standard']?.version !== 1 ||
      typeof definition.schema['~standard'].validate !== 'function' ||
      (definition.required !== undefined &&
        typeof definition.required !== 'boolean')
    ) {
      throw new TypeError('Invalid or duplicate service definition');
    }
    for (const list of [
      definition.dependencies,
      definition.reloadable,
      definition.publicFields,
    ]) {
      if (
        list !== undefined &&
        (!Array.isArray(list) ||
          list.length > 64 ||
          list.some(
            (value) => typeof value !== 'string' || value.length > 128
          ) ||
          new Set(list).size !== list.length)
      ) {
        throw new TypeError('Invalid service declaration list');
      }
    }
    for (const field of [
      ...(definition.reloadable ?? []),
      ...(definition.publicFields ?? []),
    ]) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field) ||
        ['constructor', 'prototype', '__proto__'].includes(field)
      ) {
        throw new TypeError('Invalid service config field');
      }
    }
    names.set(definition.name, definition);
    namespaces.add(definition.namespace);
  }
  /** Current topological recursion stack for dependency-cycle rejection. */
  const visiting = new Set<string>();
  /** Definitions already placed in dependency order. */
  const done = new Set<string>();
  /** Validated dependency-before-dependent startup order. */
  const ordered: ServiceDefinition[] = [];
  /** Visit only explicitly registered dependencies, rejecting cycles and unknown external names.
   * @param {ServiceDefinition} definition - Trusted registered service.
   * @returns {void} Appends a definition once after its dependencies.
   */
  const visit = (definition: ServiceDefinition) => {
    if (visiting.has(definition.name)) {
      throw new Error('Custom service dependency cycle');
    }
    if (done.has(definition.name)) {
      return;
    }
    visiting.add(definition.name);
    for (const dependency of definition.dependencies ?? []) {
      if (names.has(dependency)) {
        visit(names.get(dependency)!);
      } else if (!builtins.has(dependency) && !allowExternal) {
        throw new Error('Unknown service dependency');
      }
    }
    visiting.delete(definition.name);
    done.add(definition.name);
    ordered.push(definition);
  };
  for (const definition of definitions) {
    visit(definition);
  }
  return ordered;
}
/** Acquire configured services sequentially with dependency-only access and per-instance reverse rollback.
 * @param {RuntimeServiceScope} scope - Generation owner receiving each successfully acquired instance.
 * @param {readonly PreparedService[]} prepared - Validated topologically ordered settings and definitions.
 * @param {string} rootDir - Trusted project root.
 * @returns {Promise<void>} Startup settlement; optional failures degrade, required failures reject.
 */
export async function startCustomServices(
  scope: RuntimeServiceScope,
  prepared: readonly PreparedService[],
  rootDir: string
): Promise<void> {
  for (const item of prepared) {
    /** Current prepared custom service declaration; disabled services acquire no resources. */
    const definition = item.definition;
    if (!item.enabled) {
      scope.add(definition.name, null);
      continue;
    }
    /** Per-instance cancellation aborted before its owned cleanup. */
    const controller = new AbortController();
    /** Bounded partial-resource cleanup registered by the service in acquisition order. */
    const callbacks: (() => void | Promise<void>)[] = [];
    let instance: ServiceInstance | undefined,
      closed = false;
    /** Close the instance and partial-resource callbacks once, retaining all cleanup failures.
     * @returns {Promise<void>} Actual cleanup settlement; arbitrary JavaScript cannot be force-cancelled.
     */
    const dispose = async () => {
      if (closed) {
        return;
      }
      closed = true;
      controller.abort();
      /** Private cleanup failures aggregated without skipping later disposers. */
      const errors: unknown[] = [];
      if (instance) {
        try {
          if (instance.dispose) {
            await instance.dispose();
          } else {
            /** Instance value used only for the documented fallback close method when no explicit disposer exists. */
            const value = instance.value as {
              close?: () => void | Promise<void>;
            };
            await value?.close?.();
          }
        } catch (error) {
          errors.push(error);
        }
      }
      for (const callback of callbacks.reverse()) {
        try {
          await callback();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) {
        throw new AggregateError(errors, 'Custom service cleanup failed');
      }
    };
    try {
      for (const dependency of definition.dependencies ?? []) {
        if (
          !scope.get(dependency) ||
          scope.status().find((status) => status.name === dependency)?.state !==
            'ready'
        ) {
          throw new Error('Custom service dependency unavailable');
        }
      }
      instance = await definition.start({
        settings: item.settings,
        privateOptions: item.privateOptions,
        rootDir,
        signal: controller.signal,
        /** Borrow only an explicitly declared ready dependency; the service does not acquire its lifecycle ownership.
         * @param {RuntimeServiceName} name - Declared dependency runtime name.
         * @returns {unknown} Scoped dependency or undefined; undeclared access throws.
         */
        get(name) {
          if (!definition.dependencies?.includes(name)) {
            throw new Error('Undeclared service dependency');
          }
          return scope.get(name);
        },
        /** Register bounded partial-acquisition cleanup immediately after acquiring a resource.
         * @param {() => void | Promise<void>} callback - Owned cleanup callback.
         * @returns {void} Callback runs in reverse registration order after instance disposal.
         */
        onDispose(callback) {
          if (
            closed ||
            typeof callback !== 'function' ||
            callbacks.length >= 128
          ) {
            throw new Error('Invalid service disposer');
          }
          callbacks.push(callback);
        },
      });
      /** Preserve short-circuiting while reading the host-owned value only once for validation. */
      const instanceValue = instance && instance.value;
      if (
        !instance ||
        instanceValue === null ||
        instanceValue === undefined ||
        (instance.dispose !== undefined &&
          typeof instance.dispose !== 'function')
      ) {
        throw new TypeError('Invalid custom service instance');
      }
      if (instance.routes) {
        scope.addHttpRoutes(definition.name, instance.routes);
      }
      scope.add(definition.name, instance.value, dispose);
    } catch (error) {
      let failure: unknown = error;
      try {
        await dispose();
      } catch (cleanup) {
        failure = new AggregateError(
          [error, cleanup],
          'Custom service startup and rollback failed'
        );
      }
      if (definition.required !== false) {
        throw failure;
      }
      scope.markDegraded(definition.name, failure);
    }
  }
}
