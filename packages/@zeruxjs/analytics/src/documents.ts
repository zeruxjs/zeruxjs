import type { AnalyticsConnection, DatabaseResultLike } from './types.js';

export interface VersionedDocument {
  /** Positive optimistic revision owned by the document protocol. */
  version: number;
}
export interface VersionedStore<T extends VersionedDocument> {
  /** Load a detached document, reserving the initial value only when absent.
   * @returns {Promise<T>} Current document; a concurrent insert winner is read back without overwrite.
   */
  load(): Promise<T>;
  /** Compare-and-swap one exact document revision.
   * @param {T} document - Next document with version expected+1.
   * @param {number} expectedVersion - Previous revision required by the atomic update.
   * @returns {Promise<boolean>} True for one changed row, false for stale/invalid revisions; unsupported/storage errors reject.
   */
  save(document: T, expectedVersion: number): Promise<boolean>;
}
export interface DocumentConnection extends AnalyticsConnection {
  update(operation: {
    table: string;
    values: Record<string, string | number>;
    where: {
      and: Array<{ field: string; operator: 'eq'; value: string | number }>;
    };
  }): DatabaseResultLike | Promise<DatabaseResultLike>;
}
/** Create a lazy CAS document store over a borrowed database facade. Correctness requires atomic conditional UPDATE and affected-row counts.
 * @param {DocumentConnection} connection - Host-owned atomic database facade.
 * @param {string} table - Validated private document table.
 * @param {string} documentId - Validated document identity.
 * @param {T} initial - Initial versioned data, cloned when returned to callers.
 * @returns {VersionedStore<T>} Store whose writes require the previous exact revision; no connection close ownership.
 */
export function createDatabaseDocumentStore<T extends VersionedDocument>(
  connection: DocumentConnection,
  table: string,
  documentId: string,
  initial: T
): VersionedStore<T> {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(table) ||
    !/^[A-Za-z0-9_.:-]{1,90}$/.test(documentId)
  ) {
    throw new TypeError('Invalid document store identity');
  }
  let initialized: Promise<void> | undefined;
  /** Coalesce lazy table initialization; rejection releases the promise for a later attempt.
   * @returns {Promise<void>} Settles after schema readiness, or rejects with storage failure. */
  const ensure = () =>
    (initialized ??= (async () => {
      /** Settled schema/update result; CAS requires explicit affected-row metadata. */
      const result = await connection.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 96,
            primary: true,
            notNull: true,
          },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!result?.ok) {
        throw new Error('Versioned document storage unavailable');
      }
    })().catch((error) => {
      initialized = undefined;
      throw error;
    }));
  /** Read one stored document and verify its payload revision.
   * @returns {Promise<T|undefined>} Parsed document or absence; malformed/version-mismatched storage rejects.
   */
  async function lookup(): Promise<T | undefined> {
    /** Settled bounded document lookup response. */
    const res = await connection.select({
      table,
      columns: ['id', 'version', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: documentId },
      limit: 1,
    });
    if (!res?.ok) {
      throw new Error('Versioned document read unavailable');
    }
    /** Stored payload/version pair; no row means the initial value may be reserved. */
    const row = (res.rows ?? [])[0] as
      | {
          payload_json?: unknown; /** Positive optimistic revision owned by the document protocol. */
          version?: unknown;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    if (typeof row.payload_json !== 'string') {
      throw new Error('Invalid stored document');
    }
    /** Parsed persisted document checked against its stored revision. */
    const value = JSON.parse(row.payload_json) as T;
    if (
      typeof value?.version !== 'number' ||
      value.version !== Number(row.version)
    ) {
      throw new Error('Stored document version mismatch');
    }
    return value;
  }
  return {
    /** Load a detached document, reserving the initial value only when absent.
     * @returns {Promise<T>} Current document; a concurrent insert winner is read back without overwrite.
     */
    async load() {
      await ensure();
      let value = await lookup();
      if (value) {
        return structuredClone(value);
      }
      /** Create-only initial document insert; a losing replica reads back the winner. */
      const created = await connection.insert({
        table,
        values: {
          id: documentId,
          version: initial.version,
          payload_json: JSON.stringify(initial),
        },
      });
      if (created?.ok) {
        return structuredClone(initial);
      }
      // Concurrent replica may have won insert; never erase it.
      value = await lookup();
      if (value) {
        return structuredClone(value);
      }
      throw new Error('Unable to initialize document store');
    },
    /** Compare-and-swap one exact document revision.
     * @param {T} document - Next document with version expected+1.
     * @param {number} expected - Previous revision required by the atomic update.
     * @returns {Promise<boolean>} True for one changed row, false for stale/invalid revisions; unsupported/storage errors reject.
     */
    async save(document, expected) {
      if (
        !Number.isSafeInteger(expected) ||
        expected < 1 ||
        document.version !== expected + 1
      ) {
        return false;
      }
      await ensure();
      /** Settled schema/update result; CAS requires explicit affected-row metadata. */
      const result = await connection.update({
        table,
        values: {
          version: document.version,
          payload_json: JSON.stringify(document),
        },
        where: {
          and: [
            { field: 'id', operator: 'eq', value: documentId },
            { field: 'version', operator: 'eq', value: expected },
          ],
        },
      });
      if (!result?.ok) {
        throw new Error('Versioned document update unavailable');
      }
      /** Reported matched/affected row count; missing count cannot establish successful CAS. */
      const affected =
        (
          result as DatabaseResultLike & {
            affectedCount?: number;
            rowCount?: number;
          }
        ).affectedCount ??
        (result as DatabaseResultLike & { rowCount?: number }).rowCount;
      if (affected === undefined) {
        throw new Error(
          'Connector lacks affectedCount for atomic compare-and-swap'
        );
      }
      return affected === 1;
    },
  };
}
