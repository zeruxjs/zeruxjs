/**
 * Title: Shared database abstraction types
 * Description: Declares the JSON-first contract shared by the manager and all connector packages.
 * Global Variables: none
 */

export type MaybePromise<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type DatabaseOperationName =
  | 'query'
  | 'createDb'
  | 'dropDb'
  | 'switchDB'
  | 'createTable'
  | 'dropTable'
  | 'alterTable'
  | 'turcunateTable'
  | 'createIndex'
  | 'dropIndex'
  | 'insert'
  | 'select'
  | 'update'
  | 'delete';

export type DatabaseColumnType =
  | 'bigint'
  | 'binary'
  | 'blob'
  | 'boolean'
  | 'char'
  | 'date'
  | 'datetime'
  | 'decimal'
  | 'double'
  | 'float'
  | 'integer'
  | 'json'
  | 'number'
  | 'numeric'
  | 'smallint'
  | 'text'
  | 'time'
  | 'timestamp'
  | 'uuid'
  | 'varchar';

export type DatabaseFunctionName =
  | 'ABS'
  | 'AVG'
  | 'COALESCE'
  | 'CONCAT'
  | 'COUNT'
  | 'CURRENT_DATE'
  | 'CURRENT_TIMESTAMP'
  | 'DAY'
  | 'DATE_ADD'
  | 'DATE_DIFF'
  | 'LEN'
  | 'LOWER'
  | 'LTRIM'
  | 'MAX'
  | 'MIN'
  | 'MONTH'
  | 'NOW'
  | 'ROUND'
  | 'RTRIM'
  | 'SUBSTRING'
  | 'SUM'
  | 'TRIM'
  | 'UPPER'
  | 'YEAR';

export type BinaryOperator = 'add' | 'sub' | 'mul' | 'div' | 'mod' | 'concat';

export interface ColumnExpression {
  /** Expression/connector discriminator; native support remains adapter-owned. */
  kind: 'column';
  /** Validated referenced column identifier. */
  name: string;
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table?: string;
}

export interface ValueExpression {
  /** Expression/connector discriminator; native support remains adapter-owned. */
  kind: 'value';
  /** Inert JSON/expression value; never executable JavaScript. */
  value: JsonValue;
}

export interface FunctionExpression {
  /** Expression/connector discriminator; native support remains adapter-owned. */
  kind: 'function';
  /** Allowlisted structured function name; the selected dialect decides support. */
  name: DatabaseFunctionName;
  /** Structured function arguments, translated only by the selected connector. */
  args?: QueryExpression[];
}

export interface BinaryExpression {
  /** Expression/connector discriminator; native support remains adapter-owned. */
  kind: 'binary';
  /** Explicit structured operator; unsupported dialect semantics reject. */
  operator: BinaryOperator;
  /** Left structured operand. */
  left: QueryExpression;
  /** Right structured operand. */
  right: QueryExpression;
}

export type QueryExpression =
  | JsonPrimitive
  | ColumnExpression
  | ValueExpression
  | FunctionExpression
  | BinaryExpression;

export interface ResultReferenceToken {
  /** Explicit prior-result reference, resolved only for supported dependent batches. */
  $ref: {
    /** Structured operation identity; not raw SQL or a callback. */
    operation: number;
    /** Optional dotted own-property path; prototype traversal rejects. */
    path?: string;
  };
}

export interface ForeignKeyReference {
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Referenced column identifier. */
  column: string;
  /** Explicit foreign-key deletion action; connector support is required. */
  onDelete?: 'cascade' | 'restrict' | 'setNull' | 'setDefault' | 'noAction';
  /** Explicit foreign-key update action; connector support is required. */
  onUpdate?: 'cascade' | 'restrict' | 'setNull' | 'setDefault' | 'noAction';
}

export interface ColumnDefinition {
  /** Validated authored column identifier. */
  name: string;
  /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
  type: DatabaseColumnType;
  /** Request a primary-key constraint where the adapter supports it. */
  primary?: boolean;
  /** Request native uniqueness; type declaration alone does not create a lock. */
  unique?: boolean;
  /** Explicit referenced table/column and referential actions. */
  foreign?: ForeignKeyReference;
  /** Request native non-null constraint. */
  notNull?: boolean;
  /** Explicit content/schema default, not a generated request timestamp. */
  default?: QueryExpression | JsonValue;
  /** Compatibility CHECK candidate; raw strings/unsupported expressions can reject in the SQL compiler. */
  check?: string | QueryExpression | WhereClause;
  /** Request connector-owned identity generation semantics. */
  autoIncrement?: boolean;
  /** Optional type length, subject to dialect validation. */
  length?: number;
  /** Optional numeric precision, subject to dialect support. */
  precision?: number;
  /** Optional fractional scale, subject to dialect support. */
  scale?: number;
}

