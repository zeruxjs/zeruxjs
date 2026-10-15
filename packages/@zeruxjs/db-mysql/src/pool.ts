type MySqlExecutorResult = unknown;

type MySqlPoolLike = {
    execute(statement: string, params?: unknown[]): Promise<[MySqlExecutorResult, unknown]>;
    end?(): Promise<void>;
};

export interface MySqlConnectorOptions extends Record<string, unknown> {
    client?: {
        query?: (statement: string, params?: unknown[]) => Promise<unknown>;
        execute?: (statement: string, params?: unknown[]) => Promise<unknown>;
    };
    pool?: MySqlPoolLike;
    host?: string;
    hostname?: string;
    username?: string;
    user?: string;
    password?: string;
    database?: string;
    port?: number;
    connectionLimit?: number;
    waitForConnections?: boolean;
    ssl?: unknown;
    executor?: (statement: string, params: unknown[]) => Promise<unknown> | unknown;
}

/**
 * Title: MySQL pool creator
 * Description: Creates a mysql2 pool when only connection credentials are supplied in config.
 * Global Variables: none
 * @param options Connector options.
 * @returns Pool plus ownership flag.
 */
export const createManagedPool = async (
    options: MySqlConnectorOptions
): Promise<{ pool: MySqlPoolLike; owned: boolean; }> => {
    if (options.pool) {
        return { pool: options.pool, owned: false };
    }

    if (options.client || options.executor) {
        return {
            pool: {
                execute: async (statement, params) => {
                    if (typeof options.executor === "function") {
                        return [await options.executor(statement, params ?? []), undefined];
                    }

                    const execute = options.client?.execute ?? options.client?.query;
                    if (typeof execute !== "function") throw new Error("MySQL client does not expose execute or query");
                    const result = await execute.call(options.client, statement, params);
                    // mysql2/promise returns [rows, fields], while injected simple clients
                    // may return rows directly. Never pass a nested tuple to SQL normalization.
                    if (Array.isArray(result) && result.length === 2 && Array.isArray(result[1])) {
                        return [result[0], result[1]] as [MySqlExecutorResult, unknown];
                    }
                    return [result, undefined];
                }
            },
            owned: false
        };
    }

    const mysqlModule = await import("mysql2/promise");
    const pool = mysqlModule.createPool({
        host: typeof options.host === "string" ? options.host : options.hostname,
        user: typeof options.user === "string" ? options.user : options.username,
        password: options.password,
        database: typeof options.database === "string" ? options.database : undefined,
        port: typeof options.port === "number" ? options.port : 3306,
        connectionLimit: typeof options.connectionLimit === "number" ? options.connectionLimit : 10,
        waitForConnections: typeof options.waitForConnections === "boolean" ? options.waitForConnections : true,
        ssl: options.ssl
    });

    return { pool, owned: true };
};

