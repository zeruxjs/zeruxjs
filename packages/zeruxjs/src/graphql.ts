import { createHash } from 'node:crypto';
import type {
  GraphQLFieldResolver,
  GraphQLResolveInfo,
  ExecutionResult,
  SelectionSetNode,
  GraphQLCompositeType,
} from 'graphql';
import {
  registerModule,
  type ProviderDefinition,
  type ModuleResolver,
} from './modules.js';
import type { ZeruxPluginApi, ZeruxRequestContext } from './bootstrap/types.js';
export interface GraphQLPrincipal {
  /** Host-verified opaque initiating subject identifier. */
  subject: string;
  /** Host-verified tenant binding enforced before resolver/provider access. */
  tenant: string;
  /** Absolute principal expiry in Unix milliseconds. */
  expiresAt: number;
}
export interface GraphQLResolverContext extends Record<PropertyKey, unknown> {
  /** Immutable fresh authenticated scope for this operation. */
  readonly principal: Readonly<GraphQLPrincipal>;
  /** Cooperative operation cancellation signal. */
  readonly signal: AbortSignal;
  /** Borrowed request-scoped provider resolver. */
  readonly providers: ModuleResolver;
  /** Authorize each requested key before an operation-local cache lookup and authorize returned rows before exposure.
   * @param {string} name - Bounded authored loader name.
   * @param {string} key - Bounded data key authorized under the initiating principal.
   * @param {( keys: readonly string[], context: GraphQLResolverContext ) => Promise<readonly T[]>} batch - Stable trusted batch function for this named loader.
   * @returns {Promise<T>} Authorized operation-local result; no cross-principal cache.
   */
  load<T>(
    name: string,
    key: string,
    batch: (
      keys: readonly string[],
      context: GraphQLResolverContext
    ) => Promise<readonly T[]>
  ): Promise<T>;
}
export type GraphQLResolver<
  S = unknown,
  A = Record<string, unknown>,
  R = unknown,
> = (
  source: S,
  args: A,
  context: GraphQLResolverContext,
  info: GraphQLResolveInfo
) => R | Promise<R>;
export interface GraphQLOptions {
  /** Stable authored integration or loader namespace. */
  name: string;
  /** Explicit server POST route for this integration. */
  path: string;
  /** Trusted authored SDL, parsed under a registration byte ceiling. */
  typeDefs: string;
  /** Explicit trusted server callbacks; no JavaScript strings execute as resolvers. */
  resolvers: Record<
    string,
    Record<
      string,
      | GraphQLFieldResolver<any, GraphQLResolverContext>
      | {
          resolve?: GraphQLFieldResolver<any, GraphQLResolverContext>;
          subscribe: GraphQLFieldResolver<any, GraphQLResolverContext>;
        }
    >
  >;
  /** Borrowed request-scoped provider resolver. */
  providers?: readonly ProviderDefinition[];
  /** Verify the initiating tenant/subject and a bounded expiry from trusted host session policy.
   * @param {ZeruxRequestContext} request - Borrowed native request context.
   * @param {AbortSignal} signal - Operation cancellation signal.
   * @returns {GraphQLPrincipal | null | Promise<GraphQLPrincipal | null>} Verified principal or explicit denial.
   */
  authenticate(
    request: ZeruxRequestContext,
    signal: AbortSignal
  ): GraphQLPrincipal | null | Promise<GraphQLPrincipal | null>;
  /** Reauthorize every field before executing its resolver.
   * @param {GraphQLResolverContext} context - Authenticated operation-local context.
   * @param {GraphQLResolveInfo} info - Native schema/selection information.
   * @param {unknown} source - Trusted resolver source value.
   * @param {Record<string, unknown>} args - Native coerced field arguments.
   * @returns {boolean | Promise<boolean>} Only true admits the resolver.
   */
  authorizeField(
    context: GraphQLResolverContext,
    info: GraphQLResolveInfo,
    source: unknown,
    args: Record<string, unknown>
  ): boolean | Promise<boolean>;
  /** Authorize both requested loader keys and returned rows without trusting cached permission.
   * @param {Readonly<GraphQLPrincipal>} principal - Immutable fresh host principal.
   * @param {string} loader - Explicit authored loader name.
   * @param {string} key - Requested bounded data key.
   * @param {unknown} row - Optional returned row requiring a second authorization check.
   * @returns {boolean | Promise<boolean>} Only true admits key lookup or row exposure.
   */
  authorizeData(
    principal: Readonly<GraphQLPrincipal>,
    loader: string,
    key: string,
    row?: unknown
  ): boolean | Promise<boolean>;
  /** Apply the host’s explicit origin/CSRF or bearer-only write policy before executing a mutation.
   * @param {ZeruxRequestContext} request - Borrowed native request context.
   * @param {Readonly<GraphQLPrincipal>} principal - Immutable verified initiating principal.
   * @returns {boolean | Promise<boolean>} Only true admits mutation execution.
   */
  protectMutation(
    request: ZeruxRequestContext,
    principal: Readonly<GraphQLPrincipal>
  ): boolean | Promise<boolean>;
  /** Explicit native schema introspection policy. */
  introspection: boolean;
  /** Explicit V1 operation-hash allowlist policy. */
  persisted: {
    /** Whether every request must match the persisted operation registry. */
    required: boolean;
    /** SHA-256 hashes mapped to exact authored GraphQL query text. */
    operations: Readonly<Record<string, string>>;
  };
  /** Bounded operation, response and concurrency settings. */
  limits?: Partial<{
    /** Maximum selection nesting depth. */
    maxDepth: number;
    /** Maximum conservative list-weighted selection cost. */
    maxComplexity: number;
    /** Maximum selected field aliases. */
    maxAliases: number;
    /** Maximum serialized variable bytes. */
    maxVariablesBytes: number;
    /** Maximum serialized response bytes. */
    maxResponseBytes: number;
    /** Maximum query UTF-8 bytes. */
    maxQueryBytes: number;
    /** Maximum actual retained operations. */
    maxConcurrent: number;
    /** Cooperative operation deadline, not forced resolver termination. */
    timeoutMs: number;
    /** Maximum allowed returned list length and conservative list-cost factor. */
    maxListItems: number;
  }>;
  /** Explicit optional bounded SSE subscription policy. */
  subscriptions?: {
    /** Maximum subscription lifetime from its original start. */
    maxDurationMs: number;
    /** Interval for fresh subscription authorization checks. */
    reauthorizeMs: number;
    /** Recheck continuing subscription authority during its bounded lifetime.
     * @param {Readonly<GraphQLPrincipal>} principal - Verified initiating principal, never a browser-provided role.
     * @param {AbortSignal} signal - Operation cancellation signal.
     * @returns {boolean | Promise<boolean>} Only true retains the subscription.
     */
    reauthorize(
      principal: Readonly<GraphQLPrincipal>,
      signal: AbortSignal
    ): boolean | Promise<boolean>;
  };
  /** Observe private causes without exposing them in GraphQL responses.
   * @param {unknown} error - Private integration/field/transport failure.
   * @returns {void} Trusted diagnostic observer completion.
   */
  onError?(error: unknown): void;
}
/** Safe integration classification retaining optional private provider/resolver causes. */
export class GraphQLIntegrationError extends Error {
  /** Classify GraphQL integration failures while retaining private causes only for trusted diagnostics.
   * @param {string} code - Fixed integration diagnostic classification.
   * @param {ErrorOptions} options - Optional private cause.
   */
  constructor(
    readonly code: string,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'GraphQLIntegrationError';
  }
}
/** Create a fixed integration classification without embedding input values in its message.
 * @param {string} code - Internal fixed diagnostic classification.
 * @returns {GraphQLIntegrationError} Classified integration failure.
 */
