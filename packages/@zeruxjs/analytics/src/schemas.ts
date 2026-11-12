import { createHash } from 'node:crypto';
import type {
  AnalyticsEventInput,
  AnalyticsRow,
  EventProperties,
  EventValue,
} from './types.js';

/** Explicit stored metric units; units never imply conversion between unlike measurements. */
export type AnalyticsMeasurementUnit =
  | 'count'
  | 'milliseconds'
  | 'seconds'
  | 'bytes'
  | 'ratio'
  | 'percent';
/** Finite dimensions, bounded metrics and inert scalar parameters supported by ingestion. */
export type AnalyticsPropertyDefinition = {
  /** Whether this property must be present; omitted means optional. */
  required?: boolean;
} & (
  | {
      /** Supported rule discriminant; arbitrary rule code is unavailable. */
      kind: 'dimension';
      /** Permitted scalar type for this definition. */
      type: 'string' | 'number' | 'boolean';
      /** Finite allowlist of dimension values; no dynamic cardinality counter. */
      values: readonly (string | number | boolean)[];
      /** Maximum permitted enum size, from 1 through 256. */
      maxCardinality: number;
    }
  | {
      /** Supported rule discriminant; arbitrary rule code is unavailable. */
      kind: 'metric';
      /** Explicit measurement unit with unit-specific numeric constraints. */
      unit: AnalyticsMeasurementUnit;
      /** Optional inclusive metric lower bound. */
      min?: number;
      /** Optional inclusive metric upper bound. */
      max?: number;
    }
  | {
      /** Supported rule discriminant; arbitrary rule code is unavailable. */
      kind: 'parameter';
      /** Permitted scalar type for this definition. */
      type: 'number' | 'boolean' | 'null';
    }
);
/** One immutable event version and its separately consented property scopes. */
export interface AnalyticsEventSchema {
  /** Stable registered event name. */
  name: string;
  /** Contiguous schema version starting at one. */
  version: number;
  /** Event-owned scalar rules. */
  properties: Readonly<Record<string, AnalyticsPropertyDefinition>>;
  /** Optional user rules; nonempty input requires granted consent and visitor identity. */
  userProperties?: Readonly<Record<string, AnalyticsPropertyDefinition>>;
  /** Optional session rules; nonempty input requires granted consent and session identity. */
  sessionProperties?: Readonly<Record<string, AnalyticsPropertyDefinition>>;
}
/** Optional catalog validation limits; omitted values use conservative package defaults. */
export interface AnalyticsSchemaBudgets {
  /** Combined property count limit, default 40 and maximum 40. */
  maxProperties?: number;
  /** Serialized prepared scopes limit, default 6144 bytes (128–7168). */
  maxBytes?: number;
}
/** Infer the scalar value represented by one supported property definition. */
type Value<D> = D extends {
  kind: 'metric';
}
  ? number
  : D extends {
        kind: 'dimension';
        values: readonly (infer V)[];
      }
    ? V
    : D extends {
          type: 'number';
        }
      ? number
      : D extends {
            type: 'boolean';
          }
        ? boolean
        : null;
/** Separate required and optional authored keys while retaining finite dimension literals. */
export type InferAnalyticsProperties<
  S extends Readonly<Record<string, AnalyticsPropertyDefinition>>,
> = {
  [K in keyof S as S[K] extends {
    required: true;
  }
    ? K
    : never]: Value<S[K]>;
} & {
  [K in keyof S as S[K] extends {
    required: true;
  }
    ? never
    : K]?: Value<S[K]>;
};
/** Infer one declared scope; omitted scopes accept no authored property keys. */
type Properties<
  S,
  K extends 'properties' | 'userProperties' | 'sessionProperties',
> = S extends {
  [P in K]: infer R extends Readonly<
    Record<string, AnalyticsPropertyDefinition>
  >;
}
  ? InferAnalyticsProperties<R>
  : Record<string, never>;
/** Authored event fields inferred from a registered schema; runtime validation remains required. */
export type AnalyticsSchemaInput<S> = Omit<
  AnalyticsEventInput,
  | 'name'
  | 'properties'
  | 'schemaVersion'
  | 'userProperties'
  | 'sessionProperties'
