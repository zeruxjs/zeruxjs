import type {
  DatabaseConnectorFactory,
  DatabaseErrorShape,
  DatabaseManagerConfig,
  MaybePromise,
  NormalizedConnectionConfig,
  QueryOperation,
  ResultReferenceToken,
} from './types.js';

/** Conservative qualified identifier grammar shared by configuration and compiler consumers. */
const IDENTIFIER_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/;

/** Detect supported promise-like objects without forcing async wrappers over sync drivers.
 * @param {MaybePromise<T>} value - Candidate synchronous value or promise.
 * @returns {boolean} Whether the value exposes the supported then shape. */
export const isPromiseLike = <T>(value: MaybePromise<T>): value is Promise<T> =>
  typeof value === 'object' &&
  value !== null &&
  'then' in value &&
  typeof (value as Promise<T>).then === 'function';

/** Preserve synchronous execution while mapping an optional promise.
 * @param {MaybePromise<T>} value - Source value or pending result.
 * @param {(input:T)=>U} mapper - Pure caller mapping callback.
 * @returns {MaybePromise<U>} Mapped synchronous value or promise. */
export const mapMaybePromise = <T, U>(
  value: MaybePromise<T>,
  mapper: (input: T) => U
): MaybePromise<U> =>
  isPromiseLike(value) ? value.then(mapper) : mapper(value);

/** Reduce in order while preserving synchronous connector results when possible.
 * @param {T[]} items - Authored input order.
 * @param {U} initial - Initial accumulator.
 * @param {(accumulator:U,item:T,index:number)=>MaybePromise<U>} reducer - Sequential reducer.
 * @returns {MaybePromise<U>} Final accumulator or its pending completion. */
export const reduceMaybePromise = <T, U>(
  items: T[],
  initial: U,
  reducer: (accumulator: U, item: T, index: number) => MaybePromise<U>
): MaybePromise<U> => {
  let current: MaybePromise<U> = initial;

  items.forEach((item, index) => {
    current = mapMaybePromise(current, (accumulator) =>
      reducer(accumulator, item, index)
    ) as MaybePromise<U>;
  });

  return current;
};

/** Retain a structured private error payload; hosts must redact before publication.
 * @param {DatabaseErrorShape} error - Host/module error metadata, including optional private cause.
 * @returns {Error & {details: DatabaseErrorShape}} Error carrying the original supplied detail object. */
export const createDatabaseError = (
  error: DatabaseErrorShape
): Error & { details: DatabaseErrorShape } => {
  /** Error retaining its private metadata; this helper does not sanitize arbitrary caller values. */
  const instance = new Error(error.message) as Error & {
    details: DatabaseErrorShape;
  };
  instance.name = 'ZeruxDatabaseError';
  instance.details = error;
  return instance;
};

/** Validate a nonempty identifier before dialect translation.
 * @param {string} value - Candidate qualified identifier.
 * @param {string} label - Trusted diagnostic field label.
 * @returns {string} Original valid identifier; invalid value detail remains private. */
export const assertIdentifier = (value: string, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw createDatabaseError({
      code: 'INVALID_IDENTIFIER',
      message: `${label} must be a non-empty identifier`,
    });
  }

  if (!IDENTIFIER_PATTERN.test(value)) {
    throw createDatabaseError({
      code: 'INVALID_IDENTIFIER',
      message: `${label} contains unsupported characters`,
      details: { value },
    });
  }

  return value;
};

/** Normalize legacy keys and connector spelling while validating unique named connections.
 * @param {DatabaseManagerConfig|undefined} config - Explicit trusted host configuration.
 * @returns {{defaultSlug:string,connections:NormalizedConnectionConfig[]}} Detached normalized connection options; not a credential-free public view. */
