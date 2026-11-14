import { createHash, createHmac } from 'node:crypto';

/** One explicit named basis-point interval; allocation percentages are not statistical evidence. */
export interface ExperimentVariant {
  /** Validated unique public variant label, excluding private traits. */
  name: string;
  /** Integer basis points from zero through10000; the full ordered variant list sums exactly10000. */
  weight: number;
}
/** Versioned immutable public rollout facts with explicit environment and migration policy. */
export interface ExperimentDefinition {
  /** Stable public experiment or opaque exposure identifier according to its declared record, never permission evidence. */
  id: string;
  /** Positive retained contiguous rollout version; changing allocation policy requires explicit migration. */
  version: number;
  /** Explicit public allocation salt, not the secret tenant key. */
  salt: string;
  /** Two through sixteen ordered named variants with finite validated basis-point weights. */
  variants: readonly ExperimentVariant[];
  /** One through sixteen explicit allowed server environment labels. */
  environments: readonly string[];
  /** Explicit initial/preserve/rebucket policy; preservation requires durable assignment history. */
  migration: 'initial' | 'preserve' | 'rebucket';
}
/** Validated rollout declaration with deterministic content fingerprint. */
export interface CompiledExperiment extends ExperimentDefinition {
  /** Deterministic validated definition content hash; not authorship or authorization evidence. */
  allocationHash: string;
}
/** Branded immutable complete retained-history snapshot, independent of test execution. */
export interface ExperimentCatalog {
  /** Fixed inert branded experiment catalog discriminator. */
  schema: 'ztrial-experiments-v1';
  /** Complete bounded immutable retained definition history. */
  definitions: readonly CompiledExperiment[];
  /** Deterministic full-catalog/tenant-bound definition fingerprint according to its declared contract. */
  fingerprint: string;
}
/** Trusted resolver output; the host authenticates the initiating principal and binds tenant/consent. */
export interface VerifiedExperimentContext {
  /** Opaque host-verified tenant token bound to this evaluator, never an arbitrary browser role. */
  tenant: string;
  /** Opaque authenticated initiating subject; never infer identity from raw email/IP/traits. */
  subject: string;
  /** Trusted server environment selected by the resolver, not a request override. */
  environment: string;
  /** Explicit verified granted/denied/unknown consent; allocation effects require granted. */
  consent: 'granted' | 'denied' | 'unknown';
}
/** Private host-durable CAS snapshot, revalidated against retained rollout history. */
export interface StoredExperimentAssignment {
  /** Stable private tenant/subject/experiment HMAC reference. */
  key: string;
  /** Private stable tenant namespace revalidated on every durable assignment read. */
  scope: string;
  /** Validated immutable public experiment name. */
  experiment: string;
  /** Positive retained contiguous rollout version; changing allocation policy requires explicit migration. */
  version: number;
  /** Deterministic validated definition content hash; not authorship or authorization evidence. */
  allocationHash: string;
  /** Declared named variant; identical labels do not grant resource permissions. */
  variant: string;
  /** Positive durable CAS revision, never local last-writer-wins. */
  revision: number;
}
/** Borrowed host-qualified linearizable durable primary contract; no production adapter is implied. */
export interface ExperimentAssignmentStore {
  /** Exact host store/recorder protocol discriminator; not proof a particular implementation is durable. */
  contract: 'ztrial-experiment-store-v1';
  /** Required explicit durable-primary guarantee supplied and qualified by the host. */
  durability: 'durable';
  /** Atomically register or compare one immutable tenant-scoped experiment version on a host-owned durable linearizable primary.
 * @param {{
      scope: string;
      experiment: string;
      version: number;
      fingerprint: string;
    }} definition - Bounded immutable scope/experiment/version/fingerprint tuple supplied by the trusted evaluator.
 * @param {{ signal: AbortSignal }} context - Explicit cooperative signal; timeout does not prove native write rollback.
 * @returns {Promise<'registered' | 'same' | 'conflict'>} Actual durable registration disposition; a cache get/set sequence cannot implement this contract.
 */
  register(
    definition: {
      /** Private stable tenant namespace revalidated on every durable assignment read. */
      scope: string;
      /** Validated immutable public experiment name. */
      experiment: string;
      /** Positive retained contiguous rollout version; changing allocation policy requires explicit migration. */
      version: number;
      /** Deterministic full-catalog/tenant-bound definition fingerprint according to its declared contract. */
      fingerprint: string;
    },
    context: {
      /** Explicit cooperative operation cancellation; native writes may still commit after observation timeout. */
      signal: AbortSignal;
    }
  ): Promise<'registered' | 'same' | 'conflict'>;
  /** Read one private tenant-bound assignment from the host-owned durable primary.
   * @param {string} key - Evaluator-generated tenant/subject/experiment HMAC reference, never raw email.
   * @param {{ signal: AbortSignal }} context - Cooperative execution signal under the caller’s actual work slot.
   * @returns {Promise<StoredExperimentAssignment | null>} Private stored snapshot or absence; evaluator independently validates scope/version/variant/revision.
   */
  get(
    key: string,
    context: {
      /** Explicit cooperative operation cancellation; native writes may still commit after observation timeout. */
      signal: AbortSignal;
    }
  ): Promise<StoredExperimentAssignment | null>;
  /** Atomically unique-insert or exact-revision-advance one private assignment, preserving its tenant scope and immutable rollout facts.
   * @param {string} key - Evaluator-generated stable private assignment key.
   * @param {number | null} expectedRevision - Null for unique insert, otherwise exact observed revision.
   * @param {StoredExperimentAssignment} next - Frozen next declared assignment value; host store enforces linearizable revision ownership.
   * @param {{ signal: AbortSignal }} context - Cooperative execution signal; ambiguous native results are never automatically replayed as success.
   * @returns {Promise<boolean>} True only on committed comparison/insertion, false only on known contention; native failures reject.
   */
  cas(
    key: string,
    expectedRevision: number | null,
    next: StoredExperimentAssignment,
    context: {
      /** Explicit cooperative operation cancellation; native writes may still commit after observation timeout. */
      signal: AbortSignal;
    }
  ): Promise<boolean>;
}
/** Bounded sanitized experiment facts plus a stable private idempotent receipt reference. */
export interface ExperimentExposure {
  /** Stable public experiment or opaque exposure identifier according to its declared record, never permission evidence. */
  id: string;
  /** Validated immutable public experiment name. */
  experiment: string;
  /** Positive retained contiguous rollout version; changing allocation policy requires explicit migration. */
  version: number;
  /** Declared named variant; identical labels do not grant resource permissions. */
  variant: string;
}
/** Borrowed host-durable unique receipt/cardinality contract, separate from analytics delivery. */
export interface ExperimentRecorder {
  /** Exact host store/recorder protocol discriminator; not proof a particular implementation is durable. */
  contract: 'ztrial-experiment-recorder-v1';
  /** Persist one immutable exposure receipt under an atomic per-scope capacity limit, checking duplicates before capacity; no analytics.track return implies durable success.
   * @param {Readonly<ExperimentExposure>} exposure - Bounded immutable public experiment/version/variant plus stable private exposure reference.
   * @param {{ signal: AbortSignal; scope: string; limit: number }} context - Cooperative signal, private recording namespace and finite receipt cardinality ceiling.
   * @returns {Promise<'recorded' | 'duplicate' | 'capacity'>} Actual durable disposition; conflicting duplicates reject and unknown native failures remain uncertain.
   */
  recordOnce(
    exposure: Readonly<ExperimentExposure>,
    context: {
      /** Explicit cooperative operation cancellation; native writes may still commit after observation timeout. */
      signal: AbortSignal;
      /** Private stable tenant namespace revalidated on every durable assignment read. */
      scope: string;
      /** Atomic recorder receipt cardinality ceiling; duplicates must be checked before capacity. */
      limit: number;
    }
  ): Promise<'recorded' | 'duplicate' | 'capacity'>;
}
/** Explicit server-only tenant/key/authentication/persistence/work policy; no browser role claims. */
export interface ExperimentEvaluatorOptions {
  /** Branded immutable catalog created by this package, not arbitrary parsed JSON. */
  catalog: ExperimentCatalog;
  /** Opaque host-verified tenant token bound to this evaluator, never an arbitrary browser role. */
  tenant: string;
  /** Exactly32host-owned secret bytes, copied at evaluator construction; never logged or exposed. */
  tenantSalt: Uint8Array;
  /** Trusted server code authenticates the principal and binds all context; no header parser is inferred. */
  resolveContext: (
    principal: unknown,
    context: {
      /** Explicit cooperative operation cancellation; native writes may still commit after observation timeout. */
      signal: AbortSignal;
    }
  ) =>
    | VerifiedExperimentContext
    | null
    | Promise<VerifiedExperimentContext | null>;
  /** Optional borrowed host-owned qualified linearizable durable assignment store. */
  store?: ExperimentAssignmentStore;
  /** Bounded explicit trusted private overrides; requests cannot supply targeting traits or override roles. */
  overrides?: readonly {
    /** Validated immutable public experiment name. */
    experiment: string;
    /** Positive retained contiguous rollout version; changing allocation policy requires explicit migration. */
    version: number;
    /** Opaque authenticated initiating subject; never infer identity from raw email/IP/traits. */
    subject: string;
    /** Declared named variant; identical labels do not grant resource permissions. */
    variant: string;
  }[];
  /** Explicit optional durable recording policy or sanitized recording outcome, never implicit telemetry. */
  recording?: {
    /** Borrowed host-owned durable unique-receipt recorder. */
    recorder: ExperimentRecorder;
    /** Explicit recording outage policy: reject or return assigned with failed recording coverage. */
    failure: 'error' | 'ignore';
    /** Atomic per-recording-scope retained receipt ceiling, default100000 and at most10000000. */
    maxRecords?: number;
  };
  /** Per-evaluator actual pending work cap from1through128, default32. */
  maxConcurrent?: number;
  /** Actual simultaneous recorder callback cap from1through16, default8. */
  maxRecordPending?: number;
  /** Per-evaluation observation deadline from1through60000milliseconds, default3000. */
  timeoutMs?: number;
}
/** Sanitized assignment/eligibility receipt; never authority to access a resource or claim statistical significance. */
export type ExperimentEvaluation =
  | {
      /** Explicit denied or assigned outcome, never an authorization grant. */
      status: 'denied';
      /** Sanitized eligibility/allocation explanation with no subject/tenant/private traits. */
      reason: 'identity' | 'tenant' | 'consent' | 'environment';
    }
  | {
      /** Explicit denied or assigned outcome, never an authorization grant. */
      status: 'assigned';
      /** Validated immutable public experiment name. */
      experiment: string;
      /** Positive retained contiguous rollout version; changing allocation policy requires explicit migration. */
      version: number;
      /** Declared named variant; identical labels do not grant resource permissions. */
      variant: string;
      /** Deterministic validated definition content hash; not authorship or authorization evidence. */
      allocationHash: string;
      /** Sanitized algorithm/reason/persistence provenance only. */
      explanation: {
        /** Versioned stable cryptographic bucketing algorithm label. */
        algorithm: 'hmac-sha256-basis-points-v1';
        /** Sanitized eligibility/allocation explanation with no subject/tenant/private traits. */
        reason: 'hashed' | 'override' | 'stored' | 'preserved' | 'rebucketed';
        /** Explicit stateless or host-durable assignment mode. */
        persistence: 'stateless' | 'durable';
      };
      /** Explicit optional durable recording policy or sanitized recording outcome, never implicit telemetry. */
      recording: 'disabled' | 'recorded' | 'duplicate' | 'failed';
    };