const fail = (code: string) => new GraphQLIntegrationError(code);
/** Register explicit SDL/resolvers and host authorization policy; optional GraphQL/SSE packages load only here, never on root import.
 * @param {ZeruxPluginApi} api - Trusted generation plugin authority.
 * @param {GraphQLOptions} options - Explicit schema, resolver, consent-independent authorization and operation budgets.
 * @returns {Promise<object>} Owned integration handle also attached to generation cleanup.
 */
export async function registerGraphQL(
  api: ZeruxPluginApi,
  options: GraphQLOptions
) {
  if (
    !options ||
    typeof options.name !== 'string' ||
    typeof options.typeDefs !== 'string' ||
    Buffer.byteLength(options.typeDefs) > 262144 ||
    !options.resolvers ||
    typeof options.resolvers !== 'object' ||
    Array.isArray(options.resolvers) ||
    typeof options.authenticate !== 'function' ||
    typeof options.authorizeField !== 'function' ||
    typeof options.authorizeData !== 'function' ||
    typeof options.protectMutation !== 'function' ||
    typeof options.introspection !== 'boolean' ||
    !options.persisted ||
    typeof options.persisted.required !== 'boolean' ||
    !options.persisted.operations ||
    typeof options.persisted.operations !== 'object' ||
    Array.isArray(options.persisted.operations) ||
    (options.onError !== undefined && typeof options.onError !== 'function')
  ) {
    throw fail('GRAPHQL_POLICY_INVALID');
  }
  if (
    (options.limits !== undefined &&
      (!options.limits ||
        typeof options.limits !== 'object' ||
        Array.isArray(options.limits))) ||
    (options.subscriptions !== undefined &&
      (!options.subscriptions ||
        typeof options.subscriptions !== 'object' ||
        Array.isArray(options.subscriptions)))
  ) {
    throw fail('GRAPHQL_POLICY_INVALID');
  }
  /** Captured operation/resource limits with explicit bounded defaults. */
  const limits = {
    maxDepth: 8,
    maxComplexity: 1000,
    maxAliases: 32,
    maxVariablesBytes: 32768,
    maxResponseBytes: 1048576,
    maxQueryBytes: 32768,
    maxConcurrent: 32,
    timeoutMs: 5000,
    maxListItems: 100,
    ...options.limits,
  };
  /** Hard supported maximum for each configured operation budget. */
  const caps = {
    maxDepth: 32,
    maxComplexity: 10000,
    maxAliases: 256,
    maxVariablesBytes: 262144,
    maxResponseBytes: 16777216,
    maxQueryBytes: 131072,
    maxConcurrent: 256,
    timeoutMs: 120000,
    maxListItems: 1000,
  };
  if (
    Object.keys(limits).some(
      (key) =>
        !(key in caps) ||
        !Number.isSafeInteger(limits[key as keyof typeof limits]) ||
        limits[key as keyof typeof limits] < 1 ||
        limits[key as keyof typeof limits] > caps[key as keyof typeof caps]
    )
  ) {
    throw fail('GRAPHQL_LIMIT_INVALID');
  }
  /** Explicit trusted principal authenticator, invoked before provider construction. */
  const authenticate = options.authenticate;
  /** Fresh trusted field authorization callback, invoked before every resolver. */
  const authorizeField = options.authorizeField;
  /** Trusted key/row authorization applied before loader cache lookup and before exposure. */
  const authorizeData = options.authorizeData;
  /** Explicit host origin/CSRF or bearer policy for every mutation. */
  const protectMutation = options.protectMutation;
  /** Private trusted cause observer; public GraphQL failures are separately projected. */
  const onError = options.onError;
  /** Whether operations must match the explicitly registered hash allowlist. */
  const requirePersisted = options.persisted.required;
  /** Captured explicit subscription duration/reauthorization policy, otherwise SSE stays optional. */
  const subscriptions = options.subscriptions
    ? { ...options.subscriptions }
    : undefined;
  if (
    subscriptions &&
    (!Number.isSafeInteger(subscriptions.maxDurationMs) ||
      subscriptions.maxDurationMs < 10 ||
      subscriptions.maxDurationMs > 120000 ||
      !Number.isSafeInteger(subscriptions.reauthorizeMs) ||
      subscriptions.reauthorizeMs < 10 ||
      subscriptions.reauthorizeMs > 30000 ||
      typeof subscriptions.reauthorize !== 'function')
  ) {
    throw fail('GRAPHQL_SUBSCRIPTION_POLICY_INVALID');
  }
  let gql: typeof import('graphql');
  try {
    gql = await import('graphql');
  } catch (cause) {
    throw new GraphQLIntegrationError('GRAPHQL_DEPENDENCY_UNAVAILABLE', {
      cause,
    });
  }
  let sse: typeof import('graphql-sse');
  if (subscriptions) {
    try {
      sse = await import('graphql-sse');
    } catch (cause) {
      throw new GraphQLIntegrationError('GRAPHQL_SSE_UNAVAILABLE', { cause });
    }
  }
  /** Isolate the private host error callback so diagnostics cannot interrupt cleanup.
   * @param {unknown} error - Private integration/resolver/transport cause.
   * @returns {void} Private observer invocation completion.
   */
  const report = (error: unknown) => {
    try {
      onError?.(error);
    } catch {
      /* Diagnostics cannot interrupt ownership. */
    }
  };
  let schema: import('graphql').GraphQLSchema;
  try {
    schema = gql.buildSchema(options.typeDefs);
    gql.assertValidSchema(schema);
  } catch (cause) {
    throw new GraphQLIntegrationError('GRAPHQL_SCHEMA_INVALID', { cause });
  }
  /** Bounded explicit operation-hash allowlist; accepted operations are validated at registration. */
  const persisted = new Map<string, string>(
    Object.entries(options.persisted.operations)
  );
  if (persisted.size > 256) {
    throw fail('GRAPHQL_PERSISTED_LIMIT');
  }
  /** Native GraphQL validation rules plus explicit introspection restriction. */
  const validationRules = [
    ...gql.specifiedRules,
    ...(options.introspection ? [] : [gql.NoSchemaIntrospectionCustomRule]),
  ];
  for (const [id, query] of persisted) {
    if (
      !/^[a-f0-9]{64}$/.test(id) ||
      typeof query !== 'string' ||
      Buffer.byteLength(query) > limits.maxQueryBytes ||
      createHash('sha256').update(query).digest('hex') !== id
    ) {
      throw fail('GRAPHQL_PERSISTED_INVALID');
    }
    try {
      /** Parsed bounded GraphQL document, never executable JavaScript source. */
      const document = gql.parse(query, { maxTokens: 4096 });
      if (
        gql.validate(schema, document, validationRules, { maxErrors: 20 })
          .length
      ) {
        throw fail('GRAPHQL_PERSISTED_INVALID');
      }
    } catch (cause) {
      throw new GraphQLIntegrationError('GRAPHQL_PERSISTED_INVALID', { cause });
    }
  }
  for (const [typeName, fields] of Object.entries(options.resolvers)) {
    /** Schema-owned GraphQL type used for resolver or query-shape validation. */
    const type = schema.getType(typeName);
    if (
      !gql.isObjectType(type) ||
      !fields ||
      typeof fields !== 'object' ||
      Array.isArray(fields)
    ) {
      throw fail('GRAPHQL_RESOLVER_INVALID');
    }
    for (const fieldName of Object.keys(fields)) {
      if (!type.getFields()[fieldName]) {
        throw fail('GRAPHQL_RESOLVER_INVALID');
      }
    }
  }
  /** Weak native-request-to-operation state lookup, removed on terminal disposal. */
  const pending = new WeakMap<ZeruxRequestContext, State>();
  /** Actual accepted operations retained until their owned jobs and request cleanup settle. */
  const active = new Set<State>();
  let closed = false;
  type State = {
    /** Operation-owned cooperative abort controller. */
    controller: AbortController;
    /** Immutable fresh authenticated scope for this operation. */
    principal?: Readonly<GraphQLPrincipal>;
    /** Immutable authenticated resolver context once prepared. */
    context?: GraphQLResolverContext;
    /** Current actual in-flight field resolver count. */
    fields: number;
    /** Absolute operation deadline capped by principal expiry. */
    deadline: number;
    /** Actual unresolved resolver/loader/reauthorization jobs retained through cleanup. */
    jobs: Set<Promise<unknown>>;
    /** Replace the operation timer within its original start time and principal expiry fences.
     * @param {number} ms - Explicit operation/subscription maximum duration.
     * @returns {void} Cooperative deadline timer update.
     */
    setDuration(ms: number): void;
    /** Actual operation terminal receipt. */
    done: Promise<void>;
    /** Resolve this operation’s terminal cleanup receipt.
     * @returns {void} Completion notification.
     */
    finish(): void;
    /** Request operation cancellation without releasing actual unresolved work accounting early.
     * @returns {void} Cooperative cancellation notification.
     */
    cancel(): void;
    /** Remove operation timer/listeners/loaders and release active request ownership once.
     * @returns {void} Idempotent terminal bookkeeping completion.
     */
    end(): void;
    /** Bounded operation-local named loader registry. */
    loaders: Map<string, any>;
  };
  /** Create a fixed public GraphQL error envelope without serializing internal causes.
   * @param {string} message - Fixed authored safe public message.
   * @returns {object} Public error envelope.
   */
  const errorResult = (message = 'Request rejected') => ({
    errors: [{ message }],
  });
  /** Bound response traversal and final UTF-8 JSON bytes before committing a native response.
   * @param {unknown} value - Trusted execution-result projection to serialize.
   * @returns {string} Bounded serialized response, or explicit response-limit failure.
   */
  function serialize(value: unknown): string {
    /** Bounded iterative traversal stack for response or variable size/node inspection. */
    const stack = [value];
    let bytes = 0,
      nodes = 0;
    while (stack.length) {
      /** Next bounded traversal value or schema selection node. */
      const item = stack.pop();
      if (++nodes > 100000) {
        throw fail('GRAPHQL_RESPONSE_LIMIT');
      }
      if (typeof item === 'string') {
        if (Buffer.byteLength(item) > limits.maxResponseBytes) {
          throw fail('GRAPHQL_RESPONSE_LIMIT');
        }
        bytes += Buffer.byteLength(JSON.stringify(item));
      } else if (item && typeof item === 'object') {
        bytes += 2;
        for (const [key, child] of Object.entries(item)) {
          if (child === undefined) {
            continue;
          }
          bytes += Buffer.byteLength(JSON.stringify(key)) + 2;
          stack.push(child);
          if (stack.length > 100000) {
            throw fail('GRAPHQL_RESPONSE_LIMIT');
          }
        }
      } else if (item !== undefined) {
        bytes += String(item).length + 1;
      }
      if (bytes > limits.maxResponseBytes) {
        throw fail('GRAPHQL_RESPONSE_LIMIT');
      }
    }
    /** Serialized JSON checked against the configured operation byte ceiling. */
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > limits.maxResponseBytes) {
      throw fail('GRAPHQL_RESPONSE_LIMIT');
    }
    return text;
  }
  /** Write one safe private JSON response only before native termination; oversized results use a fixed failure body.
   * @param {ZeruxRequestContext} request - Borrowed native request/response context.
   * @param {unknown} result - Execution/error result to project.
   * @param {number} status - Explicit HTTP status, default 200.
   * @returns {void} Native response write scheduling completion.
   */
  function send(request: ZeruxRequestContext, result: unknown, status = 200) {
    if (request.res.destroyed || request.res.writableEnded) {
      return;
    }
    let body: string;
    try {
      body = serialize(result);
    } catch {
      status = 500;
      body = JSON.stringify(errorResult('Response limit exceeded'));
    }
    request.res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    request.res.end(body);
  }

  for (const type of Object.values(schema.getTypeMap())) {
    if (
      gql.isScalarType(type) &&
      !type.name.startsWith('__') &&
      !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(type.name)
    ) {
      throw fail('GRAPHQL_CUSTOM_SCALAR_UNSUPPORTED');
    }
    if (!gql.isObjectType(type) || type.name.startsWith('__')) {
      continue;
    }
    for (const field of Object.values(type.getFields())) {
      /** Own authored resolver map for this schema type, if explicitly registered. */
      const configured = Object.hasOwn(options.resolvers, type.name)
        ? options.resolvers[type.name]
        : undefined;
      /** Own authored resolver/subscriber entry for the current field. */
      const registered =
        configured && Object.hasOwn(configured, field.name)
          ? configured[field.name]
          : undefined;
      /** Explicit resolver callback; absent fields use own data descriptors rather than inherited getters. */
      const resolver =
        typeof registered === 'function' ? registered : registered?.resolve;
      if (
        registered &&
        typeof registered !== 'function' &&
        (typeof registered !== 'object' ||
          typeof registered.subscribe !== 'function' ||
          (registered.resolve !== undefined &&
            typeof registered.resolve !== 'function'))
      ) {
        throw fail('GRAPHQL_RESOLVER_INVALID');
      }
      /** Wrap a trusted resolver with fresh principal/field authorization and actual-job accounting.
       * @param {GraphQLFieldResolver<any, GraphQLResolverContext>} fn - Trusted resolver/subscription source callback.
       * @param {boolean} subscriptionSource - Whether the callback returns a subscription source rather than an ordinary field value.
       * @returns {GraphQLFieldResolver<any, GraphQLResolverContext>} Authorized bounded-work resolver wrapper.
       */
      const wrap =
        (
          fn: GraphQLFieldResolver<any, GraphQLResolverContext>,
          subscriptionSource = false
        ): GraphQLFieldResolver<any, GraphQLResolverContext> =>
        (source, args, context, info) => {
          /** Operation-local cancellation, principal, deadline, job and loader ownership. */
          const state = contextStates.get(context);
          if (state && Date.now() >= state.deadline) {
            state.cancel();
          }
          if (!state || state.controller.signal.aborted) {
            throw fail('GRAPHQL_FIELD_UNAVAILABLE');
          }
          if (++state.fields > 64) {
            state.fields--;
            throw fail('GRAPHQL_FIELD_UNAVAILABLE');
          }
          /** Actual resolver/loader/reauthorization settlement retained until completion. */
          const job = (async () => {
            try {
              context.signal.throwIfAborted();
              if (
                Date.now() >= context.principal.expiresAt ||
                (await authorizeField(context, info, source, args)) !== true
              ) {
                throw fail('GRAPHQL_FIELD_DENIED');
              }
              context.signal.throwIfAborted();
              /** Trusted resolver result inspected for schema/list/size ceilings before exposure. */
              const value = await fn(source, args, context, info);
              if (Date.now() >= state.deadline) {
                state.cancel();
              }
              context.signal.throwIfAborted();
              if (!subscriptionSource) {
                /** Bounded schema/value traversal used to validate nested returned list lengths. */
                const items = [{ value, type: field.type }];
                let count = 0;
                while (items.length) {
                  if (++count > 10000) {
                    throw fail('GRAPHQL_VALUE_LIMIT');
                  }
                  /** Next bounded traversal value or schema selection node. */
                  const item = items.pop()!;
                  let type = item.type;
                  while (gql.isNonNullType(type)) {
                    type = type.ofType;
                  }
                  if (item.value === null || item.value === undefined) {
                    continue;
                  }
                  if (gql.isListType(type)) {
                    if (
                      !Array.isArray(item.value) ||
                      item.value.length > limits.maxListItems
                    ) {
                      throw fail('GRAPHQL_VALUE_LIMIT');
                    }
                    for (const child of item.value) {
                      items.push({ value: child, type: type.ofType });
                    }
                  } else if (
                    typeof item.value === 'string' &&
                    Buffer.byteLength(item.value) > limits.maxResponseBytes
                  ) {
                    throw fail('GRAPHQL_VALUE_LIMIT');
                  }
                }
              }
              return value;
            } catch (error) {
              report(error);
              throw new gql.GraphQLError('Field unavailable');
            } finally {
              state.fields--;
            }
          })();
          state.jobs.add(job);
          void job.then(
            () => state.jobs.delete(job),
            () => state.jobs.delete(job)
          );
          return job;
        };
      field.resolve = wrap(
        resolver ??
          ((source) =>
            source &&
            Object.getOwnPropertyDescriptor(source, field.name)?.value)
      );
      if (registered && typeof registered === 'object') {
        field.subscribe = wrap(registered.subscribe, true);
      }
    }
  }
  /** Weak resolver-context-to-operation ownership lookup; contexts cannot reopen a closed operation. */
  const contextStates = new WeakMap<GraphQLResolverContext, State>();
  /** Bound parsed request variables by UTF-8 size, nodes and depth before native execution.
   * @param {unknown} value - Parsed variable object candidate.
   * @returns {void} Variable budget/type validation completion.
   */
  function variables(value: unknown) {
    /** Serialized JSON checked against the configured operation byte ceiling. */
    const text = JSON.stringify(value ?? {});
    if (Buffer.byteLength(text) > limits.maxVariablesBytes) {
      throw fail('GRAPHQL_VARIABLE_LIMIT');
    }
    /** Bounded iterative traversal stack for response or variable size/node inspection. */
    const stack = [{ value, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
      /** Current variable traversal value and bounded recursion depth. */
      const { value: v, depth } = stack.pop()!;
      if (++nodes > 2048 || depth > 16) {
        throw fail('GRAPHQL_VARIABLE_LIMIT');
      }
      if (v && typeof v === 'object') {
        for (const item of Object.values(v)) {
          stack.push({ value: item, depth: depth + 1 });
        }
      }
    }
    if (
      value !== undefined &&
      (!value || typeof value !== 'object' || Array.isArray(value))
    ) {
      throw fail('GRAPHQL_VARIABLE_INVALID');
    }
  }
  /** Validate one bounded operation against persisted policy, native schema rules and explicit complexity ceilings.
   * @param {any} body - Parsed JSON request candidate; never executable source.
   * @returns {object} Validated native operation and bounded execution inputs.
   */
  function prepare(body: any) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) =>
          !['query', 'variables', 'operationName', 'extensions'].includes(k)
      )
    ) {
      throw fail('GRAPHQL_REQUEST_INVALID');
    }
    variables(body.variables);
    if (
      body.operationName !== undefined &&
      (typeof body.operationName !== 'string' ||
        body.operationName.length > 128)
    ) {
      throw fail('GRAPHQL_REQUEST_INVALID');
    }
    if (
      body.extensions !== undefined &&
      (!body.extensions ||
        typeof body.extensions !== 'object' ||
        Array.isArray(body.extensions) ||
        Object.keys(body.extensions).some((k) => k !== 'persistedQuery'))
    ) {
      throw fail('GRAPHQL_EXTENSIONS_INVALID');
    }
    /** Untrusted persisted-operation extension checked against the fixed V1 hash contract. */
    const persistedQuery = body.extensions?.persistedQuery;
    if (
      persistedQuery !== undefined &&
      (!persistedQuery ||
        typeof persistedQuery !== 'object' ||
        Array.isArray(persistedQuery) ||
        persistedQuery.version !== 1 ||
        Object.keys(persistedQuery).some(
          (k) => !['version', 'sha256Hash'].includes(k)
        ))
    ) {
      throw fail('GRAPHQL_PERSISTED_INVALID');
    }
    /** Candidate operation hash required to match the explicit registered query text. */
    const hash = persistedQuery?.sha256Hash;
    let query = body.query;
    if (hash !== undefined || requirePersisted) {
      if (
        typeof hash !== 'string' ||
        !persisted.has(hash) ||
        (query !== undefined && query !== persisted.get(hash))
      ) {
        throw fail('GRAPHQL_PERSISTED_MISS');
      }
      query = persisted.get(hash);
    }
    if (
      typeof query !== 'string' ||
      Buffer.byteLength(query) > limits.maxQueryBytes
    ) {
      throw fail('GRAPHQL_QUERY_LIMIT');
    }
    /** Parsed bounded GraphQL document, never executable JavaScript source. */
    const document = gql.parse(query, { maxTokens: 4096 });
    /** Native schema validation failures converted to a fixed integration failure. */
    const errors = gql.validate(schema, document, validationRules, {
      maxErrors: 20,
    });
    if (errors.length) {
      throw fail('GRAPHQL_VALIDATION_FAILED');
    }
    /** Single selected native operation; multiple-operation documents reject. */
    const operation = gql.getOperationAST(document, body.operationName);
    if (
      !operation ||
      document.definitions.filter((d) => d.kind === 'OperationDefinition')
        .length !== 1
    ) {
      throw fail('GRAPHQL_OPERATION_INVALID');
    }
    /** Native-validated fragment definitions used only for bounded complexity traversal. */
    const fragments = new Map(
      document.definitions
        .filter(
          (d): d is import('graphql').FragmentDefinitionNode =>
            d.kind === 'FragmentDefinition'
        )
        .map((d) => [d.name.value, d])
    );
    let aliases = 0,
      cost = 0;
    /** Accumulate depth, alias and list-weighted complexity before resolver execution.
     * @param {SelectionSetNode} selection - Native validated selection set.
     * @param {GraphQLCompositeType | undefined} parent - Schema-owned parent type.
     * @param {number} depth - Current selection depth.
     * @param {number} weight - Accumulated parent list multiplicity.
     * @returns {void} Budget validation completion.
     */
    const walk = (
      selection: SelectionSetNode,
      parent: GraphQLCompositeType | undefined,
      depth: number,
      weight: number
    ) => {
      if (depth > limits.maxDepth) {
        throw fail('GRAPHQL_DEPTH_LIMIT');
      }
      for (const item of selection.selections) {
        if (item.kind === 'Field') {
          if (item.alias && ++aliases > limits.maxAliases) {
            throw fail('GRAPHQL_ALIAS_LIMIT');
          }
          /** Schema-owned selected field or object field being wrapped. */
          const field =
            parent && 'getFields' in parent
              ? parent.getFields()[item.name.value]
              : undefined;
          /** Schema-owned GraphQL type used for resolver or query-shape validation. */
          const type = field?.type;
          let listType = type,
            factor = 1;
          while (
            listType &&
            (gql.isNonNullType(listType) || gql.isListType(listType))
          ) {
            if (gql.isListType(listType)) {
              factor *= limits.maxListItems;
            }
            listType = listType.ofType;
            if (factor > limits.maxComplexity) {
              break;
            }
          }
          /** Conservative list-multiplied selection cost charged before traversing children. */
          const fieldWeight = weight * factor;
          if ((cost += fieldWeight) > limits.maxComplexity) {
            throw fail('GRAPHQL_COMPLEXITY_LIMIT');
          }
          if (item.selectionSet) {
            /** Schema-owned named child type, if available. */
            const next = type ? gql.getNamedType(type) : undefined;
            walk(
              item.selectionSet,
              next && gql.isCompositeType(next) ? next : undefined,
              depth + 1,
              fieldWeight
            );
          }
        } else if (item.kind === 'InlineFragment') {
          /** Schema-owned fragment type condition, never a caller-supplied executable object. */
          const target = item.typeCondition
            ? schema.getType(item.typeCondition.name.value)
            : parent;
          walk(
            item.selectionSet,
            target && gql.isCompositeType(target) ? target : parent,
            depth,
            weight
          );
        } else {
          /** Native-validated named fragment definition. */
          const fragment = fragments.get(item.name.value)!;
          /** Schema-owned fragment type condition, never a caller-supplied executable object. */
          const target = schema.getType(fragment.typeCondition.name.value);
          walk(
            fragment.selectionSet,
            target && gql.isCompositeType(target) ? target : parent,
            depth,
            weight
          );
        }
      }
    };
    /** Schema-owned root selected by query, mutation or subscription operation kind. */
    let root: ReturnType<typeof schema.getQueryType>;
    if (operation.operation === 'query') {
      root = schema.getQueryType();
    } else if (operation.operation === 'mutation') {
      root = schema.getMutationType();
    } else {
      root = schema.getSubscriptionType();
    }
    walk(operation.selectionSet, root ?? undefined, 1, 1);
    return {
      document,
      operation,
      query,
      variableValues: body.variables,
      operationName: body.operationName,
    };
  }
  /** Create an immutable principal-bound operation context with bounded per-operation loader state.
   * @param {State} state - Active authenticated operation owner.
   * @param {ModuleResolver} providers - Borrowed request-bound module resolver.
   * @returns {GraphQLResolverContext} Context whose caches never cross operation or principal boundaries.
   */
  function makeContext(
    state: State,
    providers: ModuleResolver
  ): GraphQLResolverContext {
    /** Immutable authenticated operation context with operation-local loaders. */
    const context: GraphQLResolverContext = Object.freeze({
      principal: state.principal!,
      signal: state.controller.signal,
      providers,
      /** Authorize each requested key before an operation-local cache lookup and authorize returned rows before exposure.
       * @param {string} name - Bounded authored loader name.
       * @param {string} key - Bounded data key authorized under the initiating principal.
       * @param {( keys: readonly string[], ctx: GraphQLResolverContext ) => Promise<readonly T[]>} batch - Stable trusted batch function for this named loader.
       * @returns {Promise<T>} Authorized operation-local result; no cross-principal cache.
       */
      load<T>(
        name: string,
        key: string,
        batch: (
          keys: readonly string[],
          ctx: GraphQLResolverContext
        ) => Promise<readonly T[]>
      ): Promise<T> {
        /** Actual resolver/loader/reauthorization settlement retained until completion. */
        const job = (async () => {
          if (Date.now() >= state.deadline) {
            state.cancel();
          }
          context.signal.throwIfAborted();
          if (
            !/^[A-Za-z][\w.-]{0,63}$/.test(name) ||
            typeof key !== 'string' ||
            key.length > 256 ||
            typeof batch !== 'function' ||
            (await authorizeData(context.principal, name, key)) !== true
          ) {
            throw fail('GRAPHQL_DATA_DENIED');
          }
          context.signal.throwIfAborted();
          let loader = state.loaders.get(name);
          if (!loader) {
            if (state.loaders.size >= 16) {
              throw fail('GRAPHQL_LOADER_LIMIT');
            }
            loader = { cache: new Map(), queue: [], scheduled: false, batch };
            state.loaders.set(name, loader);
          }
          if (loader.batch !== batch) {
            throw fail('GRAPHQL_LOADER_IDENTITY');
          }
          if (loader.cache.has(key)) {
            return loader.cache.get(key);
          }
          if (loader.cache.size >= 256 || loader.queue.length >= 64) {
            throw fail('GRAPHQL_LOADER_LIMIT');
          }
          /** Cached per-key loader promise scoped to this authenticated operation only. */
          const promise = new Promise<T>((resolve, reject) =>
            loader.queue.push({ key, resolve, reject })
          );
          loader.cache.set(key, promise);
          if (!loader.scheduled) {
            loader.scheduled = true;
            queueMicrotask(() => {
              /** Actual resolver/loader/reauthorization settlement retained until completion. */
              const job = (async () => {
                /** One bounded loader batch removed atomically from its operation-local queue. */
                const queued = loader.queue.splice(0);
                loader.scheduled = false;
                try {
                  context.signal.throwIfAborted();
                  /** Actual batch result required to preserve requested count/order and pass fresh row authorization. */
                  const rows = await batch(
                    queued.map((item: any) => item.key),
                    context
                  );
                  if (Date.now() >= state.deadline) {
                    state.cancel();
                  }
                  context.signal.throwIfAborted();
                  if (!Array.isArray(rows) || rows.length !== queued.length) {
                    throw fail('GRAPHQL_LOADER_RESULT');
                  }
                  for (let i = 0; i < queued.length; i++) {
                    if (
                      (await authorizeData(
                        context.principal,
                        name,
                        queued[i].key,
                        rows[i]
                      )) !== true
                    ) {
                      throw fail('GRAPHQL_DATA_DENIED');
                    }
                  }
                  queued.forEach((item: any, i: number) =>
                    item.resolve(rows[i])
                  );
                } catch (error) {
                  for (const item of queued) {
                    loader.cache.delete(item.key);
                    item.reject(error);
                  }
                }
              })();
              state.jobs.add(job);
              void job.then(
                () => state.jobs.delete(job),
                () => state.jobs.delete(job)
              );
            });
          }
          return promise;
        })();
        state.jobs.add(job);
        void job.then(
          () => state.jobs.delete(job),
          () => state.jobs.delete(job)
        );
        return job;
      },
    });
    contextStates.set(context, state);
    return context;
  }
  for (const [id, query] of persisted) {
    try {
      prepare({
        query,
        extensions: { persistedQuery: { version: 1, sha256Hash: id } },
      });
    } catch (cause) {
      throw new GraphQLIntegrationError('GRAPHQL_PERSISTED_INVALID', { cause });
    }
  }
  /** Owned explicit module/controller registration; optional dependencies were loaded only for this registration. */
  const module = await registerModule(api, {
    name: options.name,
    providers: options.providers,
    controllers: [
      {
        path: options.path,
        method: 'POST',
        guards: [
          async (request) => {
            if (closed || active.size >= limits.maxConcurrent) {
              send(request, errorResult('Unavailable'), 503);
              return false;
            }
            /** Operation-local cooperative cancellation owner. */
            const controller = new AbortController();
            /** Wall-clock operation start used for the maximum duration fence. */
            const startedAt = Date.now();
            let resolve!: () => void;
            /** Operation completion receipt retained by integration close. */
            const done = new Promise<void>((r) => (resolve = r));
            let timer: ReturnType<typeof setTimeout>,
              ended = false;
            /** Abort this operation and terminate/respond safely without pretending noncooperative resolvers settled.
             * @returns {void} Cancellation and native response termination scheduling.
             */
            const cancel = () => {
              controller.abort();
              if (!request.res.destroyed && !request.res.writableEnded) {
                if (request.res.headersSent) {
                  request.res.destroy();
                } else {
                  send(request, errorResult('Execution expired'), 504);
                }
              }
            };
            /** Propagate request lifecycle termination into operation cancellation.
             * @returns {void} Abort notification completion.
             */
            const disconnect = () => controller.abort();
            request.requestLifecycle?.signal.addEventListener(
              'abort',
              disconnect,
              { once: true }
            );
            /** Operation-local cancellation, principal, deadline, job and loader ownership. */
            const state: State = {
              controller,
              fields: 0,
              deadline: startedAt + limits.timeoutMs,
              jobs: new Set(),
              /** Replace the operation timer within its original start time and principal expiry fences.
               * @param {number} ms - Explicit operation/subscription maximum duration.
               * @returns {void} Cooperative deadline timer update.
               */
              setDuration(ms) {
                clearTimeout(timer);
                state.deadline = Math.min(
                  startedAt + ms,
                  state.principal?.expiresAt ?? Infinity
                );
                timer = setTimeout(
                  cancel,
                  Math.max(1, state.deadline - Date.now())
                );
              },
              done,
              finish: resolve,
              cancel,
              loaders: new Map(),
              /** Remove operation timer/listeners/loaders and release active request ownership once.
               * @returns {void} Idempotent terminal bookkeeping completion.
               */
              end() {
                if (ended) {
                  return;
                }
                ended = true;
                clearTimeout(timer);
                request.requestLifecycle?.signal.removeEventListener(
                  'abort',
                  disconnect
                );
                state.loaders.clear();
                active.delete(state);
                pending.delete(request);
                resolve();
              },
            };
            pending.set(request, state);
            active.add(state);
            timer = setTimeout(cancel, limits.timeoutMs);
            try {
              /** Fresh host-authenticated subject/tenant/expiry projection; no browser role claim is accepted. */
              const principal = await authenticate(request, controller.signal);
              if (Date.now() >= state.deadline) {
                state.cancel();
              }
              controller.signal.throwIfAborted();
              if (
                !principal ||
                typeof principal.subject !== 'string' ||
                principal.subject.length > 256 ||
                !principal.subject ||
                typeof principal.tenant !== 'string' ||
                principal.tenant.length > 256 ||
                !principal.tenant ||
                !Number.isSafeInteger(principal.expiresAt) ||
                principal.expiresAt <= Date.now()
              ) {
                send(request, errorResult('Forbidden'), 403);
                state.end();
                return false;
              }
              state.principal = Object.freeze({
                subject: principal.subject,
                tenant: principal.tenant,
                expiresAt: principal.expiresAt,
              });
              state.setDuration(limits.timeoutMs);
              return true;
            } catch (error) {
              report(error);
              send(request, errorResult('Forbidden'), 403);
              state.end();
              return false;
            }
          },
        ],
        /** Execute an authorized operation or bounded reauthorized subscription, draining actual jobs before provider disposal.
         * @param {unknown} input - Parsed request data validated by prepare.
         * @param {ZeruxRequestContext} request - Borrowed authenticated request owner.
         * @param {ModuleResolver} providers - Request-scoped provider resolver.
         * @returns {Promise<void>} Response/subscription handling and owned job cleanup settlement.
         */
        async handle(input, request, providers) {
          /** Operation-local cancellation, principal, deadline, job and loader ownership. */
          const state = pending.get(request)!;
          let reauth: ReturnType<typeof setInterval> | undefined,
            iterator: AsyncGenerator<string, void, undefined> | undefined;
          let ack = () => {};
          try {
            /** Validated single operation with bounded variables, selections and persisted policy. */
            const prepared = prepare(input);
            if (
              prepared.operation.operation === 'mutation' &&
              (await protectMutation(request, state.principal!)) !== true
            ) {
              send(request, errorResult('Forbidden'), 403);
              return;
            }
            state.controller.signal.throwIfAborted();
            /** Immutable authenticated operation context with operation-local loaders. */
            const context = makeContext(state, providers);
            state.context = context;
            /** Explicit native GraphQL execution inputs with this operation’s authenticated context. */
            const args = {
              schema,
              document: prepared.document,
              contextValue: context,
              variableValues: prepared.variableValues,
              operationName: prepared.operationName,
            };
            /** Project execution results while replacing internal field errors with fixed public messages.
             * @param {ExecutionResult} result - Native execution result with private causes.
             * @returns {ExecutionResult} Public result with redacted errors.
             */
            const clean = (result: ExecutionResult) => ({
              ...(result.data !== undefined ? { data: result.data } : {}),
              ...(result.errors?.length
                ? {
                    errors: result.errors.map((error) => {
                      report(error);
                      return new gql.GraphQLError('Field unavailable');
                    }),
                  }
                : {}),
            });
            if (prepared.operation.operation !== 'subscription') {
              /** Actual native execution or schema result before public projection. */
              const result = await gql.execute(args);
              if (Date.now() >= state.deadline) {
                state.cancel();
              }
              state.controller.signal.throwIfAborted();
              send(request, clean(result));
              return;
            }
            if (
              !subscriptions ||
              request.req.headers.accept !== 'text/event-stream'
            ) {
              send(request, errorResult('Subscription unavailable'), 400);
              return;
            }
            state.setDuration(subscriptions.maxDurationMs);
            let checking = false;
            reauth = setInterval(() => {
              if (checking) {
                return;
              }
              checking = true;
              /** Actual resolver/loader/reauthorization settlement retained until completion. */
              const job = Promise.resolve()
                .then(() =>
                  subscriptions.reauthorize(
                    state.principal!,
                    state.controller.signal
                  )
                )
                .then(
                  (ok) => {
                    if (ok !== true) {
                      state.cancel();
                    }
                  },
                  (error) => {
                    report(error);
                    state.cancel();
                  }
                )
                .finally(() => (checking = false));
              state.jobs.add(job);
              void job.then(
                () => state.jobs.delete(job),
                () => state.jobs.delete(job)
              );
            }, subscriptions.reauthorizeMs);
            let gate = Promise.resolve();
            /** Release subscription backpressure and request iterator return on operation cancellation.
             * @returns {void} Iterator cancellation scheduling completion.
             */
            const abort = () => {
              ack();
              void iterator?.return().catch(report);
            };
            state.controller.signal.addEventListener('abort', abort, {
              once: true,
            });
            /** Explicit optional graphql-sse handler for this authorized prepared operation. */
            const handler = sse!.createHandler({
              authenticate: () => null,
              onSubscribe: () => args,
              onNext: async (_ctx, _req, result) => {
                await gate;
                state.controller.signal.throwIfAborted();
                gate = new Promise<void>((resolve) => (ack = resolve));
                if ('hasNext' in result) {
                  throw fail('GRAPHQL_INCREMENTAL_UNSUPPORTED');
                }
                /** Sanitized subscription result checked against response budgets before framing. */
                const output = clean(result as ExecutionResult);
                serialize(output);
                return output as import('graphql-sse').ExecutionResult;
              },
            });
            /** Optional SSE library stream and response metadata for the already authorized operation. */
            const [body, init] = await handler({
              method: 'POST',
              url: request.url.href,
              headers: {
                get: (key) => {
                  if (key === 'accept') {
                    return 'text/event-stream';
                  }
                  if (key === 'content-type') {
                    return 'application/json';
                  }
                  return null;
                },
              },
              body: {
                query: prepared.query,
                variables: prepared.variableValues,
                operationName: prepared.operationName,
              },
              raw: request.req,
              context: undefined,
            });
            if (typeof body === 'string' || !body) {
              send(request, errorResult('Subscription unavailable'), 400);
              return;
            }
            iterator = body;
            request.res.writeHead(init.status, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-store, no-transform',
              'x-accel-buffering': 'no',
            });
            for await (const frame of iterator) {
              state.controller.signal.throwIfAborted();
              if (Buffer.byteLength(frame) > limits.maxResponseBytes + 128) {
                throw fail('GRAPHQL_RESPONSE_LIMIT');
              }
              if (!request.res.write(frame)) {
                await new Promise<void>((resolve) => {
                  /** Release this backpressure wait and detach both owned listeners.
                   * @returns {void} Drain/abort wait settlement notification.
                   */
                  const done = () => {
                    request.res.off('drain', done);
                    state.controller.signal.removeEventListener('abort', done);
                    resolve();
                  };
                  request.res.once('drain', done);
                  state.controller.signal.addEventListener('abort', done, {
                    once: true,
                  });
                  if (state.controller.signal.aborted) {
                    done();
                  }
                });
              }
              if (frame.startsWith('event: next')) {
                ack();
              }
            }
            request.res.end();
            state.controller.signal.removeEventListener('abort', abort);
          } catch (error) {
            report(error);
            if (!request.res.headersSent) {
              send(
                request,
                errorResult('Request rejected'),
                state.controller.signal.aborted ? 504 : 400
              );
            } else {
              request.res.end();
            }
          } finally {
            state.controller.abort();
            ack();
            if (reauth) {
              clearInterval(reauth);
            }
            await iterator?.return().catch(report);
            await Promise.allSettled([...state.jobs]);
          }
        },
        /** Release operation bookkeeping after request providers actually dispose.
         * @param {ZeruxRequestContext} request - Borrowed terminal request context.
         * @param {unknown} error - Optional private provider cleanup failure.
         * @returns {void} Terminal state cleanup completion.
         */
        onDispose(request, error) {
          if (error) {
            report(error);
          }
          pending.get(request)?.end();
        },
        /** Project a fixed failure response while releasing operation bookkeeping after controller failure.
         * @param {unknown} error - Private controller pipeline cause.
         * @param {ZeruxRequestContext} request - Borrowed request context.
         * @returns {void} Safe response scheduling and terminal bookkeeping completion.
         */
        filter(error, request) {
          report(error);
          pending.get(request)?.end();
          send(request, errorResult('Request rejected'), 400);
        },
      },
    ],
  });
  /** Stop new operations, cancel active observations, drain actual operation completion and close its module owner.
   * @returns {Promise<void>} Integration cleanup settlement; no automatic provider replays occur.
   */
  const close = async () => {
    closed = true;
    for (const state of active) {
      state.cancel();
    }
    await Promise.allSettled([...active].map((state) => state.done));
    await module.close();
  };
  try {
    api.onDispose(close);
  } catch (error) {
    await module.close();
    api.removeRoute(options.path, 'POST');
    throw error;
  }
  return Object.freeze({
    close,
    /** Count actual retained operations without principal/query labels.
     * @returns {number} Current operation ownership count.
     */
    get activeRequests() {
      return active.size;
    },
  });
}
