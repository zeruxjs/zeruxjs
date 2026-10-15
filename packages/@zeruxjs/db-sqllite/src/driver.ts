/** SQLite runtime drivers; no generated dist files or CommonJS require needed. */
export type SqliteStatement = {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid?: bigint | number };
};
export type SqliteDatabase = {
    prepare(statement: string): SqliteStatement;
    exec(statement: string): void;
    close(): void;
};
export type SqliteDriver = "auto" | "node" | "better-sqlite3";
export interface SqliteOptions {
    filename?: string;
    driver?: SqliteDriver;
    databaseInstance?: SqliteDatabase;
    readonly?: boolean;
}
export const openSqlite = async (filename: string, driver: SqliteDriver = "auto", readOnly = false): Promise<SqliteDatabase> => {
    if (driver !== "auto" && driver !== "node" && driver !== "better-sqlite3") throw new Error("Unknown SQLite driver");
    if (driver !== "better-sqlite3") {
        let module: typeof import("node:sqlite") | undefined;
        try { module = await import("node:sqlite"); }
        catch (error) { if (driver === "node") throw error; }
        // Opening failed for a real reason (invalid path/permissions): do not
        // hide it by silently trying another driver.
        if (module) return new module.DatabaseSync(filename, { readOnly }) as unknown as SqliteDatabase;
    }
    const sqliteModule = await import("better-sqlite3");
    const Database = sqliteModule.default as unknown as new (name: string, opts: { readonly: boolean }) => SqliteDatabase;
    return new Database(filename, { readonly: readOnly });
};

/** Convert statements to the expected SQL result shape without buffering data unnecessarily. */
export const createSqliteExecutor = (db: SqliteDatabase) => (sql: string, args: unknown[] = []) => {
    const statement = sql.trim();
    if (/^(?:CREATE|DROP)\s+DATABASE\b|^USE\b/i.test(statement)) {
        throw new Error("SQLite does not support CREATE/DROP DATABASE or USE");
    }
    if (/^TRUNCATE\s+TABLE\s+/i.test(statement)) {
        const table = statement.replace(/^TRUNCATE\s+TABLE\s+/i, "");
        // Names come from the validated SQL compiler; check again at this boundary.
        if (!/^(?:"[^"]+"(?:\."[^"]+")*)$/u.test(table)) throw new Error("Invalid SQLite table for TRUNCATE");
        db.exec(`DELETE FROM ${table}`);
        return { changes: 0 };
    }
    const prepared = db.prepare(statement);
    if (/^SELECT\b|^WITH\b|\bRETURNING\b/i.test(statement)) {
        return prepared.all(...args);
    }
    return prepared.run(...args);
};
