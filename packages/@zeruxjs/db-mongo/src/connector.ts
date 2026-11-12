import {
  assertSafeDocument,
  assertSafeField,
  buildWhere,
  buildProjection,
  buildSort,
  toMongoValue,
} from './query.js';
import type {
  DatabaseConnector,
  DatabaseTransaction,
  NormalizedConnectionConfig,
  DatabaseExecutionContext,
  DatabaseResult,
  DeleteOperation,
  InsertOperation,
  QueryOperation,
  SelectOperation,
  UpdateOperation,
} from '@zeruxjs/db';
import { createPinnedTransaction, createDatabaseError } from '@zeruxjs/db';

import {
  verifyTransactionDeployment,
  transactionAdapter,
  sessionDatabase,
} from './session.js';
export interface MongoSessionLike {
  /** Begin on this acquired native session with explicit snapshot concerns.
   * @param {Record<string, unknown>} options - Trusted explicit native/connector settings; no request-derived credentials.
   * @returns {void|Promise<void>} Native start completion.
   */
  startTransaction(options?: Record<string, unknown>): void | Promise<void>;
  /** Commit on this exact native session.
   * @returns {Promise<void>} Native result; uncertain labels are interpreted by the bounded adapter.
   */
  commitTransaction(): Promise<void>;
  /** Abort this exact native transaction.
   * @returns {Promise<void>} Native abort receipt; does not undo a previously committed result.
   */
  abortTransaction(): Promise<void>;
  /** Release this acquired session exactly once through its owner.
   * @returns {Promise<void>} Actual native session cleanup.
   */
  endSession(): Promise<void>;
}
export interface MongoClientLike {
  /** Resolve one native database using trusted configuration.
   * @param {string} name - Explicit authored collection/index/database identifier.
   * @returns {MongoDbLike} Borrowed database from this native client.
   */
  db(name?: string): MongoDbLike;
  /** Acquire one native session only through explicit transaction opt-in.
   * @returns {MongoSessionLike} Native session lifecycle owner.
   */
  startSession?(): MongoSessionLike;
  /** Initialize only URI-created native clients; borrowed clients stay host-owned.
   * @returns {Promise<unknown>} Native readiness or explicit failure.
   */
  connect?(): Promise<unknown>;
  /** Close the native client only when its owner requests it.
   * @returns {Promise<unknown>} Native client cleanup receipt.
   */
  close?(): Promise<unknown>;
}
export type MongoDbLike = {
  /** Execute the explicitly generated read-only deployment probe.
   * @param {Record<string, unknown>} command - Generated trusted native probe command.
   * @param {Record<string, unknown>} options - Trusted explicit native/connector settings; no request-derived credentials.
   * @returns {Promise<Record<string,unknown>>} Native deployment facts, not authorization proof.
   */
  command?(
    command: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  /** Resolve the exact authored native collection.
   * @param {string} name - Explicit authored collection/index/database identifier.
   * @returns {MongoCollectionLike} Borrowed collection whose receiver must be preserved.
   */
  collection(name: string): MongoCollectionLike;
  /** Create one explicit native collection.
   * @param {string} name - Explicit authored collection/index/database identifier.
   * @returns {Promise<unknown>} Native schema result, not a complete SQL schema implementation.
   */
  createCollection?(name: string): Promise<unknown>;
  /** Drop the explicitly selected database only under host policy.
   * @returns {Promise<boolean>} Native database deletion outcome.
   */
  dropDatabase?(): Promise<boolean>;
};

export type MongoCursorLike = {
  /** Apply validated native named-field ordering to this cursor.
   * @param {Record<string, 1 | -1>} criteria - Validated native field/direction sort map.
   * @returns {MongoCursorLike} Native fluent cursor.
   */
  sort?(criteria: Record<string, 1 | -1>): MongoCursorLike;
  /** Apply a validated native offset to this cursor.
   * @param {number} count - Validated explicit nonnegative offset or row cap.
   * @returns {MongoCursorLike} Native fluent cursor.
   */
  skip?(count: number): MongoCursorLike;
  /** Apply a validated native row cap to this cursor.
   * @param {number} count - Validated explicit nonnegative offset or row cap.
   * @returns {MongoCursorLike} Native fluent cursor.
   */
  limit?(count: number): MongoCursorLike;
  /** Materialize this explicitly configured cursor.
   * @returns {Promise<unknown[]>} Native records; manager input budgets do not cap result bytes.
   */
  toArray(): Promise<unknown[]>;
};
export type MongoCollectionLike = {
  /** Insert one validated native document.
   * @param {Record<string, unknown>} doc - Validated native document data.
   * @returns {Promise<{insertedId:unknown}>} Native generated identity, retained without numeric coercion promises.
   */
  insertOne?(doc: Record<string, unknown>): Promise<{ insertedId: unknown }>;
  /** Insert validated native documents.
   * @param {Record<string, unknown>[]} docs - Validated native document array.
   * @returns {Promise<{insertedIds:Record<string,unknown>}>} Native generated identities; default native bulk semantics apply.
   */
  insertMany?(
    docs: Record<string, unknown>[]
  ): Promise<{ insertedIds: Record<string, unknown> }>;
  /** Create a native cursor over generated structured selectors.
   * @param {Record<string, unknown>} query - Generated native selector, not caller-owned raw Mongo operators.
   * @param {Record<string, unknown>} options - Trusted explicit native/connector settings; no request-derived credentials.
   * @returns {MongoCursorLike} Native cursor; no arbitrary raw query authorization is supplied.
   */
  find?(
    query: Record<string, unknown>,
    options?: Record<string, unknown>
  ): {
    /** Apply validated native named-field ordering to this cursor.
     * @param {Record<string, 1 | -1>} criteria - Validated native field/direction sort map.
     * @returns {MongoCursorLike} Native fluent cursor.
     */
    sort?(criteria: Record<string, 1 | -1>): MongoCursorLike;
    /** Apply a validated native offset to this cursor.
     * @param {number} count - Validated explicit nonnegative offset or row cap.
     * @returns {MongoCursorLike} Native fluent cursor.
     */
    skip?(count: number): MongoCursorLike;
    /** Apply a validated native row cap to this cursor.
     * @param {number} count - Validated explicit nonnegative offset or row cap.
     * @returns {MongoCursorLike} Native fluent cursor.
     */
    limit?(count: number): MongoCursorLike;
    /** Materialize this explicitly configured cursor.
     * @returns {Promise<unknown[]>} Native records; manager input budgets do not cap result bytes.
     */
    toArray(): Promise<unknown[]>;
  };
  /** Create a cursor over only the generated supported aggregation path.
   * @param {unknown[]} pipeline - Generated native stage array; arbitrary executable stages are not accepted.
   * @returns {{toArray():Promise<unknown[]>}} Native result cursor; no general SQL/aggregation parity.
   */
  aggregate?(pipeline: unknown[]): {
    /** Materialize this explicitly configured cursor.
     * @returns {Promise<unknown[]>} Native records; manager input budgets do not cap result bytes.
     */
    toArray(): Promise<unknown[]>;
  };
  /** Update through generated selectors and validated $set fields.
   * @param {Record<string, unknown>} query - Generated native selector, not caller-owned raw Mongo operators.
   * @param {Record<string, unknown>} update - Generated validated native update shape.
   * @returns {Promise<{modifiedCount:number,matchedCount?:number}>} Exact native changed/matched counters when supplied.
   */
  updateMany?(
    query: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ modifiedCount: number; matchedCount?: number }>;
  /** Delete through the generated selector.
   * @param {Record<string, unknown>} query - Generated native selector, not caller-owned raw Mongo operators.
   * @returns {Promise<{deletedCount:number}>} Native deletion count.
   */
  deleteMany?(
    query: Record<string, unknown>
  ): Promise<{ deletedCount: number }>;
  /** Create a validated named-column index.
   * @param {Record<string, 1 | -1>} keys - Validated named-field index keys.
   * @param {Record<string, unknown>} options - Trusted explicit native/connector settings; no request-derived credentials.
   * @returns {Promise<string>} Native index name; authorization remains with the host.
   */
  createIndex?(
    keys: Record<string, 1 | -1>,
    options?: Record<string, unknown>
  ): Promise<string>;
  /** Remove an explicitly named native index.
   * @param {string} name - Explicit authored collection/index/database identifier.
   * @returns {Promise<unknown>} Native index outcome.
   */
  dropIndex?(name: string): Promise<unknown>;
  /** Drop this explicit collection.
   * @returns {Promise<boolean>} Native collection deletion outcome.
   */
  drop?(): Promise<boolean>;
};

export interface MongoConnectorOptions extends Record<string, unknown> {
  /** Optional borrowed database; cannot enable matching-client sessions. */
  db?: MongoDbLike;
  /** Optional borrowed native client; never closed by the connector. */
  client?: MongoClientLike;
  /** Default false; true requires native sessions and an explicit deployment probe. */
  transactions?: boolean;
  /** Default one, range 1–3; retries uncertain commit calls only. */
  maxCommitAttempts?: number;
  /** Default 10000ms, range 1–60000 for native commit policy. */
  maxCommitTimeMS?: number;
  /** Default 32, range 1–1024 retained until actual session cleanup. */
  maxSessions?: number;
  /** Default 5000ms, range 1–60000 for hello observation. */
  probeTimeoutMS?: number;
  /** Explicit selected database; prevents later database switching. */
  database?: string;
  /** Trusted Mongo URI; creates an owned optional-driver client only without injection. */
  uri?: string;
  /** Compatible URI alias; never public browser configuration. */
  url?: string;
  /** Private native transport/auth/TLS/retry policy owned by the host. */
  clientOptions?: Record<string, unknown>;
  /** Default false; true deliberately permits trusted unfiltered administration. */
  allowUnfilteredWrites?: boolean;
  /** Explicit trusted executable dispatch, still subject to validation/unfiltered-write policy. */
  executor?: (operation: QueryOperation) => Promise<unknown> | unknown;
  /** Prevent structured database switching. */
  fixedDatabase?: boolean;
  /** Compatible destructive database-operation guard. */
  locked?: boolean;
  /** Compatible destructive database-operation guard. */
  lockDatabase?: boolean;
}

/** Preserve native matched/modified/deleted count semantics without inventing changed rows.
 * @param {QueryOperation} operation - Validated structured operation.
 * @param {DatabaseExecutionContext} context - Explicit connection identity and cooperative request controls.
 * @param {unknown} native - Private native result, retained only for trusted consumers.
 * @param {unknown[]|undefined} pipeline - Optional generated private aggregation stages.
 * @returns {DatabaseResult} Normalized private outcome; counts must be safe nonnegative integers. */
const normalizeResult = (
  operation: QueryOperation,
  context: DatabaseExecutionContext,
  native: unknown,
  pipeline?: unknown[]
): DatabaseResult => {
  /** Object-shaped native outcome used only for reviewed count/identity fields. */
  const objectResult =
    native && typeof native === 'object'
      ? (native as Record<string, unknown>)
      : {};
  // Validate every supplied native count without conflating matched and changed rows.
  for (const key of ['matchedCount', 'modifiedCount', 'deletedCount']) {
    if (
      objectResult[key] !== undefined &&
      (!Number.isSafeInteger(objectResult[key]) ||
        Number(objectResult[key]) < 0)
    ) {
      throw createDatabaseError({
        code: 'INVALID_MONGO_COUNT',
        message: 'Invalid Mongo result count',
      });
    }
  }
  // Preserve native array/rows precedence without inventing record conversion.
  let rows: unknown[] | undefined;
  if (Array.isArray(native)) {
    rows = native;
  } else if (Array.isArray(objectResult.rows)) {
    rows = objectResult.rows;
  }

  return {
    ok: true,
    connection: context.connection.slug,
    connector: context.connection.connector,
    operation: operation.op,
    rows,
    rowCount: rows?.length,
    matchedCount:
      typeof objectResult.matchedCount === 'number'
        ? objectResult.matchedCount
        : undefined,
    changedCount:
      typeof objectResult.modifiedCount === 'number'
        ? objectResult.modifiedCount
        : undefined,
    counts: {
      affected:
        typeof objectResult.modifiedCount === 'number' ||
        typeof objectResult.deletedCount === 'number'
          ? 'exact'
          : 'unknown',
      matched:
        typeof objectResult.matchedCount === 'number' ? 'exact' : 'unknown',
      changed:
        typeof objectResult.modifiedCount === 'number' ? 'exact' : 'unknown',
      affectedMeaning: 'changed',
    },
    // Preserve native read order and zero modifiedCount precedence over deletedCount.
    affectedCount: (() => {
      if (typeof objectResult.modifiedCount === 'number') {
        return objectResult.modifiedCount;
      }
      if (typeof objectResult.deletedCount === 'number') {
        return objectResult.deletedCount;
      }
      return undefined;
    })(),
    insertedIds: (() => {
      if (objectResult.insertedId !== undefined) {
        return [String(objectResult.insertedId)];
      }
      if (
        objectResult.insertedIds &&
        typeof objectResult.insertedIds === 'object'
      ) {
        return Object.values(
          objectResult.insertedIds as Record<string, unknown>
        ).map((value) => String(value));
      }
      return undefined;
    })(),
    native,
    pipeline,
  };
};

/** Resolve an explicitly injected database or client-selected database.
 * @param {MongoConnectorOptions} options - Trusted injected transport configuration.
 * @param {string|undefined} databaseName - Optional explicit native database selection.
 * @returns {MongoDbLike} Borrowed native database or an explicit missing-client error. */
const getDatabase = (
  options: MongoConnectorOptions,
  databaseName?: string
): MongoDbLike => {
  if (options.db) {
    return options.db;
  }

  if (options.client) {
    return options.client.db(databaseName ?? options.database);
  }

  throw createDatabaseError({
    code: 'MISSING_MONGO_CLIENT',
    message:
      'Mongo connector requires options.db, options.client, or options.executor',
  });
};

/** Validate direct/facade operation policy before native mutation or trusted executor dispatch.
 * @param {MongoConnectorOptions} options - Trusted explicit native/connector settings; no request-derived credentials.
 * @param {QueryOperation} operation - Structured operation candidate; native support is deliberately limited.
 * @returns {void} Rejects unsafe selectors, unsupported returning and unapproved unfiltered writes.
 */
function validateOperation(
  options: MongoConnectorOptions,
  operation: QueryOperation
) {
  if (
    !operation ||
    typeof operation !== 'object' ||
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
      code: 'INVALID_QUERY',
      message: 'Invalid Mongo operation',
    });
  }
  if ('returning' in operation && operation.returning?.length) {
    throw createDatabaseError({
      code: 'UNSUPPORTED_RETURNING',
      message: 'Mongo structured operations do not support returning',
    });
  }
  if (!['createDb', 'dropDb', 'switchDB'].includes(operation.op)) {
    assertSafeField((operation as { table: string }).table);
  }
  if (['createDb', 'dropDb', 'switchDB'].includes(operation.op)) {
    assertSafeField((operation as { name: string }).name);
  }
  if ('where' in operation && operation.where !== undefined) {
    buildWhere(operation.where);
  }
  if (operation.op === 'update' || operation.op === 'delete') {
    if (!operation.where && !options.allowUnfilteredWrites) {
      throw createDatabaseError({
        code: 'UNFILTERED_WRITE',
        message:
          'Mongo write requires a where clause (or explicit allowUnfilteredWrites)',
      });
    }
  }
  if (operation.op === 'insert' || operation.op === 'update') {
    /** Candidate insert/update document inventory validated before native mutation. */
    const values = operation.values;
    if (
      !values ||
      typeof values !== 'object' ||
      (operation.op === 'update' && Array.isArray(values)) ||
      (Array.isArray(values) &&
        (!values.length ||
          values.length > 10000 ||
          values.some((v) => !v || typeof v !== 'object' || Array.isArray(v))))
    ) {
      throw createDatabaseError({
        code: 'INVALID_QUERY',
        message: 'Invalid Mongo write document',
      });
    }
    assertSafeDocument(values);
  }
  if (operation.op === 'select') {
    if (operation.orderBy !== undefined) {
      if (!Array.isArray(operation.orderBy)) {
        throw createDatabaseError({
          code: 'INVALID_QUERY',
          message: 'Invalid Mongo sort',
        });
      }
      buildSort(operation);
    }
    if (operation.groupBy !== undefined) {
      if (!Array.isArray(operation.groupBy)) {
        throw createDatabaseError({
          code: 'INVALID_QUERY',
          message: 'Invalid Mongo grouping',
        });
      }
      // Validate each grouping operand before generating a pipeline.
      for (const entry of operation.groupBy) {
        if (typeof entry === 'string') {
          assertSafeField(entry);
        } else {
          toMongoValue(entry, true);
        }
      }
    }
    if (operation.having) {
      buildWhere(operation.having);
    }
    // Validate every authored join table/alias/predicate before native dispatch.
    for (const join of operation.joins ?? []) {
      assertSafeField(join.table);
      if (join.as !== undefined) {
        assertSafeField(join.as);
      }
      buildWhere(join.on);
    }
    // Validate both union inventories without accepting arbitrary stage objects.
    for (const union of [
      ...(operation.union ?? []),
      ...(operation.unionAll ?? []),
    ]) {
      assertSafeField(union.table);
      if (union.where) {
        buildWhere(union.where);
      }
    }
  }
  // Validate every index before any createCollection mutation can occur.
  let indexes: Extract<QueryOperation, { op: 'createIndex' }>[] = [];
  if (operation.op === 'createTable') {
    indexes = operation.indexes ?? [];
  } else if (operation.op === 'createIndex') {
    indexes = [operation];
  }
  // Reject invalid indexes before createCollection can mutate a namespace.
  for (const index of indexes) {
    if (index.name !== undefined) {
      assertSafeField(index.name);
    }
    if (
      !Array.isArray(index.columns) ||
      !index.columns.length ||
      index.columns.length > 64 ||
      index.columns.some((c) => typeof c !== 'string')
    ) {
      throw createDatabaseError({
        code: 'INVALID_INDEX',
        message: 'Mongo indexes require plain named columns',
      });
    }
    // Require every index operand to be a safe named column.
    for (const column of index.columns) {
      assertSafeField(column as string);
    }
    if (index.unique !== undefined && typeof index.unique !== 'boolean') {
      throw createDatabaseError({
        code: 'INVALID_INDEX',
        message: 'Invalid Mongo index policy',
      });
    }
  }
}

