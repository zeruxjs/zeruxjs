type PgQueryResult = unknown;

type PgPoolLike = {
    query(statement: string, params?: unknown[]): Promise<PgQueryResult>;
    end?(): Promise<void>;
};

export interface PgConnectorOptions extends Record<string, unknown> {
    client?: {
        query?: (statement: string, params?: unknown[]) => Promise<unknown>;
        execute?: (statement: string, params?: unknown[]) => Promise<unknown>;
    };
    pool?: PgPoolLike;
    host?: string;
    hostname?: string;
    username?: string;
    user?: string;
    password?: string;
    database?: string;
    port?: number;
    ssl?: unknown;
    max?: number;
    connectionString?: string;
    executor?: (statement: string, params: unknown[]) => Promise<unknown> | unknown;
}

/**
 * Title: PostgreSQL pool creator
 * Description: Creates a pg pool when only connection credentials are supplied in config.
 * Global Variables: none
 * @param options Connector options.
 * @returns Pool plus ownership flag.
 */
export const createManagedPool = async (
    options: PgConnectorOptions
): Promise<{ pool: PgPoolLike; owned: boolean; }> => {
    if (options.pool) {
        return { pool: options.pool, owned: false };
    }

    if (options.client || options.executor) {
        return {
            pool: {
                query: async (statement, params) => {
                    if (typeof options.executor === "function") {
                        return options.executor(statement, params ?? []);
                    }

                    if (typeof options.client?.query === "function") {
                        return options.client.query(statement, params);
                    }

                    if (typeof options.client?.execute === "function") {
                        return options.client.execute(statement, params);
                    }

                    throw new Error("PostgreSQL client does not expose query or execute");
                }
            },
            owned: false
        };
    }

    const pgModule = await import("pg");
    const pool = new pgModule.Pool({
        host: typeof options.host === "string" ? options.host : options.hostname,
        user: typeof options.user === "string" ? options.user : options.username,
        password: options.password,
        database: typeof options.database === "string" ? options.database : undefined,
        port: typeof options.port === "number" ? options.port : 5432,
        ssl: options.ssl as Record<string, unknown> | boolean | undefined,
        max: typeof options.max === "number" ? options.max : undefined,
        connectionString: typeof options.connectionString === "string" ? options.connectionString : undefined
    });

    return { pool, owned: true };
};