> & {
  /** Event-owned scalar rules. */
  properties: Properties<S, 'properties'>;
  /** Optional user rules; nonempty input requires granted consent and visitor identity. */
  userProperties?: Properties<S, 'userProperties'>;
  /** Optional session rules; nonempty input requires granted consent and session identity. */
  sessionProperties?: Properties<S, 'sessionProperties'>;
};
/** Fixed-code validation error with no raw schema/event values in its message. */
export class AnalyticsSchemaError extends TypeError {
  /** Create a redacted schema error.
   * @param {string} code - Stable validation category, not private input.
   */
  constructor(readonly code: string) {
    super(`Analytics schema rejected (${code})`);
    this.name = 'AnalyticsSchemaError';
  }
}
/** Reject with a fixed code rather than echoing private definition or event values.
 * @param {string} code - Stable validation failure category.
 * @returns {never} Always throws AnalyticsSchemaError. */
const reject = (code: string): never => {
  throw new AnalyticsSchemaError(code);
};
/** Package-instance identity set; structurally similar objects are not accepted as validated catalogs. */
const registries = new WeakSet<object>();
/** Accept only validated catalogs produced by this package instance.
 * @param {unknown} value - Candidate registry.
 * @returns {boolean} Whether this package instance registered the object.
 */
export const isEventSchemaRegistry = (
  value: unknown
): value is AnalyticsEventSchemaRegistry =>
  typeof value === 'object' && value !== null && registries.has(value);
/** Stable scope traversal order used for validation, budgets and schema provenance. */
const scopes = ['properties', 'userProperties', 'sessionProperties'] as const;
/** Bounded public event/property label grammar. */
const namePattern = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
/** Prototype-sensitive and package-owned provenance keys excluded from authored schemas. */
const reserved = new Set([
  'constructor',
  'prototype',
  '__proto__',
  'zVisitorId',
  'zConsent',
  'zRequestId',
  'zRequestUtcDay',
  'zAnalyticsSchema',
]);
/** Conservative sensitive-name detector; this is not a general personal-data classifier. */
const sensitive =
  /(?:^|[_.:-])(?:email|ip|password|secret|token|cookie|address|phone|authorization)(?:$|[_.:-])/i;
/** Require a plain own-data record without evaluating accessors.
 * @param {unknown} value - Candidate schema/event record.
 * @returns {void} Returns normally for an accepted record; malformed records throw.
 */
function record(value: unknown): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== 'string' ||
        !('value' in Object.getOwnPropertyDescriptor(value, key)!)
    )
  ) {
    reject('INVALID_RECORD');
  }
}
/** Reject unrecognized definition keys before copying a schema.
 * @param {Record<string, unknown>} value - Validated plain record.
 * @param {readonly string[]} allowed - Explicit keys supported for this definition kind.
 * @returns {void} Returns normally when all keys are recognized.
 */
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    reject('UNKNOWN_DEFINITION_KEY');
  }
}
/** Validate an inclusive safe-integer budget.
 * @param {unknown} value - Candidate budget/version value.
 * @param {number} min - Inclusive lower bound.
 * @param {number} max - Inclusive upper bound.
 * @returns {number} Validated safe integer; invalid values throw.
 */
function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    reject('INVALID_BUDGET');
  }
  return value as number;
}
/** Serialize validated catalog data with stable sorted object keys.
 * @param {unknown} value - Validated acyclic scalar/array/record data.
 * @returns {string} Canonical JSON spelling used by compatibility checks and hashes.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ':' +
            canonical((value as Record<string, unknown>)[key])
        )
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}
/** Recursively freeze detached catalog values.
 * @param {T} value - Validated acyclic catalog value owned by this registry.
 * @returns {T} The same deeply frozen value.
 */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    // Freeze descendants before publishing their owning catalog node.
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
/** Check finite numeric values while rejecting unsafe integer precision.
 * @param {unknown} value - Candidate event scalar.
 * @returns {boolean} Whether the value satisfies numeric representation limits. */
const finite = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  (!Number.isInteger(value) || Number.isSafeInteger(value));
/** Validate and detach one supported property definition.
 * @param {unknown} value - Caller-owned rule; free text and executable accessors are unsupported.
 * @returns {AnalyticsPropertyDefinition} Canonical detached rule, or a fixed-code rejection.
 */