/** Validate and dispatch one supported native operation without raw operator passthrough.
 * @param {MongoConnectorOptions} options - Trusted normalized native transport/policy.
 * @param {QueryOperation} operation - Validated structured operation.
 * @param {DatabaseExecutionContext} context - Explicit connection identity and cooperative request controls.
 * @returns {Promise<DatabaseResult>} Normalized native result; schema/pipeline semantics remain deliberately limited. */
const executeWithDb = async (
  options: MongoConnectorOptions,
  operation: QueryOperation,
  context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
  validateOperation(options, operation);
  /** Explicit configured database name, never a browser-selected connection. */
  const databaseName =
    typeof options.database === 'string' ? options.database : undefined;
  if ('table' in operation && typeof operation.table === 'string') {
    assertSafeField(operation.table);
  }
  if (
    'name' in operation &&
    typeof operation.name === 'string' &&
    ['createDb', 'dropDb', 'switchDB', 'dropIndex'].includes(operation.op)
  ) {
    assertSafeField(operation.name);
  }

  if (
    (operation.op === 'createDb' || operation.op === 'dropDb') &&
    (options.locked || options.lockDatabase)
  ) {
    throw createDatabaseError({
      code: 'DATABASE_LOCKED',
      message: `Operation "${operation.op}" is locked for connection "${context.connection.slug}"`,
    });
  }

  if (
    operation.op === 'switchDB' &&
    (options.fixedDatabase || options.database)
  ) {
    throw createDatabaseError({
      code: 'DATABASE_FIXED',
      message: `Connection "${context.connection.slug}" uses a fixed database and cannot be switched`,
    });
  }

  if (typeof options.executor === 'function') {
    return normalizeResult(
      operation,
      context,
      await options.executor(operation)
    );
  }

  switch (operation.op) {
    case 'createDb':
      getDatabase(options, operation.name);
      return normalizeResult(operation, context, { ok: true });
    case 'dropDb':
      return normalizeResult(
        operation,
        context,
        await requireMethod(
          getDatabase(options, operation.name).dropDatabase,
          'dropDatabase'
        ).call(getDatabase(options, operation.name))
      );
    case 'switchDB':
      getDatabase(options, operation.name);
      return normalizeResult(operation, context, {
        ok: true,
        database: operation.name,
      });
    case 'createTable': {
      /** Borrowed resolved database used for this schema operation. */
      const db = getDatabase(options, databaseName);
      if (!db.createCollection) {
        throw createDatabaseError({
          code: 'UNSUPPORTED_OPERATION',
          message: 'Mongo database does not support createCollection',
        });
      }
      try {
        await db.createCollection(operation.table);
      } catch (error) {
        /** Private native namespace-error classification; only known existing-namespace codes can be tolerated. */
        const e = error as { code?: number; codeName?: string };
        if (
          !operation.ifNotExists ||
          (e.code !== 48 && e.codeName !== 'NamespaceExists')
        ) {
          throw error;
        }
      }
      /** Borrowed native collection whose methods retain their original receiver. */
      const collection = db.collection(operation.table);
      // Create only prevalidated named-column indexes after the explicit namespace operation.
      for (const index of operation.indexes ?? []) {
        if (index.columns.some((column) => typeof column !== 'string')) {
          throw createDatabaseError({
            code: 'INVALID_INDEX',
            message: 'Mongo indexes require plain named columns',
          });
        }
        index.columns.forEach((column) => assertSafeField(column as string));
        await requireMethod(collection.createIndex, 'createIndex').call(
          collection,
          Object.fromEntries(
            index.columns.map((column) => [column, 1 as const])
          ),
          {
            unique: index.unique,
            name: index.name,
          }
        );
      }
      return normalizeResult(operation, context, { ok: true });
    }
    case 'dropTable': {
      /** Borrowed native collection whose methods retain their original receiver. */
      const collection = getDatabase(options, databaseName).collection(
        operation.table
      );
      return normalizeResult(
        operation,
        context,
        await requireMethod(collection.drop, 'drop').call(collection)
      );
    }
    case 'alterTable':
      throw createDatabaseError({
        code: 'UNSUPPORTED_OPERATION',
        message:
          'Mongo alterTable is not supported; perform an explicit schema migration',
      });
    case 'turcunateTable': {
      /** Borrowed native collection whose methods retain their original receiver. */
      const collection = getDatabase(options, databaseName).collection(
        operation.table
      );
      return normalizeResult(
        operation,
        context,
        await requireMethod(collection.deleteMany, 'deleteMany').call(
          collection,
          {}
        )
      );
    }
    case 'createIndex': {
      /** Borrowed native collection whose methods retain their original receiver. */
      const collection = getDatabase(options, databaseName).collection(
        operation.table
      );
      if (operation.columns.some((column) => typeof column !== 'string')) {
        throw createDatabaseError({
          code: 'INVALID_INDEX',
          message: 'Mongo indexes require plain named columns',
        });
      }
      operation.columns.forEach((column) => assertSafeField(column as string));
      /** Private native outcome checked before normalized result exposure. */
      const result = await requireMethod(
        collection.createIndex,
        'createIndex'
      ).call(
        collection,
        Object.fromEntries(
          operation.columns.map((column) => [column, 1 as const])
        ),
        {
          unique: operation.unique,
          name: operation.name,
        }
      );
      return normalizeResult(operation, context, { value: result });
    }
    case 'dropIndex': {
      if (!operation.table) {
        throw createDatabaseError({
          code: 'INVALID_IDENTIFIER',
          message: 'dropIndex requires table',
        });
      }
      /** Borrowed native collection whose methods retain their original receiver. */
      const collection = getDatabase(options, databaseName).collection(
        operation.table
      );
      return normalizeResult(
        operation,
        context,
        await requireMethod(collection.dropIndex, 'dropIndex').call(
          collection,
          operation.name
        )
      );
    }
    case 'insert':
      return executeInsert(options, operation, context);
    case 'select':
      return executeSelect(options, operation, context);
    case 'update':
      return executeUpdate(options, operation, context);
    case 'delete':
      return executeDelete(options, operation, context);
    default:
      throw createDatabaseError({
        code: 'UNSUPPORTED_OPERATION',
        message: `Unsupported Mongo operation "${String((operation as QueryOperation).op)}"`,
      });
  }
};

