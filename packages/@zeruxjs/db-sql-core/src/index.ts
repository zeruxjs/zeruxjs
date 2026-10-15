import type {
    AlterTableAction,
    ColumnDefinition,
    ComparisonOperator,
    CreateIndexOperation,
    CreateTableOperation,
    DatabaseConnector,
    DatabaseExecutionContext,
    DatabaseFunctionName,
    DatabaseResult,
    DeleteOperation,
    DropIndexOperation,
    InsertOperation,
    JoinDefinition,
    MaybePromise,
    OrderByClause,
    QueryExpression,
    QueryOperation,
    SelectColumn,
    SelectOperation,
    SwitchDbOperation,
    TruncateTableOperation,
    UpdateOperation,
    WhereClause,
    WherePredicate
} from "@zeruxjs/db";
import { createDatabaseError } from "@zeruxjs/db";

export interface SqlDialectDefinition {
    kind: string;
    quoteIdentifier(identifier: string): string;
    placeholder(index: number): string;
    functions: Partial<Record<DatabaseFunctionName, string>>;
    supportsReturning?: boolean;
    supportsIfNotExistsIndex?: boolean;
    supportsFetch?: boolean;
    ilikeOperator?: string;
    autoIncrementKeyword: string;
}

export interface SqlConnectorOptions extends Record<string, unknown> {
    executor?: (statement: string, params: unknown[], operation: QueryOperation) => MaybePromise<unknown>;
    client?: {
        query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
        execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
    };
    pool?: {
        query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
        execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>;
    };
    database?: string;
    fixedDatabase?: boolean;
    lockDatabase?: boolean;
    locked?: boolean;
}

interface SqlCompilation {
    statements: string[];
    params: unknown[][];
}

type StructuredQueryExpression = Exclude<QueryExpression, string | number | boolean | null>;

const isStructuredQueryExpression = (input: unknown): input is StructuredQueryExpression =>
    typeof input === "object" &&
    input !== null &&
    "kind" in input;

class SqlCompiler {
    readonly #dialect: SqlDialectDefinition;
    readonly #params: unknown[] = [];

    constructor(dialect: SqlDialectDefinition) {
        this.#dialect = dialect;
    }