export interface TableSchema {
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Explicit selected/index/schema columns; owning operation determines its supported shape. */
  columns: ColumnDefinition[];
  /** Structured index definitions; native schema/index capabilities are separate. */
  indexes?: CreateIndexOperation[];
}

export type ComparisonOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'notIn'
  | 'between'
  | 'isNull'
  | 'isNotNull'
  | 'exists'
  | 'notExists'
  | 'any'
  | 'all';

export interface WherePredicate {
  /** Structured predicate operand; no arbitrary user SQL. */
  field?: string | ColumnExpression | FunctionExpression | BinaryExpression;
  /** Explicit structured operator; unsupported dialect semantics reject. */
  operator: ComparisonOperator;
  /** Inert JSON/expression value; never executable JavaScript. */
  value?: QueryExpression | JsonValue;
  /** Explicit JSON/expression values; batching does not imply a transaction. */
  values?: Array<QueryExpression | JsonValue>;
  /** Explicit lower bound or authored rename source. */
  from?: QueryExpression | JsonValue;
  /** Explicit upper bound or authored rename target. */
  to?: QueryExpression | JsonValue;
  /** Structured subquery; tenant projection rejects subqueries. */
  query?: SelectOperation;
}

export interface WhereAnd {
  /** All predicates must match; every member stays structured data. */
  and: WhereClause[];
}

export interface WhereOr {
  /** Any predicate can match; tenant isolation is combined outside caller disjunctions. */
  or: WhereClause[];
}

export interface WhereNot {
  /** Negated structured predicate. */
  not: WhereClause;
}

export type WhereClause = WherePredicate | WhereAnd | WhereOr | WhereNot;

export interface SelectColumn {
  /** Explicit selected expression; no executable callback. */
  expr: string | QueryExpression;
  /** Optional validated alias. */
  as?: string;
}

export interface JoinDefinition {
  /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
  type: 'inner' | 'left' | 'right' | 'full' | 'self';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Optional validated alias. */
  as?: string;
  /** Structured join predicate; restricted tenant facades reject joins. */
  on: WhereClause;
}

export interface OrderByClause {
  /** Explicit ordering column or supported expression. */
  by: string | QueryExpression;
  /** Optional ascending/descending native order. */
  direction?: 'asc' | 'desc';
  /** Explicit native null placement where supported. */
  nulls?: 'first' | 'last';
}

export interface BaseOperation {
  /** Explicit configured connection identity; tenant/pinned facades restrict cross-connection routing. */
  connection?: string;
  /** Prior batch-result indexes requiring sequential evaluation. */
  dependsOn?: number | number[];
  /** Compatibility prior-result mapping used only in the supported dependent-batch path. */
  use?: string | Record<string, string>;
}

export interface CreateDbOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'createDb';
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  name: string;
  /** Request native existence guard only where the selected dialect supports it. */
  ifNotExists?: boolean;
}

export interface DropDbOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'dropDb';
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  name: string;
  /** Request native existence guard only where supported. */
  ifExists?: boolean;
  /** Explicit destructive native option; host approval is separate. */
  force?: boolean;
}

export interface SwitchDbOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'switchDB';
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  name: string;
}

export interface CreateTableOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'createTable';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Request native existence guard only where the selected dialect supports it. */
  ifNotExists?: boolean;
  /** Explicit selected/index/schema columns; owning operation determines its supported shape. */
  columns: ColumnDefinition[];
  /** Structured index definitions; native schema/index capabilities are separate. */
  indexes?: CreateIndexOperation[];
}

export interface DropTableOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'dropTable';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Request native existence guard only where supported. */
  ifExists?: boolean;
  /** Explicit native cascading behavior; dialect support/authorization remain separate. */
  cascade?: boolean;
}