/** Require a supported native structural method without fabricating success.
 * @param {T | undefined} method - Optional native method inspected before invocation.
 * @param {string} name - Explicit authored collection/index/database identifier.
 * @returns {T} Original method; caller preserves its collection/database receiver.
 */
function requireMethod<T extends (...args: any[]) => any>(
  method: T | undefined,
  name: string
): T {
  if (!method) {
    throw createDatabaseError({
      code: 'UNSUPPORTED_OPERATION',
      message: `Mongo collection does not support ${name}`,
    });
  }
  return method;
}

/** Validate documents and call native one/many insertion without callback replay.
 * @param {MongoConnectorOptions} options - Trusted normalized native transport/policy.
 * @param {InsertOperation} operation - Validated insertion candidate.
 * @param {DatabaseExecutionContext} context - Explicit connection identity and cooperative request controls.
 * @returns {Promise<DatabaseResult>} Native inserted identities and private result. */
const executeInsert = async (
  options: MongoConnectorOptions,
  operation: InsertOperation,
  context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
  /** Borrowed native collection whose methods retain their original receiver. */
  const collection = getDatabase(options, options.database).collection(
    operation.table
  );
  assertSafeDocument(operation.values);
  if (Array.isArray(operation.values)) {
    return normalizeResult(
      operation,
      context,
      await requireMethod(collection.insertMany, 'insertMany').call(
        collection,
        operation.values as Record<string, unknown>[]
      )
    );
  }

  return normalizeResult(
    operation,
    context,
    await requireMethod(collection.insertOne, 'insertOne').call(
      collection,
      operation.values as Record<string, unknown>
    )
  );
};

