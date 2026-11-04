import { createDatabaseError } from '@zeruxjs/db';
/** Minimal synchronous driver contract. Optional integer controls are driver-specific. */
export type SqliteStatement = {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid?: bigint | number };
    setReadBigInts?(enabled:boolean):void;
    safeIntegers?(enabled:boolean):unknown;
    readonly reader?:boolean;
    columns?():readonly unknown[];
};
export type SqliteDatabase = {
    prepare(statement: string): SqliteStatement;
    exec(statement: string): void;
    close(): void;
    readonly isTransaction?:boolean;
    readonly inTransaction?:boolean;
};
export type SqliteDriver = 'auto' | 'node' | 'better-sqlite3';
export interface SqliteOptions {
    filename?: string; driver?: SqliteDriver; databaseInstance?: SqliteDatabase; readonly?: boolean;
    busyTimeoutMs?:number;
    /** Preserve existing journal policy by default; WAL/delete must be explicitly configured. */
    journalMode?:'preserve'|'wal'|'delete';
    /** Default preserves safe numbers and emits unsafe 64-bit integers as strings. */
    readBigInts?:boolean;
}
export const sqliteError=(code:string,cause?:unknown)=>createDatabaseError({code,message:code.toLowerCase().replaceAll('_',' '),...(cause!==undefined?{cause}:{})});
export function syncValue<T>(value:T):T {
    if(value!==null&&(typeof value==='object'||typeof value==='function')&&typeof (value as any).then==='function'){
        void Promise.resolve(value).catch(()=>{});throw sqliteError('SQLITE_ASYNC_RESULT');
    }
    return value;
}
export function validateSqliteOptions(options:SqliteOptions):void {
    if(!options||typeof options!=='object'||Array.isArray(options))throw sqliteError('INVALID_SQLITE_OPTIONS');
    if(options.driver!==undefined&&!['auto','node','better-sqlite3'].includes(options.driver))throw sqliteError('UNKNOWN_SQLITE_DRIVER');
    if(options.filename!==undefined&&(typeof options.filename!=='string'||!options.filename||options.filename.length>4096||options.filename.includes('\0')))throw sqliteError('INVALID_SQLITE_FILENAME');
    for(const flag of ['readonly','readBigInts'] as const)if(options[flag]!==undefined&&typeof options[flag]!=='boolean')throw sqliteError('INVALID_SQLITE_OPTIONS');
    if(options.busyTimeoutMs!==undefined&&(!Number.isSafeInteger(options.busyTimeoutMs)||options.busyTimeoutMs<0||options.busyTimeoutMs>60000))throw sqliteError('INVALID_SQLITE_BUSY_TIMEOUT');
    if(options.journalMode!==undefined&&!['preserve','wal','delete'].includes(options.journalMode))throw sqliteError('INVALID_SQLITE_JOURNAL_MODE');
    if(options.readonly&&options.journalMode!==undefined&&options.journalMode!=='preserve')throw sqliteError('SQLITE_READONLY_JOURNAL_POLICY');
    if(options.databaseInstance!==undefined&&(!options.databaseInstance||typeof options.databaseInstance!=='object'))throw sqliteError('INVALID_SYNC_SQLITE_DATABASE');
    if(options.databaseInstance)for(const name of ['prepare','exec','close'] as const)if(typeof options.databaseInstance[name]!=='function'||options.databaseInstance[name].constructor.name==='AsyncFunction')throw sqliteError('INVALID_SYNC_SQLITE_DATABASE');
}
/** Opens only the selected driver. Auto falls back only when node:sqlite cannot be imported. */
export const openSqlite = async (filename:string,driver:SqliteDriver='auto',readOnly=false):Promise<SqliteDatabase>=>{
    validateSqliteOptions({filename,driver,readonly:readOnly});
    if(driver!=='better-sqlite3'){
        let module:typeof import('node:sqlite')|undefined;
        try{module=await import('node:sqlite');}catch(error){if(driver==='node')throw error;}
        if(module)return new module.DatabaseSync(filename,{readOnly}) as unknown as SqliteDatabase;
    }
    const sqliteModule=await import('better-sqlite3');
    const Database=sqliteModule.default as unknown as new(name:string,opts:{readonly:boolean})=>SqliteDatabase;
    return new Database(filename,{readonly:readOnly});
};
/** Apply explicitly requested policies to this handle. The host owns policy for borrowed handles. */
export function configureSqlite(db:SqliteDatabase,options:SqliteOptions):void {
    if(options.busyTimeoutMs!==undefined)syncValue(db.exec(`PRAGMA busy_timeout=${options.busyTimeoutMs}`));
    if(options.journalMode&&options.journalMode!=='preserve'){
        const requested=options.journalMode.toUpperCase();
        const rows=syncValue(db.prepare(`PRAGMA journal_mode=${requested}`).all()) as Array<{journal_mode?:string}>;
        if(rows[0]?.journal_mode?.toUpperCase()!==requested)throw sqliteError('SQLITE_JOURNAL_MODE_UNAVAILABLE');
    }
}
/** Prepared synchronous execution with explicit, precision-preserving integer conversion. */
export const createSqliteExecutor=(db:SqliteDatabase,options:Pick<SqliteOptions,'readBigInts'>={})=>{
    if(!options||typeof options!=='object'||Array.isArray(options))throw sqliteError('INVALID_SQLITE_OPTIONS');
    validateSqliteOptions({...options,databaseInstance:db});
    return (sql:string,args:unknown[]=[])=>{
    if(typeof sql!=='string'||!sql.trim()||sql.length>8*1024*1024||sql.includes('\0')||!Array.isArray(args))throw sqliteError('INVALID_SQLITE_STATEMENT');
    let statement=sql.trim();
    if(/^TRUNCATE\s+TABLE\s+/i.test(statement)){
        const table=statement.replace(/^TRUNCATE\s+TABLE\s+/i,'');
        if(!/^"[A-Za-z_][A-Za-z0-9_]*"(?:\."[A-Za-z_][A-Za-z0-9_]*")*$/.test(table))throw sqliteError('INVALID_SQLITE_TRUNCATE');
        statement=`DELETE FROM ${table}`;
    }
    if(/^(?:CREATE|DROP)\s+DATABASE\b|^USE\b/i.test(statement))throw sqliteError('SQLITE_UNSUPPORTED_DATABASE_OPERATION');
    const prepared=syncValue(db.prepare(statement));
    const precise=()=>{if(prepared.setReadBigInts)syncValue(prepared.setReadBigInts(true));else if(prepared.safeIntegers)syncValue(prepared.safeIntegers(true));else if(options.readBigInts)throw sqliteError('SQLITE_BIGINT_MODE_UNAVAILABLE');};
    precise();
    const scalar=(value:unknown):unknown=>typeof value==='bigint'&&!options.readBigInts?(value>=BigInt(Number.MIN_SAFE_INTEGER)&&value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):value.toString()):value;
    const tokens=statement.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,' ');
    if(typeof prepared.reader!=='boolean'&&!prepared.columns&&/^WITH\b/i.test(tokens))throw sqliteError('SQLITE_STATEMENT_METADATA_UNAVAILABLE');
    const returnsRows=typeof prepared.reader==='boolean'?prepared.reader:prepared.columns?syncValue(prepared.columns()).length>0:/^(?:SELECT|PRAGMA|EXPLAIN)\b/i.test(tokens)||/^(?:INSERT|UPDATE|DELETE)\b[\s\S]*\bRETURNING\b/i.test(tokens);
    if(returnsRows){
        const rows=syncValue(prepared.all(...args));
        return rows.map(row=>row&&typeof row==='object'?Object.fromEntries(Object.entries(row).map(([key,value])=>[key,scalar(value)])):row);
    }
    const result=syncValue(prepared.run(...args));
    const changes=typeof result.changes==='bigint'?Number(result.changes):result.changes;
    if(!Number.isSafeInteger(changes)||changes<0)throw sqliteError('SQLITE_UNSAFE_CHANGE_COUNT');
    const rowId=result.lastInsertRowid;
    return {...result,changes,lastInsertRowid:typeof rowId==='bigint'&&rowId>=BigInt(Number.MIN_SAFE_INTEGER)&&rowId<=BigInt(Number.MAX_SAFE_INTEGER)?Number(rowId):rowId};
    };
};