/** Fixed public evaluation error code with nonenumerable host-private native cause. */
export class ExperimentError extends Error {
  /** Create a fixed public experiment error code with an optional nonenumerable host-private cause.
   * @param {string} code - Fixed internal outcome classification.
   * @param {unknown} cause - Optional private native authentication/store/recorder failure.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Experiment evaluation failed (${code})`);
    this.name = 'ExperimentError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Create a fixed experiment failure with optional private nonenumerable native cause.
 * @param {string} code Fixed internal classification.
 * @param {unknown} cause Optional private native/store/authentication failure.
 * @returns {ExperimentError} Redacted public error with host-private cause. */
const fail = (code: string, cause?: unknown) =>
  new ExperimentError(code, cause);
/** Require a plain inert own-data record with only explicitly supported keys; trusted JavaScript Proxy traps remain outside a data-validation sandbox.
 * @param {unknown} value - Unknown parsed configuration/store/context record.
 * @param {readonly string[]} allowed - Fixed supported field names for this specific boundary.
 * @returns {void} Narrows supported data records or throws before further evaluation.
 */
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
  ) {
    throw fail('INVALID_OPTIONS');
  }
}
/** Copy a bounded dense ordinary array of own data elements, rejecting sparse/accessor/extra-field shapes.
 * @param {readonly T[]} value - Unknown-at-runtime list from validated host data.
 * @param {number} min - Inclusive minimum allowed element count.
 * @param {number} max - Inclusive maximum allowed element count.
 * @returns {T[]} Detached dense element list; nested schemas are validated by their owning caller.
 */