function property(value: unknown): AnalyticsPropertyDefinition {
  record(value);
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    reject('INVALID_REQUIRED');
  }
  if (value.kind === 'dimension') {
    keys(value, ['kind', 'type', 'values', 'maxCardinality', 'required']);
    /** Explicit enum cardinality ceiling, independently bounded to 1–256. */
    const max = integer(value.maxCardinality, 1, 256);
    if (
      !['string', 'number', 'boolean'].includes(value.type as string) ||
      !Array.isArray(value.values) ||
      !value.values.length ||
      value.values.length > max
    ) {
      reject('DIMENSION_CARDINALITY');
    }
    if (
      Object.values(Object.getOwnPropertyDescriptors(value.values)).some(
        (d) => !('value' in d)
      )
    ) {
      reject('INVALID_DIMENSION_VALUE');
    }
    // Every enum value must satisfy its declared scalar type and public-value policy.
    for (const item of value.values as unknown[]) {
      if (
        typeof item !== value.type ||
        (typeof item === 'number' && !finite(item)) ||
        (typeof item === 'string' &&
          (!item.length ||
            Buffer.byteLength(item) > 128 ||
            // eslint-disable-next-line no-control-regex -- Reject controls and address-like enum values.
            /[\x00-\x1f\x7f@]/.test(item)))
      ) {
        reject('INVALID_DIMENSION_VALUE');
      }
    }
    if (
      new Set((value.values as unknown[]).map(canonical)).size !==
      (value.values as unknown[]).length
    ) {
      reject('DUPLICATE_DIMENSION_VALUE');
    }
  } else if (value.kind === 'metric') {
    keys(value, ['kind', 'unit', 'min', 'max', 'required']);
    if (
      ![
        'count',
        'milliseconds',
        'seconds',
        'bytes',
        'ratio',
        'percent',
      ].includes(value.unit as string)
    ) {
      reject('INVALID_UNIT');
    }
    // Validate both optional metric bounds independently.
    for (const key of ['min', 'max']) {
      if (
        value[key] !== undefined &&
        (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
      ) {
        reject('INVALID_METRIC_RANGE');
      }
    }
    if (
      typeof value.min === 'number' &&
      typeof value.max === 'number' &&
      value.min > value.max
    ) {
      reject('INVALID_METRIC_RANGE');
    }
  } else if (value.kind === 'parameter') {
    keys(value, ['kind', 'type', 'required']);
    if (!['number', 'boolean', 'null'].includes(value.type as string)) {
      reject('INVALID_PARAMETER_TYPE');
    }
  } else {
    reject('INVALID_PROPERTY_KIND');
  }
  return JSON.parse(canonical(value)) as AnalyticsPropertyDefinition;
}
/** Validate a bounded property scope in deterministic key order.
 * @param {unknown} value - Caller-owned property map.
 * @returns {Record<string, AnalyticsPropertyDefinition>} Detached null-prototype map of validated rules.
 */
function group(value: unknown): Record<string, AnalyticsPropertyDefinition> {
  record(value);
  if (Object.keys(value).length > 40) {
    reject('PROPERTY_BUDGET');
  }
  /** Detached validated result; callers cannot mutate the catalog through the original definition. */
  const result: Record<string, AnalyticsPropertyDefinition> =
    Object.create(null);
  // Stable key order keeps detached definitions and hashes deterministic.
  for (const key of Object.keys(value).sort()) {
    if (!namePattern.test(key) || reserved.has(key) || sensitive.test(key)) {
      reject('INVALID_PROPERTY_NAME');
    }
    result[key] = property(value[key]);
  }
  return result;
}
/** Require additive optional-only evolution with unchanged existing rules.
 * @param {AnalyticsEventSchema} previous - Earlier contiguous version.
 * @param {AnalyticsEventSchema} next - Candidate next version.
 * @returns {void} Returns normally for compatible changes; breaking changes throw.
 */
function compatible(
  previous: AnalyticsEventSchema,
  next: AnalyticsEventSchema
) {
  // Apply the same compatibility/validation boundary to every declared scope.
  for (const scope of scopes) {
    /** Previous version scope, with absent optional scopes treated as empty. */
    const before = previous[scope] ?? {};
    /** Next version scope checked for immutable old fields and optional-only additions. */
    const after = next[scope] ?? {};
    // Existing rules are immutable; removal or modification is a breaking change.
    for (const [key, spec] of Object.entries(before)) {
      if (
        !Object.hasOwn(after, key) ||
        canonical(spec) !== canonical(after[key])
      ) {
        reject('BREAKING_SCHEMA_EVOLUTION');
      }
    }
    // Newly introduced fields must remain optional for older events.
    for (const [key, spec] of Object.entries(after)) {
      if (!Object.hasOwn(before, key) && spec.required) {
        reject('BREAKING_SCHEMA_EVOLUTION');
      }
    }
  }
}
/** Create an immutable generation-scoped catalog without storage or network work.
 * @param {T} definitions - One to 100 schemas with contiguous versions starting at one.
 * @param {AnalyticsSchemaBudgets} budgets - Optional combined property and byte limits.
 * @returns {AnalyticsEventSchemaRegistry} Frozen facade for validation, authored events, units and provenance.
 */