export interface TruncateTableOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'turcunateTable';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Explicit native identity-reset request; SQLite/other dialect behavior can differ. */
  restartIdentity?: boolean;
  /** Explicit native cascading behavior; dialect support/authorization remain separate. */
  cascade?: boolean;
}

export type AlterTableAction =
  | {
      /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
      type: 'addColumn';
      /** Referenced column identifier. */
      column: ColumnDefinition;
    }
  | {
      /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
      type: 'dropColumn';
      /** Explicit authored name; identifiers and dialect support are validated before execution. */
      name: string;
    }
  | {
      /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
      type: 'renameColumn';
      /** Explicit lower bound or authored rename source. */
      from: string;
      /** Explicit upper bound or authored rename target. */
      to: string;
    }
  | {
      /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
      type: 'renameTable';
      /** Explicit upper bound or authored rename target. */
      to: string;
    }
  | {
      /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
      type: 'modifyColumn';
      /** Referenced column identifier. */
      column: ColumnDefinition;
    }
  | ({
      /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
      type: 'addIndex';
    } & CreateIndexOperation)
  | ({
      /** Declared structured schema/relationship kind; runtime connector validation remains authoritative. */
      type: 'dropIndex';
    } & DropIndexOperation);

export interface AlterTableOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'alterTable';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Ordered structured table alterations, validated by the owning compiler. */
  actions: AlterTableAction[];
}

export interface CreateIndexOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'createIndex';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  name: string;
  /** Explicit selected/index/schema columns; owning operation determines its supported shape. */
  columns: Array<string | QueryExpression>;
  /** Request native uniqueness; type declaration alone does not create a lock. */
  unique?: boolean;
  /** Request native existence guard only where the selected dialect supports it. */
  ifNotExists?: boolean;
  /** Explicit native index method, validated by the selected dialect. */
  using?: string;
}

export interface DropIndexOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'dropIndex';
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  name: string;
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table?: string;
  /** Request native existence guard only where supported. */
  ifExists?: boolean;
}

export interface InsertOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'insert';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Qualified database selection; tenant facade rejects it. */
  into?: string;
  /** Explicit JSON/expression values; batching does not imply a transaction. */
  values:
    | Record<string, JsonValue | QueryExpression | ResultReferenceToken>
    | Array<Record<string, JsonValue | QueryExpression | ResultReferenceToken>>;
  /** Requested native returned fields; explicit unsupported capability rejects before execution. */
  returning?: string[];
}

export interface SelectOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'select';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Optional validated alias. */
  as?: string;
  /** Qualified database selection; tenant facade rejects it. */
  into?: string;
  /** Request native duplicate elimination. */
  distinct?: boolean;
  /** Explicit selected/index/schema columns; owning operation determines its supported shape. */
  columns?: Array<string | SelectColumn>;
  /** Explicit structured joins; tenant facade rejects them. */
  joins?: JoinDefinition[];
  /** Structured caller filter; a tenant facade appends its own mandatory tenant equality. */
  where?: WhereClause;
  /** Explicit aggregation grouping keys; result/cardinality budgets remain caller-owned. */
  groupBy?: Array<string | QueryExpression>;
  /** Structured post-group predicate. */
  having?: WhereClause;
  /** Explicit ordering; keyset paging additionally requires a stable unique tie-breaker. */
  orderBy?: Array<string | OrderByClause>;
  /** Explicit row cap; use bounded reads because manager input limits do not cap result bytes. */
  limit?: number;
  /** Optional native offset; the keyset helper rejects offset-based continuations. */
  offset?: number;
  /** Optional supported native TOP selection. */
  top?: number;
  /** Optional native fetch/count policy, subject to dialect support. */
  fetch?:
    | number
    | {
        /** Explicit nonnegative safe count; meaning is defined by the owning result/metric/native option. */
        count: number;
        /** Request native tie-preserving fetch where supported. */
        withTies?: boolean;
      };
  /** Explicit structured union branches; tenant facade rejects them. */
  union?: SelectOperation[];
  /** Explicit structured union-all branches; tenant facade rejects them. */
  unionAll?: SelectOperation[];
}

export interface UpdateOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'update';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Explicit JSON/expression values; batching does not imply a transaction. */
  values: Record<string, JsonValue | QueryExpression | ResultReferenceToken>;
  /** Structured caller filter; a tenant facade appends its own mandatory tenant equality. */
  where?: WhereClause;
  /** Requested native returned fields; explicit unsupported capability rejects before execution. */
  returning?: string[];
}

