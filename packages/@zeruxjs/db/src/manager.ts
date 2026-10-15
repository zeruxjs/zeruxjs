import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
    AlterTableOperation,
    CreateDbOperation,
    CreateIndexOperation,
    CreateTableOperation,
    DatabaseConnector,
    DatabaseFacade,
    DatabaseManager,
    DatabaseManagerConfig,
    DatabaseResult,
    DeleteOperation,
    DropDbOperation,
    DropIndexOperation,
    DropTableOperation,
    InsertOperation,
    MaybePromise,
    NormalizedConnectionConfig,
    QueryOperation,
    SelectOperation,
    SwitchDbOperation,
    TruncateTableOperation,
    UpdateOperation
} from "./types.js";
import {
    createDatabaseError,
    extractConnectorFactory,
    isPromiseLike,
    mapMaybePromise,
    normalizeManagerConfig,
    redactConnectionOptions,
    resolveReferences,
    validateOperation
} from "./utils.js";

interface ConnectionState {
    config: NormalizedConnectionConfig;
    connector: DatabaseConnector;
}

/**
 * Title: Application-scoped connector import
 * Description: Resolves bare connector packages from the running application's node_modules before falling back to package-local resolution.
 * Global Variables: process.cwd()
 * @param packageName Connector package name from database config.
 * @returns Imported connector module namespace.
 */
const importConnectorPackage = async (packageName: string): Promise<Record<string, unknown>> => {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9][a-z0-9._/-]*)?$/i.test(packageName) || packageName.includes("..")) {
        throw createDatabaseError({ code: "INVALID_CONNECTOR", message: "Database connector must be a package specifier" });
    }
    const appRequire = createRequire(path.join(process.cwd(), "package.json"));
    let resolved: string | undefined;
    try { resolved = appRequire.resolve(packageName); }
    catch { /* Workspaces can resolve dependencies relative to their own package. */ }
    return await import(resolved ? pathToFileURL(resolved).href : packageName) as Record<string, unknown>;
};

/**
 * Title: Database manager implementation
 * Description: Validates config, loads connector packages, and routes JSON-only operations to the correct connection.
 * Global Variables: none
 */
class DatabaseManagerImpl implements DatabaseManager {
    public readonly defaultConnectionSlug: string;
    public readonly connectionSlugs: string[];

    readonly #connections: Map<string, ConnectionState>;
    #closed = false;
    #closing?: Promise<void>;

    constructor(
        defaultConnectionSlug: string,
        connections: Map<string, ConnectionState>
    ) {
        this.defaultConnectionSlug = defaultConnectionSlug;
        this.connectionSlugs = [...connections.keys()];
        this.#connections = connections;
    }

