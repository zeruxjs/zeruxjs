import type { DatabaseConnectorFactory } from "@zeruxjs/db";
import { createSqlConnector } from "@zeruxjs/db-sql-core";
import { createManagedPool } from "./pool.js";
import type { PgConnectorOptions } from "./pool.js";
import { pgDialect } from "./dialect.js";

/**
 * Title: PostgreSQL connector factory
 * Description: Creates the PostgreSQL JSON connector with dialect-specific placeholders and function mapping.
 * Global Variables: none
 * @param options Connector options.
 * @returns PostgreSQL connector instance.
 */
export const createConnector: DatabaseConnectorFactory = async (options) => {
    const pgOptions = options as PgConnectorOptions;
    const { pool, owned } = await createManagedPool(pgOptions);
    const connector = createSqlConnector(pgDialect,
        {
            ...pgOptions,
            client: undefined,
            executor: undefined,
            pool: {
                query: (statement, params) => pool.query(statement, params)
            }
        }
    );
    return {
        ...connector,
        async disconnect() {
            await connector.disconnect?.();
            if (owned && typeof pool.end === "function") {
                await pool.end();
            }
        },
        getNativeConnection() {
            return pool;
        }
    };
};

export default createConnector;
