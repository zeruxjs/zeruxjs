import { assertSafeDocument, assertSafeField, buildWhere, buildProjection, buildSort, toMongoValue } from "./query.js";
import type {
    ComparisonOperator,
    DatabaseConnector,
    DatabaseConnectorFactory,
    DatabaseExecutionContext,
    DatabaseResult,
    DeleteOperation,
    InsertOperation,
    QueryExpression,
    QueryOperation,
    SelectOperation,
    UpdateOperation,
    WhereClause,
    WherePredicate
} from "@zeruxjs/db";
import { createDatabaseError } from "@zeruxjs/db";

export type MongoDbLike = {
    collection(name: string): MongoCollectionLike;
    createCollection?(name: string): Promise<unknown>;
    dropDatabase?(): Promise<boolean>;
};

export type MongoCursorLike = { sort?(criteria: Record<string, 1 | -1>): MongoCursorLike; skip?(count: number): MongoCursorLike; limit?(count: number): MongoCursorLike; toArray(): Promise<unknown[]>; };
export type MongoCollectionLike = {
    insertOne?(doc: Record<string, unknown>): Promise<{ insertedId: unknown; }>;
    insertMany?(docs: Record<string, unknown>[]): Promise<{ insertedIds: Record<string, unknown>; }>;
    find?(query: Record<string, unknown>, options?: Record<string, unknown>): {
        sort?(criteria: Record<string, 1 | -1>): MongoCursorLike;
        skip?(count: number): MongoCursorLike;
        limit?(count: number): MongoCursorLike;
        toArray(): Promise<unknown[]>;
    };
    aggregate?(pipeline: unknown[]): {
        toArray(): Promise<unknown[]>;
    };
    updateMany?(query: Record<string, unknown>, update: Record<string, unknown>): Promise<{ modifiedCount: number; }>;
    deleteMany?(query: Record<string, unknown>): Promise<{ deletedCount: number; }>;
    createIndex?(keys: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<string>;
    dropIndex?(name: string): Promise<unknown>;
    drop?(): Promise<boolean>;
};

export interface MongoConnectorOptions extends Record<string, unknown> {
    db?: MongoDbLike;
    client?: {
        db(name?: string): MongoDbLike;
    };
    database?: string;
    uri?: string;
    url?: string;
    clientOptions?: Record<string, unknown>;
    allowUnfilteredWrites?: boolean;
    executor?: (operation: QueryOperation) => Promise<unknown> | unknown;
    fixedDatabase?: boolean;
    locked?: boolean;
    lockDatabase?: boolean;
}

const normalizeResult = (
    operation: QueryOperation,
    context: DatabaseExecutionContext,
    native: unknown,
    pipeline?: unknown[]
): DatabaseResult => {
    const objectResult = native && typeof native === "object" ? native as Record<string, unknown> : {};
    const rows = Array.isArray(native)
        ? native
        : Array.isArray(objectResult.rows)
            ? objectResult.rows
            : undefined;

    return {
        ok: true,
        connection: context.connection.slug,
        connector: context.connection.connector,
        operation: operation.op,
        rows,
        rowCount: rows?.length,
        affectedCount: typeof objectResult.modifiedCount === "number"
            ? objectResult.modifiedCount
            : typeof objectResult.deletedCount === "number"
                ? objectResult.deletedCount
                : undefined,
        insertedIds: objectResult.insertedId !== undefined
            ? [String(objectResult.insertedId)]
            : objectResult.insertedIds && typeof objectResult.insertedIds === "object"
                ? Object.values(objectResult.insertedIds as Record<string, unknown>).map((value) => String(value))
                : undefined,
        native,
        pipeline
    };
};

const getDatabase = (options: MongoConnectorOptions, databaseName?: string): MongoDbLike => {
    if (options.db) {
        return options.db;
    }

    if (options.client) {
        return options.client.db(databaseName ?? options.database);
    }

    throw createDatabaseError({
        code: "MISSING_MONGO_CLIENT",
        message: "Mongo connector requires options.db, options.client, or options.executor"
    });
};

const executeWithDb = async (
    options: MongoConnectorOptions,
    operation: QueryOperation,
    context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
    const databaseName = typeof options.database === "string" ? options.database : undefined;
    if ("table" in operation && typeof operation.table === "string") assertSafeField(operation.table);
    if ("name" in operation && typeof operation.name === "string" && ["createDb", "dropDb", "switchDB", "dropIndex"].includes(operation.op)) assertSafeField(operation.name);

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

    if (typeof options.executor === "function") {
        return normalizeResult(operation, context, await options.executor(operation));
    }

    switch (operation.op) {
        case "createDb":
            getDatabase(options, operation.name);
            return normalizeResult(operation, context, { ok: true });
        case "dropDb":
            return normalizeResult(operation, context, await requireMethod(getDatabase(options, operation.name).dropDatabase, "dropDatabase").call(getDatabase(options, operation.name)));
        case "switchDB":
            getDatabase(options, operation.name);
            return normalizeResult(operation, context, { ok: true, database: operation.name });
        case "createTable": {
            const db = getDatabase(options, databaseName);
            if (!db.createCollection) throw createDatabaseError({ code: "UNSUPPORTED_OPERATION", message: "Mongo database does not support createCollection" });
            try { await db.createCollection(operation.table); }
            catch (error) {
                const e=error as {code?:number;codeName?:string};
                if(!operation.ifNotExists || (e.code!==48 && e.codeName!=='NamespaceExists')) throw error;
            }
            const collection = db.collection(operation.table);
            for (const index of operation.indexes ?? []) {
                if (index.columns.some(column => typeof column !== "string")) throw createDatabaseError({ code: "INVALID_INDEX", message: "Mongo indexes require plain named columns" });
                index.columns.forEach(column => assertSafeField(column as string));
                await requireMethod(collection.createIndex, "createIndex").call(collection,
                    Object.fromEntries(index.columns.map((column) => [column, 1 as const])),
                    {
                        unique: index.unique,
                        name: index.name
                    }
                );
            }
            return normalizeResult(operation, context, { ok: true });
        }
        case "dropTable": {
            const collection = getDatabase(options, databaseName).collection(operation.table);
            return normalizeResult(operation, context, await requireMethod(collection.drop, "drop").call(collection));
        }
        case "alterTable":
            throw createDatabaseError({ code: "UNSUPPORTED_OPERATION", message: "Mongo alterTable is not supported; perform an explicit schema migration" });
        case "turcunateTable":
            const collection = getDatabase(options, databaseName).collection(operation.table);
            return normalizeResult(operation, context, await requireMethod(collection.deleteMany, "deleteMany").call(collection, {}));
        case "createIndex": {
            const collection = getDatabase(options, databaseName).collection(operation.table);
            if (operation.columns.some(column => typeof column !== "string")) throw createDatabaseError({ code: "INVALID_INDEX", message: "Mongo indexes require plain named columns" });
            operation.columns.forEach(column => assertSafeField(column as string));
            const result = await requireMethod(collection.createIndex, "createIndex").call(collection,
                Object.fromEntries(operation.columns.map((column) => [column, 1 as const])),
                {
                    unique: operation.unique,
                    name: operation.name
                }
            );
            return normalizeResult(operation, context, { value: result });
        }
        case "dropIndex": {
            if (!operation.table) throw createDatabaseError({ code: "INVALID_IDENTIFIER", message: "dropIndex requires table" });
            const collection = getDatabase(options, databaseName).collection(operation.table);
            return normalizeResult(operation, context, await requireMethod(collection.dropIndex, "dropIndex").call(collection, operation.name));
        }
        case "insert":
            return executeInsert(options, operation, context);
        case "select":
            return executeSelect(options, operation, context);
        case "update":
            return executeUpdate(options, operation, context);
        case "delete":
            return executeDelete(options, operation, context);
        default:
            throw createDatabaseError({
                code: "UNSUPPORTED_OPERATION",
                message: `Unsupported Mongo operation "${String((operation as QueryOperation).op)}"`
            });
    }
};

function requireMethod<T extends (...args: any[]) => any>(method: T | undefined, name: string): T {
    if (!method) throw createDatabaseError({ code: "UNSUPPORTED_OPERATION", message: `Mongo collection does not support ${name}` });
    return method;
}

const executeInsert = async (
    options: MongoConnectorOptions,
    operation: InsertOperation,
    context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
    const collection = getDatabase(options, options.database).collection(operation.table);
    assertSafeDocument(operation.values);
    if (Array.isArray(operation.values)) {
        return normalizeResult(operation, context, await requireMethod(collection.insertMany, "insertMany").call(collection, operation.values as Record<string, unknown>[]));
    }

    return normalizeResult(operation, context, await requireMethod(collection.insertOne, "insertOne").call(collection, operation.values as Record<string, unknown>));
};

const executeSelect = async (
    options: MongoConnectorOptions,
    operation: SelectOperation,
    context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
    const collection = getDatabase(options, options.database).collection(operation.table);
    const requestedLimit = operation.limit ?? operation.top ?? (typeof operation.fetch === "number" ? operation.fetch : operation.fetch?.count);
    if (requestedLimit !== undefined && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100000)) throw createDatabaseError({ code: "INVALID_QUERY", message: "Mongo limit must be between 1 and 100000" });
    if (operation.offset !== undefined && (!Number.isSafeInteger(operation.offset) || operation.offset < 0 || operation.offset > 1_000_000)) throw createDatabaseError({ code: "INVALID_QUERY", message: "Invalid Mongo offset" });
    // Portable analytics COUNT queries: convert the DB facade's small, validated
    // COUNT(id)/GROUP BY DSL subset to Mongo aggregation. Ordinary Mongo selects
    // continue through their previous paths unchanged.
    const cols=operation.columns;
    const countCol=cols?.[cols.length-1];
    const countExpr=countCol&&typeof countCol==='object'&&'expr' in countCol?countCol.expr:undefined;
    const countArg=countExpr&&typeof countExpr==='object'&&'args' in countExpr&&Array.isArray(countExpr.args)?countExpr.args[0]:undefined;
    const isCount=typeof countExpr==='object'&&countExpr!==null&&'kind' in countExpr&&countExpr.kind==='function'&&countExpr.name==='COUNT'&&
      countExpr.args?.length===1&&typeof countArg==='object'&&countArg!==null&&'kind' in countArg&&countArg.kind==='column'&&'name' in countArg&&countArg.name==='id'&&
      typeof countCol==='object'&&'as' in countCol&&countCol.as==='event_count';
    const dimensionCol=cols?.[0];
    const dimExpr=dimensionCol&&typeof dimensionCol==='object'&&'expr' in dimensionCol?dimensionCol.expr:undefined;
    const dimension=dimExpr&&typeof dimExpr==='object'&&'kind' in dimExpr&&dimExpr.kind==='column'?dimExpr.name:undefined;
    const grouped=cols?.length===2&&isCount&&typeof dimension==='string'&&
      typeof dimensionCol==='object'&&'as' in dimensionCol&&dimensionCol.as==='category'&&
      operation.groupBy?.length===1&&operation.groupBy[0]===dimension;
    const onlyTotal=cols?.length===1&&isCount&&!operation.groupBy?.length;
    if((grouped||onlyTotal)&&!operation.joins?.length&&!operation.having&&!operation.union?.length&&!operation.unionAll?.length){
        const pipeline:unknown[]=[];
        if(operation.where)pipeline.push({$match:buildWhere(operation.where)});
        if(grouped){
            assertSafeField(dimension!);
            pipeline.push({$group:{_id:`$${dimension}`,event_count:{$sum:1}}});
            pipeline.push({$project:{_id:0,category:'$_id',event_count:1}});
            pipeline.push({$sort:{event_count:-1,category:1}});
            if(requestedLimit!==undefined)pipeline.push({$limit:requestedLimit});
        }else pipeline.push({$count:'event_count'});
        const rows=await requireMethod(collection.aggregate,'aggregate').call(collection,pipeline).toArray();
        return normalizeResult(operation,context,onlyTotal&&rows.length===0?[{event_count:0}]:rows,pipeline);
    }
    // Opt-in numeric fact metric DSL. This narrow shape is generated exclusively by
    // the analytics package: property field filtering and a validated numeric column.
    const metricColumn=cols?.[0];
    const numericMetricExpr=metricColumn&&typeof metricColumn==='object'&&'expr' in metricColumn?metricColumn.expr:undefined;
    const numericArg=numericMetricExpr&&typeof numericMetricExpr==='object'&&'args' in numericMetricExpr&&Array.isArray(numericMetricExpr.args)?numericMetricExpr.args[0]:undefined;
    const metricNames=['SUM','AVG','MIN','MAX'];
    const validMetric=numericMetricExpr&&typeof numericMetricExpr==='object'&&'kind' in numericMetricExpr&&numericMetricExpr.kind==='function'&&
      'name' in numericMetricExpr&&metricNames.includes(String(numericMetricExpr.name))&&
      'args' in numericMetricExpr&&Array.isArray(numericMetricExpr.args)&&numericMetricExpr.args.length===1&&
      numericArg&&typeof numericArg==='object'&&numericArg.kind==='column'&&numericArg.name==='numeric_value'&&
      typeof metricColumn==='object'&&'as' in metricColumn&&metricColumn.as==='metric_value';
    const numericCountCol=cols?.[cols.length-1];
    const numericCountExpr=numericCountCol&&typeof numericCountCol==='object'&&'expr' in numericCountCol?numericCountCol.expr:undefined;
    const numericCountArg=numericCountExpr&&typeof numericCountExpr==='object'&&'args' in numericCountExpr&&Array.isArray(numericCountExpr.args)?numericCountExpr.args[0]:undefined;
    const validNumericCount=numericCountExpr&&typeof numericCountExpr==='object'&&'kind' in numericCountExpr&&numericCountExpr.kind==='function'&&numericCountExpr.name==='COUNT'&&
      'args' in numericCountExpr&&Array.isArray(numericCountExpr.args)&&numericCountExpr.args.length===1&&
      numericCountArg&&typeof numericCountArg==='object'&&numericCountArg.kind==='column'&&numericCountArg.name==='event_id'&&
      typeof numericCountCol==='object'&&'as' in numericCountCol&&numericCountCol.as==='numeric_count';
    const numericDimCol=cols?.[0];
    const numericDimExpr=numericDimCol&&typeof numericDimCol==='object'&&'expr' in numericDimCol?numericDimCol.expr:undefined;
    const numericDimension=numericDimExpr&&typeof numericDimExpr==='object'&&numericDimExpr.kind==='column'?numericDimExpr.name:undefined;
    const numericGrouped=cols?.length===3&&validNumericCount&&
      typeof cols?.[1]==='object'&&'expr' in cols[1]&&cols[1].expr&&typeof cols[1].expr==='object'&&
      cols[1].expr.kind==='function'&&metricNames.includes(cols[1].expr.name)&&
      (cols[1].expr.args?.[0] as {name?:string}|undefined)?.name==='numeric_value'&&cols[1].as==='metric_value'&&
      typeof numericDimCol==='object'&&'as' in numericDimCol&&numericDimCol.as==='category'&&
      typeof numericDimension==='string'&&operation.groupBy?.length===1&&operation.groupBy[0]===numericDimension;
    const numericTotal=cols?.length===2&&validMetric&&validNumericCount&&!operation.groupBy?.length;
    if((numericTotal||numericGrouped)&&!operation.joins?.length&&!operation.having&&!operation.union?.length&&!operation.unionAll?.length){
      const metric=numericGrouped?(cols![1] as {expr:{name:string}}).expr.name:String((numericMetricExpr as {name:string}).name);
      const mongoMetric:Record<string,string>={SUM:'$sum',AVG:'$avg',MIN:'$min',MAX:'$max'};
      const accumulator={[mongoMetric[metric]]:'$numeric_value'};
      const pipeline:unknown[]=[];
      if(operation.where)pipeline.push({$match:buildWhere(operation.where)});
      if(numericGrouped){
        assertSafeField(numericDimension!);
        pipeline.push({$group:{_id:`$${numericDimension}`,metric_value:accumulator,numeric_count:{$sum:1}}});
        pipeline.push({$project:{_id:0,category:'$_id',metric_value:1,numeric_count:1}});
        pipeline.push({$sort:{metric_value:-1,category:1}});
        if(requestedLimit!==undefined)pipeline.push({$limit:requestedLimit});
      }else{
        pipeline.push({$group:{_id:null,metric_value:accumulator,numeric_count:{$sum:1}}});
        pipeline.push({$project:{_id:0,metric_value:1,numeric_count:1}});
      }
      const rows=await requireMethod(collection.aggregate,'aggregate').call(collection,pipeline).toArray();
      return normalizeResult(operation,context,numericTotal&&rows.length===0?[{metric_value:null,numeric_count:0}]:rows,pipeline);
    }
    const advanced = Boolean(operation.joins?.length || operation.groupBy?.length || operation.having || operation.union?.length || operation.unionAll?.length);
    if (!advanced) {
        const filter = operation.where ? buildWhere(operation.where) : {};
        const cursor = requireMethod(collection.find, "find").call(collection, filter, { projection: buildProjection(operation) });
        const sort = buildSort(operation);
        if (sort) {
            if (!cursor.sort) throw createDatabaseError({ code: "UNSUPPORTED_OPERATION", message: "Mongo cursor does not support sort" });
            cursor.sort(sort);
        }
        if (operation.offset) {
            if (!cursor.skip) throw createDatabaseError({ code: "UNSUPPORTED_OPERATION", message: "Mongo cursor does not support skip" });
            cursor.skip(operation.offset);
        }
        if (requestedLimit !== undefined) {
            if (!cursor.limit) throw createDatabaseError({ code: "UNSUPPORTED_OPERATION", message: "Mongo cursor does not support limit" });
            cursor.limit(requestedLimit);
        }
        return normalizeResult(operation, context, await cursor.toArray());
    }
    if (!collection.aggregate) throw createDatabaseError({ code: "UNSUPPORTED_OPERATION", message: "Advanced Mongo select requires aggregate" });
    const pipeline: unknown[] = [];

    if (operation.where) {
        pipeline.push({ $match: buildWhere(operation.where) });
    }

    for (const join of operation.joins ?? []) {
        assertSafeField(join.table);
        if (join.as) assertSafeField(join.as);
        pipeline.push({
            $lookup: {
                from: join.table,
                as: join.as ?? join.table,
                let: {},
                pipeline: [{ $match: buildWhere(join.on) }]
            }
        });
    }

    const projection = buildProjection(operation);
    if (projection) {
        pipeline.push({ $project: projection });
    }

    if (operation.groupBy && operation.groupBy.length > 0) {
        pipeline.push({
            $group: {
                _id: Object.fromEntries(
                    operation.groupBy.map((entry) => [
                        typeof entry === "string" ? entry : "value",
                        typeof entry === "string" ? `$${entry}` : toMongoValue(entry)
                    ])
                )
            }
        });
    }

    if (operation.having) {
        pipeline.push({ $match: buildWhere(operation.having) });
    }

    const sort = buildSort(operation);
    if (sort) {
        pipeline.push({ $sort: sort });
    }

    if (typeof operation.offset === "number" && operation.offset > 0) {
        pipeline.push({ $skip: operation.offset });
    }

    const limit = operation.limit ?? operation.top ?? (
        typeof operation.fetch === "number"
            ? operation.fetch
            : operation.fetch?.count
    );
    if (typeof limit === "number") {
        pipeline.push({ $limit: limit });
    }

    for (const union of operation.union ?? []) {
        assertSafeField(union.table);
        pipeline.push({
            $unionWith: {
                coll: union.table,
                pipeline: union.where ? [{ $match: buildWhere(union.where) }] : []
            }
        });
    }

    for (const union of operation.unionAll ?? []) {
        assertSafeField(union.table);
        pipeline.push({
            $unionWith: {
                coll: union.table,
                pipeline: union.where ? [{ $match: buildWhere(union.where) }] : []
            }
        });
    }

    const rows = await collection.aggregate(pipeline).toArray();

    return normalizeResult(operation, context, rows, pipeline);
};