export interface DeleteOperation extends BaseOperation {
  /** Exact structured operation discriminator, including the compatible turcunateTable spelling. */
  op: 'delete';
  /** Explicit table identity; tenant facades require an allowlisted logical mapping. */
  table: string;
  /** Structured caller filter; a tenant facade appends its own mandatory tenant equality. */
  where?: WhereClause;
  /** Requested native returned fields; explicit unsupported capability rejects before execution. */
  returning?: string[];
}

export type QueryOperation =
  | CreateDbOperation
  | DropDbOperation
  | SwitchDbOperation
  | CreateTableOperation
  | DropTableOperation
  | AlterTableOperation
  | TruncateTableOperation
  | CreateIndexOperation
  | DropIndexOperation
  | InsertOperation
  | SelectOperation
  | UpdateOperation
  | DeleteOperation;

export interface DatabaseErrorShape {
  /** Stable classification; host-created values still require redaction. */
  code: string;
  /** Public-facing message candidate; native/private values must be redacted by the host. */
  message: string;
  /** Explicit configured connector package or outcome label; not request-derived module loading. */
  connector?: string;
  /** Explicit configured connection identity; tenant/pinned facades restrict cross-connection routing. */
  connection?: string;
  /** Structured operation identity; not raw SQL or a callback. */
  operation?: DatabaseOperationName;
  /** Private diagnostic detail object; never serialize indiscriminately. */
  details?: Record<string, unknown>;
  /** Private original failure; not default telemetry or a public response. */
  cause?: unknown;
}

export interface DatabaseResult<T = unknown> {
  /** Native/adapter success indicator validated before result exposure. */
  ok: boolean;
  /** Explicit configured connection identity; tenant/pinned facades restrict cross-connection routing. */
  connection: string;
  /** Explicit configured connector package or outcome label; not request-derived module loading. */
  connector: string;
  /** Structured operation identity; not raw SQL or a callback. */
  operation: DatabaseOperationName;
  /** Returned records; manager admission/input budgets do not cap their bytes. */
  rows?: T[];
  /** Native returned/command row count; never inferred as affected rows from rows.length. */
  rowCount?: number;
  /** Native affected count; zero is preserved and meanings differ by adapter. */
  affectedCount?: number;
  /** Native matched-row count only when supplied by the adapter. */
  matchedCount?: number;
  /** Native modified-row count only when supplied by the adapter. */
  changedCount?: number;
  /** Explicit precision/affected-meaning metadata; absence becomes unknown. */
  counts?: DatabaseCountMetadata;
  /** Native generated identities in supported adapter representation. */
  insertedIds?: Array<number | string>;
  /** Optional native scalar/application outcome; not automatically public. */
  value?: unknown;
  /** Privileged raw native outcome; can contain private values. */
  native?: unknown;
  /** Private generated native query text; never logged by the fixed metric hook. */
  query?: string;
  /** Private native parameter data; never metric labels or public diagnostics. */
  params?: unknown[];
  /** Private generated aggregation pipeline; not arbitrary client code. */
  pipeline?: unknown[];
  /** Adapter-provided warnings requiring host review before publication. */
  warnings?: string[];
  /** Structured private failure metadata; no automatic credential scrubbing. */
  error?: DatabaseErrorShape;
}

export interface DatabaseConnectionConfig {
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  name: string;
  /** Stable validated configured connection identity. */
  slug: string;
  /** Explicit configured connector package or outcome label; not request-derived module loading. */
  connector?: string;
  /** Legacy connector spelling retained for compatibility. */
  connecter?: string;
  /** Private trusted connector configuration or explicit execution controls; never publish raw credentials. */
  options?: Record<string, unknown>;
}

export interface DatabaseManagerConfig {
  /** Package-owned admission/batch/shutdown policy validated before connection startup. */
  execution?: DatabaseExecutionPolicy;
  /** Explicit configured default slug; required when more than one connection exists. */
  default?: string;
  /** Explicit named connector configurations, acquired sequentially with reverse rollback. */
  connections?: DatabaseConnectionConfig[];
  /** Legacy singular configuration key containing the connection array. */
  connection?: DatabaseConnectionConfig[];
}

