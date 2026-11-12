import { link, lstat, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { SqliteDatabase } from './driver.js';

/** Copy a live Node SQLite database with native online backup, verify integrity, then publish without replacement. Cleanup retains original failures.
 * @param {SqliteDatabase} database - Privileged Node DatabaseSync handle; other injected drivers reject.
 * @param {string} destination - Absolute trusted host destination in an existing directory; never a request-provided path.
 * @returns {Promise<{destination: string, integrity: "ok"}>} Verified published snapshot; host owns directory permissions, protection and restoration.
 */
export async function createSqliteConsistentBackup(
  database: SqliteDatabase,
  destination: string
): Promise<{ destination: string; integrity: 'ok' }> {
  /** Lazily loaded native online-copy API; importing the package opens no database. */
  const { backup, DatabaseSync } = await import('node:sqlite');
  if (typeof backup !== 'function') {
    throw new Error(
      'SQLite online backup API is unavailable on this Node runtime'
    );
  }
  if (!(database instanceof DatabaseSync)) {
    throw new Error(
      'SQLite online backup requires Node DatabaseSync; injected drivers must supply their own safe backup'
    );
  }
  if (
    typeof destination !== 'string' ||
    !path.isAbsolute(destination) ||
    destination.includes('\0')
  ) {
    throw new Error('Backup destination must be an absolute path');
  }

  /** Trusted destination parent checked before creating any temporary snapshot. */
  const parent = path.dirname(destination);
  if (!(await lstat(parent)).isDirectory()) {
    throw new Error('Backup parent must be a directory');
  }
  // Never overwrite an existing backup; in particular, never overwrite the live database.
  try {
    await lstat(destination);
    throw new Error('Backup destination already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  /** Cryptographically random sibling file owned only by this backup invocation. */
  const temp = path.join(
    parent,
    `.zerux-backup-${randomBytes(16).toString('hex')}.sqlite`
  );
  let failure: unknown,
    failed = false;
  try {
    await backup(database, temp);

    /** Read-only integrity-check handle; closes before main/WAL/SHM cleanup. */
    const check = new DatabaseSync(temp, { readOnly: true });
    try {
      /** Native integrity-check result, accepted only when explicitly ok. */
      const first = check.prepare('PRAGMA integrity_check').get() as
        | { integrity_check?: string }
        | undefined;
      if (first?.integrity_check !== 'ok') {
        throw new Error('SQLite backup integrity check failed');
      }
    } finally {
      check.close();
    }
    await link(temp, destination); // hard-link fails with EEXIST instead of replacing existing destination
    return { destination, integrity: 'ok' };
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    // These random temporary names belong only to this backup, including read-only WAL sidecars.

    /** Cleanup failures retained alongside any original copy/publication failure. */
    const errors: unknown[] = [];
    for (const file of [temp, `${temp}-wal`, `${temp}-shm`]) {
      try {
        await unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          errors.push(error);
        }
      }
    }

    if (errors.length) {
      // eslint-disable-next-line no-unsafe-finally -- Report owned cleanup failure together with the primary error.
      throw new AggregateError(
        [...(failed ? [failure] : []), ...errors],
        'SQLite backup temporary cleanup failed'
      );
    }
  }
}