const executeUpdate = async (
    options: MongoConnectorOptions,
    operation: UpdateOperation,
    context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
    const collection = getDatabase(options, options.database).collection(operation.table);
    if (!operation.where && !options.allowUnfilteredWrites) throw createDatabaseError({ code: "UNFILTERED_WRITE", message: "Mongo update requires a where clause (or explicit allowUnfilteredWrites)" });
    assertSafeDocument(operation.values);
    return normalizeResult(
        operation,
        context,
        await requireMethod(collection.updateMany, "updateMany").call(collection, operation.where ? buildWhere(operation.where) : {}, {
            $set: operation.values
        })
    );
};

const executeDelete = async (
    options: MongoConnectorOptions,
    operation: DeleteOperation,
    context: DatabaseExecutionContext
): Promise<DatabaseResult> => {
    const collection = getDatabase(options, options.database).collection(operation.table);
    if (!operation.where && !options.allowUnfilteredWrites) throw createDatabaseError({ code: "UNFILTERED_WRITE", message: "Mongo delete requires a where clause (or explicit allowUnfilteredWrites)" });
    return normalizeResult(
        operation,
        context,
        await requireMethod(collection.deleteMany, "deleteMany").call(collection, operation.where ? buildWhere(operation.where) : {})
    );
};

/**
 * Title: Mongo connector factory
 * Description: Creates the document-database connector that translates normalized JSON into Mongo collection operations.
 * Global Variables: none
 * @param options Connector options.
 * @returns Mongo connector instance.
 */