    compile(operation: QueryOperation): SqlCompilation {
        switch (operation.op) {
            case "createDb":
                return {
                    statements: [`CREATE DATABASE${operation.ifNotExists ? " IF NOT EXISTS" : ""} ${this.#quote(operation.name)}`],
                    params: [[]]
                };
            case "dropDb":
                return {
                    statements: [`DROP DATABASE${operation.ifExists ? " IF EXISTS" : ""} ${this.#quote(operation.name)}`],
                    params: [[]]
                };
            case "switchDB":
                return {
                    statements: [`USE ${this.#quote(operation.name)}`],
                    params: [[]]
                };
            case "createTable":
                return this.#compileCreateTable(operation);
            case "dropTable":
                return {
                    statements: [`DROP TABLE${operation.ifExists ? " IF EXISTS" : ""} ${this.#quote(operation.table)}${operation.cascade ? " CASCADE" : ""}`],
                    params: [[]]
                };
            case "alterTable":
                return this.#compileAlterTable(operation.table, operation.actions);
            case "turcunateTable":
                return {
                    statements: [`TRUNCATE TABLE ${this.#quote(operation.table)}${operation.restartIdentity ? " RESTART IDENTITY" : ""}${operation.cascade ? " CASCADE" : ""}`],
                    params: [[]]
                };
            case "createIndex":
                return {
                    statements: [this.#buildCreateIndex(operation)],
                    params: [[]]
                };
            case "dropIndex":
                return {
                    statements: [this.#buildDropIndex(operation)],
                    params: [[]]
                };
            case "insert":
                return this.#compileInsert(operation);
            case "select":
                return this.#compileSelect(operation);
            case "update":
                return this.#compileUpdate(operation);
            case "delete":
                return this.#compileDelete(operation);
            default:
                throw createDatabaseError({
                    code: "UNSUPPORTED_OPERATION",
                    message: `Unsupported SQL operation "${(operation as QueryOperation).op}"`
                });
        }
    }

    #compileCreateTable(operation: CreateTableOperation): SqlCompilation {
        const columns = operation.columns.map((column) => this.#buildColumn(column));
        const statements = [
            `CREATE TABLE${operation.ifNotExists ? " IF NOT EXISTS" : ""} ${this.#quote(operation.table)} (${columns.join(", ")})`
        ];
        const params = [[] as unknown[]];

        for (const index of operation.indexes ?? []) {
            statements.push(this.#buildCreateIndex(index));
            params.push([]);
        }

        return { statements, params };
    }

    #compileAlterTable(table: string, actions: AlterTableAction[]): SqlCompilation {
        const statements = actions.map((action) => {
            switch (action.type) {
                case "addColumn":
                    return `ALTER TABLE ${this.#quote(table)} ADD COLUMN ${this.#buildColumn(action.column)}`;
                case "dropColumn":
                    return `ALTER TABLE ${this.#quote(table)} DROP COLUMN ${this.#quote(action.name)}`;
                case "renameColumn":
                    return `ALTER TABLE ${this.#quote(table)} RENAME COLUMN ${this.#quote(action.from)} TO ${this.#quote(action.to)}`;
                case "renameTable":
                    return `ALTER TABLE ${this.#quote(table)} RENAME TO ${this.#quote(action.to)}`;
                case "modifyColumn":
                    return `ALTER TABLE ${this.#quote(table)} MODIFY COLUMN ${this.#buildColumn(action.column)}`;
                case "addIndex":
                    return this.#buildCreateIndex(action);
                case "dropIndex":
                    return this.#buildDropIndex(action);
                default:
                    throw createDatabaseError({
                        code: "UNSUPPORTED_ALTER_ACTION",
                        message: `Unsupported alter table action "${(action as AlterTableAction).type}"`
                    });
            }
        });

        return {
            statements,
            params: statements.map(() => [])
        };
    }

    #compileInsert(operation: InsertOperation): SqlCompilation {
        const rows = Array.isArray(operation.values) ? operation.values : [operation.values];
        if (rows.length === 0) {
            throw createDatabaseError({
                code: "EMPTY_INSERT",
                message: "Insert operation must contain at least one row"
            });
        }

        const columns = Object.keys(rows[0]);
        const values = rows.map((row) =>
            `(${columns.map((column) => this.#compileValue(row[column] as QueryExpression | unknown)).join(", ")})`
        );

        const returning = operation.returning && operation.returning.length > 0 && this.#dialect.supportsReturning
            ? ` RETURNING ${operation.returning.map((column) => this.#quote(column)).join(", ")}`
            : "";

        return {
            statements: [
                `INSERT INTO ${this.#qualifiedTable(operation.into, operation.table)} (${columns.map((column) => this.#quote(column)).join(", ")}) VALUES ${values.join(", ")}${returning}`
            ],
            params: [this.#drainParams()]
        };
    }

    #compileSelect(operation: SelectOperation): SqlCompilation {
        const statement = this.#buildSelect(operation);
        return {
            statements: [statement],
            params: [this.#drainParams()]
        };
    }

    #compileUpdate(operation: UpdateOperation): SqlCompilation {
        const assignments = Object.entries(operation.values).map(
            ([column, value]) => `${this.#quote(column)} = ${this.#compileValue(value)}`
        );
        const where = operation.where ? ` WHERE ${this.#compileWhere(operation.where)}` : "";
        const returning = operation.returning && operation.returning.length > 0 && this.#dialect.supportsReturning
            ? ` RETURNING ${operation.returning.map((column) => this.#quote(column)).join(", ")}`
            : "";

        return {
            statements: [`UPDATE ${this.#quote(operation.table)} SET ${assignments.join(", ")}${where}${returning}`],
            params: [this.#drainParams()]
        };
    }

    #compileDelete(operation: DeleteOperation): SqlCompilation {
        const where = operation.where ? ` WHERE ${this.#compileWhere(operation.where)}` : "";
        const returning = operation.returning && operation.returning.length > 0 && this.#dialect.supportsReturning
            ? ` RETURNING ${operation.returning.map((column) => this.#quote(column)).join(", ")}`
            : "";

        return {
            statements: [`DELETE FROM ${this.#quote(operation.table)}${where}${returning}`],
            params: [this.#drainParams()]
        };
    }

    #buildSelect(operation: SelectOperation): string {
        const columns = operation.columns && operation.columns.length > 0
            ? operation.columns.map((column) => this.#buildSelectColumn(column)).join(", ")
            : "*";
        const table = `${this.#qualifiedTable(operation.into, operation.table)}${operation.as ? ` AS ${this.#quote(operation.as)}` : ""}`;
        const joins = (operation.joins ?? []).map((join) => this.#buildJoin(join)).join(" ");
        const where = operation.where ? ` WHERE ${this.#compileWhere(operation.where)}` : "";
        const groupBy = operation.groupBy && operation.groupBy.length > 0
            ? ` GROUP BY ${operation.groupBy.map((entry) => this.#compileSelectable(entry)).join(", ")}`
            : "";
        const having = operation.having ? ` HAVING ${this.#compileWhere(operation.having)}` : "";
        const orderBy = operation.orderBy && operation.orderBy.length > 0
            ? ` ORDER BY ${operation.orderBy.map((entry) => this.#buildOrderBy(entry)).join(", ")}`
            : "";
        const limit = this.#buildLimit(operation);

        const base = `SELECT${operation.distinct ? " DISTINCT" : ""} ${columns} FROM ${table}${joins}${where}${groupBy}${having}${orderBy}${limit}`;
        const unions = [
            ...(operation.union ?? []).map((entry) => ` UNION ${this.#buildSelect(entry)}`),
            ...(operation.unionAll ?? []).map((entry) => ` UNION ALL ${this.#buildSelect(entry)}`)
        ];

        return `${base}${unions.join("")}`;
    }

    #buildSelectColumn(column: string | SelectColumn): string {
        if (typeof column === "string") {
            return this.#compileSelectable(column);
        }

        const value = this.#compileSelectable(column.expr);
        return column.as ? `${value} AS ${this.#quote(column.as)}` : value;
    }

    #buildJoin(join: JoinDefinition): string {
        const joinKeyword = join.type === "self"
            ? "INNER JOIN"
            : `${join.type.toUpperCase()} JOIN`;
        return ` ${joinKeyword} ${this.#quote(join.table)}${join.as ? ` AS ${this.#quote(join.as)}` : ""} ON ${this.#compileWhere(join.on)}`;
    }

    #buildOrderBy(entry: string | OrderByClause): string {
        if (typeof entry === "string") {
            return `${this.#compileSelectable(entry)} ASC`;
        }

        const direction = entry.direction?.toUpperCase() ?? "ASC";
        const nulls = entry.nulls ? ` NULLS ${entry.nulls.toUpperCase()}` : "";
        return `${this.#compileSelectable(entry.by)} ${direction}${nulls}`;
    }

    #buildLimit(operation: SelectOperation): string {
        const effectiveLimit = operation.limit ?? operation.top ?? (
            typeof operation.fetch === "number"
                ? operation.fetch
                : operation.fetch?.count
        );

        const offset = operation.offset ?? 0;
        if (effectiveLimit === undefined) {
            return offset > 0 ? ` OFFSET ${offset}` : "";
        }

        if (this.#dialect.supportsFetch && operation.fetch) {
            const ties = typeof operation.fetch === "object" && operation.fetch.withTies ? " WITH TIES" : "";
            return ` OFFSET ${offset} ROWS FETCH NEXT ${effectiveLimit} ROWS ONLY${ties}`;
        }

        return ` LIMIT ${effectiveLimit}${offset > 0 ? ` OFFSET ${offset}` : ""}`;
    }

    #buildCreateIndex(operation: CreateIndexOperation): string {
        const ifNotExists = operation.ifNotExists && this.#dialect.supportsIfNotExistsIndex ? " IF NOT EXISTS" : "";
        const unique = operation.unique ? "UNIQUE " : "";
        const using = operation.using ? ` USING ${operation.using}` : "";
        const columns = operation.columns.map((column) => this.#compileSelectable(column)).join(", ");
        return `CREATE ${unique}INDEX${ifNotExists} ${this.#quote(operation.name)} ON ${this.#quote(operation.table)}${using} (${columns})`;
    }

    #buildDropIndex(operation: DropIndexOperation): string {
        const ifExists = operation.ifExists ? " IF EXISTS" : "";
        if (operation.table) {
            return `DROP INDEX${ifExists} ${this.#quote(operation.name)} ON ${this.#quote(operation.table)}`;
        }

        return `DROP INDEX${ifExists} ${this.#quote(operation.name)}`;
    }

