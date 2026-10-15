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
    | "query"
    | "createDb"
    | "dropDb"
    | "switchDB"
    | "createTable"
    | "dropTable"
    | "alterTable"
    | "turcunateTable"
    | "createIndex"
    | "dropIndex"
    | "insert"
    | "select"
    | "update"
    | "delete";

export type DatabaseColumnType =
    | "bigint"
    | "binary"
    | "blob"
    | "boolean"
    | "char"
    | "date"
    | "datetime"
    | "decimal"
    | "double"
    | "float"
    | "integer"
    | "json"
    | "number"
    | "numeric"
    | "smallint"
    | "text"
    | "time"
    | "timestamp"
    | "uuid"
    | "varchar";

export type DatabaseFunctionName =
    | "ABS"
    | "AVG"
    | "COALESCE"
    | "CONCAT"
    | "COUNT"
    | "CURRENT_DATE"
    | "CURRENT_TIMESTAMP"
    | "DAY"
    | "DATE_ADD"
    | "DATE_DIFF"
    | "LEN"
    | "LOWER"
    | "LTRIM"
    | "MAX"
    | "MIN"
    | "MONTH"
    | "NOW"
    | "ROUND"
    | "RTRIM"
    | "SUBSTRING"
    | "SUM"
    | "TRIM"
    | "UPPER"
    | "YEAR";

export type BinaryOperator = "add" | "sub" | "mul" | "div" | "mod" | "concat";

export interface ColumnExpression {
    kind: "column";
    name: string;
    table?: string;
}

export interface ValueExpression {
    kind: "value";
    value: JsonValue;
}

export interface FunctionExpression {
    kind: "function";
    name: DatabaseFunctionName;
    args?: QueryExpression[];
}

export interface BinaryExpression {
    kind: "binary";
    operator: BinaryOperator;
    left: QueryExpression;
    right: QueryExpression;
}

export type QueryExpression =
    | JsonPrimitive
    | ColumnExpression
    | ValueExpression
    | FunctionExpression
    | BinaryExpression;

export interface ResultReferenceToken {
    $ref: {
        operation: number;
        path?: string;
    };
}

export interface ForeignKeyReference {
    table: string;
    column: string;
    onDelete?: "cascade" | "restrict" | "setNull" | "setDefault" | "noAction";
    onUpdate?: "cascade" | "restrict" | "setNull" | "setDefault" | "noAction";
}

export interface ColumnDefinition {
    name: string;
    type: DatabaseColumnType;
    primary?: boolean;
    unique?: boolean;
    foreign?: ForeignKeyReference;
    notNull?: boolean;
    default?: QueryExpression | JsonValue;
    check?: string | QueryExpression;
    autoIncrement?: boolean;
    length?: number;
    precision?: number;
    scale?: number;
}

export interface TableSchema {
    table: string;
    columns: ColumnDefinition[];
    indexes?: CreateIndexOperation[];
}

export type ComparisonOperator =
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "like"
    | "ilike"
    | "in"
    | "notIn"
    | "between"
    | "isNull"
    | "isNotNull"
    | "exists"
    | "notExists"
    | "any"
    | "all";

export interface WherePredicate {
    field?: string | ColumnExpression | FunctionExpression | BinaryExpression;
    operator: ComparisonOperator;
    value?: QueryExpression | JsonValue;
    values?: Array<QueryExpression | JsonValue>;
    from?: QueryExpression | JsonValue;
    to?: QueryExpression | JsonValue;
    query?: SelectOperation;
}

export interface WhereAnd {
    and: WhereClause[];
}

export interface WhereOr {
    or: WhereClause[];
}

export interface WhereNot {
    not: WhereClause;
}

export type WhereClause = WherePredicate | WhereAnd | WhereOr | WhereNot;

export interface SelectColumn {
    expr: string | QueryExpression;
    as?: string;
}