export function createEventSchemaRegistry<
  const T extends readonly AnalyticsEventSchema[],
>(definitions: T, budgets: AnalyticsSchemaBudgets = {}) {
  record(budgets);
  keys(budgets, ['maxProperties', 'maxBytes']);
  /** Combined event/user/session property budget, default 40 and maximum 40. */
  const maxProperties = integer(budgets.maxProperties ?? 40, 1, 40);
  /** Serialized property budget, default 6144 bytes and bounded to 128–7168. */
  const maxBytes = integer(budgets.maxBytes ?? 6144, 128, 7168);
  if (
    !Array.isArray(definitions) ||
    !definitions.length ||
    definitions.length > 100
  ) {
    reject('SCHEMA_BUDGET');
  }
  /** Detached schema copies sorted and deeply frozen before publication. */
  const catalog: AnalyticsEventSchema[] = [];
  /** Private event-name index used for version validation and lookup. */
  const byName = new Map<string, AnalyticsEventSchema[]>();
  // Detach every schema before indexing or publishing any caller-owned definitions.
  for (const raw of definitions) {
    record(raw);
    keys(raw, ['name', 'version', ...scopes]);
    if (
      typeof raw.name !== 'string' ||
      !namePattern.test(raw.name) ||
      reserved.has(raw.name)
    ) {
      reject('INVALID_EVENT_NAME');
    }
    /** Resolved or newly validated schema, separate from caller-owned input. */
    const schema: AnalyticsEventSchema = {
      name: raw.name,
      version: integer(raw.version, 1, 10000),
      properties: group(raw.properties),
      ...(raw.userProperties !== undefined
        ? { userProperties: group(raw.userProperties) }
        : {}),
      ...(raw.sessionProperties !== undefined
        ? { sessionProperties: group(raw.sessionProperties) }
        : {}),
    };
    if (
      scopes.reduce(
        (n, scope) => n + Object.keys(schema[scope] ?? {}).length,
        0
      ) > maxProperties
    ) {
      reject('PROPERTY_BUDGET');
    }
    catalog.push(schema);
    /** Private ordered versions for one event name; contiguous numbering starts at one. */
    const versions = byName.get(schema.name) ?? [];
    versions.push(schema);
    byName.set(schema.name, versions);
  }
  // Check contiguous versions and additive evolution per event name.
  for (const versions of byName.values()) {
    versions.sort((a, b) => a.version - b.version);
    // Each sorted position corresponds to exactly one schema version.
    for (let i = 0; i < versions.length; i++) {
      if (versions[i]!.version !== i + 1) {
        reject('NONCONTIGUOUS_VERSION');
      }
      if (i) {
        compatible(versions[i - 1]!, versions[i]!);
      }
    }
  }
  if (
    catalog.reduce(
      (count, schema) =>
        count +
        scopes.reduce(
          (total, scope) =>
            total +
            Object.values(schema[scope] ?? {}).reduce(
              (n, p) => n + (p.kind === 'dimension' ? p.values.length : 0),
              0
            ),
          0
        ),
      0
    ) > 4096 ||
    Buffer.byteLength(canonical(catalog)) > 1048576
  ) {
    reject('CATALOG_BUDGET');
  }
  catalog.sort((a, b) => {
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return a.version - b.version;
  });
  freeze(catalog);
  /** SHA-256 of canonical catalog plus budgets; identifies configuration, not permission or authorship. */
  const catalogId = createHash('sha256')
    .update(canonical({ catalog, maxProperties, maxBytes }))
    .digest('hex');
  /** Canonical per-schema hashes retained for persisted provenance. */
  const schemaIds = new Map(
    catalog.map((schema) => [
      schema,
      createHash('sha256').update(canonical(schema)).digest('hex'),
    ])
  );
  /** Resolve an explicitly registered version, or the latest version when omitted.
   * @param {string} name - Registered event name.
   * @param {number|undefined} version - Optional exact historical version.
   * @returns {AnalyticsEventSchema} Validated schema; unknown names/versions reject. */
  const resolve = (name: string, version?: number) => {
    /** Private ordered versions for one event name; contiguous numbering starts at one. */
    const versions = byName.get(name);
    if (!versions) {
      reject('UNREGISTERED_EVENT');
    }
    if (version !== undefined) {
      integer(version, 1, 10000);
    }
    /** Resolved or newly validated schema, separate from caller-owned input. */
    const schema =
      version === undefined
        ? versions![versions!.length - 1]
        : versions!.find((s) => s.version === version);
    if (!schema) {
      reject('UNKNOWN_SCHEMA_VERSION');
    }
    return schema!;
  };
  /** Validate event scopes and produce detached scalar properties with provenance.
   * @param {AnalyticsEventInput} input - Event data; user/session properties require consent and their opaque identifier.
   * @returns {ReturnType<AnalyticsEventSchemaRegistry['prepare']>} Prepared scopes and version/hash metadata; invalid input throws. */
  const prepare = (input: AnalyticsEventInput) => {
    record(input);
    /** Resolved or newly validated schema, separate from caller-owned input. */
    const schema = resolve(input.name, input.schemaVersion);
    /** Detached null-prototype property scopes accumulated under the combined budget. */
    const clean: Record<string, EventProperties> = Object.create(null);
    let count = 0;
    // Validate event/user/session scopes without merging their consent or identity requirements.
    for (const scope of scopes) {
      /** Current input scope, defaulting to an empty record without inventing identity. */
      const raw = input[scope] ?? {};
      record(raw);
      /** Registered rules for this scope; unknown input keys are rejected. */
      const spec = schema[scope] ?? {};
      /** Detached validated scalar values for this scope. */
      const output: EventProperties = Object.create(null);
      if (
        scope !== 'properties' &&
        Object.keys(raw).length &&
        (input.consent !== 'granted' ||
          !(scope === 'userProperties' ? input.visitorId : input.sessionId))
      ) {
        reject('PROPERTY_CONSENT_REQUIRED');
      }
      // Count and validate each supplied scalar before copying it into clean scopes.
      for (const [key, value] of Object.entries(raw)) {
        if (++count > maxProperties) {
          reject('PROPERTY_BUDGET');
        }
        if (!Object.hasOwn(spec, key)) {
          reject('UNKNOWN_PROPERTY');
        }
        /** Registered property rule selected only after an own-key check. */
        const rule = spec[key]!;
        if (rule.kind === 'dimension') {
          if (!rule.values.includes(value as never)) {
            reject('DIMENSION_CARDINALITY');
          }
        } else if (rule.kind === 'metric') {
          if (
            !finite(value) ||
            typeof value !== 'number' ||
            (['count', 'bytes'].includes(rule.unit) &&
              (!Number.isSafeInteger(value) || value < 0)) ||
            (rule.unit === 'ratio' && (value < 0 || value > 1)) ||
            (rule.unit === 'percent' && (value < 0 || value > 100)) ||
            (rule.min !== undefined && value < rule.min) ||
            (rule.max !== undefined && value > rule.max)
          ) {
            reject('INVALID_METRIC');
          }
        } else if (
          (value === null ? 'null' : typeof value) !== rule.type ||
          (typeof value === 'number' && !finite(value))
        ) {
          reject('INVALID_PARAMETER');
        }
        output[key] = value as EventValue;
      }
      // Required fields are checked after supplied keys have passed their own rules.
      for (const [key, rule] of Object.entries(spec)) {
        if (rule.required && !Object.hasOwn(output, key)) {
          reject('MISSING_PROPERTY');
        }
      }
      clean[scope] = output;
    }
    if (Buffer.byteLength(JSON.stringify(clean)) > maxBytes) {
      reject('PROPERTY_BYTE_BUDGET');
    }
    /** Hash of the resolved historical schema included in stored provenance. */
    const schemaId = schemaIds.get(schema)!;
    return {
      properties: clean.properties!,
      metadata: {
        coverageVersion: 1 as const,
        schemaVersion: schema.version,
        schemaId,
        catalogId,
        userProperties: clean.userProperties!,
        sessionProperties: clean.sessionProperties!,
      },
    };
  };
  /** Frozen public catalog facade; no timers, storage handles or shutdown ownership. */
  const registry = Object.freeze({
    /** Describe immutable schemas and their configuration identity.
     * @returns {ReturnType<AnalyticsEventSchemaRegistry['describe']>} Frozen catalog description, not a coverage guarantee.
     */
    describe: () =>
      Object.freeze({
        coverageVersion: 1 as const,
        catalogId,
        maxProperties,
        maxBytes,
        schemas: catalog,
      }),
    prepare,
    /** Construct an authored event pinned to the latest registered version.
     * @param {N} name - Registered literal event name.
     * @param {AnalyticsSchemaInput<Extract<T[number], {name: N}>>} input - Typed event fields; runtime checks still apply.
     * @returns {AnalyticsEventInput} Validated authored event; ingestion revalidates before persistence.
     */
    event<N extends T[number]['name']>(
      name: N,
      input: AnalyticsSchemaInput<
        Extract<
          T[number],
          {
            /** Stable registered event name. */
            name: N;
          }
        >
      >
    ): AnalyticsEventInput {
      /** Detached validated result; callers cannot mutate the catalog through the original definition. */
      const result = {
        ...input,
        name,
        schemaVersion: resolve(name).version,
      } as unknown as AnalyticsEventInput;
      prepare(result);
      return result;
    },
    /** Resolve one consistent metric unit across the selected registered history.
     * @param {string} field - Registered event metric property.
     * @param {string|undefined} name - Optional event name to disambiguate units.
     * @returns {{unit: AnalyticsMeasurementUnit, coverageVersion: 1, coverage: 'mixed-history'}} Unit and explicit historical coverage label.
     */
    metric(field: string, name?: string) {
      /** Registered field definitions across the requested event history. */
      const definitions = catalog
        .filter((s) => name === undefined || s.name === name)
        .map((s) => s.properties[field])
        .filter(Boolean);
      if (
        !definitions.length ||
        definitions.some((d) => d!.kind !== 'metric')
      ) {
        reject('UNREGISTERED_METRIC');
      }
      /** Distinct declared units; ambiguous cross-event units reject rather than being normalized silently. */
      const units = new Set(
        definitions.map(
          (d) =>
            (
              d as {
                /** Explicit measurement unit with unit-specific numeric constraints. */
                unit: AnalyticsMeasurementUnit;
              }
            ).unit
        )
      );
      if (units.size !== 1) {
        reject('AMBIGUOUS_METRIC_UNIT');
      }
      return {
        unit: [...units][0]!,
        coverageVersion: 1 as const,
        coverage: 'mixed-history' as const,
      };
    },
  });
  registries.add(registry);
  return registry;
}
/** Public immutable registry facade inferred from the generation-scoped factory. */
export type AnalyticsEventSchemaRegistry = ReturnType<
  typeof createEventSchemaRegistry