export interface NormalizedConnectionConfig {
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  name: string;
  /** Stable validated configured connection identity. */
  slug: string;
  /** Explicit configured connector package or outcome label; not request-derived module loading. */
  connector: string;
  /** Private trusted connector configuration or explicit execution controls; never publish raw credentials. */
  options: Record<string, unknown>;
}

export interface DatabaseExecutionContext {
  /** Cooperative driver cancellation; absence of support never implies forced cancellation. */
  signal?: AbortSignal;
  /** Optional absolute epoch milliseconds; earliest timeout/deadline wins. */
  deadline?: number;
  /** Private normalized connection context for this exact execution. */
  connection: NormalizedConnectionConfig;
}

export interface DatabaseConnector {
  /** Optional actual pinned native extension; metadata alone is insufficient. */
  readonly transactionAdapter?: import('./transactions.js').PinnedTransactionAdapter;
  /** Structured API guarantees; omitted metadata remains unknown. */
  readonly capabilities?: Partial<DatabaseCapabilities>;
  /** Expression/connector discriminator; native support remains adapter-owned. */
  readonly kind: string;
  /** Private trusted connector configuration or explicit execution controls; never publish raw credentials. */
  readonly options: Record<string, unknown>;
  /** Initialize the connector native transport when explicitly requested.
   * @returns {MaybePromise<void>} Native readiness or failure; partial ownership stays connector-owned.
   */
  connect?(): MaybePromise<void>;
  /** Close only connector-owned resources and invalidate native access.
   * @returns {MaybePromise<void>} Native cleanup receipt.
   */
  disconnect?(): MaybePromise<void>;
  /** Execute validated structured operations on this explicit connector.
   * @param {QueryOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseExecutionContext} context - Explicit connection identity and cooperative native execution controls.
   * @returns {MaybePromise<DatabaseResult>} Native result; owner validates its dialect/precision/size contract.
   */
  execute(
    operation: QueryOperation,
    context: DatabaseExecutionContext
  ): MaybePromise<DatabaseResult>;
  /** Expose a privileged native connection outside structured query guarantees.
   * @returns {unknown} Trusted handle; borrowed ownership is connector-specific.
   */
  getNativeConnection?(): unknown;
}

export type DatabaseConnectorFactory = (
  options: Record<string, unknown>,
  connection: NormalizedConnectionConfig
) => MaybePromise<DatabaseConnector>;