    #buildColumn(column: ColumnDefinition): string {
        const type = this.#buildColumnType(column);
        const parts = [`${this.#quote(column.name)} ${type}`];

        if (column.autoIncrement) {
            parts.push(this.#dialect.autoIncrementKeyword);
        }

        if (column.primary) {
            parts.push("PRIMARY KEY");
        }

        if (column.unique) {
            parts.push("UNIQUE");
        }

        if (column.notNull) {
            parts.push("NOT NULL");
        }

        if (column.default !== undefined) {
            parts.push(`DEFAULT ${this.#compileDefaultValue(column.default)}`);
        }

        if (column.check !== undefined) {
            if (typeof column.check === "string") {
                parts.push(`CHECK (${column.check})`);
            } else {
                parts.push(`CHECK (${this.#compileSelectable(column.check)})`);
            }
        }

        if (column.foreign) {
            parts.push(
                `REFERENCES ${this.#quote(column.foreign.table)} (${this.#quote(column.foreign.column)})`
            );

            if (column.foreign.onDelete) {
                parts.push(`ON DELETE ${this.#formatReferenceAction(column.foreign.onDelete)}`);
            }

            if (column.foreign.onUpdate) {
                parts.push(`ON UPDATE ${this.#formatReferenceAction(column.foreign.onUpdate)}`);
            }
        }

        return parts.join(" ");
    }

