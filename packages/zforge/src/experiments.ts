import type {
  createExperimentEvaluator,
  ExperimentEvaluatorOptions,
} from 'ztrial/experiments';
import type {
  DevtoolsEndpointContext,
  DevtoolsModuleEndpoint,
  TransportDevtoolsModule,
} from './module-endpoints.js';

export interface ExperimentInspectionAudit {
  /** Explicit authorized inspection operation. */
  action: 'inspect' | 'preview' | 'test';
  /** Host application identity associated with the operator action. */
  appId: string;
  /** Framework generation identity fencing stale operator controls. */
  generationId: string;
  /** Module load epoch distinguishing replacement definitions. */
  moduleEpoch: number;
  /** Verified operator reference; never private experiment subject traits. */
  actor: string;
  /** Bounded registered experiment identifier. */
  experiment: string;
  /** Audit event time in epoch milliseconds. */
  at: number;
  /** Optional display-preview expiry; does not persist an assignment override. */
  expiresAt?: number;
  /** Optional declared preview variant name. */
  variant?: string;
  /** Optional explicit trusted callback name. */
  test?: string;
  /** Authorized/completed/failed audit phase. */
  phase: 'authorized' | 'completed' | 'failed';
}
export interface ExperimentInspectionOptions {
  /** Development mode is required; production rejects before evaluator acquisition. */
  mode: 'development' | 'production';
  /** Explicit shared evaluator factory injected by the host; imports remain type-only. */
  createEvaluator: typeof createExperimentEvaluator;
  /** Private host configuration. Store/recording/assignment overrides are deliberately excluded. */
  evaluation: Pick<
    ExperimentEvaluatorOptions,
    'catalog' | 'tenant' | 'tenantSalt' | 'resolveContext'
  >;
  /** Bounded explicit MCP endpoint settings with exact origins and host-owned authentication. */
  endpoint: Pick<
    Extract<DevtoolsModuleEndpoint, { kind: 'mcp' }>,
    'bind' | 'publicOrigin' | 'allowedOrigins' | 'limits'
  >;
  /** Reauthorize the authenticated operator for the specific inspection action.
   * @param {ExperimentInspectionAudit['action']} action - Fixed inspect/preview/test action.
   * @param {DevtoolsEndpointContext} context - Verified initiating tenant/operator context supplied by the endpoint host.
   * @returns {boolean | Promise<boolean>} True only when current host policy explicitly permits this action.
   */
  authorize(
    action: ExperimentInspectionAudit['action'],
    context: DevtoolsEndpointContext
  ): boolean | Promise<boolean>;
  /** Verify session-bound CSRF for mutating preview/test operations after exact-origin checks.
   * @param {DevtoolsEndpointContext['request']} request - Actual authenticated native request, not client-provided identity fields.
   * @param {DevtoolsEndpointContext} context - Verified host endpoint context for this operation.
   * @returns {boolean | Promise<boolean>} True only when host CSRF policy accepts the initiating request.
   */
  verifyCsrf(
    request: DevtoolsEndpointContext['request'],
    context: DevtoolsEndpointContext
  ): boolean | Promise<boolean>;
  /** Persist identifier-only operator audit metadata without private evaluation traits.
   * @param {Readonly<ExperimentInspectionAudit>} event - Frozen authorized/completed/failed receipt; terminal failure cannot undo prior side effects.
   * @returns {void | Promise<void>} Required sink settlement according to the host durability policy.
   */
  audit(event: Readonly<ExperimentInspectionAudit>): void | Promise<void>;
  /** Bounded explicit trusted boolean test callbacks; no discovery or arbitrary command execution. */
  tests?: Readonly<
    Record<
      string,
      (context: DevtoolsEndpointContext) => boolean | Promise<boolean>
    >
  >;
}
/** Validate bounded authored experiment/test identifiers without importing or evaluating names.
 * @param {unknown} v - Candidate explicit identifier.
 * @returns {boolean} Whether the bounded grammar accepts the value as a string.
 */
const token = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(v);
/** Describe an opt-in development inspection module without mutating production assignments.
 * @param {ExperimentInspectionOptions} options - Explicit host evaluator, auth/CSRF/audit policies and bounded endpoint settings.
 * @returns {TransportDevtoolsModule} Inert module definition; setup acquires the evaluator and disposal closes it.
 */
