import { createHash, createHmac } from 'node:crypto';

export interface ExperimentVariant {
  name: string;
  weight: number;
}
export interface ExperimentDefinition {
  id: string;
  version: number;
  salt: string;
  variants: readonly ExperimentVariant[];
  environments: readonly string[];
  migration: 'initial' | 'preserve' | 'rebucket';
}
export interface CompiledExperiment extends ExperimentDefinition {
  allocationHash: string;
}
export interface ExperimentCatalog {
  schema: 'ztrial-experiments-v1';
  definitions: readonly CompiledExperiment[];
  fingerprint: string;
}
export interface VerifiedExperimentContext {
  tenant: string;
  subject: string;
  environment: string;
  consent: 'granted' | 'denied' | 'unknown';
}
export interface StoredExperimentAssignment {
  key: string;
  scope: string;
  experiment: string;
  version: number;
  allocationHash: string;
  variant: string;
  revision: number;
}
export interface ExperimentAssignmentStore {
  contract: 'ztrial-experiment-store-v1';
  durability: 'durable';
  /** Unique immutable (scope,experiment,version); reject conflicting rollout/salt fingerprints. */
  register(
    definition: {
      scope: string;
      experiment: string;
      version: number;
      fingerprint: string;
    },
    context: { signal: AbortSignal }
  ): Promise<'registered' | 'same' | 'conflict'>;
  get(
    key: string,
    context: { signal: AbortSignal }
  ): Promise<StoredExperimentAssignment | null>;
  /** Linearizable unique insert (null revision) or exact revision CAS; preserve key/scope/experiment. */
  cas(
    key: string,
    expectedRevision: number | null,
    next: StoredExperimentAssignment,
    context: { signal: AbortSignal }
  ): Promise<boolean>;
}
export interface ExperimentExposure {
  id: string;
  experiment: string;
  version: number;
  variant: string;
}
export interface ExperimentRecorder {
  contract: 'ztrial-experiment-recorder-v1';
  /** Durable unique receipt with immutable fields; never claim delivery from an ordinary analytics.track result. */
  recordOnce(
    exposure: Readonly<ExperimentExposure>,
    context: { signal: AbortSignal; scope: string; limit: number }
  ): Promise<'recorded' | 'duplicate' | 'capacity'>;
}
export interface ExperimentEvaluatorOptions {
  catalog: ExperimentCatalog;
  tenant: string;
  tenantSalt: Uint8Array;
  /** Trusted server code authenticates the principal and binds all context; no header parser is inferred. */
  resolveContext: (
    principal: unknown,
    context: { signal: AbortSignal }
  ) =>
    | VerifiedExperimentContext
    | null
    | Promise<VerifiedExperimentContext | null>;
  store?: ExperimentAssignmentStore;
  overrides?: readonly {
    experiment: string;
    version: number;
    subject: string;
    variant: string;
  }[];
  recording?: {
    recorder: ExperimentRecorder;
    failure: 'error' | 'ignore';
    maxRecords?: number;
  };
  maxConcurrent?: number;
  maxRecordPending?: number;
  timeoutMs?: number;
}
export type ExperimentEvaluation =
  | {
      status: 'denied';
      reason: 'identity' | 'tenant' | 'consent' | 'environment';
    }
  | {
      status: 'assigned';
      experiment: string;
      version: number;
      variant: string;
      allocationHash: string;
      explanation: {
        algorithm: 'hmac-sha256-basis-points-v1';
        reason: 'hashed' | 'override' | 'stored' | 'preserved' | 'rebucketed';
        persistence: 'stateless' | 'durable';
      };
      recording: 'disabled' | 'recorded' | 'duplicate' | 'failed';
    };