export interface DatabaseFacade {
  /** Optional native pinned callback extension; legacy structural facades may omit it. */
  transaction?: import('./transactions.js').DatabaseTransaction;
  /** Report negotiated native pin guarantees without acquiring a session.
   * @returns {Readonly<import("./transactions.js").PinnedTransactionCapabilities>|undefined} Detached guarantees or absent extension.
   */
  transactionCapabilities?():
    | Readonly<import('./transactions.js').PinnedTransactionCapabilities>
    | undefined;
  /** Read normalized structured-connector guarantees.
   * @returns {Readonly<DatabaseCapabilities>} Known support or unknown; native engine features are separate.
   */
  capabilities?(): Readonly<DatabaseCapabilities>;
  /** Stable validated configured connection identity. */
  readonly slug: string;
  /** Explicit authored name; identifiers and dialect support are validated before execution. */
  readonly name: string;
  /** Explicit configured connector package or outcome label; not request-derived module loading. */
  readonly connector: string;
  /** Compatibility-redacted connection summary; custom secret fields remain host-reviewed. */
  readonly options: Record<string, unknown>;
  /** Dispatch bounded JSON operations; arrays remain nontransactional unless used inside an actual pin.
   * @param {QueryOperation | QueryOperation[]} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult|DatabaseResult[]>} Validated connector results; native causes/results stay private.
   */
  query(
    operation: QueryOperation | QueryOperation[],
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult | DatabaseResult[]>;
  /** Dispatch supported database creation through explicit connector policy.
   * @param {CreateDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  createDb(
    operation: Omit<CreateDbOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit database removal; host authorization is separate.
   * @param {DropDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  dropDb(
    operation: Omit<DropDbOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch supported database selection outside pinned callbacks.
   * @param {SwitchDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific outcome.
   */
  switchDB(
    operation: Omit<SwitchDbOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch validated structured schema creation.
   * @param {CreateTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  createTable(
    operation: Omit<CreateTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit table removal.
   * @param {DropTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  dropTable(
    operation: Omit<DropTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch only the selected connector supported alteration subset.
   * @param {AlterTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  alterTable(
    operation: Omit<AlterTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Preserve the legacy truncate spelling and native semantics.
   * @param {TruncateTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native outcome; no universal identity/reset guarantee.
   */
  turcunateTable(
    operation: Omit<TruncateTableOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch supported structured index creation.
   * @param {CreateIndexOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  createIndex(
    operation: Omit<CreateIndexOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit supported index removal.
   * @param {DropIndexOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  dropIndex(
    operation: Omit<DropIndexOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch bounded prepared insertion rows.
   * @param {InsertOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native counts/identities; a batch is not automatically atomic.
   */
  insert(
    operation: Omit<InsertOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch a structured read with caller/connector-owned result limits.
   * @param {SelectOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Returned rows; manager input budgets do not cap result bytes.
   */
  select(
    operation: Omit<SelectOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch structured updates with native affected/matched/changed semantics.
   * @param {UpdateOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native count metadata; unknown/approximate counts cannot prove CAS.
   */
  update(
    operation: Omit<UpdateOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit structured deletion without automatic retry.
   * @param {DeleteOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native counts; timeout does not prove rollback.
   */
  delete(
    operation: Omit<DeleteOperation, 'op' | 'connection'>,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Expose the trusted native escape hatch only outside pinned callback scope.
   * @returns {unknown} Handle bypassing structured facade guarantees.
   */
  native(): unknown;
}

export interface DatabaseManager {
  /** Optional native pinned callback extension; legacy structural facades may omit it. */
  transaction?: import('./transactions.js').DatabaseTransaction;
  /** Report negotiated native pin guarantees without acquiring a session.
   * @returns {Readonly<import("./transactions.js").PinnedTransactionCapabilities>|undefined} Detached guarantees or absent extension.
   */
  transactionCapabilities?():
    | Readonly<import('./transactions.js').PinnedTransactionCapabilities>
    | undefined;
  /** Read normalized structured-connector guarantees.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {Readonly<DatabaseCapabilities>} Known support or unknown; native engine features are separate.
   */
  capabilities?(slug?: string): Readonly<DatabaseCapabilities>;
  /** Validated default connection selected from the configured inventory. */
  readonly defaultConnectionSlug: string;
  /** Configured connection identities; the manager owns their acquired connectors. */
  readonly connectionSlugs: string[];
  /** Bind to one explicitly configured connection.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {DatabaseFacade} Generation-owned facade.
   */
  getConnectionFacade(slug?: string): DatabaseFacade;
  /** Read compatibility-redacted configured connection metadata.
   * @returns {NormalizedConnectionConfig[]} Private host view requiring custom-secret review.
   */
  listConnections(): NormalizedConnectionConfig[];
  /** Read a privileged configured connector.
   * @param {string} slug - Explicit configured connection slug, default the selected manager default.
   * @returns {DatabaseConnector} Native escape hatch; not an authorization boundary.
   */
  dbAccess(slug: string): DatabaseConnector;
  /** Close only connector-owned resources and invalidate native access.
   * @returns {MaybePromise<void>} Native cleanup receipt.
   */
  disconnect(): Promise<void>;
  /** Dispatch bounded JSON operations; arrays remain nontransactional unless used inside an actual pin.
   * @param {QueryOperation | QueryOperation[]} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult|DatabaseResult[]>} Validated connector results; native causes/results stay private.
   */
  query(
    operation: QueryOperation | QueryOperation[],
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult | DatabaseResult[]>;
  /** Dispatch supported database creation through explicit connector policy.
   * @param {CreateDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  createDb(
    operation: CreateDbOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit database removal; host authorization is separate.
   * @param {DropDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  dropDb(
    operation: DropDbOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch supported database selection outside pinned callbacks.
   * @param {SwitchDbOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific outcome.
   */
  switchDB(
    operation: SwitchDbOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch validated structured schema creation.
   * @param {CreateTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  createTable(
    operation: CreateTableOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit table removal.
   * @param {DropTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific supported schema outcome.
   */
  dropTable(
    operation: DropTableOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch only the selected connector supported alteration subset.
   * @param {AlterTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific schema outcome.
   */
  alterTable(
    operation: AlterTableOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Preserve the legacy truncate spelling and native semantics.
   * @param {TruncateTableOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native outcome; no universal identity/reset guarantee.
   */
  turcunateTable(
    operation: TruncateTableOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch supported structured index creation.
   * @param {CreateIndexOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  createIndex(
    operation: CreateIndexOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit supported index removal.
   * @param {DropIndexOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Connector-specific index outcome.
   */
  dropIndex(
    operation: DropIndexOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch bounded prepared insertion rows.
   * @param {InsertOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native counts/identities; a batch is not automatically atomic.
   */
  insert(
    operation: InsertOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch a structured read with caller/connector-owned result limits.
   * @param {SelectOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Returned rows; manager input budgets do not cap result bytes.
   */
  select(
    operation: SelectOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch structured updates with native affected/matched/changed semantics.
   * @param {UpdateOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native count metadata; unknown/approximate counts cannot prove CAS.
   */
  update(
    operation: UpdateOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
  /** Dispatch explicit structured deletion without automatic retry.
   * @param {DeleteOperation} operation - Structured JSON operation or bounded batch; dialect checks remain connector-owned.
   * @param {DatabaseQueryOptions} options - Separate execution controls or transaction policy, never JSON query content.
   * @returns {MaybePromise<DatabaseResult>} Native counts; timeout does not prove rollback.
   */
  delete(
    operation: DeleteOperation,
    options?: DatabaseQueryOptions
  ): MaybePromise<DatabaseResult>;
}

/** Capabilities of the structured connector API, not claims about its native engine. */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';
export interface DatabaseCapabilities {
  /** Requested native returned fields; explicit unsupported capability rejects before execution. */
  returning: CapabilitySupport;
  /** Shared asynchronous native pin guarantee; separate synchronous APIs do not imply support. */
  transactions: CapabilitySupport;
  /** Declared native cancellation guarantee; cooperative caller cancellation alone is insufficient. */
  cancellation: CapabilitySupport;
  /** Structured schema-operation capability, not universal dialect parity. */
  schema: CapabilitySupport;
  /** Structured index definitions; native schema/index capabilities are separate. */
  indexes: CapabilitySupport;
  /** Declared generated native aggregation capability, not arbitrary pipeline execution. */
  nativeAggregation: CapabilitySupport;
}
export interface DatabaseQueryOptions {
  /** Cooperative caller cancellation outside operation JSON; timeout does not prove rollback. */
  signal?: AbortSignal;
  /** Optional absolute epoch milliseconds; earliest timeout/deadline wins. */
  deadline?: number;
  /** Relative wait/deadline budget, integer 1–600000ms. */
  timeoutMs?: number;
  /** Explicit capabilities that must be supported; unknown rejects when required. */
  require?: Array<keyof DatabaseCapabilities>;
}
export interface DatabaseQueryMetric {
  /** Structured operation identity; not raw SQL or a callback. */
  operation: DatabaseOperationName;
  /** Conservative identifier-only table label; invalid identifiers are omitted. */
  table?: string;
  /** Monotonic elapsed query observation milliseconds. */
  durationMs: number;
  /** Explicit nonnegative safe count; meaning is defined by the owning result/metric/native option. */
  count?: number;
  /** Fixed success/failure/cancelled/deadline metric classification. */
  outcome: 'success' | 'failure' | 'cancelled' | 'deadline';
}
export interface DatabaseExecutionPolicy {
  /** Accepted operation/pin ceiling, default 64; integer 1–4096. */
  maxPending?: number;
  /** Operation-array and multi-insert row cap, default 128; integer 1–4096. */
  maxBatch?: number;
  /** Cooperative drain grace, default 5000ms; integer 1–60000. */
  shutdownGraceMs?: number;
  /** Optional bounded-shape fixed-label host observation; failures are isolated. */
  onMetric?: (metric: Readonly<DatabaseQueryMetric>) => void;
}
export interface DatabaseCountMetadata {
  /** Precision of the native affected count; unknown/approximate cannot prove CAS. */
  affected?: 'exact' | 'approximate' | 'unknown';
  /** Precision of the optional native matched count. */
  matched?: 'exact' | 'approximate' | 'unknown';
  /** Precision of the optional native changed count. */
  changed?: 'exact' | 'approximate' | 'unknown';
  /** Adapter-declared matched/changed/engine interpretation; never assumed portable. */
  affectedMeaning?: 'matched' | 'changed' | 'engine';
}