/** Select simple cursor or reviewed generated aggregation paths with explicit native limits.
 * @param {MongoConnectorOptions} options - Trusted normalized native transport/policy.
 * @param {SelectOperation} operation - Validated selected fields/order/filter/limits.
 * @param {DatabaseExecutionContext} context - Explicit connection identity and cooperative request controls.
 * @returns {Promise<DatabaseResult>} Native records and optional private generated pipeline. */
const executeSelect = async (
  options: MongoConnectorOptions,
  operation: SelectOperation,
  context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
  /** Borrowed native collection whose methods retain their original receiver. */
  const collection = getDatabase(options, options.database).collection(
    operation.table
  );
  /** Validated limit/top/fetch precedence; explicit cap is at most 100000 rows. */
  const requestedLimit =
    operation.limit ??
    operation.top ??
    (typeof operation.fetch === 'number'
      ? operation.fetch
      : operation.fetch?.count);
  if (
    requestedLimit !== undefined &&
    (!Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 100000)
  ) {
    throw createDatabaseError({
      code: 'INVALID_QUERY',
      message: 'Mongo limit must be between 1 and 100000',
    });
  }
  if (
    operation.offset !== undefined &&
    (!Number.isSafeInteger(operation.offset) ||
      operation.offset < 0 ||
      operation.offset > 1_000_000)
  ) {
    throw createDatabaseError({
      code: 'INVALID_QUERY',
      message: 'Invalid Mongo offset',
    });
  }
  // Portable analytics COUNT queries: convert the DB facade's small, validated
  // COUNT(id)/GROUP BY DSL subset to Mongo aggregation. Ordinary Mongo selects
  // continue through their previous paths unchanged.
  /** Authored projection inventory inspected for the narrow portable analytics shapes. */
  const cols = operation.columns;
  /** Final projected column candidate for the supported COUNT alias. */
  const countCol = cols?.[cols.length - 1];
  /** Structured expression candidate, never a raw aggregation stage. */
  const countExpr =
    countCol && typeof countCol === 'object' && 'expr' in countCol
      ? countCol.expr
      : undefined;
  /** First explicit COUNT argument checked against the supported ID column. */
  const countArg =
    countExpr &&
    typeof countExpr === 'object' &&
    'args' in countExpr &&
    Array.isArray(countExpr.args)
      ? countExpr.args[0]
      : undefined;
  /** Exact supported COUNT(id) as event_count pattern, without generic SQL COUNT claims. */
  const isCount =
    typeof countExpr === 'object' &&
    countExpr !== null &&
    'kind' in countExpr &&
    countExpr.kind === 'function' &&
    countExpr.name === 'COUNT' &&
    countExpr.args?.length === 1 &&
    typeof countArg === 'object' &&
    countArg !== null &&
    'kind' in countArg &&
    countArg.kind === 'column' &&
    'name' in countArg &&
    countArg.name === 'id' &&
    typeof countCol === 'object' &&
    'as' in countCol &&
    countCol.as === 'event_count';
  /** First projection candidate for a category grouping. */
  const dimensionCol = cols?.[0];
  /** Structured first-column expression candidate. */
  const dimExpr =
    dimensionCol && typeof dimensionCol === 'object' && 'expr' in dimensionCol
      ? dimensionCol.expr
      : undefined;
  /** Validated column name only when the expression is an explicit column. */
  const dimension =
    dimExpr &&
    typeof dimExpr === 'object' &&
    'kind' in dimExpr &&
    dimExpr.kind === 'column'
      ? dimExpr.name
      : undefined;
  /** Exact two-column COUNT/category/groupBy pattern supported by the analytics consumer. */
  const grouped =
    cols?.length === 2 &&
    isCount &&
    typeof dimension === 'string' &&
    typeof dimensionCol === 'object' &&
    'as' in dimensionCol &&
    dimensionCol.as === 'category' &&
    operation.groupBy?.length === 1 &&
    operation.groupBy[0] === dimension;
  /** Exact ungrouped one-column total pattern. */
  const onlyTotal = cols?.length === 1 && isCount && !operation.groupBy?.length;
  if (
    (grouped || onlyTotal) &&
    !operation.joins?.length &&
    !operation.having &&
    !operation.union?.length &&
    !operation.unionAll?.length
  ) {
    /** Generated native stages; never accepts executable caller pipeline strings. */
    const pipeline: unknown[] = [];
    if (operation.where) {
      pipeline.push({ $match: buildWhere(operation.where) });
    }
    if (grouped) {
      assertSafeField(dimension!);
      pipeline.push({
        $group: { _id: `$${dimension}`, event_count: { $sum: 1 } },
      });
      pipeline.push({ $project: { _id: 0, category: '$_id', event_count: 1 } });
      pipeline.push({ $sort: { event_count: -1, category: 1 } });
      if (requestedLimit !== undefined) {
        pipeline.push({ $limit: requestedLimit });
      }
    } else {
      pipeline.push({ $count: 'event_count' });
    }
    /** Returned native records preserved without BSON-to-lossless-JSON claims. */
    const rows = await requireMethod(collection.aggregate, 'aggregate')
      .call(collection, pipeline)
      .toArray();
    return normalizeResult(
      operation,
      context,
      onlyTotal && rows.length === 0 ? [{ event_count: 0 }] : rows,
      pipeline
    );
  }
  // Opt-in numeric fact metric DSL. This narrow shape is generated exclusively by
  // the analytics package: property field filtering and a validated numeric column.
  /** Projection candidate for the supported numeric fact metric. */
  const metricColumn = cols?.[0];
  /** Structured numeric aggregate expression candidate. */
  const numericMetricExpr =
    metricColumn && typeof metricColumn === 'object' && 'expr' in metricColumn
      ? metricColumn.expr
      : undefined;
  /** First numeric aggregate argument checked against numeric_value. */
  const numericArg =
    numericMetricExpr &&
    typeof numericMetricExpr === 'object' &&
    'args' in numericMetricExpr &&
    Array.isArray(numericMetricExpr.args)
      ? numericMetricExpr.args[0]
      : undefined;
  /** Only the implemented SUM/AVG/MIN/MAX accumulator names. */
  const metricNames = ['SUM', 'AVG', 'MIN', 'MAX'];
  /** Exact supported metric expression and metric_value alias. */
  const validMetric =
    numericMetricExpr &&
    typeof numericMetricExpr === 'object' &&
    'kind' in numericMetricExpr &&
    numericMetricExpr.kind === 'function' &&
    'name' in numericMetricExpr &&
    metricNames.includes(String(numericMetricExpr.name)) &&
    'args' in numericMetricExpr &&
    Array.isArray(numericMetricExpr.args) &&
    numericMetricExpr.args.length === 1 &&
    numericArg &&
    typeof numericArg === 'object' &&
    numericArg.kind === 'column' &&
    numericArg.name === 'numeric_value' &&
    typeof metricColumn === 'object' &&
    'as' in metricColumn &&
    metricColumn.as === 'metric_value';
  /** Final projection candidate for numeric_count. */
  const numericCountCol = cols?.[cols.length - 1];
  /** Structured COUNT expression candidate for numeric facts. */
  const numericCountExpr =
    numericCountCol &&
    typeof numericCountCol === 'object' &&
    'expr' in numericCountCol
      ? numericCountCol.expr
      : undefined;
  /** First COUNT argument checked against event_id. */
  const numericCountArg =
    numericCountExpr &&
    typeof numericCountExpr === 'object' &&
    'args' in numericCountExpr &&
    Array.isArray(numericCountExpr.args)
      ? numericCountExpr.args[0]
      : undefined;
  /** Exact COUNT(event_id) as numeric_count pattern. */
  const validNumericCount =
    numericCountExpr &&
    typeof numericCountExpr === 'object' &&
    'kind' in numericCountExpr &&
    numericCountExpr.kind === 'function' &&
    numericCountExpr.name === 'COUNT' &&
    'args' in numericCountExpr &&
    Array.isArray(numericCountExpr.args) &&
    numericCountExpr.args.length === 1 &&
    numericCountArg &&
    typeof numericCountArg === 'object' &&
    numericCountArg.kind === 'column' &&
    numericCountArg.name === 'event_id' &&
    typeof numericCountCol === 'object' &&
    'as' in numericCountCol &&
    numericCountCol.as === 'numeric_count';
  /** First numeric projection candidate for a grouped category. */
  const numericDimCol = cols?.[0];
  /** Structured category column expression candidate. */
  const numericDimExpr =
    numericDimCol &&
    typeof numericDimCol === 'object' &&
    'expr' in numericDimCol
      ? numericDimCol.expr
      : undefined;
  /** Explicit named grouping field, validated before pipeline interpolation. */
  const numericDimension =
    numericDimExpr &&
    typeof numericDimExpr === 'object' &&
    numericDimExpr.kind === 'column'
      ? numericDimExpr.name
      : undefined;
  /** Exact three-column category/metric/count analytics shape. */
  const numericGrouped =
    cols?.length === 3 &&
    validNumericCount &&
    typeof cols?.[1] === 'object' &&
    'expr' in cols[1] &&
    cols[1].expr &&
    typeof cols[1].expr === 'object' &&
    cols[1].expr.kind === 'function' &&
    metricNames.includes(cols[1].expr.name) &&
    (cols[1].expr.args?.[0] as { name?: string } | undefined)?.name ===
      'numeric_value' &&
    cols[1].as === 'metric_value' &&
    typeof numericDimCol === 'object' &&
    'as' in numericDimCol &&
    numericDimCol.as === 'category' &&
    typeof numericDimension === 'string' &&
    operation.groupBy?.length === 1 &&
    operation.groupBy[0] === numericDimension;
  /** Exact ungrouped metric/count analytics shape. */
  const numericTotal =
    cols?.length === 2 &&
    validMetric &&
    validNumericCount &&
    !operation.groupBy?.length;
  if (
    (numericTotal || numericGrouped) &&
    !operation.joins?.length &&
    !operation.having &&
    !operation.union?.length &&
    !operation.unionAll?.length
  ) {
    /** Validated aggregate name selected from the exact total/group pattern. */
    const metric = numericGrouped
      ? (cols![1] as { expr: { name: string } }).expr.name
      : String((numericMetricExpr as { name: string }).name);
    /** Fixed allowlist translating supported metric names to native accumulator operators. */
    const mongoMetric: Record<string, string> = {
      SUM: '$sum',
      AVG: '$avg',
      MIN: '$min',
      MAX: '$max',
    };
    /** Generated numeric_value accumulator; no raw caller operator key. */
    const accumulator = { [mongoMetric[metric]]: '$numeric_value' };
    /** Generated native stages; never accepts executable caller pipeline strings. */
    const pipeline: unknown[] = [];
    if (operation.where) {
      pipeline.push({ $match: buildWhere(operation.where) });
    }
    if (numericGrouped) {
      assertSafeField(numericDimension!);
      pipeline.push({
        $group: {
          _id: `$${numericDimension}`,
          metric_value: accumulator,
          numeric_count: { $sum: 1 },
        },
      });
      pipeline.push({
        $project: {
          _id: 0,
          category: '$_id',
          metric_value: 1,
          numeric_count: 1,
        },
      });
      pipeline.push({ $sort: { metric_value: -1, category: 1 } });
      if (requestedLimit !== undefined) {
        pipeline.push({ $limit: requestedLimit });
      }
    } else {
      pipeline.push({
        $group: {
          _id: null,
          metric_value: accumulator,
          numeric_count: { $sum: 1 },
        },
      });
      pipeline.push({
        $project: { _id: 0, metric_value: 1, numeric_count: 1 },
      });
    }
    /** Returned native records preserved without BSON-to-lossless-JSON claims. */
    const rows = await requireMethod(collection.aggregate, 'aggregate')
      .call(collection, pipeline)
      .toArray();
    return normalizeResult(
      operation,
      context,
      numericTotal && rows.length === 0
        ? [{ metric_value: null, numeric_count: 0 }]
        : rows,
      pipeline
    );
  }
  /** Whether the authored query needs the existing limited aggregation path. */
  const advanced = Boolean(
    operation.joins?.length ||
    operation.groupBy?.length ||
    operation.having ||
    operation.union?.length ||
    operation.unionAll?.length
  );
  if (!advanced) {
    /** Generated structured predicate or an explicit empty read filter. */
    const filter = operation.where ? buildWhere(operation.where) : {};
    /** Native cursor configured before toArray; native ownership remains driver-specific. */
    const cursor = requireMethod(collection.find, 'find').call(
      collection,
      filter,
      { projection: buildProjection(operation) }
    );
    /** Validated native named-field ordering. */
    const sort = buildSort(operation);
    if (sort) {
      if (!cursor.sort) {
        throw createDatabaseError({
          code: 'UNSUPPORTED_OPERATION',
          message: 'Mongo cursor does not support sort',
        });
      }
      cursor.sort(sort);
    }
    if (operation.offset) {
      if (!cursor.skip) {
        throw createDatabaseError({
          code: 'UNSUPPORTED_OPERATION',
          message: 'Mongo cursor does not support skip',
        });
      }
      cursor.skip(operation.offset);
    }
    if (requestedLimit !== undefined) {
      if (!cursor.limit) {
        throw createDatabaseError({
          code: 'UNSUPPORTED_OPERATION',
          message: 'Mongo cursor does not support limit',
        });
      }
      cursor.limit(requestedLimit);
    }
    return normalizeResult(operation, context, await cursor.toArray());
  }
  if (!collection.aggregate) {
    throw createDatabaseError({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Advanced Mongo select requires aggregate',
    });
  }
  /** Generated native stages; never accepts executable caller pipeline strings. */
  const pipeline: unknown[] = [];

  if (operation.where) {
    pipeline.push({ $match: buildWhere(operation.where) });
  }

  // Generate only the existing supported lookup shape; this is not generic SQL join parity.
  for (const join of operation.joins ?? []) {
    assertSafeField(join.table);
    if (join.as) {
      assertSafeField(join.as);
    }
    pipeline.push({
      $lookup: {
        from: join.table,
        as: join.as ?? join.table,
        let: {},
        pipeline: [{ $match: buildWhere(join.on) }],
      },
    });
  }

  /** Validated native projection with literal values wrapped as data. */
  const projection = buildProjection(operation);
  if (projection) {
    pipeline.push({ $project: projection });
  }

  if (operation.groupBy && operation.groupBy.length > 0) {
    pipeline.push({
      $group: {
        _id: Object.fromEntries(
          operation.groupBy.map((entry) => [
            typeof entry === 'string' ? entry : 'value',
            typeof entry === 'string'
              ? (assertSafeField(entry), `$${entry}`)
              : toMongoValue(entry, true),
          ])
        ),
      },
    });
  }

  if (operation.having) {
    pipeline.push({ $match: buildWhere(operation.having) });
  }

  /** Validated native named-field ordering. */
  const sort = buildSort(operation);
  if (sort) {
    pipeline.push({ $sort: sort });
  }

  if (typeof operation.offset === 'number' && operation.offset > 0) {
    pipeline.push({ $skip: operation.offset });
  }

  /** Resolve and validate one positive policy integer.
   * @param {unknown} value - Candidate configured limit.
   * @param {number} fallback - Default when absent.
   * @param {number} max - Inclusive upper bound.
   * @returns {number} Validated policy integer. */
  const limit =
    operation.limit ??
    operation.top ??
    (typeof operation.fetch === 'number'
      ? operation.fetch
      : operation.fetch?.count);
  if (typeof limit === 'number') {
    pipeline.push({ $limit: limit });
  }

  // Append supported union stages from validated named collections.
  for (const union of operation.union ?? []) {
    assertSafeField(union.table);
    pipeline.push({
      $unionWith: {
        coll: union.table,
        pipeline: union.where ? [{ $match: buildWhere(union.where) }] : [],
      },
    });
  }

  // Preserve the existing union-all translation without claiming duplicate semantics parity.
  for (const union of operation.unionAll ?? []) {
    assertSafeField(union.table);
    pipeline.push({
      $unionWith: {
        coll: union.table,
        pipeline: union.where ? [{ $match: buildWhere(union.where) }] : [],
      },
    });
  }

  /** Returned native records preserved without BSON-to-lossless-JSON claims. */
  const rows = await collection.aggregate(pipeline).toArray();

  return normalizeResult(operation, context, rows, pipeline);
};