function list<T>(value: readonly T[], min: number, max: number): T[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw fail('INVALID_LIST');
  }
  /** Detached dense copied list awaiting its specific element-schema validation. */
  const out: T[] = [];
  for (let i = 0; i < value.length; i++) {
    /** Own data descriptor, retained experiment record or trusted version definition according to the enclosing validated loop. */
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) {
      throw fail('INVALID_LIST');
    }
    out.push(d.value);
  }
  return out;
}
/** Validate one bounded public experiment/variant/environment label without coercion.
 * @param {unknown} value Unknown parsed label.
 * @returns {string} Supported explicit public name or a fixed validation failure. */
const name = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
  ) {
    throw fail('INVALID_NAME');
  }
  return value;
};
/** Require an explicit bounded opaque identity/allocation token; syntactic validity is never authentication.
 * @param {unknown} value Host-resolved opaque token.
 * @returns {string} Supported ASCII token; raw email/IP/traits are not accepted. */
const opaque = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw fail('INVALID_IDENTITY');
  }
  return value;
};
/** Require an inclusive safe-integer policy without coercing strings.
 * @param {unknown} value Unknown configuration/store number.
 * @param {number} min Inclusive minimum.
 * @param {number} max Inclusive maximum.
 * @returns {number} Validated finite policy/revision value. */