export const normalizeManagerConfig = (
  config: DatabaseManagerConfig | undefined
): { defaultSlug: string; connections: NormalizedConnectionConfig[] } => {
  /** Configured connection entries normalized without opening any resource. */
  const connections = (config?.connections ?? config?.connection ?? []).map(
    (entry) => {
      /** Explicit connector spelling resolved from current or compatible legacy key. */
      const connector = entry.connector ?? entry.connecter;
      if (!connector) {
        throw createDatabaseError({
          code: 'INVALID_CONNECTION',
          message: `Database connection "${entry.slug || entry.name || 'unknown'}" is missing a connector package`,
        });
      }

      return {
        name: String(entry.name || '').trim(),
        slug: assertIdentifier(
          String(entry.slug || '').trim(),
          'Database slug'
        ),
        connector: normalizeConnectorPackageName(String(connector).trim()),
        options:
          typeof entry.options === 'object' && entry.options !== null
            ? { ...entry.options }
            : {},
      };
    }
  );

  if (connections.length === 0) {
    throw createDatabaseError({
      code: 'MISSING_CONNECTIONS',
      message: 'At least one database connection must be configured',
    });
  }

  /** Previously validated connection slugs used to reject duplicates. */
  const seen = new Set<string>();
  connections.forEach((connection) => {
    if (!connection.name) {
      throw createDatabaseError({
        code: 'INVALID_CONNECTION',
        message: `Database connection "${connection.slug}" is missing a name`,
      });
    }

    if (seen.has(connection.slug)) {
      throw createDatabaseError({
        code: 'DUPLICATE_CONNECTION',
        message: `Database slug "${connection.slug}" must be unique`,
      });
    }

    seen.add(connection.slug);
  });

  // Multiple connections never silently select the first one.
  let defaultSlug = '';
  if (config?.default) {
    defaultSlug = assertIdentifier(config.default, 'Default database slug');
  } else if (connections.length === 1) {
    defaultSlug = connections[0].slug;
  }

  if (!defaultSlug) {
    throw createDatabaseError({
      code: 'MISSING_DEFAULT_CONNECTION',
      message:
        'A default database connection is required when multiple connections are configured',
    });
  }

  if (!connections.some((connection) => connection.slug === defaultSlug)) {
    throw createDatabaseError({
      code: 'UNKNOWN_DEFAULT_CONNECTION',
      message: `Configured default database "${defaultSlug}" does not exist`,
    });
  }

  return { defaultSlug, connections };
};

/** Preserve the historical SQLite package spelling alias.
 * @param {string} value - Configured connector package name.
 * @returns {string} Compatible canonical package spelling. */
export const normalizeConnectorPackageName = (value: string): string => {
  if (value === '@zeruxjs/db-sqllite') {
    return '@zeruxjs/db-sqlite';
  }

  return value;
};

/** Read only supported exports from an already imported trusted connector namespace.
 * @param {Record<string,unknown>} moduleValue - Imported executable module exports.
 * @returns {DatabaseConnectorFactory} Explicit createConnector/createDatabaseConnector/default function. */
export const extractConnectorFactory = (
  moduleValue: Record<string, unknown>
): DatabaseConnectorFactory => {
  /** Supported explicit factory export selected without package scanning. */
  const candidate =
    moduleValue.createConnector ??
    moduleValue.createDatabaseConnector ??
    moduleValue.default;

  if (typeof candidate !== 'function') {
    throw createDatabaseError({
      code: 'INVALID_CONNECTOR_FACTORY',
      message: 'Connector package does not export a connector factory',
    });
  }

  return candidate as DatabaseConnectorFactory;
};

/** Resolve own prior-result fields without traversing object prototypes.
 * @param {unknown} input - Previous result data.
 * @param {string|undefined} path - Optional dotted own-property/numeric-index path.
 * @returns {unknown} Resolved value or undefined for unsupported paths. */
export const getPathValue = (
  input: unknown,
  path: string | undefined
): unknown => {
  if (!path) {
    return input;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      /** Canonical array index candidate; junk suffixes never parse as indexes. */
      const index = /^(0|[1-9][0-9]*)$/.test(segment) ? Number(segment) : NaN;
      return Number.isNaN(index) ? undefined : current[index];
    }

    if (typeof current === 'object' && current !== null) {
      if (
        ['__proto__', 'constructor', 'prototype'].includes(segment) ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, input);
};

/** Recognize the legacy explicit prior-result reference marker.
 * @param {unknown} value - Candidate JSON node.
 * @returns {boolean} Whether the node carries the supported object-shaped $ref. */
const isReferenceToken = (value: unknown): value is ResultReferenceToken =>
  typeof value === 'object' &&
  value !== null &&
  '$ref' in value &&
  typeof (value as ResultReferenceToken).$ref === 'object' &&
  (value as ResultReferenceToken).$ref !== null;

/** Resolve explicit prior-result tokens into a new operation data tree.
 * @param {unknown} value - Candidate operation data.
 * @param {unknown[]} results - Already collected prior outcomes.
 * @returns {unknown} New data tree; no query/code evaluation occurs here. */
export const resolveReferences = (
  value: unknown,
  results: unknown[]
): unknown => {
  if (isReferenceToken(value)) {
    /** Explicit prior result selected by the reference operation index. */
    const referenced = results[value.$ref.operation];
    return getPathValue(referenced, value.$ref.path);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveReferences(entry, results));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveReferences(entry, results),
      ])
    );
  }

  return value;
};