export interface JoinDefinition {
    type: "inner" | "left" | "right" | "full" | "self";
    table: string;
    as?: string;
    on: WhereClause;
}

export interface OrderByClause {
    by: string | QueryExpression;
    direction?: "asc" | "desc";
    nulls?: "first" | "last";
}

export interface BaseOperation {
    connection?: string;
    dependsOn?: number | number[];
    use?: string | Record<string, string>;
}

export interface CreateDbOperation extends BaseOperation {
    op: "createDb";
    name: string;
    ifNotExists?: boolean;
}

export interface DropDbOperation extends BaseOperation {
    op: "dropDb";
    name: string;
    ifExists?: boolean;
    force?: boolean;
}

export interface SwitchDbOperation extends BaseOperation {
    op: "switchDB";
    name: string;
}

export interface CreateTableOperation extends BaseOperation {
    op: "createTable";
    table: string;
    ifNotExists?: boolean;
    columns: ColumnDefinition[];
    indexes?: CreateIndexOperation[];
}

export interface DropTableOperation extends BaseOperation {
    op: "dropTable";
    table: string;
    ifExists?: boolean;
    cascade?: boolean;
}

export interface TruncateTableOperation extends BaseOperation {
    op: "turcunateTable";
    table: string;
    restartIdentity?: boolean;
    cascade?: boolean;
}

export type AlterTableAction =
    | {
        type: "addColumn";
        column: ColumnDefinition;
    }
    | {
        type: "dropColumn";
        name: string;
    }
    | {
        type: "renameColumn";
        from: string;
        to: string;
    }
    | {
        type: "renameTable";
        to: string;
    }
    | {
        type: "modifyColumn";
        column: ColumnDefinition;
    }
    | ({
        type: "addIndex";
    } & CreateIndexOperation)
    | ({
        type: "dropIndex";
    } & DropIndexOperation);

export interface AlterTableOperation extends BaseOperation {
    op: "alterTable";
    table: string;
    actions: AlterTableAction[];
}

export interface CreateIndexOperation extends BaseOperation {
    op: "createIndex";
    table: string;
    name: string;
    columns: Array<string | QueryExpression>;
    unique?: boolean;
    ifNotExists?: boolean;
    using?: string;
}

export interface DropIndexOperation extends BaseOperation {
    op: "dropIndex";
    name: string;
    table?: string;
    ifExists?: boolean;
}

export interface InsertOperation extends BaseOperation {
    op: "insert";
    table: string;
    into?: string;
    values: Record<string, JsonValue | QueryExpression | ResultReferenceToken> |
    Array<Record<string, JsonValue | QueryExpression | ResultReferenceToken>>;
    returning?: string[];
}

export interface SelectOperation extends BaseOperation {
    op: "select";
    table: string;
    as?: string;
    into?: string;
    distinct?: boolean;
    columns?: Array<string | SelectColumn>;
    joins?: JoinDefinition[];
    where?: WhereClause;
    groupBy?: Array<string | QueryExpression>;
    having?: WhereClause;
    orderBy?: Array<string | OrderByClause>;
    limit?: number;
    offset?: number;
    top?: number;
    fetch?: number | {
        count: number;
        withTies?: boolean;
    };
    union?: SelectOperation[];
    unionAll?: SelectOperation[];
}

export interface UpdateOperation extends BaseOperation {
    op: "update";
    table: string;
    values: Record<string, JsonValue | QueryExpression | ResultReferenceToken>;
    where?: WhereClause;
    returning?: string[];
}

export interface DeleteOperation extends BaseOperation {
    op: "delete";
    table: string;
    where?: WhereClause;
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
    code: string;
    message: string;
    connector?: string;
    connection?: string;
    operation?: DatabaseOperationName;
    details?: Record<string, unknown>;
    cause?: unknown;
}