const integer = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw fail('INVALID_LIMIT');
  }
  return value;
};
/** Serialize only already validated inert definition arrays/records with stable sorted keys.
 * @param {unknown} value Bounded owned plain catalog data; not an arbitrary executable object.
 * @returns {string} Stable deterministic representation used only for hashing. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  } else {
    if (value && typeof value === 'object') {
      return (
        '{' +
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
      );
    } else {
      return JSON.stringify(value);
    }
  }
};
/** Hash declared inert UTF-8 text for content identity, never authentication or anonymization.
 * @param {string} text Explicit bounded canonical data.
 * @returns {string} Lower-case SHA-256 digest. */
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** Recursively freeze newly constructed validated inert catalog data; never use this helper as a hostile-object sandbox.
 * @param {T} value - Owned bounded plain catalog object/array.
 * @returns {T} Same recursively frozen owned value.
 */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Weak brand set for this module’s own immutable validated catalogs; no durable global feature state. */
const catalogs = new WeakSet<object>();
/** Validate/detach/freeze complete bounded version history with explicit named basis-point weights and migration policy; no runtime evaluation or analytics begins.
 * @param {readonly ExperimentDefinition[]} definitions - Explicit trusted inert definitions with complete contiguous retained history.
 * @returns {ExperimentCatalog} Immutable branded catalog snapshot and deterministic content fingerprint; no subject traits are retained.
 */
export function createExperimentCatalog(
  definitions: readonly ExperimentDefinition[]
): ExperimentCatalog {
  if (
    !Array.isArray(definitions) ||
    !definitions.length ||
    definitions.length > 128
  ) {
    throw fail('CATALOG_LIMIT');
  }
  /** Detached compiled definition list before immutable publication. */
  const result: CompiledExperiment[] = [];
  /** Bounded retained version lists keyed by stable experiment name. */
  const families = new Map<string, CompiledExperiment[]>();
  for (const raw of list(definitions, 1, 128)) {
    record(raw, [
      'id',
      'version',
      'salt',
      'variants',
      'environments',
      'migration',
    ]);
    /** Validated stable experiment identifier. */
    const id = name(raw.id);
    /** Validated positive declared rollout version. */
    const version = integer(raw.version, 1, 10000);
    /** Validated explicit public allocation salt, separate from the secret tenant key. */
    const salt = opaque(raw.salt);
    if (
      !Array.isArray(raw.variants) ||
      raw.variants.length < 2 ||
      raw.variants.length > 16 ||
      !Array.isArray(raw.environments) ||
      !raw.environments.length ||
      raw.environments.length > 16 ||
      !['initial', 'preserve', 'rebucket'].includes(raw.migration as string)
    ) {
      throw fail('INVALID_DEFINITION');
    }
    /** Detached declared ordered named basis-point intervals. */
    const variants = list(raw.variants, 2, 16).map((v) => {
      record(v, ['name', 'weight']);
      return { name: name(v.name), weight: integer(v.weight, 0, 10000) };
    });
    /** Detached validated unique server environment eligibility labels, sorted deterministically. */
    const environments = list(raw.environments, 1, 16).map(name).sort();
    if (
      new Set(variants.map((v) => v.name)).size !== variants.length ||
      variants.reduce((n, v) => n + v.weight, 0) !== 10000 ||
      new Set(environments).size !== environments.length
    ) {
      throw fail('INVALID_WEIGHTS_OR_NAMES');
    }
    /** Validated immutable rollout facts or matched retained version, never inferred unfinished features. */
    const definition: ExperimentDefinition = {
      id,
      version,
      salt,
      variants,
      environments,
      migration: raw.migration as ExperimentDefinition['migration'],
    };
    /** Definition bound to its deterministic allocation content hash. */
    const compiled = {
      ...definition,
      allocationHash: hash(canonical(definition)),
    };
    result.push(compiled);
    /** Bounded retained contiguous version history for one validated experiment. */
    const family = families.get(id) ?? [];
    family.push(compiled);
    families.set(id, family);
  }
  if (families.size > 32) {
    throw fail('CATALOG_LIMIT');
  }
  for (const family of families.values()) {
    family.sort((a, b) => a.version - b.version);
    if (family.length > 16) {
      throw fail('CATALOG_LIMIT');
    }
    for (let i = 0; i < family.length; i++) {
      /** Validated immutable rollout facts or matched retained version, never inferred unfinished features. */
      const definition = family[i]!;
      if (
        definition.version !== i + 1 ||
        (i === 0
          ? definition.migration !== 'initial'
          : definition.migration === 'initial')
      ) {
        throw fail('MIGRATION_REQUIRED');
      }
      if (
        i &&
        definition.migration === 'preserve' &&
        family[i - 1]!.variants.some(
          (v) => !definition.variants.some((n) => n.name === v.name)
        )
      ) {
        throw fail('PRESERVED_VARIANT_REMOVED');
      }
    }
  }
  result.sort((a, b) => {
    if (a.id < b.id) {
      return -1;
    } else {
      if (a.id > b.id) {
        return 1;
      } else {
        return a.version - b.version;
      }
    }
  });
  /** Branded immutable full retained catalog, never a mutable per-request context. */
  const catalog = freeze({
    schema: 'ztrial-experiments-v1' as const,
    definitions: result,
    fingerprint: hash(canonical(result)),
  });
  catalogs.add(catalog);
  return catalog;
}
/** Create a new immutable catalog only for each exact next version with explicit preserve/rebucket policy; earlier retained references stay intact.
 * @param {ExperimentCatalog} previous - Previously created branded immutable catalog.
 * @param {readonly ExperimentDefinition[]} changes - Bounded explicit next-version declarations, one per changed experiment.
 * @returns {ExperimentCatalog} New immutable retained-history catalog; no live assignment write or silent weight mutation occurs.
 */