    #buildColumnType(column: ColumnDefinition): string {
        switch (column.type) {
            case "varchar":
            case "char":
                return `${column.type.toUpperCase()}(${column.length ?? 255})`;
            case "decimal":
            case "numeric":
                return `${column.type.toUpperCase()}(${column.precision ?? 10}, ${column.scale ?? 0})`;
            case "integer":
            case "number":
                return "INTEGER";
            case "boolean":
                return "BOOLEAN";
            case "datetime":
                return "DATETIME";
            default:
                return column.type.toUpperCase();
        }
    }

    #formatReferenceAction(action: string): string {
        switch (action) {
            case "setNull":
                return "SET NULL";
            case "setDefault":
                return "SET DEFAULT";
            case "noAction":
                return "NO ACTION";
            default:
                return action.toUpperCase();
        }
    }

    #compileWhere(where: WhereClause): string {
        if ("and" in where) {
            return `(${where.and.map((entry) => this.#compileWhere(entry)).join(" AND ")})`;
        }

        if ("or" in where) {
            return `(${where.or.map((entry) => this.#compileWhere(entry)).join(" OR ")})`;
        }

        if ("not" in where) {
            return `(NOT ${this.#compileWhere(where.not)})`;
        }

        return this.#compilePredicate(where);
    }

    #compilePredicate(predicate: WherePredicate): string {
        if (predicate.operator === "exists" || predicate.operator === "notExists") {
            if (!predicate.query) {
                throw createDatabaseError({
                    code: "INVALID_WHERE",
                    message: `${predicate.operator} predicates require a query`
                });
            }

            const keyword = predicate.operator === "exists" ? "EXISTS" : "NOT EXISTS";
            return `${keyword} (${this.#buildSelect(predicate.query)})`;
        }

        const field = predicate.field ? this.#compileSelectable(predicate.field) : "";
        const operator = this.#mapOperator(predicate.operator);

        switch (predicate.operator) {
            case "between":
                return `${field} BETWEEN ${this.#compileValue(predicate.from)} AND ${this.#compileValue(predicate.to)}`;
            case "in":
            case "notIn":
                return `${field} ${operator} (${(predicate.values ?? []).map((entry) => this.#compileValue(entry)).join(", ")})`;
            case "isNull":
            case "isNotNull":
                return `${field} ${operator}`;
            case "any":
            case "all":
                if (!predicate.query) {
                    throw createDatabaseError({
                        code: "INVALID_WHERE",
                        message: `${predicate.operator} predicates require a query`
                    });
                }
                return `${field} = ${predicate.operator.toUpperCase()} (${this.#buildSelect(predicate.query)})`;
            default:
                return `${field} ${operator} ${this.#compileValue(predicate.value)}`;
        }
    }

    #mapOperator(operator: ComparisonOperator): string {
        switch (operator) {
            case "eq":
                return "=";
            case "ne":
                return "<>";
            case "gt":
                return ">";
            case "gte":
                return ">=";
            case "lt":
                return "<";
            case "lte":
                return "<=";
            case "like":
                return "LIKE";
            case "ilike":
                return this.#dialect.ilikeOperator ?? "ILIKE";
            case "in":
                return "IN";
            case "notIn":
                return "NOT IN";
            case "isNull":
                return "IS NULL";
            case "isNotNull":
                return "IS NOT NULL";
            default:
                return operator.toUpperCase();
        }
    }

    #compileSelectable(input: string | QueryExpression): string {
        if (typeof input === "string") {
            return this.#quote(input);
        }

        if (typeof input === "number" || typeof input === "boolean" || input === null) {
            return this.#compileValue(input);
        }

        switch (input.kind) {
            case "column":
                return input.table
                    ? `${this.#quote(input.table)}.${this.#quote(input.name)}`
                    : this.#quote(input.name);
            case "value":
                return this.#compileValue(input.value);
            case "function": {
                const functionName = this.#dialect.functions[input.name] ?? input.name;
                const args = (input.args ?? []).map((entry) => this.#compileSelectable(entry)).join(", ");
                return `${functionName}(${args})`;
            }
            case "binary":
                return `(${this.#compileSelectable(input.left)} ${this.#mapBinaryOperator(input.operator)} ${this.#compileSelectable(input.right)})`;
            default:
                throw createDatabaseError({
                    code: "INVALID_EXPRESSION",
                    message: `Unsupported query expression "${(input as QueryExpression & { kind?: string; }).kind}"`
                });
        }
    }

    #compileValue(input: unknown): string {
        if (isStructuredQueryExpression(input)) {
            return this.#compileSelectable(input as QueryExpression);
        }

        this.#params.push(input);
        return this.#dialect.placeholder(this.#params.length);
    }

    #compileDefaultValue(input: unknown): string {
        if (isStructuredQueryExpression(input)) {
            const expression = input;

            switch (expression.kind) {
                case "value":
                    return this.#compileDefaultValue(expression.value);
                case "function": {
                    const functionName = this.#dialect.functions[expression.name] ?? expression.name;
                    const argsList = expression.args ?? [];

                    if (
                        argsList.length === 0 &&
                        (functionName === "CURRENT_TIMESTAMP" || functionName === "CURRENT_DATE")
                    ) {
                        return functionName;
                    }

                    const args = argsList.map((entry) => this.#compileDefaultValue(entry)).join(", ");
                    return `${functionName}(${args})`;
                }
                case "column":
                    return expression.table
                        ? `${this.#quote(expression.table)}.${this.#quote(expression.name)}`
                        : this.#quote(expression.name);
                case "binary":
                    return `(${this.#compileDefaultValue(expression.left)} ${this.#mapBinaryOperator(expression.operator)} ${this.#compileDefaultValue(expression.right)})`;
                default:
                    throw createDatabaseError({
                        code: "INVALID_DEFAULT",
                        message: `Unsupported default expression "${(expression as QueryExpression & { kind?: string; }).kind}"`
                    });
            }
        }

        if (typeof input === "string") {
            return `'${input.replace(/'/g, "''")}'`;
        }

        if (typeof input === "number") {
            if (!Number.isFinite(input)) {
                throw createDatabaseError({
                    code: "INVALID_DEFAULT",
                    message: "Numeric default values must be finite"
                });
            }

            return String(input);
        }

        if (typeof input === "bigint") {
            return input.toString();
        }

        if (typeof input === "boolean") {
            return input ? "TRUE" : "FALSE";
        }

        if (input === null) {
            return "NULL";
        }

        throw createDatabaseError({
            code: "INVALID_DEFAULT",
            message: `Unsupported default value type "${typeof input}"`
        });
    }

    #mapBinaryOperator(operator: string): string {
        switch (operator) {
            case "add":
                return "+";
            case "sub":
                return "-";
            case "mul":
                return "*";
            case "div":
                return "/";
            case "mod":
                return "%";
            case "concat":
                return "||";
            default:
                throw createDatabaseError({
                    code: "INVALID_OPERATOR",
                    message: `Unsupported binary operator "${operator}"`
                });
        }
    }

    #qualifiedTable(databaseName: string | undefined, table: string): string {
        return databaseName ? `${this.#quote(databaseName)}.${this.#quote(table)}` : this.#quote(table);
    }

    #quote(identifier: string): string {
        return identifier.split(".").map((segment) => this.#dialect.quoteIdentifier(segment)).join(".");
    }

    #drainParams(): unknown[] {
        const params = [...this.#params];
        this.#params.length = 0;
        return params;
    }
}