>;
/** Read bounded stored provenance without inventing coverage for historical fields.
 * @param {Pick<AnalyticsRow, 'properties_json'>} row - Stored event payload; unrelated private properties are not returned.
 * @returns {ReturnType<typeof readEventSchemaCoverage>} Versioned identifiers or explicit legacy-unversioned coverage; corrupt metadata rejects.
 */
export function readEventSchemaCoverage(
  row: Pick<AnalyticsRow, 'properties_json'>
) {
  if (
    typeof row?.properties_json !== 'string' ||
    Buffer.byteLength(row.properties_json) > 8192
  ) {
    reject('INVALID_STORED_PROPERTIES');
  }
  let props: Record<string, unknown>;
  try {
    props = JSON.parse(row.properties_json) as Record<string, unknown>;
    record(props);
  } catch {
    reject('INVALID_STORED_PROPERTIES');
  }
  /** Stored schema provenance when present; absence remains legacy-unversioned. */
  const metadata = Object.hasOwn(props!, 'zAnalyticsSchema')
    ? props!.zAnalyticsSchema
    : undefined;
  if (metadata === undefined) {
    return {
      coverageVersion: 1 as const,
      coverage: 'legacy-unversioned' as const,
    };
  }
  record(metadata);
  if (
    metadata.coverageVersion !== 1 ||
    typeof metadata.schemaVersion !== 'number' ||
    !Number.isSafeInteger(metadata.schemaVersion) ||
    metadata.schemaVersion < 1 ||
    metadata.schemaVersion > 10000 ||
    typeof metadata.schemaId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(metadata.schemaId) ||
    typeof metadata.catalogId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(metadata.catalogId)
  ) {
    reject('INVALID_STORED_SCHEMA');
  }
  return {
    coverageVersion: 1 as const,
    coverage: 'versioned' as const,
    schemaVersion: metadata.schemaVersion,
    schemaId: metadata.schemaId,
    catalogId: metadata.catalogId,
  };
}
