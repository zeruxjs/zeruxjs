import type { DatabaseConnectorFactory } from "@zeruxjs/db";
import { createSqlConnector } from "@zeruxjs/db-sql-core";
import { createSqliteExecutor, openSqlite } from "./driver.js";
import type { SqliteOptions, SqliteDatabase } from "./driver.js";
import { sqliteDialect } from "./dialect.js";

/** Node built-in SQLite by default, optional better-sqlite3, or injected client/executor. */
export const createConnector: DatabaseConnectorFactory = async options => {
    const config = options as SqliteOptions & Record<string, unknown>;
    let db: SqliteDatabase | undefined;
    let owned = false;
    if (!config.executor && !config.client && !config.pool) {
        db = config.databaseInstance ?? await openSqlite(config.filename ?? ":memory:", config.driver, config.readonly ?? false);
        owned = !config.databaseInstance;
    }
    const delegate = createSqlConnector(sqliteDialect, {
        ...config,
        database: typeof config.database === "string" ? config.database : undefined,
        fixedDatabase: true,
        executor: db ? createSqliteExecutor(db) : config.executor as (sql: string, params: unknown[]) => unknown
    });
    return {
        ...delegate,
        execute(operation, context) {
            if (operation.op === "createDb" || operation.op === "dropDb" || operation.op === "switchDB") {
                throw new Error(`SQLite cannot execute ${operation.op}`);
            }
            return delegate.execute(operation, context);
        },
        async disconnect() { await delegate.disconnect?.(); if (owned) db?.close(); },
        getNativeConnection() { return db ?? delegate.getNativeConnection?.(); }
    };
};
export { createSqliteExecutor, openSqlite } from "./driver.js";
export type { SqliteDatabase, SqliteDriver, SqliteOptions } from "./driver.js";
export default createConnector;
