import type {
  AlterTableOperation,
  CreateDbOperation,
  CreateIndexOperation,
  CreateTableOperation,
  DatabaseFacade,
  DatabaseResult,
  DatabaseQueryOptions,
  DeleteOperation,
  DropDbOperation,
  DropIndexOperation,
  DropTableOperation,
  InsertOperation,
  MaybePromise,
  QueryOperation,
  SelectOperation,
  SwitchDbOperation,
  TruncateTableOperation,
  UpdateOperation,
} from './types.js';
import {
  configureDatabaseManager,
  createDatabaseManager,
  getActiveDatabaseManager,
  setActiveDatabaseManager,
} from './manager.js';
import { createDatabaseError } from './utils.js';

/** Resolve the explicitly active default connection for each compatibility call.

 * @returns {DatabaseFacade} Current bound facade; replacement does not close previous owners. */
const getDefaultFacade = (): DatabaseFacade =>
  getActiveDatabaseManager().getConnectionFacade();

/** Process-global compatibility facade; scoped managers remain the generation-owned API. */
export const db: DatabaseFacade = {
  /** Report negotiated native pin guarantees without acquiring a session.
   * @returns {Readonly<import("./transactions.js").PinnedTransactionCapabilities>|undefined} Detached guarantees or absent extension.
   */
  transactionCapabilities() {
    return getDefaultFacade().transactionCapabilities?.();
  },
  /** Run application work on one negotiated native pin through actual cleanup.
   * @param {(db:import("./transactions.js").TransactionDatabase)=>MaybePromise<T>} run - Trusted callback; use only its pinned facade and await work.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {Promise<T>} Callback result after commit/rollback/release; indeterminate commit failures remain explicit.
   */
  transaction(run, options) {
    /** Current bound facade, checked for optional native pin support. */
    const facade = getDefaultFacade();
    if (!facade.transaction) {
      throw createDatabaseError({
        code: 'UNSUPPORTED_TRANSACTION',
        message: 'Pinned transactions are unavailable',
      });
    }
    return facade.transaction(run, options);
  },
  /** Read normalized structured-connector guarantees.
   * @returns {Readonly<import("./types.js").DatabaseCapabilities>} Known support or unknown; native engine features are separate.
   */
  capabilities() {
    return (
      getDefaultFacade().capabilities?.() ?? {
        returning: 'unknown',
        transactions: 'unknown',
        cancellation: 'unknown',
        schema: 'unknown',
        indexes: 'unknown',
        nativeAggregation: 'unknown',
      }
    );
  },
  /** Read the current default facade metadata.
   * @returns {string} Configured default connection identity.
   */
  get slug() {
    return getDefaultFacade().slug;
  },
  /** Read the current default facade metadata.
   * @returns {string} Configured display name, not an authorization grant.
   */
  get name() {
    return getDefaultFacade().name;
  },
  /** Read the current default facade metadata.
   * @returns {string} Explicit configured executable connector package.
   */
  get connector() {
    return getDefaultFacade().connector;
  },
  /** Read the current default facade metadata.
   * @returns {Record<string,unknown>} Compatibility-redacted configuration; custom secrets require host review.
   */
  get options() {
    return getDefaultFacade().options;
  },
  /** Dispatch bounded JSON operations; arrays remain nontransactional unless used inside an actual pin.
   * @param {QueryOperation | QueryOperation[]} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult|DatabaseResult[]>} Validated connector results; native causes/results stay private.
   */
  query(
    operation: QueryOperation | QueryOperation[],
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult | DatabaseResult[]> {
    return getActiveDatabaseManager().query(operation, options);
  },
  /** Dispatch supported database creation through explicit connector policy.
   * @param {Omit<CreateDbOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  createDb(
    operation: Omit<CreateDbOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().createDb(
      { ...operation, op: 'createDb' },
      options
    );
  },
  /** Dispatch explicit database removal; host authorization is separate.
   * @param {Omit<DropDbOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  dropDb(
    operation: Omit<DropDbOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().dropDb(
      { ...operation, op: 'dropDb' },
      options
    );
  },
  /** Dispatch supported database selection outside pinned callbacks.
   * @param {Omit<SwitchDbOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific outcome.
   */
  switchDB(
    operation: Omit<SwitchDbOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().switchDB(
      { ...operation, op: 'switchDB' },
      options
    );
  },
  /** Dispatch validated structured schema creation.
   * @param {Omit<CreateTableOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  createTable(
    operation: Omit<CreateTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().createTable(
      { ...operation, op: 'createTable' },
      options
    );
  },
  /** Dispatch explicit table removal.
   * @param {Omit<DropTableOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  dropTable(
    operation: Omit<DropTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().dropTable(
      { ...operation, op: 'dropTable' },
      options
    );
  },
  /** Dispatch only the selected connector supported alteration subset.
   * @param {Omit<AlterTableOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  alterTable(
    operation: Omit<AlterTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().alterTable(
      { ...operation, op: 'alterTable' },
      options
    );
  },
  /** Preserve the legacy truncate spelling and native semantics.
   * @param {Omit<TruncateTableOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Native outcome; no universal identity/reset guarantee.
   */
  turcunateTable(
    operation: Omit<TruncateTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().turcunateTable(
      { ...operation, op: 'turcunateTable' },
      options
    );
  },
  /** Dispatch supported structured index creation.
   * @param {Omit<CreateIndexOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  createIndex(
    operation: Omit<CreateIndexOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().createIndex(
      { ...operation, op: 'createIndex' },
      options
    );
  },
  /** Dispatch explicit supported index removal.
   * @param {Omit<DropIndexOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  dropIndex(
    operation: Omit<DropIndexOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().dropIndex(
      { ...operation, op: 'dropIndex' },
      options
    );
  },
  /** Dispatch bounded prepared insertion rows.
   * @param {Omit<InsertOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Native counts/identities; a batch is not automatically atomic.
   */
  insert(
    operation: Omit<InsertOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().insert(
      { ...operation, op: 'insert' },
      options
    );
  },
  /** Dispatch a structured read with caller/connector-owned result limits.
   * @param {Omit<SelectOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Returned rows; manager input budgets do not cap result bytes.
   */
  select(
    operation: Omit<SelectOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().select(
      { ...operation, op: 'select' },
      options
    );
  },
  /** Dispatch structured updates with native affected/matched/changed semantics.
   * @param {Omit<UpdateOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Native count metadata; unknown/approximate counts cannot prove CAS.
   */
  update(
    operation: Omit<UpdateOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().update(
      { ...operation, op: 'update' },
      options
    );
  },
  /** Dispatch explicit structured deletion without automatic retry.
   * @param {Omit<DeleteOperation, 'op' | 'connection'>} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {import("./transactions.js").TransactionOptions} options - Explicit negotiated isolation and cooperative transaction controls.
   * @returns {MaybePromise<DatabaseResult>} Native counts; timeout does not prove rollback.
   */
  delete(
    operation: Omit<DeleteOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ) {
    return getActiveDatabaseManager().delete(
      { ...operation, op: 'delete' },
      options
    );
  },
  /** Expose the trusted native escape hatch only outside pinned callback scope.
   * @returns {unknown} Handle bypassing structured facade guarantees.
   */
  native() {
    return getDefaultFacade().native();
  },
};

/** Access a privileged connector only outside pinned callback scope.
 * @param {string} slug - Explicit configured connection identity.
 * @returns {import("./types.js").DatabaseConnector} Native connector escape hatch; host owns authorization. */
export const dbAccess = (slug: string) =>
  getActiveDatabaseManager().dbAccess(slug);

/** Route one operation or bounded batch through the active manager.
 * @param {QueryOperation|QueryOperation[]} operation - JSON candidate or nontransactional batch.
 * @param {DatabaseQueryOptions|undefined} options - Separate cancellation/deadline/strict capability policy.
 * @returns {MaybePromise<DatabaseResult|DatabaseResult[]>} Native results; array queries are not automatically transactions. */
export const query = (
  operation: QueryOperation | QueryOperation[],
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().query(operation, options);

/** Request database creation where the connector supports it. Uses the explicitly active manager.
 * @param {CreateDbOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const createDb = (
  operation: CreateDbOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().createDb(operation, options);

/** Request explicit database removal; host authorization remains required. Uses the explicitly active manager.
 * @param {DropDbOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const dropDb = (
  operation: DropDbOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().dropDb(operation, options);

/** Request a supported database switch outside pinned callbacks. Uses the explicitly active manager.
 * @param {SwitchDbOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const switchDB = (
  operation: SwitchDbOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().switchDB(operation, options);

/** Request validated schema creation. Uses the explicitly active manager.
 * @param {CreateTableOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const createTable = (
  operation: CreateTableOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().createTable(operation, options);

/** Request explicit table removal. Uses the explicitly active manager.
 * @param {DropTableOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const dropTable = (
  operation: DropTableOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().dropTable(operation, options);

/** Request supported structured table alterations. Uses the explicitly active manager.
 * @param {AlterTableOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const alterTable = (
  operation: AlterTableOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().alterTable(operation, options);

/** Preserve the historical truncate spelling and connector-specific semantics. Uses the explicitly active manager.
 * @param {TruncateTableOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const turcunateTable = (
  operation: TruncateTableOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().turcunateTable(operation, options);

/** Request supported structured index creation. Uses the explicitly active manager.
 * @param {CreateIndexOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const createIndex = (
  operation: CreateIndexOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().createIndex(operation, options);

/** Request explicit index removal. Uses the explicitly active manager.
 * @param {DropIndexOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const dropIndex = (
  operation: DropIndexOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().dropIndex(operation, options);

/** Insert structured JSON data without implying transactionality. Uses the explicitly active manager.
 * @param {InsertOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const insert = (
  operation: InsertOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().insert(operation, options);

/** Read structured data with caller/connector-owned row budgets. Uses the explicitly active manager.
 * @param {SelectOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const select = (
  operation: SelectOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().select(operation, options);

/** Update matching rows while preserving native count semantics. Uses the explicitly active manager.
 * @param {UpdateOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const update = (
  operation: UpdateOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().update(operation, options);

/** Delete matching rows; no automatic retry on uncertain writes. Uses the explicitly active manager.
 * @param {DeleteOperation} operation - Structured operation; connector validates its dialect-specific subset.
 * @param {DatabaseQueryOptions|undefined} options - Optional separate execution controls.
 * @returns {MaybePromise<DatabaseResult>} Connector result with native count/consistency semantics. */
export const remove = (
  operation: DeleteOperation,
  options?: DatabaseQueryOptions
) => getActiveDatabaseManager().delete(operation, options);

export { remove as delete };
export { createTenantDatabaseFacade } from './tenant.js';
export type { TenantDatabase, TenantDatabaseOptions } from './tenant.js';
export { createDatabaseMigrationRunner } from './migrations.js';
export type {
  DatabaseMigration,
  MigrationRecord,
  MigrationJournal,
  ExclusiveMigrationTransaction,
  MigrationRunnerOptions,
} from './migrations.js';
export {
  createDatabaseError,
  configureDatabaseManager,
  createDatabaseManager,
  getActiveDatabaseManager,
  setActiveDatabaseManager,
};
export type {
  AlterTableAction,
  BinaryExpression,
  ColumnDefinition,
  ColumnExpression,
  ComparisonOperator,
  CreateDbOperation,
  CreateIndexOperation,
  CreateTableOperation,
  DatabaseColumnType,
  DatabaseConnector,
  DatabaseConnectorFactory,
  DatabaseErrorShape,
  DatabaseExecutionContext,
  DatabaseFacade,
  DatabaseFunctionName,
  DatabaseManager,
  DatabaseManagerConfig,
  DatabaseOperationName,
  DatabaseResult,
  DeleteOperation,
  DropDbOperation,
  DropIndexOperation,
  DropTableOperation,
  ForeignKeyReference,
  FunctionExpression,
  InsertOperation,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  JoinDefinition,
  MaybePromise,
  OrderByClause,
  QueryExpression,
  QueryOperation,
  ResultReferenceToken,
  SelectColumn,
  SelectOperation,
  SwitchDbOperation,
  TableSchema,
  TruncateTableOperation,
  UpdateOperation,
  ValueExpression,
  WhereClause,
  WherePredicate,
} from './types.js';

export default db;

export type {
  CapabilitySupport,
  DatabaseCapabilities,
  DatabaseQueryOptions,
  DatabaseQueryMetric,
  DatabaseExecutionPolicy,
  DatabaseCountMetadata,
} from './types.js';
export { createKeysetPage } from './pagination.js';
export type {
  KeysetOrder,
  KeysetContinuation,
  KeysetPageOptions,
} from './pagination.js';

export { executionPolicy as validateDatabaseExecutionPolicy } from './execution.js';

export { createPinnedTransaction } from './manager.js';
export type {
  TransactionIsolation,
  TransactionOptions,
  TransactionDatabase,
  DatabaseTransaction,
  PinnedTransactionAdapter,
  PinnedTransactionSession,
  PinnedTransactionCapabilities,
} from './transactions.js';
export type { NormalizedConnectionConfig } from './types.js';

export { createPinnedMigrationTransaction } from './migration-coordination.js';
export type {
  MigrationLock,
  MigrationLockLease,
  MigrationCoordinationOptions,
} from './migration-coordination.js';