export function createExperimentInspectionModule(
  options: ExperimentInspectionOptions
): TransportDevtoolsModule {
  if (options.mode !== 'development') {
    throw new Error('Experiment inspection requires development mode');
  }
  if (
    typeof options.createEvaluator !== 'function' ||
    typeof options.authorize !== 'function' ||
    typeof options.verifyCsrf !== 'function' ||
    typeof options.audit !== 'function'
  ) {
    throw new TypeError('Explicit experiment inspection policies required');
  }
  /** Private host evaluation configuration; persistence, recording and assignment overrides are forbidden. */
  const config = options.evaluation;
  if (
    !config ||
    Object.keys(config).some(
      (k) => !['catalog', 'tenant', 'tenantSalt', 'resolveContext'].includes(k)
    )
  ) {
    throw new TypeError(
      'Inspection cannot configure persistence, recording or assignment overrides'
    );
  }
  /** Explicit bounded trusted callback registry; client strings never become executable source. */
  const tests = new Map(Object.entries(options.tests ?? {}));
  if (
    tests.size > 16 ||
    [...tests].some(([k, v]) => !token(k) || typeof v !== 'function')
  ) {
    throw new TypeError('Invalid trusted test registry');
  }
  /** Exact configured origins required independently from authenticated operator authorization. */
  const origins = [...options.endpoint.allowedOrigins];
  if (
    !origins.length ||
    origins.some((value) => {
      try {
        return new URL(value).origin !== value;
      } catch {
        return true;
      }
    })
  ) {
    throw new TypeError('Explicit inspection origins required');
  }
  // Delay ownership acquisition until module setup, so an unused definition owns no secret copy.
  let evaluator: ReturnType<typeof createExperimentEvaluator> | undefined;
  let disposed = false;
  /** Fence execution against disposal, request cancellation and both credential/deadline expiry.
   * @param {DevtoolsEndpointContext} ctx - Verified host-bound endpoint context.
   * @returns {void} Returns only while the inspection generation remains active.
   */
  const check = (ctx: DevtoolsEndpointContext) => {
    ctx.signal.throwIfAborted();
    if (
      disposed ||
      !evaluator ||
      Date.now() >= ctx.deadline ||
      Date.now() >= ctx.principal.expiresAt
    ) {
      throw new Error('Inspection inactive');
    }
  };
  /** Await the required redacted host audit sink before subsequent execution.
   * @param {ExperimentInspectionAudit["action"]} action - Explicit operator operation.
   * @param {ExperimentInspectionAudit["phase"]} phase - Authorized/completed/failed receipt.
   * @param {Record<string, unknown>} args - Validated identifier-only input.
   * @param {DevtoolsEndpointContext} ctx - Authenticated host context without private traits in the emitted record.
   * @param {number} [expiresAt] - Bounded display-preview expiry.
   * @returns {Promise<void>} Audit settlement; terminal failure cannot undo an already-run trusted callback.
   */
  const emit = async (
    action: ExperimentInspectionAudit['action'],
    phase: ExperimentInspectionAudit['phase'],
    args: Record<string, unknown>,
    ctx: DevtoolsEndpointContext,
    expiresAt?: number
  ) => {
    await options.audit(
      Object.freeze({
        action,
        phase,
        appId: ctx.appId,
        generationId: ctx.generationId,
        moduleEpoch: ctx.moduleEpoch,
        actor: ctx.principal.subject,
        experiment: String(args.experiment),
        at: Date.now(),
        ...(expiresAt ? { expiresAt } : {}),
        ...(action === 'preview' ? { variant: String(args.variant) } : {}),
        ...(action === 'test' ? { test: String(args.test) } : {}),
      })
    );
  };
  /** Describe one explicitly allowed inspection action with per-call authorization and bounded output.
   * @param {ExperimentInspectionAudit["action"]} action - Fixed inspect/preview/test operation.
   * @returns {object} Inert MCP tool definition; module setup owns evaluator acquisition.
   */
  const tool = (action: ExperimentInspectionAudit['action']) => ({
    name: 'experiment.' + action,
    inputSchema: {
      type: 'object',
      properties: {
        experiment: { type: 'string' },
        ...(action === 'preview'
          ? { variant: { type: 'string' }, ttlMs: { type: 'integer' } }
          : {}),
        ...(action === 'test' ? { test: { type: 'string' } } : {}),
      },
      required: [
        'experiment',
        ...(action === 'preview' ? ['variant', 'ttlMs'] : []),
        ...(action === 'test' ? ['test'] : []),
      ],
      additionalProperties: false,
    },
    authorize: async (
      _args: Record<string, unknown>,
      ctx: DevtoolsEndpointContext
    ) => {
      check(ctx);
      if ((await options.authorize(action, ctx)) !== true) {
        return false;
      }
      if (action !== 'inspect') {
        if (
          ctx.request.method !== 'POST' ||
          !origins.includes(String(ctx.request.headers.origin ?? ''))
        ) {
          return false;
        }
        if ((await options.verifyCsrf(ctx.request, ctx)) !== true) {
          return false;
        }
      }
      check(ctx);
      return true;
    },
    handle: async (
      args: Record<string, unknown>,
      ctx: DevtoolsEndpointContext
    ) => {
      check(ctx);
      /** Exact action-specific input key allowlist checked before evaluator or test dispatch. */
      const keys = [
        'experiment',
        ...(action === 'preview' ? ['variant', 'ttlMs'] : []),
        ...(action === 'test' ? ['test'] : []),
      ];
      if (
        Object.keys(args).some((k) => !keys.includes(k)) ||
        !token(args.experiment)
      ) {
        throw new TypeError('Invalid inspection arguments');
      }
      /** Latest registered experiment definition selected from the injected shared evaluator catalog. */
      const definition = evaluator!
        .describe()
        .definitions.filter((d) => d.id === args.experiment)
        .at(-1);
      if (!definition) {
        throw new Error('Unknown experiment');
      }
      if (
        action === 'preview' &&
        (!definition.variants.some((v) => v.name === args.variant) ||
          !Number.isSafeInteger(args.ttlMs) ||
          Number(args.ttlMs) < 1 ||
          Number(args.ttlMs) > 60000)
      ) {
        throw new TypeError('Invalid preview');
      }
      if (action === 'test' && (!token(args.test) || !tests.has(args.test))) {
        throw new TypeError('Unknown test');
      }
      /** Display-only preview expiry capped by requested TTL, credential expiry and request deadline. */
      const expiresAt =
        action === 'preview'
          ? Math.min(
              Date.now() + Number(args.ttlMs),
              ctx.principal.expiresAt,
              ctx.deadline
            )
          : undefined;
      await emit(action, 'authorized', args, ctx, expiresAt);
      check(ctx);
      try {
        /** Shared deterministic evaluator result retaining tenant/environment/consent denial semantics. */
        const decision = await evaluator!.evaluate(
          args.experiment,
          ctx.principal,
          { signal: ctx.signal }
        );
        check(ctx);
        if (decision.status === 'denied') {
          await emit(action, 'completed', args, ctx);
          return { status: 'denied', reason: decision.reason };
        }
        // Rebuild public data; do not spread resolver/context/test output into the response.
        /** Rebuilt public explanation fields only; private traits and raw test output are never spread. */
        const result = {
          status: action === 'preview' ? 'preview' : 'assigned',
          experiment: decision.experiment,
          version: decision.version,
          variant:
            action === 'preview' ? String(args.variant) : decision.variant,
          reason: decision.explanation.reason,
          algorithm: decision.explanation.algorithm,
          variants: definition.variants.map((v) => ({
            name: v.name,
            weight: v.weight,
          })),
          previewOnly: action === 'preview',
          ...(expiresAt ? { expiresAt } : {}),
          ...(action === 'test'
            ? { passed: await tests.get(String(args.test))!(ctx) }
            : {}),
        };
        if (action === 'test' && typeof result.passed !== 'boolean') {
          throw new TypeError('Invalid test outcome');
        }
        check(ctx);
        await emit(action, 'completed', args, ctx, expiresAt);
        check(ctx);
        return result;
      } catch (error) {
        await emit(action, 'failed', args, ctx, expiresAt);
        throw new Error('Experiment inspection failed', { cause: error });
      }
    },
  });
  return {
    id: 'experiments',
    title: 'Experiments',
    endpoints: [
      {
        ...options.endpoint,
        allowedOrigins: origins,
        id: 'controls',
        kind: 'mcp',
        tools: [tool('inspect'), tool('preview'), tool('test')],
        publicFields: [
          'status',
          'reason',
          'experiment',
          'version',
          'variant',
          'algorithm',
          'variants',
          'name',
          'weight',
          'previewOnly',
          'expiresAt',
          'passed',
        ],
      },
    ],
    /** Acquire one stateless shared evaluator only when the module is explicitly loaded.
     * @param {{onDispose: (callback: () => Promise<void>) => void}} context - Host module cleanup registrar owning evaluator close and callback registry release.
     * @returns {Promise<void>} Completes after evaluator creation and teardown registration.
     */
    async setup({ onDispose }) {
      if (disposed || evaluator) {
        throw new Error('Create a fresh inspection module for each load');
      }
      evaluator = options.createEvaluator({
        catalog: config.catalog,
        tenant: config.tenant,
        tenantSalt: config.tenantSalt,
        resolveContext: config.resolveContext,
        maxConcurrent: 4,
        timeoutMs: Math.min(options.endpoint.limits.timeoutMs, 60000),
      });
      onDispose(async () => {
        disposed = true;
        await evaluator!.close();
        tests.clear();
      });
    },
  };
}