    /**
     * Title: Connection facade getter
     * Description: Returns a bound facade for a specific or default connection.
     * Global Variables: none
     * @param slug Optional connection slug.
     * @returns Bound connection facade.
     */
    getConnectionFacade(slug = this.defaultConnectionSlug): DatabaseFacade {
        const state = this.#getConnectionState(slug);

        return {
            slug: state.config.slug,
            name: state.config.name,
            connector: state.config.connector,
            options: redactConnectionOptions(state.config.options),
            query: (operation) => this.query(this.#assignConnection(operation, slug)),
            createDb: (operation) => this.createDb({ ...operation, op: "createDb", connection: slug }),
            dropDb: (operation) => this.dropDb({ ...operation, op: "dropDb", connection: slug }),
            switchDB: (operation) => this.switchDB({ ...operation, op: "switchDB", connection: slug }),
            createTable: (operation) => this.createTable({ ...operation, op: "createTable", connection: slug }),
            dropTable: (operation) => this.dropTable({ ...operation, op: "dropTable", connection: slug }),
            alterTable: (operation) => this.alterTable({ ...operation, op: "alterTable", connection: slug }),
            turcunateTable: (operation) => this.turcunateTable({ ...operation, op: "turcunateTable", connection: slug }),
            createIndex: (operation) => this.createIndex({ ...operation, op: "createIndex", connection: slug }),
            dropIndex: (operation) => this.dropIndex({ ...operation, op: "dropIndex", connection: slug }),
            insert: (operation) => this.insert({ ...operation, op: "insert", connection: slug }),
            select: (operation) => this.select({ ...operation, op: "select", connection: slug }),
            update: (operation) => this.update({ ...operation, op: "update", connection: slug }),
            delete: (operation) => this.delete({ ...operation, op: "delete", connection: slug }),
            native: () => state.connector.getNativeConnection?.() ?? state.connector
        };
    }

    /**
     * Title: Connection listing
     * Description: Returns safe connection metadata without secret values.
     * Global Variables: none
     * @returns Connection list.
     */
    listConnections(): NormalizedConnectionConfig[] {
        return [...this.#connections.values()].map(({ config }) => ({
            ...config,
            options: redactConnectionOptions(config.options)
        }));
    }

    /**
     * Title: Native connector access
     * Description: Exposes the connector instance for advanced usage outside the JSON abstraction.
     * Global Variables: none
     * @param slug Connection slug.
     * @returns Native connector instance.
     */
    dbAccess(slug: string): DatabaseConnector {
        return this.#getConnectionState(slug).connector;
    }

    query(operation: QueryOperation | QueryOperation[]): MaybePromise<DatabaseResult | DatabaseResult[]> {
        if (Array.isArray(operation)) {
            const normalized = operation.map((entry) => validateOperation(entry));
            const requiresSequential = normalized.some((entry) => entry.dependsOn !== undefined);

            if (!requiresSequential) {
                const parallelResult = normalized.map((entry) => this.#dispatch(entry));
                return parallelResult.some(isPromiseLike)
                    ? Promise.all(parallelResult as Promise<DatabaseResult>[])
                    : parallelResult as DatabaseResult[];
            }

            const results: DatabaseResult[] = [];
            let current: MaybePromise<DatabaseResult[]> = results;

            normalized.forEach((entry) => {
                current = mapMaybePromise(current, (collected) => {
                    const resolved = resolveReferences(entry, collected) as QueryOperation;
                    const dependencies = Array.isArray(resolved.dependsOn)
                        ? resolved.dependsOn
                        : resolved.dependsOn !== undefined
                            ? [resolved.dependsOn]
                            : [];

                    if (dependencies.some((index) => index < 0 || index >= collected.length)) {
                        throw createDatabaseError({
                            code: "INVALID_DEPENDENCY",
                            message: `Operation "${resolved.op}" depends on an unavailable previous result`
                        });
                    }

                    if (typeof resolved.use === "string" && dependencies.length === 1) {
                        (resolved as QueryOperation & { previousValue?: unknown; }).previousValue =
                            (collected[dependencies[0]] as unknown as Record<string, unknown> | undefined)?.[resolved.use];
                    }

                    return mapMaybePromise(this.#dispatch(resolved), (result) => {
                        collected.push(result);
                        return collected;
                    });
                }) as MaybePromise<DatabaseResult[]>;
            });

            return current;
        }

        return this.#dispatch(validateOperation(operation));
    }

    createDb(operation: CreateDbOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    dropDb(operation: DropDbOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    switchDB(operation: SwitchDbOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    createTable(operation: CreateTableOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    dropTable(operation: DropTableOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    alterTable(operation: AlterTableOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    turcunateTable(operation: TruncateTableOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    createIndex(operation: CreateIndexOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    dropIndex(operation: DropIndexOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    insert(operation: InsertOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    select(operation: SelectOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    update(operation: UpdateOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    delete(operation: DeleteOperation): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation));
    }

    #getConnectionState(slug: string): ConnectionState {
        if (this.#closed) throw createDatabaseError({ code: "MANAGER_CLOSED", message: "Database manager has been disconnected" });
        const state = this.#connections.get(slug);
        if (!state) {
            throw createDatabaseError({
                code: "UNKNOWN_CONNECTION",
                message: `Database connection "${slug}" is not registered`
            });
        }

        return state;
    }

    #assignConnection(
        operation: QueryOperation | QueryOperation[],
        slug: string
    ): QueryOperation | QueryOperation[] {
        if (Array.isArray(operation)) {
            return operation.map((entry) => ({ ...entry, connection: entry.connection ?? slug }));
        }

        return {
            ...operation,
            connection: operation.connection ?? slug
        };
    }

    async disconnect(): Promise<void> {
        if (this.#closing) return this.#closing;
        this.#closed = true;
        this.#closing = (async () => {
            const failures: unknown[] = [];
            for (const { connector } of [...this.#connections.values()].reverse()) {
                try { await connector.disconnect?.(); } catch (error) { failures.push(error); }
            }
            if (failures.length) throw new AggregateError(failures, "One or more database connectors failed to disconnect");
        })();
        return this.#closing;
    }

    #dispatch(operation: QueryOperation): MaybePromise<DatabaseResult> {
        const slug = operation.connection ?? this.defaultConnectionSlug;
        const state = this.#getConnectionState(slug);

        return mapMaybePromise(
            state.connector.execute(operation, {
                connection: state.config
            }),
            (result) => ({
                ...result,
                connection: result.connection || state.config.slug,
                connector: result.connector || state.config.connector,
                operation: result.operation || operation.op
            })
        );
    }
}

let activeManager: DatabaseManager | null = null;

/**
 * Title: Database manager factory
 * Description: Creates a new manager instance and loads every configured connector package.
 * Global Variables: none
 * @param config Database manager config.
 * @returns Database manager.
 */
export const createDatabaseManager = async (
    config: DatabaseManagerConfig
): Promise<DatabaseManager> => {
    const normalized = normalizeManagerConfig(config);
    const states = new Map<string, ConnectionState>();

    try {
        for (const connection of normalized.connections) {
            const imported = await importConnectorPackage(connection.connector);
            const factory = extractConnectorFactory(imported as Record<string, unknown>);
            const connector = await factory(connection.options, connection);
            try { await connector.connect?.(); }
            catch (error) { try { await connector.disconnect?.(); } catch { /* preserve connect error */ } throw error; }
            states.set(connection.slug, { config: connection, connector });
        }
        return new DatabaseManagerImpl(normalized.defaultSlug, states);
    } catch (error) {
        for (const { connector } of [...states.values()].reverse()) {
            try { await connector.disconnect?.(); } catch { /* preserve initial error */ }
        }
        throw error;
    }
};

/**
 * Title: Active manager setter
 * Description: Updates the process-wide manager used by the public convenience exports.
 * Global Variables: activeManager
 * @param manager Database manager instance.
 */
export const setActiveDatabaseManager = (manager: DatabaseManager): void => {
    activeManager = manager;
};

/**
 * Title: Active manager getter
 * Description: Returns the configured process-wide database manager.
 * Global Variables: activeManager
 * @returns Active manager instance.
 */
export const getActiveDatabaseManager = (): DatabaseManager => {
    if (!activeManager) {
        throw createDatabaseError({
            code: "DATABASE_MANAGER_NOT_INITIALIZED",
            message: "Database manager has not been initialized yet"
        });
    }

    return activeManager;
};

/**
 * Title: Database manager configurator
 * Description: Creates and installs the active manager in one step.
 * Global Variables: activeManager
 * @param config Database manager config.
 * @returns Installed manager.
 */
export const configureDatabaseManager = async (
    config: DatabaseManagerConfig
): Promise<DatabaseManager> => {
    const manager = await createDatabaseManager(config);
    setActiveDatabaseManager(manager);
    return manager;
};