/** Reject unfiltered writes unless explicitly enabled, then use native $set on validated fields.
 * @param {MongoConnectorOptions} options - Trusted normalized native transport/policy.
 * @param {UpdateOperation} operation - Validated update and explicit predicate.
 * @param {DatabaseExecutionContext} context - Explicit connection identity and cooperative request controls.
 * @returns {Promise<DatabaseResult>} Native matched/modified counts, including zero. */
const executeUpdate = async (
  options: MongoConnectorOptions,
  operation: UpdateOperation,
  context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
  /** Borrowed native collection whose methods retain their original receiver. */
  const collection = getDatabase(options, options.database).collection(
    operation.table
  );
  if (!operation.where && !options.allowUnfilteredWrites) {
    throw createDatabaseError({
      code: 'UNFILTERED_WRITE',
      message:
        'Mongo update requires a where clause (or explicit allowUnfilteredWrites)',
    });
  }
  assertSafeDocument(operation.values);
  return normalizeResult(
    operation,
    context,
    await requireMethod(collection.updateMany, 'updateMany').call(
      collection,
      operation.where ? buildWhere(operation.where) : {},
      {
        $set: operation.values,
      }
    )
  );
};

/** Reject unfiltered deletion unless explicitly enabled, then use the generated native selector.
 * @param {MongoConnectorOptions} options - Trusted normalized native transport/policy.
 * @param {DeleteOperation} operation - Validated deletion predicate.
 * @param {DatabaseExecutionContext} context - Explicit connection identity and cooperative request controls.
 * @returns {Promise<DatabaseResult>} Native deleted count; no automatic retry. */
