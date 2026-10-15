import type { DatabaseFacade, DatabaseResult, DeleteOperation, InsertOperation, JsonPrimitive, MaybePromise, QueryOperation, SelectOperation, UpdateOperation, WhereClause } from "./types.js";
import { assertJsonSerializable, createDatabaseError } from "./utils.js";

/**
 * Opt-in fail-closed tenant projection for JSON-first data operations.
 * Does not expose schema changes, raw SQL, native connections, joins, subqueries or cross-connection routes.
 * An application MUST still authorize the current principal and resource ownership before constructing it.
 */
export interface TenantDatabase {
    readonly tenantId: string | number;
    select(operation: Omit<SelectOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    insert(operation: Omit<InsertOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    update(operation: Omit<UpdateOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
    delete(operation: Omit<DeleteOperation, "op" | "connection">): MaybePromise<DatabaseResult>;
}

export interface TenantDatabaseOptions {
    tenantId: string | number;
    /** Explicit allowlist of logical table names mapped to actual physical table names. */
    tables: Record<string, string>;
    tenantColumn?: string;
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const refuse = (message: string): never => { throw createDatabaseError({ code: "TENANT_SCOPE_DENIED", message }); };

/** Reject every query feature that could silently reference a second tenant's table or database. */
const inspectWhere = (where: WhereClause | undefined): void => {
    if (!where) return;
    if ("and" in where) { if (!Array.isArray(where.and) || !where.and.length) refuse("Invalid tenant WHERE"); where.and.forEach(inspectWhere); }
    else if ("or" in where) { if (!Array.isArray(where.or) || !where.or.length) refuse("Invalid tenant WHERE"); where.or.forEach(inspectWhere); }
    else if ("not" in where) inspectWhere(where.not);
    else if (where.query || ["exists", "notExists", "any", "all"].includes(where.operator)) refuse("Tenant subqueries are forbidden");
};

export function createTenantDatabaseFacade(base: Pick<DatabaseFacade, "select" | "insert" | "update" | "delete">, options: TenantDatabaseOptions): TenantDatabase {
    const { tenantId } = options;
    const tenantColumn = options.tenantColumn ?? "tenant_id";
    if (!((typeof tenantId === "string" && tenantId.length > 0 && tenantId.length <= 256) || (typeof tenantId === "number" && Number.isSafeInteger(tenantId))) ||
        !identifier.test(tenantColumn) || !options.tables || Array.isArray(options.tables) || Object.keys(options.tables).length === 0) {
        refuse("Invalid tenant scope configuration");
    }
    const tables = new Map<string, string>();
    for (const [logical, physical] of Object.entries(options.tables)) {
        if (!identifier.test(logical) || typeof physical !== "string" || !identifier.test(physical)) refuse("Unsafe tenant table mapping");
        tables.set(logical, physical);
    }
    const prepare = <T extends SelectOperation | InsertOperation | UpdateOperation | DeleteOperation>(op: T): T => {
        assertJsonSerializable(op, "Tenant operation");
        const copy = JSON.parse(JSON.stringify(op)) as T;
        const table = tables.get(copy.table);
        if (!table) refuse("Table is outside tenant allowlist");
        // `into` is a qualified database selector; `use` is a prior-result mapping.
        if (copy.connection || copy.dependsOn !== undefined || copy.use !== undefined ||
            ("into" in copy && copy.into !== undefined)) refuse("Cross-connection and cross-database access denied");
        copy.table = table!;
        if (copy.op === "select" && (copy.joins?.length || copy.union?.length || copy.unionAll?.length)) refuse("Tenant joins/unions require a separately audited API");
        if (copy.op !== "insert") {
            inspectWhere(copy.where);
            const tenantPredicate: WhereClause = { field: tenantColumn, operator: "eq", value: tenantId as JsonPrimitive };
            copy.where = copy.where ? { and: [copy.where, tenantPredicate] } : tenantPredicate;
        } else {
            const rows = Array.isArray(copy.values) ? copy.values : [copy.values];
            if (rows.length === 0) refuse("Empty tenant insert");
            for (const row of rows) {
                if (!row || Array.isArray(row) || typeof row !== "object") refuse("Invalid tenant insert row");
                if (Object.prototype.hasOwnProperty.call(row, tenantColumn) && row[tenantColumn] !== tenantId) refuse("Tenant identifier cannot be changed");
                row[tenantColumn] = tenantId;
            }
        }
        if (copy.op === "update" && Object.prototype.hasOwnProperty.call(copy.values, tenantColumn)) refuse("Tenant identifier cannot be updated");
        return copy;
    };
    return Object.freeze({
        tenantId,
        select: (operation: Omit<SelectOperation, "op" | "connection">) => base.select(prepare({ ...operation, op: "select" })),
        insert: (operation: Omit<InsertOperation, "op" | "connection">) => base.insert(prepare({ ...operation, op: "insert" })),
        update: (operation: Omit<UpdateOperation, "op" | "connection">) => base.update(prepare({ ...operation, op: "update" })),
        delete: (operation: Omit<DeleteOperation, "op" | "connection">) => base.delete(prepare({ ...operation, op: "delete" }))
    });
}