export interface DatabaseResult<T = unknown> {
    ok: boolean;
    connection: string;
    connector: string;
    operation: DatabaseOperationName;
    rows?: T[];
    rowCount?: number;
    affectedCount?: number;
    insertedIds?: Array<number | string>;
    value?: unknown;
    native?: unknown;
    query?: string;
    params?: unknown[];
    pipeline?: unknown[];
    warnings?: string[];
    error?: DatabaseErrorShape;
}

export interface DatabaseConnectionConfig {
    name: string;
    slug: string;
    connector?: string;
    connecter?: string;
    options?: Record<string, unknown>;
}

export interface DatabaseManagerConfig {
    default?: string;
    connections?: DatabaseConnectionConfig[];
    connection?: DatabaseConnectionConfig[];
}

export interface NormalizedConnectionConfig {
    name: string;
    slug: string;
    connector: string;
    options: Record<string, unknown>;
}

export interface DatabaseExecutionContext {
    connection: NormalizedConnectionConfig;
}

export interface DatabaseConnector {
    readonly kind: string;
    readonly options: Record<string, unknown>;
    connect?(): MaybePromise<void>;
    disconnect?(): MaybePromise<void>;
    execute(
        operation: QueryOperation,
        context: DatabaseExecutionContext
    ): MaybePromise<DatabaseResult>;
    getNativeConnection?(): unknown;
}

export type DatabaseConnectorFactory = (
    options: Record<string, unknown>,
    connection: NormalizedConnectionConfig
) => MaybePromise<DatabaseConnector>;

export interface DatabaseFacade {
    readonly slug: string;
    readonly name: string;
    readonly connector: string;
    readonly options: Record<string, unknown>;
    query(operation: QueryOperation | QueryOperation[]): MaybePromise<DatabaseResult | DatabaseResult[]>;
    createDb(operation: Omit<CreateDbOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    dropDb(operation: Omit<DropDbOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    switchDB(operation: Omit<SwitchDbOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    createTable(operation: Omit<CreateTableOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    dropTable(operation: Omit<DropTableOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    alterTable(operation: Omit<AlterTableOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    turcunateTable(operation: Omit<TruncateTableOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    createIndex(operation: Omit<CreateIndexOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    dropIndex(operation: Omit<DropIndexOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    insert(operation: Omit<InsertOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    select(operation: Omit<SelectOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    update(operation: Omit<UpdateOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    delete(operation: Omit<DeleteOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    native(): unknown;
}

export interface DatabaseManager {
    readonly defaultConnectionSlug: string;
    readonly connectionSlugs: string[];
    getConnectionFacade(slug?: string): DatabaseFacade;
    listConnections(): NormalizedConnectionConfig[];
    dbAccess(slug: string): DatabaseConnector;
    disconnect(): Promise<void>;
    query(operation: QueryOperation | QueryOperation[]): MaybePromise<DatabaseResult | DatabaseResult[]>;
    createDb(operation: CreateDbOperation): MaybePromise<DatabaseResult>;
    dropDb(operation: DropDbOperation): MaybePromise<DatabaseResult>;
    switchDB(operation: SwitchDbOperation): MaybePromise<DatabaseResult>;
    createTable(operation: CreateTableOperation): MaybePromise<DatabaseResult>;
    dropTable(operation: DropTableOperation): MaybePromise<DatabaseResult>;
    alterTable(operation: AlterTableOperation): MaybePromise<DatabaseResult>;
    turcunateTable(operation: TruncateTableOperation): MaybePromise<DatabaseResult>;
    createIndex(operation: CreateIndexOperation): MaybePromise<DatabaseResult>;
    dropIndex(operation: DropIndexOperation): MaybePromise<DatabaseResult>;
    insert(operation: InsertOperation): MaybePromise<DatabaseResult>;
    select(operation: SelectOperation): MaybePromise<DatabaseResult>;
    update(operation: UpdateOperation): MaybePromise<DatabaseResult>;
    delete(operation: DeleteOperation): MaybePromise<DatabaseResult>;
}