const normalizeResult = (
    operation: QueryOperation,
    context: DatabaseExecutionContext,
    statement: string,
    params: unknown[],
    native: unknown
): DatabaseResult => {
    const result = (native ?? {}) as
        | { rows?: unknown[]; rowCount?: number; affectedRows?: number; insertId?: number | string; changes?: number; lastInsertRowid?: number | bigint; }
        | unknown[];

    if (Array.isArray(result)) {
        return {
            ok: true,
            connection: context.connection.slug,
            connector: context.connection.connector,
            operation: operation.op,
            rows: result,
            rowCount: result.length,
            native,
            query: statement,
            params
        };
    }

    return {
        ok: true,
        connection: context.connection.slug,
        connector: context.connection.connector,
        operation: operation.op,
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows?.length,
        affectedCount: result.affectedRows ?? result.changes,
        insertedIds: operation.op === "insert"
            ? (result.insertId !== undefined
                ? [result.insertId]
                : result.lastInsertRowid !== undefined
                    ? [typeof result.lastInsertRowid === "bigint" ? result.lastInsertRowid.toString() : result.lastInsertRowid]
                    : undefined)
            : undefined,
        native,
        query: statement,
        params
    };
};

const runSql = (
    options: SqlConnectorOptions,
    statement: string,
    params: unknown[],
    operation: QueryOperation
): MaybePromise<unknown> => {
    if (typeof options.executor === "function") {
        return options.executor(statement, params, operation);
    }

    const client = options.client ?? options.pool;
    if (client?.execute) {
        return client.execute(statement, params);
    }

    if (client?.query) {
        return client.query(statement, params);
    }

    throw createDatabaseError({
        code: "MISSING_EXECUTOR",
        message: "SQL connector requires options.executor, options.client, or options.pool"
    });
};

