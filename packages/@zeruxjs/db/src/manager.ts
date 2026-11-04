import { ownsTransaction, transactionError, negotiateTransaction, runPinnedTransaction } from './transactions.js';
import type { PinnedTransactionAdapter, TransactionDatabase, TransactionOptions } from './transactions.js';
import { capabilities, executionPolicy, queryOptions, checkCapabilities, executionError } from './execution.js';
import type { DatabaseCapabilities, DatabaseExecutionPolicy, DatabaseQueryOptions, DatabaseQueryMetric } from './types.js';
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
    assertJsonSerializable,
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
    capabilities:Readonly<DatabaseCapabilities>;
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
    #policy:ReturnType<typeof executionPolicy>;
    #pending=new Set<{controller:AbortController;settled:Promise<void>}>();
    #closing?: Promise<void>;

    constructor(
        defaultConnectionSlug: string,
        connections: Map<string, ConnectionState>,
        policy:DatabaseExecutionPolicy={}
    ) {
        this.#policy=executionPolicy(policy);
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
            transaction:(run,options)=>this.transaction(run,options,slug),
            transactionCapabilities:()=>this.transactionCapabilities(slug),
            capabilities:()=>state.capabilities,
            slug: state.config.slug,
            name: state.config.name,
            connector: state.config.connector,
            options: redactConnectionOptions(state.config.options),
            query: (operation, options) => this.query(this.#assignConnection(operation, slug),options),
            createDb: (operation, options) => this.createDb({ ...operation, op: "createDb", connection: slug },options),
            dropDb: (operation, options) => this.dropDb({ ...operation, op: "dropDb", connection: slug },options),
            switchDB: (operation, options) => this.switchDB({ ...operation, op: "switchDB", connection: slug },options),
            createTable: (operation, options) => this.createTable({ ...operation, op: "createTable", connection: slug },options),
            dropTable: (operation, options) => this.dropTable({ ...operation, op: "dropTable", connection: slug },options),
            alterTable: (operation, options) => this.alterTable({ ...operation, op: "alterTable", connection: slug },options),
            turcunateTable: (operation, options) => this.turcunateTable({ ...operation, op: "turcunateTable", connection: slug },options),
            createIndex: (operation, options) => this.createIndex({ ...operation, op: "createIndex", connection: slug },options),
            dropIndex: (operation, options) => this.dropIndex({ ...operation, op: "dropIndex", connection: slug },options),
            insert: (operation, options) => this.insert({ ...operation, op: "insert", connection: slug },options),
            select: (operation, options) => this.select({ ...operation, op: "select", connection: slug },options),
            update: (operation, options) => this.update({ ...operation, op: "update", connection: slug },options),
            delete: (operation, options) => this.delete({ ...operation, op: "delete", connection: slug },options),
            native: () => {if(ownsTransaction(this))throw transactionError('TRANSACTION_SCOPE_REQUIRED');const current=this.#getConnectionState(slug);return current.connector.getNativeConnection?.()??current.connector;}
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
        if(ownsTransaction(this))throw transactionError('TRANSACTION_SCOPE_REQUIRED');
        return this.#getConnectionState(slug).connector;
    }

    transactionCapabilities(slug=this.defaultConnectionSlug){
        const state=this.#getConnectionState(slug);if(state.capabilities.transactions!=='supported'||!state.connector.transactionAdapter)return undefined;
        negotiateTransaction(state.connector.transactionAdapter);const caps=state.connector.transactionAdapter.capabilities;
        return Object.freeze({...caps,isolationLevels:Object.freeze([...caps.isolationLevels])});
    }

    async transaction<T>(run:(db:TransactionDatabase)=>MaybePromise<T>,options:TransactionOptions={},slug=this.defaultConnectionSlug):Promise<T>{
        if(ownsTransaction(this))throw transactionError('NESTED_TRANSACTION_UNSUPPORTED');
        const state=this.#getConnectionState(slug),adapter=state.connector.transactionAdapter;
        if(state.capabilities.transactions!=='supported')throw transactionError('UNSUPPORTED_TRANSACTION');
        negotiateTransaction(adapter,options);
        if(this.#pending.size>=this.#policy.maxPending)throw executionError('QUERY_LIMIT');
        const controller=new AbortController();let settle!:()=>void;
        const pending={controller,settled:new Promise<void>(resolve=>settle=resolve)};this.#pending.add(pending);
        try{return await runPinnedTransaction(this,adapter!,{connection:state.config},run,execute=>{
            const pinned=new DatabaseManagerImpl(slug,new Map([[slug,{...state,connector:{kind:state.connector.kind,options:state.config.options,execute}}]]),this.#policy);
            return pinned.getConnectionFacade(slug);
        },{...options,signal:AbortSignal.any([controller.signal,...(options.signal?[options.signal]:[])])});}
        finally{this.#pending.delete(pending);settle();}
    }

    capabilities(slug=this.defaultConnectionSlug){return this.#getConnectionState(slug).capabilities;}

    query(operation: QueryOperation | QueryOperation[], options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult | DatabaseResult[]> {
        options=queryOptions(options);
        if(this.#closed)throw createDatabaseError({code:'MANAGER_CLOSED',message:'Database manager has been disconnected'});
        if (Array.isArray(operation)) {
            if(operation.length>this.#policy.maxBatch)throw executionError('BATCH_LIMIT');
            assertJsonSerializable(operation,'Database batch');
            const normalized = operation.map((entry) => validateOperation(entry));
            normalized.forEach(entry=>{if(entry.op==='insert'&&Array.isArray(entry.values)&&entry.values.length>this.#policy.maxBatch)throw executionError('BATCH_LIMIT');const state=this.#getConnectionState(entry.connection??this.defaultConnectionSlug);checkCapabilities(entry,state.capabilities,options);});
            const requiresSequential = normalized.some((entry) => entry.dependsOn !== undefined);

            if (!requiresSequential) {
                if(normalized.length+this.#pending.size>this.#policy.maxPending)throw executionError('QUERY_LIMIT');
                const parallelResult = normalized.map((entry) => this.#dispatch(entry,options));
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

                    return mapMaybePromise(this.#dispatch(resolved,options), (result) => {
                        collected.push(result);
                        return collected;
                    });
                }) as MaybePromise<DatabaseResult[]>;
            });

            return current;
        }

        return this.#dispatch(validateOperation(operation),options);
    }

    createDb(operation: CreateDbOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    dropDb(operation: DropDbOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    switchDB(operation: SwitchDbOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    createTable(operation: CreateTableOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    dropTable(operation: DropTableOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    alterTable(operation: AlterTableOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    turcunateTable(operation: TruncateTableOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    createIndex(operation: CreateIndexOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    dropIndex(operation: DropIndexOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    insert(operation: InsertOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    select(operation: SelectOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    update(operation: UpdateOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
    }

    delete(operation: DeleteOperation, options:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        return this.#dispatch(validateOperation(operation),options);
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
        if(ownsTransaction(this))throw transactionError('TRANSACTION_SCOPE_REQUIRED');
        if (this.#closing) return this.#closing;
        this.#closed = true;
        this.#closing = Promise.resolve().then(async () => {
            for(const pending of this.#pending)pending.controller.abort();
            let timer:ReturnType<typeof setTimeout>|undefined;
            try { await Promise.race([Promise.all([...this.#pending].map(p=>p.settled)),new Promise<void>(resolve=>{timer=setTimeout(resolve,this.#policy.shutdownGraceMs);})]); }
            finally {if(timer)clearTimeout(timer);}
            const failures: unknown[] = [];
            for (const { connector } of [...this.#connections.values()].reverse()) {
                try { await connector.disconnect?.(); } catch (error) { failures.push(error); }
            }
            if (failures.length) throw new AggregateError(failures, "One or more database connectors failed to disconnect");
        });
        return this.#closing;
    }

    #dispatch(operation: QueryOperation, rawOptions:DatabaseQueryOptions={}): MaybePromise<DatabaseResult> {
        if(ownsTransaction(this))throw transactionError('TRANSACTION_SCOPE_REQUIRED');
        const options=queryOptions(rawOptions);
        const state=this.#getConnectionState(operation.connection??this.defaultConnectionSlug);
        checkCapabilities(operation,state.capabilities,options);
        if(operation.op==='insert'&&Array.isArray(operation.values)&&operation.values.length>this.#policy.maxBatch)throw executionError('BATCH_LIMIT');
        if(options.signal?.aborted)throw executionError('QUERY_CANCELLED');
        if(options.deadline!==undefined&&options.deadline<=Date.now())throw executionError('QUERY_DEADLINE');
        if(this.#pending.size>=this.#policy.maxPending)throw executionError('QUERY_LIMIT');
        const controller=new AbortController();
        let settle!:()=>void;
        const pending={controller,settled:new Promise<void>(resolve=>{settle=resolve;})};
        this.#pending.add(pending);
        const start=performance.now();let reported=false;
        const metric=(outcome:DatabaseQueryMetric['outcome'],result?:DatabaseResult)=>{
            if(reported)return;reported=true;
            const table='table'in operation&&typeof operation.table==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(operation.table)?operation.table:undefined;
            const count=result?.affectedCount??result?.rowCount;
            const event=Object.freeze({operation:operation.op,...(table?{table}:{}),durationMs:Math.max(0,performance.now()-start),...(typeof count==='number'&&Number.isSafeInteger(count)&&count>=0?{count}:{}),outcome});
            try{Promise.resolve(this.#policy.onMetric?.(event)).catch(()=>{});}catch{/* Diagnostics never change query results. */}
        };
        let timer:ReturnType<typeof setTimeout>|undefined;
        let abort!:()=>void;let timedOut=false;
        const cleanup=()=>{this.#pending.delete(pending);settle();};
        const callerCleanup=()=>{if(timer)clearTimeout(timer);options.signal?.removeEventListener('abort',externalAbort);if(abort)controller.signal.removeEventListener('abort',abort);};
        const externalAbort=()=>controller.abort();
        options.signal?.addEventListener('abort',externalAbort,{once:true});
        if(options.deadline!==undefined)timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.min(2147483647,Math.max(0,options.deadline-Date.now())));
        const normalize=(result:DatabaseResult)=>{
            if(!result||typeof result.ok!=='boolean')throw createDatabaseError({code:'INVALID_RESULT',message:'Invalid database result'});
            for(const count of [result.affectedCount,result.matchedCount,result.changedCount,result.rowCount])if(count!==undefined&&(!Number.isSafeInteger(count)||count<0))throw createDatabaseError({code:'INVALID_RESULT',message:'Invalid database result count'});
            return {...result,counts:result.counts??{affected:'unknown' as const,matched:'unknown' as const,changed:'unknown' as const},connection:result.connection||state.config.slug,connector:result.connector||state.config.connector,operation:result.operation||operation.op};
        };
        let execution:MaybePromise<DatabaseResult>;
        try { execution=state.connector.execute(operation,{connection:state.config,signal:controller.signal,deadline:options.deadline}); }
        catch(error){cleanup();callerCleanup();metric('failure');throw error;}
        if(!isPromiseLike(execution)){cleanup();callerCleanup();if(controller.signal.aborted||options.deadline!==undefined&&options.deadline<=Date.now()){metric(options.deadline!==undefined&&options.deadline<=Date.now()?'deadline':'cancelled');throw executionError(options.deadline!==undefined&&options.deadline<=Date.now()?'QUERY_DEADLINE':'QUERY_CANCELLED');}let result:DatabaseResult;try{result=normalize(execution);}catch(error){metric('failure');throw error;}metric(result.ok?'success':'failure',result);return result;}
        const result=Promise.resolve(execution).then(value=>{cleanup();return normalize(value);},error=>{cleanup();throw error;});
        const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(executionError(timedOut?'QUERY_DEADLINE':'QUERY_CANCELLED'));controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();});
        return Promise.race([result,cancelled]).then(value=>{metric(value.ok?'success':'failure',value);return value;},error=>{metric(controller.signal.aborted?(timedOut?'deadline':'cancelled'):'failure');throw error;}).finally(callerCleanup);
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
    executionPolicy(config?.execution);
    const normalized = normalizeManagerConfig(config);
    const states = new Map<string, ConnectionState>();

    try {
        for (const connection of normalized.connections) {
            const imported = await importConnectorPackage(connection.connector);
            const factory = extractConnectorFactory(imported as Record<string, unknown>);
            const connector = await factory(connection.options, connection);
            let reportedCapabilities:Readonly<DatabaseCapabilities>;
            try { reportedCapabilities=capabilities(connector.capabilities);await connector.connect?.(); }
            catch (error) { try { await connector.disconnect?.(); } catch { /* preserve connect error */ } throw error; }
            states.set(connection.slug, { config: connection, connector, capabilities:reportedCapabilities! });
        }
        return new DatabaseManagerImpl(normalized.defaultSlug, states,config.execution);
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

/** Build an explicit transaction runner around an adapter; no driver is loaded or resource acquired here. */
export function createPinnedTransaction(adapter:PinnedTransactionAdapter,connection:NormalizedConnectionConfig,policy:DatabaseExecutionPolicy={}):import('./transactions.js').DatabaseTransaction {
    negotiateTransaction(adapter);executionPolicy(policy);
    const normalized=normalizeManagerConfig({connections:[connection]}).connections[0];
    connection=normalized;
    const connector:DatabaseConnector={kind:'pinned',options:connection.options,capabilities:{transactions:'supported'},transactionAdapter:adapter,execute(){throw transactionError('TRANSACTION_SCOPE_REQUIRED');}};
    const manager=new DatabaseManagerImpl(connection.slug,new Map([[connection.slug,{config:connection,connector,capabilities:capabilities(connector.capabilities)}]]),policy);
    return (run,options)=>manager.transaction(run,options);
}
