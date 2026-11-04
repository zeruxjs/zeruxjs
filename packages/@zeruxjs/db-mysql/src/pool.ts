import type { PoolOptions } from "mysql2/promise";

type MySqlExecutorResult = unknown;

export interface MySqlConnectionLike {
    execute(statement:string,params?:unknown[]):Promise<[unknown,unknown]>;
    query(statement:string,params?:unknown[]):Promise<[unknown,unknown]>;
    release():void;
    destroy():void;
}
export type MySqlPoolLike = {
    getConnection?():Promise<MySqlConnectionLike>;
    execute(statement: string, params?: unknown[]): Promise<[MySqlExecutorResult, unknown]>;
    end?(): Promise<void>;
};

export interface MySqlConnectorOptions extends Record<string, unknown> {
    acquireTimeoutMs?:number;
    maxPendingAcquires?:number;
    affectedRowsMode?:"matched"|"changed";
    multipleStatements?:false;
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
    ssl?: PoolOptions["ssl"];
    executor?: (statement: string, params: unknown[]) => Promise<unknown> | unknown;
}

/** Validate JavaScript configuration before creating a pool or acquiring a lease. */
export function validateOptions(options:MySqlConnectorOptions){
    if(!options||typeof options!=="object"||Array.isArray(options))throw new Error("Invalid MySQL options");
    if([options.pool,options.client,options.executor].filter(v=>v!==undefined).length>1)throw new Error("Ambiguous MySQL transport");
    if(options.multipleStatements!==undefined&&options.multipleStatements!==false)throw new Error("MySQL multiple statements are disabled");
    if(options.affectedRowsMode!==undefined&&!['matched','changed'].includes(options.affectedRowsMode))throw new Error("Invalid MySQL affected rows mode");
    for(const key of ['acquireTimeoutMs','maxPendingAcquires','connectionLimit','port'] as const){const value=options[key];if(value!==undefined&&(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>({acquireTimeoutMs:60000,maxPendingAcquires:1024,connectionLimit:1024,port:65535}[key])))throw new Error("Invalid MySQL limit");}
    for(const key of ['host','hostname','user','username','password','database'] as const)if(options[key]!==undefined&&typeof options[key]!=='string')throw new Error("Invalid MySQL connection option");
    if(options.waitForConnections!==undefined&&typeof options.waitForConnections!=='boolean')throw new Error("Invalid MySQL wait policy");
    for(const [key,expected] of [['supportBigNumbers',true],['bigNumberStrings',true],['decimalNumbers',false]] as const)if(options[key]!==undefined&&options[key]!==expected)throw new Error("MySQL precision policy cannot be disabled");
    if(options.ssl!==undefined){if(!options.ssl||typeof options.ssl!=='object'||Array.isArray(options.ssl)||options.ssl.rejectUnauthorized===false||(options.ssl as Record<string,unknown>).verifyIdentity===false)throw new Error("MySQL TLS requires verified certificates");}
    if(options.pool!==undefined&&(!options.pool||typeof options.pool!=='object'))throw new Error("Invalid MySQL pool");
    if(options.client!==undefined&&(!options.client||typeof options.client!=='object'))throw new Error("Invalid MySQL client");
    if(options.pool&&typeof options.pool.execute!=='function'||options.pool?.getConnection!==undefined&&typeof options.pool.getConnection!=='function')throw new Error("Invalid MySQL pool");
    if(options.executor!==undefined&&typeof options.executor!=='function')throw new Error("Invalid MySQL executor");
    if(options.client&&typeof options.client.execute!=='function'&&typeof options.client.query!=='function')throw new Error("Invalid MySQL client");
    return {acquireTimeoutMs:options.acquireTimeoutMs??5000,maxPendingAcquires:options.maxPendingAcquires??32};
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
    const limits=validateOptions(options);
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
                    if (Array.isArray(result) && result.length === 2 && (Array.isArray(result[1]) || result[1] === undefined && result[0] !== null && typeof result[0] === "object")) {
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
        multipleStatements:false, supportBigNumbers:true, bigNumberStrings:true, decimalNumbers:false,
        flags:options.affectedRowsMode==="changed"?["-FOUND_ROWS"]:["FOUND_ROWS"],
        connectTimeout:limits.acquireTimeoutMs, queueLimit:limits.maxPendingAcquires,
        ssl: options.ssl ? {...options.ssl as object,rejectUnauthorized:true,verifyIdentity:true}:undefined
    });

    // The shared SQL executor accepts unknown parameters; mysql2 performs the
    // final runtime validation. Preserve the native pool for getNativeConnection().
    return { pool: pool as unknown as MySqlPoolLike, owned: true };
};