/**
 * Title: SQL connector factory
 * Description: Creates a reusable SQL connector that translates normalized JSON into parameterized SQL.
 * Global Variables: none
 * @param dialect Dialect definition.
 * @param options Connector options.
 * @returns SQL connector instance.
 */
export const createSqlConnector = (
    dialect: SqlDialectDefinition,
    options: SqlConnectorOptions
): DatabaseConnector => ({
    kind: dialect.kind,
    options,
    execute(operation, context) {
        if ((operation.op === "createDb" || operation.op === "dropDb") && (options.locked || options.lockDatabase)) {
            throw createDatabaseError({
                code: "DATABASE_LOCKED",
                message: `Operation "${operation.op}" is locked for connection "${context.connection.slug}"`
            });
        }

        if (operation.op === "switchDB" && (options.fixedDatabase || options.database)) {
            throw createDatabaseError({
                code: "DATABASE_FIXED",
                message: `Connection "${context.connection.slug}" uses a fixed database and cannot be switched`
            });
        }

        const compilation = new SqlCompiler(dialect).compile(operation);
        if (compilation.statements.length === 1) {
            const statement = compilation.statements[0];
            const params = compilation.params[0] ?? [];
            const native = runSql(options, statement, params, operation);

            if (native && typeof native === "object" && "then" in native) {
                return (native as Promise<unknown>).then((value) =>
                    normalizeResult(operation, context, statement, params, value)
                );
            }

            return normalizeResult(operation, context, statement, params, native);
        }

        return (async () => {
            const results: DatabaseResult[] = [];

            for (const [index, statement] of compilation.statements.entries()) {
                const params = compilation.params[index] ?? [];
                const native = await runSql(options, statement, params, operation);
                results.push(normalizeResult(operation, context, statement, params, native));
            }

            return {
                ...results[results.length - 1],
                native: results.map((entry) => entry.native),
                warnings: [`Executed ${results.length} SQL statements`]
            };
        })();
    }
});
