import { backup, DatabaseSync } from "node:sqlite";
import { link, lstat, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { SqliteDatabase } from "./driver.js";

/**
 * Online SQLite consistent snapshot. Works with the built-in node:sqlite driver only.
 * Uses SQLite's backup API (not a raw copy of a potentially active WAL database).
 * Verifies PRAGMA integrity_check, then creates the destination without overwriting it.
 * Caller must protect the backup at rest, set private directory permissions and rehearse restoration.
 */
export async function createSqliteConsistentBackup(database: SqliteDatabase, destination: string): Promise<{ destination: string; integrity: "ok" }> {
    if (!(database instanceof DatabaseSync)) throw new Error("SQLite online backup requires Node DatabaseSync; injected drivers must supply their own safe backup");
    if (typeof destination !== "string" || !path.isAbsolute(destination) || destination.includes("\0")) throw new Error("Backup destination must be an absolute path");
    const parent = path.dirname(destination);
    if (!(await lstat(parent)).isDirectory()) throw new Error("Backup parent must be a directory");
    // Never overwrite an existing backup; in particular, never overwrite the live database.
    try { await lstat(destination); throw new Error("Backup destination already exists"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temp = path.join(parent, `.zerux-backup-${randomBytes(16).toString("hex")}.sqlite`);
    try {
        await backup(database, temp);
        const check = new DatabaseSync(temp, { readOnly: true });
        try {
            const first = check.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
            if (first?.integrity_check !== "ok") throw new Error("SQLite backup integrity check failed");
        } finally { check.close(); }
        await link(temp, destination); // hard-link fails with EEXIST instead of replacing existing destination
        return { destination, integrity: "ok" };
    } finally {
        try { await unlink(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
}