const executeDelete = async (
  options: MongoConnectorOptions,
  operation: DeleteOperation,
  context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
  /** Borrowed native collection whose methods retain their original receiver. */
  const collection = getDatabase(options, options.database).collection(
    operation.table
  );
  if (!operation.where && !options.allowUnfilteredWrites) {
    throw createDatabaseError({
      code: 'UNFILTERED_WRITE',
      message:
        'Mongo delete requires a where clause (or explicit allowUnfilteredWrites)',
    });
  }
  return normalizeResult(
    operation,
    context,
    await requireMethod(collection.deleteMany, 'deleteMany').call(
      collection,
      operation.where ? buildWhere(operation.where) : {}
    )
  );
};

/** Explicit native connector owner with opt-in sessions and host-owned injected clients. */
export interface MongoConnector extends DatabaseConnector {
  /** Explicitly enabled/probed pin runner; unsupported configuration rejects before callback use. */
  transaction: DatabaseTransaction;
  /** Fence new work and drain accepted operations/sessions before closing owned clients.
   * @returns {Promise<void>} Idempotent wrapper cleanup; borrowed clients remain open.
   */
  disconnect(): Promise<void>;
}
/** Create an explicit owned-URI or borrowed-client connector; enable sessions only after the opt-in probe.
 * @param {MongoConnectorOptions} options - Trusted explicit native/connector settings; no request-derived credentials.
 * @param {NormalizedConnectionConfig} connection - Private normalized connection identity.
 * @returns {Promise<MongoConnector>} Closeable connector; injected native clients remain host-owned.
 */