/** Bound JSON serialization and reject unsupported primitives/prototype-like keys.
 * @param {unknown} value - Candidate operation/configuration data.
 * @param {string} label - Trusted diagnostic label.
 * @returns {void} Rejects unsupported/oversized/deep input; legacy serialization may invoke host getters/toJSON. */
export const assertJsonSerializable = (value: unknown, label: string): void => {
  try {
    /** Legacy JSON serialization measured before recursive primitive validation. */
    const encoded = JSON.stringify(value);
    if (
      encoded === undefined ||
      Buffer.byteLength(encoded, 'utf8') > 8 * 1024 * 1024
    ) {
      throw new Error('JSON input is missing or exceeds 8 MiB');
    }
    // Stringifying drops unsupported JavaScript primitives; never silently strip user operations.
    /** Check the legacy JSON traversal domain after serialization.
     * @param {unknown} input - Candidate node.
     * @param {number} depth - Root-zero depth, default zero and maximum 64.
     * @returns {void} Rejects unsupported primitives/keys; this is not a sandbox. */
    const visit = (input: unknown, depth = 0): void => {
      if (depth > 64) {
        throw new Error('JSON input nesting is too deep');
      }
      if (
        input === undefined ||
        typeof input === 'function' ||
        typeof input === 'symbol' ||
        (typeof input === 'number' && !Number.isFinite(input))
      ) {
        throw new Error('Unsupported JSON value');
      }
      if (Array.isArray(input)) {
        // Reject unsupported nested array primitives within the legacy JSON depth budget.
        for (const item of input) {
          visit(item, depth + 1);
        }
      } else if (input !== null && typeof input === 'object') {
        // Reject prototype-like keys and recurse through the legacy JSON object domain.
        for (const [key, item] of Object.entries(input)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) {
            throw new Error('Unsafe JSON object property');
          }
          visit(item, depth + 1);
        }
      }
    };
    visit(value);
  } catch (error) {
    throw createDatabaseError({
      code: 'NON_JSON_INPUT',
      message: `${label} must be JSON serializable`,
      cause: error,
    });
  }
};

/** Clone an already validated query through its existing JSON representation.
 * @param {T} value - Validated JSON data; host getters/toJSON must not carry side effects.
 * @returns {T} Detached JSON copy with compatible serialization semantics. */
export const cloneQueryValue = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

/** Check the shared operation discriminator before cloning bounded JSON.
 * @param {T} operation - Candidate structured operation.
 * @returns {T} Detached operation; dialect validation still belongs to the connector. */
export const validateOperation = <T extends QueryOperation>(
  operation: T
): T => {
  if (typeof operation !== 'object' || operation === null) {
    throw createDatabaseError({
      code: 'INVALID_OPERATION',
      message: 'Database operation must be an object',
    });
  }

  if (
    typeof operation.op !== 'string' ||
    ![
      'createDb',
      'dropDb',
      'switchDB',
      'createTable',
      'dropTable',
      'alterTable',
      'turcunateTable',
      'createIndex',
      'dropIndex',
      'insert',
      'select',
      'update',
      'delete',
    ].includes(operation.op)
  ) {
    throw createDatabaseError({
      code: 'INVALID_OPERATION',
      message: 'Database operation is missing the op property',
    });
  }

  assertJsonSerializable(operation, `Database operation "${operation.op}"`);
  return cloneQueryValue(operation);
};

/** Summarize connection options with known sensitive names and bounded traversal.
 * @param {Record<string,unknown>} options - Private trusted host configuration.
 * @returns {Record<string,unknown>} Compatibility summary; unknown custom secrets still require host review. */
export const redactConnectionOptions = (
  options: Record<string, unknown>
): Record<string, unknown> => {
  /** Known credential/native-object field patterns; not a universal secret detector. */
  const sensitive =
    /password|secret|token|key|uri|url|dsn|connectionstring|credential|auth|client|executor|certificate|private|^db$/i;
  /** Recursively mask known sensitive configuration fields within a bounded display depth.
   * @param {unknown} input - Private trusted configuration node.
   * @param {number} depth - Current redaction traversal depth; deeper nodes become placeholders.
   * @returns {unknown} Compatibility summary; arbitrary host secret names are not automatically known.
   */
  function redact(input: unknown, depth: number): unknown {
    if (depth > 5) {
      return '[redacted]';
    }
    if (Array.isArray(input)) {
      return input.map((item) => redact(item, depth + 1));
    }
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          sensitive.test(key) ? '[redacted]' : redact(value, depth + 1),
        ])
      );
    }
    return typeof input === 'function' ? '[redacted]' : input;
  }
  return redact(options, 0) as Record<string, unknown>;
};