export function evolveExperimentCatalog(
  previous: ExperimentCatalog,
  changes: readonly ExperimentDefinition[]
): ExperimentCatalog {
  if (
    !catalogs.has(previous) ||
    !Array.isArray(changes) ||
    !changes.length ||
    changes.length > 32
  ) {
    throw fail('INVALID_CATALOG');
  }
  /** Changed experiment IDs so a rollout update cannot silently overwrite another change. */
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
    /** Retained immutable versions for this explicitly changed experiment. */
    const history = previous.definitions.filter((d) => d.id === change.id);
    /** Latest retained version requiring exactly one explicit migration step. */
    const last = history.at(-1);
    if (
      !last ||
      seen.has(change.id) ||
      change.version !== last.version + 1 ||
      !['preserve', 'rebucket'].includes(change.migration)
    ) {
      throw fail('MIGRATION_REQUIRED');
    }
    seen.add(change.id);
  }
  return createExperimentCatalog([
    ...previous.definitions.map(({ allocationHash: _, ...d }) => d),
    ...changes,
  ]);
}
/** Return finite versioned analytics schema data derived from an immutable catalog without importing or dispatching analytics.
 * @param {ExperimentCatalog} catalog - Previously created branded immutable catalog.
 * @returns {object} Finite experiment/version/variant dimensions under a catalog-specific namespace; no causal/statistical result is claimed.
 */