export async function createConnector(
  options: MongoConnectorOptions = {},
  connection?: NormalizedConnectionConfig
): Promise<MongoConnector> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw createDatabaseError({
      code: 'INVALID_MONGO_OPTIONS',
      message: 'Invalid Mongo options',
    });
  }
  /** Private shallow option snapshot; caller configuration is not mutated. */
  const normalized = { ...options };
  // Reject nonboolean transaction/destructive-write/database-lock configuration before acquisition.
  for (const key of [
    'transactions',
    'allowUnfilteredWrites',
    'fixedDatabase',
    'locked',
    'lockDatabase',
  ] as const) {
    if (normalized[key] !== undefined && typeof normalized[key] !== 'boolean') {
      throw createDatabaseError({
        code: 'INVALID_MONGO_OPTIONS',
        message: 'Invalid Mongo boolean option',
      });
    }
  }
  /** Resolve and validate one positive policy integer.
   * @param {unknown} value - Candidate configured limit.
   * @param {number} fallback - Default when absent.
   * @param {number} max - Inclusive upper bound.
   * @returns {number} Validated policy integer. */
  const limit = (value: unknown, fallback: number, max: number) => {
    /** Configured integer or default checked before acquisition. */
    const n = value === undefined ? fallback : value;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > max) {
      throw createDatabaseError({
        code: 'INVALID_MONGO_OPTIONS',
        message: 'Invalid Mongo limit',
      });
    }
    return n;
  };
  /** Validated finite session/commit/probe budgets. */
  const policy = {
    maxCommitAttempts: limit(normalized.maxCommitAttempts, 1, 3),
    maxCommitTimeMS: limit(normalized.maxCommitTimeMS, 10000, 60000),
    maxSessions: limit(normalized.maxSessions, 32, 1024),
    probeTimeoutMS: limit(normalized.probeTimeoutMS, 5000, 60000),
  };
  if (normalized.database !== undefined) {
    assertSafeField(normalized.database);
  }
  if (
    normalized.clientOptions !== undefined &&
    (!normalized.clientOptions ||
      typeof normalized.clientOptions !== 'object' ||
      Array.isArray(normalized.clientOptions))
  ) {
    throw createDatabaseError({
      code: 'INVALID_MONGO_OPTIONS',
      message: 'Invalid Mongo client options',
    });
  }
  if (
    (normalized.db !== undefined &&
      (!normalized.db || typeof normalized.db.collection !== 'function')) ||
    (normalized.client !== undefined &&
      (!normalized.client || typeof normalized.client.db !== 'function')) ||
    (normalized.executor !== undefined &&
      typeof normalized.executor !== 'function')
  ) {
    throw createDatabaseError({
      code: 'INVALID_MONGO_OPTIONS',
      message: 'Invalid Mongo transport',
    });
  }
  if (normalized.transactions && (normalized.db || normalized.executor)) {
    throw createDatabaseError({
      code: 'UNSUPPORTED_MONGO_SESSIONS',
      message: 'Transactions require a client owning both database and session',
    });
  }
  let ownedClient: MongoClientLike | undefined;
  /** Explicit trusted Mongo URI, never emitted in fixed diagnostics. */
  const uri = normalized.uri ?? normalized.url;
  if (
    uri !== undefined &&
    (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//i.test(uri))
  ) {
    throw createDatabaseError({
      code: 'INVALID_CONNECTION',
      message: 'Invalid MongoDB URI',
    });
  }
  if (!normalized.db && !normalized.client && !normalized.executor && uri) {
    /** Fixed optional mongodb driver import, never derived from arbitrary user input. */
    const packageName = 'mongodb';
    let driver: Record<string, any>;
    try {
      driver = await import(packageName);
    } catch (cause) {
      throw createDatabaseError({
        code: 'MISSING_MONGO_DRIVER',
        message: 'Install mongodb to use a URI connection',
        cause,
      });
    }
    ownedClient = new driver.MongoClient(uri, {
      serverSelectionTimeoutMS: policy.probeTimeoutMS,
      connectTimeoutMS: policy.probeTimeoutMS,
      ...normalized.clientOptions,
    });
    normalized.client = ownedClient;
  }
  if (!normalized.db && !normalized.client && !normalized.executor) {
    throw createDatabaseError({
      code: 'MISSING_MONGO_CLIENT',
      message: 'Provide db, client, executor, or uri',
    });
  }
  /** Private default connection identity for direct connector use. */
  const fallback = {
    connection: connection ?? {
      name: 'MongoDB',
      slug: 'default',
      connector: '@zeruxjs/db-mongo',
      options: {},
    },
  };
  let closed = false,
    closing: Promise<void> | undefined;
  /** Accepted operations retained until actual settlement before native shutdown. */
  const active = new Set<Promise<unknown>>();
  /** Fence native dispatch after shutdown/cancellation/deadline and validate connection context.
   * @param {DatabaseExecutionContext} ctx - Explicit native execution context.
   * @returns {void} Cooperative fence; issued work is never forcibly rolled back. */
  const check = (ctx: DatabaseExecutionContext) => {
    if (closed) {
      throw createDatabaseError({
        code: 'MONGO_CLOSED',
        message: 'Mongo connector closed',
      });
    }
    if (
      !ctx ||
      !ctx.connection ||
      typeof ctx.connection.slug !== 'string' ||
      typeof ctx.connection.connector !== 'string' ||
      (ctx.signal !== undefined && !(ctx.signal instanceof AbortSignal)) ||
      (ctx.deadline !== undefined &&
        (!Number.isSafeInteger(ctx.deadline) || ctx.deadline < 0))
    ) {
      throw createDatabaseError({
        code: 'INVALID_MONGO_CONTEXT',
        message: 'Invalid Mongo execution context',
      });
    }
    if (
      ctx.signal?.aborted ||
      (ctx.deadline !== undefined && ctx.deadline <= Date.now())
    ) {
      throw createDatabaseError({
        code: 'MONGO_CANCELLED',
        message: 'Mongo operation cancelled or deadline exceeded',
      });
    }
  };
  let sessions: ReturnType<typeof transactionAdapter> | undefined;
  if (normalized.transactions) {
    try {
      await ownedClient?.connect?.();
      await verifyTransactionDeployment(normalized.client!, policy);
      sessions = transactionAdapter(
        normalized.client!,
        policy,
        (op, ctx, session) =>
          executeWithDb(
            {
              ...normalized,
              db: sessionDatabase(getDatabase(normalized), session),
            },
            op,
            ctx
          ),
        check
      );
    } catch (error) {
      try {
        await ownedClient?.close?.();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          'Mongo initialization cleanup failed'
        );
      }
      throw error;
    }
  }
  /** Inert shared pinned runner, present only after explicit deployment probe. */
  const transaction = sessions
    ? createPinnedTransaction(sessions.adapter, fallback.connection)
    : undefined;
  /** Retain actual accepted operation settlement for connector drain.
   * @param {()=>Promise<T>} run - One trusted native-work callback.
   * @returns {Promise<T>} Observed native completion; no replay. */
  const tracked = async <T>(run: () => Promise<T>) => {
    /** Actual accepted native promise retained in the connector owner. */
    const work = Promise.resolve().then(run);
    active.add(work);
    try {
      return await work;
    } finally {
      active.delete(work);
    }
  };
  return {
    kind: 'mongo',
    options: normalized,
    capabilities: {
      returning: 'unsupported',
      transactions: sessions ? 'supported' : 'unsupported',
      cancellation: 'unsupported',
      schema: 'supported',
      indexes: 'supported',
      nativeAggregation: 'supported',
    },
    ...(sessions ? { transactionAdapter: sessions.adapter } : {}),
    /** Initialize only URI-created native clients; borrowed clients stay host-owned.
     * @returns {Promise<unknown>} Native readiness or explicit failure.
     */
    async connect() {
      check(fallback);
      await ownedClient?.connect?.();
    },
    /** Fence new work and drain accepted operations/sessions before closing owned clients.
     * @returns {Promise<void>} Idempotent wrapper cleanup; borrowed clients remain open.
     */
    disconnect() {
      closed = true;
      return (closing ??= Promise.resolve().then(async () => {
        await Promise.allSettled([...active]);
        await sessions?.drain();
        await ownedClient?.close?.();
      }));
    },
    /** Execute one validated operation through the explicit selected native transport.
     * @param {QueryOperation} operation - Structured operation candidate; native support is deliberately limited.
     * @param {DatabaseExecutionContext} context - Explicit connection-bound cooperative signal/deadline.
     * @returns {Promise<DatabaseResult>} Private normalized result; no callback replay.
     */
    execute(operation, context = fallback) {
      check(context);
      if ('returning' in operation && operation.returning?.length) {
        throw createDatabaseError({
          code: 'UNSUPPORTED_RETURNING',
          message: 'Mongo structured operations do not support returning',
        });
      }
      return tracked(() => executeWithDb(normalized, operation, context));
    },
    /** Use the explicitly enabled/probed native session runner.
     * @param {Parameters<DatabaseTransaction>[0]} run - Trusted application callback, never replayed by this adapter.
     * @param {Parameters<DatabaseTransaction>[1]} opts - Negotiated snapshot/deadline policy.
     * @returns {Promise<unknown>} Callback result only after actual session cleanup; unsupported opt-in rejects.
     */
    transaction(run, opts) {
      check(fallback);
      return tracked(() =>
        transaction
          ? transaction(run, opts)
          : Promise.reject(
              createDatabaseError({
                code: 'UNSUPPORTED_TRANSACTION',
                message:
                  'Mongo transactions require explicit enablement and a capable deployment',
              })
            )
      );
    },
    /** Read the privileged native handle only while this connector remains open.
     * @returns {MongoClientLike|MongoDbLike|undefined} Escape hatch bypassing structured policy; host retains authorization.
     */
    getNativeConnection() {
      check(fallback);
      return normalized.client ?? normalized.db;
    },
  };
}
export default createConnector;