export const createConnector: DatabaseConnectorFactory = async (options) => {
    const normalized = options as MongoConnectorOptions;
    let ownedClient: { connect?(): Promise<unknown>; close?(): Promise<unknown>; db(name?: string): MongoDbLike } | undefined;
    const uri = normalized.uri ?? normalized.url;
    if (!normalized.db && !normalized.client && !normalized.executor && uri) {
        if (typeof uri !== "string" || !/^mongodb(?:\+srv)?:\/\//i.test(uri)) throw createDatabaseError({ code: "INVALID_CONNECTION", message: "Invalid MongoDB URI" });
        const packageName = "mongodb"; // optional peer dependency; loaded only for real connections
        let driver: Record<string, any>;
        try { driver = await import(packageName); }
        catch (cause) { throw createDatabaseError({ code: "MISSING_MONGO_DRIVER", message: "Install mongodb to use a URI connection", cause }); }
        ownedClient = new driver.MongoClient(uri, normalized.clientOptions ?? {});
        normalized.client = ownedClient;
    }
    if (!normalized.db && !normalized.client && !normalized.executor) throw createDatabaseError({ code: "MISSING_MONGO_CLIENT", message: "Provide db, client, executor, or uri" });
    const connector: DatabaseConnector = {
        kind: "mongo",
        options: normalized,
        async connect() { await ownedClient?.connect?.(); },
        async disconnect() { await ownedClient?.close?.(); },
        execute(operation, context) { return executeWithDb(normalized, operation, context); },
        getNativeConnection() { return normalized.client ?? normalized.db; }
    };

    return connector;
};

export default createConnector;