export class ExperimentError extends Error {
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Experiment evaluation failed (${code})`);
    this.name = 'ExperimentError';
    if (cause !== undefined)
      Object.defineProperty(this, 'cause', { value: cause });
  }
}
const fail = (code: string, cause?: unknown) =>
  new ExperimentError(code, cause);
function record(
  value: unknown,
  allowed: readonly string[]
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== 'string' ||
        !allowed.includes(k) ||
        !('value' in Object.getOwnPropertyDescriptor(value, k)!)
    )
  )
    throw fail('INVALID_OPTIONS');
}
function list<T>(value: readonly T[], min: number, max: number): T[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw fail('INVALID_LIST');
  const out: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) throw fail('INVALID_LIST');
    out.push(d.value);
  }
  return out;
}
const name = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
  )
    throw fail('INVALID_NAME');
  return value;
};
const opaque = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value))
    throw fail('INVALID_IDENTITY');
  return value;
};
const integer = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw fail('INVALID_LIMIT');
  return value;
};
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object'
      ? '{' +
        Object.keys(value)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ':' +
              canonical((value as Record<string, unknown>)[k])
          )
          .join(',') +
        '}'
      : JSON.stringify(value);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const catalogs = new WeakSet<object>();
/** Catalogs contain complete retained version history. No executable rules or client targeting traits. */
export function createExperimentCatalog(
  definitions: readonly ExperimentDefinition[]
): ExperimentCatalog {
  if (
    !Array.isArray(definitions) ||
    !definitions.length ||
    definitions.length > 128
  )
    throw fail('CATALOG_LIMIT');
  const result: CompiledExperiment[] = [],
    families = new Map<string, CompiledExperiment[]>();
  for (const raw of list(definitions, 1, 128)) {
    record(raw, [
      'id',
      'version',
      'salt',
      'variants',
      'environments',
      'migration',
    ]);
    const id = name(raw.id),
      version = integer(raw.version, 1, 10000),
      salt = opaque(raw.salt);
    if (
      !Array.isArray(raw.variants) ||
      raw.variants.length < 2 ||
      raw.variants.length > 16 ||
      !Array.isArray(raw.environments) ||
      !raw.environments.length ||
      raw.environments.length > 16 ||
      !['initial', 'preserve', 'rebucket'].includes(raw.migration as string)
    )
      throw fail('INVALID_DEFINITION');
    const variants = list(raw.variants, 2, 16).map((v) => {
      record(v, ['name', 'weight']);
      return { name: name(v.name), weight: integer(v.weight, 0, 10000) };
    });
    const environments = list(raw.environments, 1, 16).map(name).sort();
    if (
      new Set(variants.map((v) => v.name)).size !== variants.length ||
      variants.reduce((n, v) => n + v.weight, 0) !== 10000 ||
      new Set(environments).size !== environments.length
    )
      throw fail('INVALID_WEIGHTS_OR_NAMES');
    const definition: ExperimentDefinition = {
      id,
      version,
      salt,
      variants,
      environments,
      migration: raw.migration as ExperimentDefinition['migration'],
    };
    const compiled = {
      ...definition,
      allocationHash: hash(canonical(definition)),
    };
    result.push(compiled);
    const family = families.get(id) ?? [];
    family.push(compiled);
    families.set(id, family);
  }
  if (families.size > 32) throw fail('CATALOG_LIMIT');
  for (const family of families.values()) {
    family.sort((a, b) => a.version - b.version);
    if (family.length > 16) throw fail('CATALOG_LIMIT');
    for (let i = 0; i < family.length; i++) {
      const definition = family[i]!;
      if (
        definition.version !== i + 1 ||
        (i === 0
          ? definition.migration !== 'initial'
          : definition.migration === 'initial')
      )
        throw fail('MIGRATION_REQUIRED');
      if (
        i &&
        definition.migration === 'preserve' &&
        family[i - 1]!.variants.some(
          (v) => !definition.variants.some((n) => n.name === v.name)
        )
      )
        throw fail('PRESERVED_VARIANT_REMOVED');
    }
  }
  result.sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version
  );
  const catalog = freeze({
    schema: 'ztrial-experiments-v1' as const,
    definitions: result,
    fingerprint: hash(canonical(result)),
  });
  catalogs.add(catalog);
  return catalog;
}
/** The only in-process rollout update: exact next version and explicit migration required. */
export function evolveExperimentCatalog(
  previous: ExperimentCatalog,
  changes: readonly ExperimentDefinition[]
): ExperimentCatalog {
  if (
    !catalogs.has(previous) ||
    !Array.isArray(changes) ||
    !changes.length ||
    changes.length > 32
  )
    throw fail('INVALID_CATALOG');
  const seen = new Set<string>();
  for (const change of list<ExperimentDefinition>(changes, 1, 32)) {
    record(change, [
      'id',
      'version',
      'salt',
      'variants',
      'environments',
      'migration',
    ]);
    const history = previous.definitions.filter((d) => d.id === change.id),
      last = history.at(-1);
    if (
      !last ||
      seen.has(change.id) ||
      change.version !== last.version + 1 ||
      !['preserve', 'rebucket'].includes(change.migration)
    )
      throw fail('MIGRATION_REQUIRED');
    seen.add(change.id);
  }
  return createExperimentCatalog([
    ...previous.definitions.map(({ allocationHash: _, ...d }) => d),
    ...changes,
  ]);
}
/** Finite schema data consumed explicitly by analytics.createEventSchemaRegistry, with no dependency import. */
export function experimentAnalyticsSchema(catalog: ExperimentCatalog) {
  if (!catalogs.has(catalog)) throw fail('INVALID_CATALOG');
  const dimension = <T extends string | number>(
    type: 'string' | 'number',
    values: T[]
  ) => ({
    kind: 'dimension' as const,
    type,
    values,
    maxCardinality: values.length,
    required: true as const,
  });
  const ids = [...new Set(catalog.definitions.map((d) => d.id))],
    versions = [...new Set(catalog.definitions.map((d) => d.version))],
    variants = [
      ...new Set(
        catalog.definitions.flatMap((d) => d.variants.map((v) => v.name))
      ),
    ];
  if (variants.length > 256) throw fail('ANALYTICS_CARDINALITY_LIMIT');
  return {
    name: 'experiment.assignment.' + catalog.fingerprint,
    version: 1,
    properties: {
      experiment: dimension('string', ids),
      version: dimension('number', versions),
      variant: dimension('string', variants),
    },
  };
}
/** Server-only evaluation; no imports from test context, runner, browser adapter or analytics runtime. */
export function createExperimentEvaluator(options: ExperimentEvaluatorOptions) {
  record(options, [
    'catalog',
    'tenant',
    'tenantSalt',
    'resolveContext',
    'store',
    'overrides',
    'recording',
    'maxConcurrent',
    'maxRecordPending',
    'timeoutMs',
  ]);
  if (
    !catalogs.has(options.catalog) ||
    typeof options.resolveContext !== 'function' ||
    !(options.tenantSalt instanceof Uint8Array) ||
    options.tenantSalt.byteLength !== 32
  )
    throw fail('INVALID_CONFIGURATION');
  const tenant = opaque(options.tenant),
    secret = Buffer.from(options.tenantSalt),
    resolve = options.resolveContext,
    store = options.store,
    rawRecording = options.recording,
    catalog = options.catalog;
  if (rawRecording) record(rawRecording, ['recorder', 'failure', 'maxRecords']);
  const recording = rawRecording
    ? Object.freeze({
        recorder: rawRecording.recorder,
        failure: rawRecording.failure,
        maxRecords: integer(rawRecording.maxRecords ?? 100000, 1, 10000000),
      })
    : undefined;
  const maxConcurrent = integer(options.maxConcurrent ?? 32, 1, 128),
    maxRecordPending = integer(options.maxRecordPending ?? 8, 1, 16),
    timeoutMs = integer(options.timeoutMs ?? 3000, 1, 60000);
  if (
    store &&
    (store.contract !== 'ztrial-experiment-store-v1' ||
      store.durability !== 'durable' ||
      ['register', 'get', 'cas'].some(
        (k) => typeof (store as any)[k] !== 'function'
      ))
  )
    throw fail('INVALID_STORE');
  if (recording) {
    record(recording, ['recorder', 'failure', 'maxRecords']);
    if (
      recording.recorder?.contract !== 'ztrial-experiment-recorder-v1' ||
      typeof recording.recorder.recordOnce !== 'function' ||
      !['error', 'ignore'].includes(recording.failure)
    )
      throw fail('INVALID_RECORDER');
  }
  const families = new Map<string, CompiledExperiment[]>();
  for (const d of catalog.definitions) {
    const family = families.get(d.id) ?? [];
    family.push(d);
    families.set(d.id, family);
  }
  if (!store && catalog.definitions.some((d) => d.migration === 'preserve'))
    throw fail('PRESERVE_REQUIRES_DURABLE_STORE');
  const mac = (parts: unknown[]) =>
      createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex'),
    scope = hash(JSON.stringify(['ztrial.tenant.v1', tenant]));
  const keyFor = (experiment: string, subject: string) =>
    mac(['ztrial.assignment-key.v1', tenant, experiment, subject]);
  const overrides = new Map<string, string>();
  if (options.overrides !== undefined) {
    if (!Array.isArray(options.overrides) || options.overrides.length > 1024)
      throw fail('OVERRIDE_LIMIT');
    for (const raw of list(options.overrides, 0, 1024)) {
      record(raw, ['experiment', 'version', 'subject', 'variant']);
      const definition = families
        .get(name(raw.experiment))
        ?.find((d) => d.version === raw.version);
      if (
        !definition ||
        !definition.variants.some((v) => v.name === raw.variant)
      )
        throw fail('INVALID_OVERRIDE');
      const key =
        keyFor(definition.id, opaque(raw.subject)) + ':' + definition.version;
      if (overrides.has(key)) throw fail('DUPLICATE_OVERRIDE');
      overrides.set(key, raw.variant as string);
    }
  }
  const choose = (d: CompiledExperiment, subject: string, key: string) => {
    const override = overrides.get(key + ':' + d.version);
    if (override) return { variant: override, override: true };
    const digest = mac([
      'ztrial.bucket.v1',
      tenant,
      subject,
      d.id,
      d.version,
      d.salt,
    ]);
    const bucket = Number((BigInt('0x' + digest) * 10000n) >> 256n);
    let threshold = 0;
    for (const variant of d.variants) {
      threshold += variant.weight;
      if (bucket < threshold) return { variant: variant.name, override: false };
    }
    throw fail('INVALID_BUCKET');
  };
  let closed = false,
    recordPending = 0;
  const pending = new Set<Promise<unknown>>(),
    controllers = new Set<AbortController>();
  let closing: Promise<void> | undefined;
  const evaluate = async (
    experiment: string,
    principal: unknown,
    execution: { signal?: AbortSignal } = {}
  ): Promise<ExperimentEvaluation> => {
    name(experiment);
    record(execution, ['signal']);
    if (
      execution.signal !== undefined &&
      !(execution.signal instanceof AbortSignal)
    )
      throw fail('INVALID_SIGNAL');
    if (closed) throw fail('CLOSED');
    if (pending.size >= maxConcurrent) throw fail('OVERLOAD');
    const family = families.get(experiment);
    if (!family) throw fail('UNKNOWN_EXPERIMENT');
    const current = family.at(-1)!;
    const controller = new AbortController();
    controllers.add(controller);
    let expired = false;
    const abort = () => controller.abort(),
      check = () => {
        if (controller.signal.aborted)
          throw fail(expired ? 'DEADLINE' : 'CANCELLED');
      };
    execution.signal?.addEventListener('abort', abort, { once: true });
    if (execution.signal?.aborted) abort();
    let stop = () => {};
    const stopped = new Promise<never>((_, reject) => {
      stop = () => reject(fail(expired ? 'DEADLINE' : 'CANCELLED'));
      controller.signal.addEventListener('abort', stop, { once: true });
      if (controller.signal.aborted) stop();
    });
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, timeoutMs);
    const work = Promise.resolve().then(
      async (): Promise<ExperimentEvaluation> => {
        check();
        const context = await resolve(principal, { signal: controller.signal });
        check();
        if (!context) return { status: 'denied', reason: 'identity' };
        record(context, ['tenant', 'subject', 'environment', 'consent']);
        if (context.tenant !== tenant)
          return { status: 'denied', reason: 'tenant' };
        const subject = opaque(context.subject),
          environment = name(context.environment);
        if (!['granted', 'denied', 'unknown'].includes(context.consent))
          throw fail('INVALID_CONTEXT');
        if (context.consent !== 'granted')
          return { status: 'denied', reason: 'consent' };
        if (!current.environments.includes(environment))
          return { status: 'denied', reason: 'environment' };
        const key = keyFor(experiment, subject);
        let chosen = choose(current, subject, key),
          reason: Extract<
            ExperimentEvaluation,
            { status: 'assigned' }
          >['explanation']['reason'] = chosen.override ? 'override' : 'hashed';
        if (store) {
          for (const definition of family) {
            check();
            const registered = await store.register(
              {
                scope,
                experiment,
                version: definition.version,
                fingerprint: mac([
                  'ztrial.definition.v1',
                  tenant,
                  definition.allocationHash,
                ]),
              },
              { signal: controller.signal }
            );
            check();
            if (registered === 'conflict') throw fail('VERSION_CONFLICT');
            if (!['registered', 'same'].includes(registered))
              throw fail('INVALID_STORE_RESULT');
          }
          let committed = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            check();
            const old = await store.get(key, { signal: controller.signal });
            check();
            let revision: number | null = null;
            if (old) {
              record(old, [
                'key',
                'scope',
                'experiment',
                'version',
                'allocationHash',
                'variant',
                'revision',
              ]);
              const definition = family.find((d) => d.version === old.version);
              if (!definition || old.version > current.version)
                throw fail('ROLLBACK_OR_UNKNOWN_VERSION');
              if (
                old.key !== key ||
                old.scope !== scope ||
                old.experiment !== experiment ||
                old.allocationHash !== definition.allocationHash ||
                !definition.variants.some((v) => v.name === old.variant)
              )
                throw fail('CORRUPT_ASSIGNMENT');
              revision = integer(old.revision, 1, Number.MAX_SAFE_INTEGER - 1);
              chosen = { variant: old.variant, override: false };
              reason = 'stored';
              for (const definition of family.filter(
                (d) => d.version > old.version
              )) {
                if (definition.migration === 'rebucket') {
                  chosen = choose(definition, subject, key);
                  reason = 'rebucketed';
                } else {
                  reason = reason === 'rebucketed' ? 'rebucketed' : 'preserved';
                }
              }
              if (old.version === current.version) {
                committed = true;
                break;
              }
            }
            const next: StoredExperimentAssignment = {
              key,
              scope,
              experiment,
              version: current.version,
              allocationHash: current.allocationHash,
              variant: chosen.variant,
              revision: (revision ?? 0) + 1,
            };
            const changed = await store.cas(
              key,
              revision,
              Object.freeze(next),
              { signal: controller.signal }
            );
            check();
            if (changed === true) {
              committed = true;
              break;
            }
            if (changed !== false) throw fail('INVALID_STORE_RESULT');
          }
          if (!committed) throw fail('ASSIGNMENT_CONFLICT');
        }
        let recorded: 'disabled' | 'recorded' | 'duplicate' | 'failed' =
          'disabled';
        if (recording) {
          try {
            if (recordPending >= maxRecordPending)
              throw fail('RECORDING_OVERLOAD');
            recordPending++;
            try {
              check();
              const outcome = await recording.recorder.recordOnce(
                Object.freeze({
                  id: mac(['ztrial.exposure.v1', key, current.version]),
                  experiment,
                  version: current.version,
                  variant: chosen.variant,
                }),
                {
                  signal: controller.signal,
                  scope: mac([
                    'ztrial.recording-scope.v1',
                    tenant,
                    experiment,
                    current.version,
                  ]),
                  limit: recording.maxRecords,
                }
              );
              if (outcome === 'capacity') throw fail('RECORDING_CAPACITY');
              if (!['recorded', 'duplicate'].includes(outcome))
                throw fail('INVALID_RECORDER_RESULT');
              recorded = outcome;
            } finally {
              recordPending--;
            }
          } catch (cause) {
            if (recording.failure === 'error')
              throw cause instanceof ExperimentError &&
                ['RECORDING_OVERLOAD', 'RECORDING_CAPACITY'].includes(
                  cause.code
                )
                ? cause
                : fail('RECORDING_UNCERTAIN', cause);
            recorded = 'failed';
          }
        }
        check();
        return {
          status: 'assigned',
          experiment,
          version: current.version,
          variant: chosen.variant,
          allocationHash: current.allocationHash,
          explanation: {
            algorithm: 'hmac-sha256-basis-points-v1',
            reason,
            persistence: store ? 'durable' : 'stateless',
          },
          recording: recorded,
        };
      }
    );
    pending.add(work);
    void work
      .finally(() => {
        pending.delete(work);
        controllers.delete(controller);
      })
      .catch(() => {});
    try {
      return await Promise.race([work, stopped]);
    } catch (cause) {
      throw cause instanceof ExperimentError
        ? cause
        : fail('DEPENDENCY_UNAVAILABLE', cause);
    } finally {
      clearTimeout(timer);
      execution.signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', stop);
    }
  };
  return Object.freeze({
    evaluate,
    describe: () => catalog,
    diagnostics: () => ({ closed, pending: pending.size, recordPending }),
    close() {
      if (closing) return closing;
      closed = true;
      for (const c of controllers) c.abort();
      closing = Promise.allSettled([...pending]).then(() => {
        secret.fill(0);
        overrides.clear();
      });
      return closing;
    },
  });
}