export function experimentAnalyticsSchema(catalog: ExperimentCatalog) {
  if (!catalogs.has(catalog)) {
    throw fail('INVALID_CATALOG');
  }
  /** Build finite analytics dimension data without collecting or dispatching any event.
   * @param {"string" | "number"} type Fixed scalar schema kind.
   * @param {T[]} values Bounded unique declared enum values.
   * @returns {object} Required finite dimension with explicit cardinality. */
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
  /** Unique declared public experiment names for the optional finite schema. */
  const ids = [...new Set(catalog.definitions.map((d) => d.id))];
  /** Unique declared retained rollout versions for the optional finite schema. */
  const versions = [...new Set(catalog.definitions.map((d) => d.version))];
  /** Detached declared ordered named basis-point intervals. */
  const variants = [
    ...new Set(
      catalog.definitions.flatMap((d) => d.variants.map((v) => v.name))
    ),
  ];
  if (variants.length > 256) {
    throw fail('ANALYTICS_CARDINALITY_LIMIT');
  }
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
/** Create an explicit server-only tenant-bound evaluator borrowing verified-context/store/recorder callbacks and owning one copied secret; no test runner or analytics starts on construction.
 * @param {ExperimentEvaluatorOptions} options - Trusted immutable catalog, fixed tenant/key and explicit authorization/consent/persistence/recording policy.
 * @returns {object} Owned evaluate/describe/diagnostics/close API; await close after actual pending work settles to release its secret copy.
 */
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
  ) {
    throw fail('INVALID_CONFIGURATION');
  }
  /** Fixed validated host tenant token retained only inside this server evaluator. */
  const tenant = opaque(options.tenant);
  /** Owned32byte copy of the host secret, zeroed only after actual pending work settles. */
  const secret = Buffer.from(options.tenantSalt);
  /** Borrowed trusted server authentication/context resolver; syntactic schema is not authorization. */
  const resolve = options.resolveContext;
  /** Borrowed explicitly qualified durable assignment owner; evaluator never closes it. */
  const store = options.store;
  /** Borrowed explicit recording configuration validated before use. */
  const rawRecording = options.recording;
  /** Branded immutable full retained catalog, never a mutable per-request context. */
  const catalog = options.catalog;
  if (rawRecording) {
    record(rawRecording, ['recorder', 'failure', 'maxRecords']);
  }
  /** Detached finite recording policy retaining only its explicitly borrowed durable recorder. */
  const recording = rawRecording
    ? Object.freeze({
        recorder: rawRecording.recorder,
        failure: rawRecording.failure,
        maxRecords: integer(rawRecording.maxRecords ?? 100000, 1, 10000000),
      })
    : undefined;
  /** Validated finite actual-pending evaluation cap. */
  const maxConcurrent = integer(options.maxConcurrent ?? 32, 1, 128);
  /** Validated finite actual-pending recorder cap. */
  const maxRecordPending = integer(options.maxRecordPending ?? 8, 1, 16);
  /** Validated finite per-request observation deadline. */
  const timeoutMs = integer(options.timeoutMs ?? 3000, 1, 60000);
  if (
    store &&
    (store.contract !== 'ztrial-experiment-store-v1' ||
      store.durability !== 'durable' ||
      ['register', 'get', 'cas'].some(
        (k) => typeof (store as any)[k] !== 'function'
      ))
  ) {
    throw fail('INVALID_STORE');
  }
  if (recording) {
    record(recording, ['recorder', 'failure', 'maxRecords']);
    if (
      recording.recorder?.contract !== 'ztrial-experiment-recorder-v1' ||
      typeof recording.recorder.recordOnce !== 'function' ||
      !['error', 'ignore'].includes(recording.failure)
    ) {
      throw fail('INVALID_RECORDER');
    }
  }
  /** Bounded retained version lists keyed by stable experiment name. */
  const families = new Map<string, CompiledExperiment[]>();
  for (const d of catalog.definitions) {
    /** Bounded retained contiguous version history for one validated experiment. */
    const family = families.get(d.id) ?? [];
    family.push(d);
    families.set(d.id, family);
  }
  if (!store && catalog.definitions.some((d) => d.migration === 'preserve')) {
    throw fail('PRESERVE_REQUIRES_DURABLE_STORE');
  }
  /** Compute a domain-separated HMAC using only this owned tenant-secret copy.
   * @param {unknown[]} parts Explicit fixed-domain inert tuple including host-verified tenant/subject facts.
   * @returns {string} Private stable HMAC reference; never a public permission or anonymous identity. */
  const mac = (parts: unknown[]) =>
    createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex');
  /** Stable hashed tenant namespace for durable contract binding; hashing is not anonymization. */
  const scope = hash(JSON.stringify(['ztrial.tenant.v1', tenant]));
  /** Derive the private stable assignment key only from verified tenant, experiment and authenticated subject.
   * @param {string} experiment Validated declared experiment name.
   * @param {string} subject Host-authenticated opaque subject token.
   * @returns {string} Private domain-separated tenant-secret HMAC key. */
  const keyFor = (experiment: string, subject: string) =>
    mac(['ztrial.assignment-key.v1', tenant, experiment, subject]);
  /** Bounded trusted private subject/version overrides indexed only by HMAC references. */
  const overrides = new Map<string, string>();
  if (options.overrides !== undefined) {
    if (!Array.isArray(options.overrides) || options.overrides.length > 1024) {
      throw fail('OVERRIDE_LIMIT');
    }
    for (const raw of list(options.overrides, 0, 1024)) {
      record(raw, ['experiment', 'version', 'subject', 'variant']);
      /** Validated immutable rollout facts or matched retained version, never inferred unfinished features. */
      const definition = families
        .get(name(raw.experiment))
        ?.find((d) => d.version === raw.version);
      if (
        !definition ||
        !definition.variants.some((v) => v.name === raw.variant)
      ) {
        throw fail('INVALID_OVERRIDE');
      }
      /** Stable private assignment/override lookup reference, never raw recipient identity. */
      const key =
        keyFor(definition.id, opaque(raw.subject)) + ':' + definition.version;
      if (overrides.has(key)) {
        throw fail('DUPLICATE_OVERRIDE');
      }
      overrides.set(key, raw.variant as string);
    }
  }
  /** Select only a declared named variant from trusted overrides or stable full-width cryptographic bucketing.
   * @param {CompiledExperiment} d Validated retained definition.
   * @param {string} subject Authenticated opaque subject token.
   * @param {string} key Stable private assignment HMAC key.
   * @returns {{ variant: string; override: boolean }} Declared allocation only, never a resource authorization decision. */
  const choose = (d: CompiledExperiment, subject: string, key: string) => {
    /** Explicit trusted declared variant override, if configured for this exact private subject/version. */
    const override = overrides.get(key + ':' + d.version);
    if (override) {
      return { variant: override, override: true };
    }
    /** Full256bit domain-separated HMAC over the stable versioned allocation tuple. */
    const digest = mac([
      'ztrial.bucket.v1',
      tenant,
      subject,
      d.id,
      d.version,
      d.salt,
    ]);
    /** Unbiased fixed10000basis-point bucket derived from the full256bit digest. */
    const bucket = Number((BigInt('0x' + digest) * 10000n) >> 256n);
    let threshold = 0;
    for (const variant of d.variants) {
      threshold += variant.weight;
      if (bucket < threshold) {
        return { variant: variant.name, override: false };
      }
    }
    throw fail('INVALID_BUCKET');
  };
  let closed = false,
    recordPending = 0;
  /** Actual evaluation work retained through native/callback settlement even after caller timeout. */
  const pending = new Set<Promise<unknown>>();
  /** Owned cooperative evaluation controllers retained only through actual work settlement. */
  const controllers = new Set<AbortController>();
  let closing: Promise<void> | undefined;
  /** Resolve trusted server context, enforce tenant/consent/environment and perform finite explicit durable/recording stages.
   * @param {string} experiment Validated declared experiment identifier.
   * @param {unknown} principal Host initiating principal passed only to the trusted authentication resolver.
   * @param {{ signal?: AbortSignal }} execution Optional cooperative per-call cancellation.
   * @param {AbortSignal | undefined} execution.signal - Optional initiating-call cooperative cancellation; does not prove native write rollback.
   * @returns {Promise<ExperimentEvaluation>} Sanitized assigned/denied result or fixed failure; timeout never implies rollback. */
  const evaluate = async (
    experiment: string,
    principal: unknown,
    execution: {
      /** Explicit cooperative operation cancellation; native writes may still commit after observation timeout. */
      signal?: AbortSignal;
    } = {}
  ): Promise<ExperimentEvaluation> => {
    name(experiment);
    record(execution, ['signal']);
    if (
      execution.signal !== undefined &&
      !(execution.signal instanceof AbortSignal)
    ) {
      throw fail('INVALID_SIGNAL');
    }
    if (closed) {
      throw fail('CLOSED');
    }
    if (pending.size >= maxConcurrent) {
      throw fail('OVERLOAD');
    }
    /** Bounded retained contiguous version history for one validated experiment. */
    const family = families.get(experiment);
    if (!family) {
      throw fail('UNKNOWN_EXPERIMENT');
    }
    /** Latest retained immutable version, selected only after validating the family exists. */
    const current = family.at(-1)!;
    /** Owned one-evaluation cancellation signal passed to each trusted dependency. */
    const controller = new AbortController();
    controllers.add(controller);
    let expired = false;
    /** Propagate only this call’s cancellation into its owned evaluator scope.
     * @returns {void} Requests cooperative cancellation without releasing actual work capacity early. */
    const abort = () => controller.abort();
    /** Fence subsequent stages after observed cancellation/deadline.
     * @returns {void} Throws a fixed outcome before any further dependency effect starts. */
    const check = () => {
      if (controller.signal.aborted) {
        throw fail(expired ? 'DEADLINE' : 'CANCELLED');
      }
    };
    execution.signal?.addEventListener('abort', abort, { once: true });
    if (execution.signal?.aborted) {
      abort();
    }
    let stop = () => {};
    /** Observed cancellation/deadline promise racing actual work without replaying its effects. */
    const stopped = new Promise<never>((_, reject) => {
      stop = () => reject(fail(expired ? 'DEADLINE' : 'CANCELLED'));
      controller.signal.addEventListener('abort', stop, { once: true });
      if (controller.signal.aborted) {
        stop();
      }
    });
    /** Owned finite observation deadline, cleared when this caller stops waiting. */
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, timeoutMs);
    /** Actual trusted dependency work; retained capacity and secret lifetime wait for its real settlement. */
    const work = Promise.resolve().then(
      async (): Promise<ExperimentEvaluation> => {
        check();
        /** Actual host-authenticated context revalidated for fixed tenant, opaque subject, explicit consent and environment. */
        const context = await resolve(principal, { signal: controller.signal });
        check();
        if (!context) {
          return { status: 'denied', reason: 'identity' };
        }
        record(context, ['tenant', 'subject', 'environment', 'consent']);
        if (context.tenant !== tenant) {
          return { status: 'denied', reason: 'tenant' };
        }
        /** Host-authenticated opaque subject token, never inferred from email or browser claims. */
        const subject = opaque(context.subject);
        /** Host-verified declared environment eligibility label. */
        const environment = name(context.environment);
        if (!['granted', 'denied', 'unknown'].includes(context.consent)) {
          throw fail('INVALID_CONTEXT');
        }
        if (context.consent !== 'granted') {
          return { status: 'denied', reason: 'consent' };
        }
        if (!current.environments.includes(environment)) {
          return { status: 'denied', reason: 'environment' };
        }
        /** Stable private assignment/override lookup reference, never raw recipient identity. */
        const key = keyFor(experiment, subject);
        let chosen = choose(current, subject, key),
          reason: Extract<
            ExperimentEvaluation,
            {
              /** Explicit denied or assigned outcome, never an authorization grant. */
              status: 'assigned';
            }
          >['explanation']['reason'] = chosen.override ? 'override' : 'hashed';
        if (store) {
          for (const definition of family) {
            check();
            /** Actual durable version insert/compare disposition, rechecked after cancellation. */
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
            if (registered === 'conflict') {
              throw fail('VERSION_CONFLICT');
            }
            if (!['registered', 'same'].includes(registered)) {
              throw fail('INVALID_STORE_RESULT');
            }
          }
          let committed = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            check();
            /** Actual private durable assignment snapshot, validated before preserving or migrating it. */
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
              /** Validated immutable rollout facts or matched retained version, never inferred unfinished features. */
              const definition = family.find((d) => d.version === old.version);
              if (!definition || old.version > current.version) {
                throw fail('ROLLBACK_OR_UNKNOWN_VERSION');
              }
              if (
                old.key !== key ||
                old.scope !== scope ||
                old.experiment !== experiment ||
                old.allocationHash !== definition.allocationHash ||
                !definition.variants.some((v) => v.name === old.variant)
              ) {
                throw fail('CORRUPT_ASSIGNMENT');
              }
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
            /** Frozen next declared assignment value tied to exact expected revision and tenant scope. */
            const next: StoredExperimentAssignment = {
              key,
              scope,
              experiment,
              version: current.version,
              allocationHash: current.allocationHash,
              variant: chosen.variant,
              revision: (revision ?? 0) + 1,
            };
            /** Actual durable CAS known committed/conflict receipt; unknown native results throw, never auto-claim success. */
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
            if (changed !== false) {
              throw fail('INVALID_STORE_RESULT');
            }
          }
          if (!committed) {
            throw fail('ASSIGNMENT_CONFLICT');
          }
        }
        let recorded: 'disabled' | 'recorded' | 'duplicate' | 'failed' =
          'disabled';
        if (recording) {
          try {
            if (recordPending >= maxRecordPending) {
              throw fail('RECORDING_OVERLOAD');
            }
            recordPending++;
            try {
              check();
              /** Actual durable recorder disposition; ordinary nonthrowing analytics calls cannot substitute for it. */
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
              if (outcome === 'capacity') {
                throw fail('RECORDING_CAPACITY');
              }
              if (!['recorded', 'duplicate'].includes(outcome)) {
                throw fail('INVALID_RECORDER_RESULT');
              }
              recorded = outcome;
            } finally {
              recordPending--;
            }
          } catch (cause) {
            if (recording.failure === 'error') {
              throw cause instanceof ExperimentError &&
                ['RECORDING_OVERLOAD', 'RECORDING_CAPACITY'].includes(
                  cause.code
                )
                ? cause
                : fail('RECORDING_UNCERTAIN', cause);
            }
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
    /** Fence new evaluations, abort active scopes and await actual work before zeroing this owned secret copy and clearing overrides.
     * @returns {Promise<void>} Shared actual work drain; borrowed durable stores/recorders remain host-owned and are never closed.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      for (const c of controllers) {
        c.abort();
      }
      closing = Promise.allSettled([...pending]).then(() => {
        secret.fill(0);
        overrides.clear();
      });
      return closing;
    },
  });
}
