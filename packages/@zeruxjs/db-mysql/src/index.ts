import type { DatabaseConnectorFactory } from "@zeruxjs/db";
import { createSqlConnector } from "@zeruxjs/db-sql-core";
import { createManagedPool } from "./pool.js";
import type { MySqlConnectorOptions } from "./pool.js";
import { mysqlDialect } from "./dialect.js";

/**
 * Title: MySQL connector factory
 * Description: Creates the MySQL JSON connector with dialect-specific quoting and function mapping.
 * Global Variables: none
 * @param options Connector options.
 * @returns MySQL connector instance.
 */
export const createConnector: DatabaseConnectorFactory = async (options) => {
    const mysqlOptions = options as MySqlConnectorOptions;
    const { pool, owned } = await createManagedPool(mysqlOptions);
    const connector = createSqlConnector(mysqlDialect,
        {
            ...mysqlOptions,
            client: undefined,
            executor: undefined,
            pool: {
                execute: async (statement, params) => {
                    const [result] = await pool.execute(statement, params);
                    return result;
                }
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
