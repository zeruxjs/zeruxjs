import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';

/** Detached notebook data; permissions are applied by the fixed tenant-bound store and HTTP owner. */
export interface Note {
  /** Immutable opaque entry identity within the fixed tenant. */
  id: string;
  /** Bounded plain text; renderers must escape rather than interpret markup. */
  title: string;
  /** Bounded inert note text, never code or raw HTML. */
  body: string;
  /** Optimistic write revision, incremented only after successful persistence. */
  revision: number;
  /** Explicit public-board visibility; private records are excluded from public queries. */
  published: boolean;
  /** Committed content timestamp in milliseconds; not synthesized by feed generation. */
  updatedAt: number;
}
/** Fixed status/code error for expected invalid input and revision conflicts; no record contents are exposed. */
export class WorkspaceError extends Error {
  readonly status: number;
  readonly code: string;
  /** Create an expected application failure with a fixed redacted code.
   * @param {number} status - Deliberate HTTP status chosen by the application owner.
   * @param {string} code - Fixed safe code, never user text or a private database cause.
   */
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
/** Bind notebook SQL to one verified host tenant; do not choose this scope from request parameters.
 * @param {SqliteConnector} connection - Borrowed synchronous durable connector, never closed here.
 * @param {string} tenant - Host-verified tenant/site namespace used in every query and write.
 * @param {boolean} migrate - Explicit operator schema permission.
 * @returns {object} Bounded list and optimistic transactional save operations.
 */
export function createNotebook(
  connection: SqliteConnector,
  tenant: string,
  migrate: boolean
) {
  /** Borrowed native handle; fixed SQL retains the same tenant parameter in every operation. */
  const db = connection.getNativeConnection() as DatabaseSync;
  if (migrate) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_notes_v1 (tenant TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, published INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(tenant, id))'
    );
  }
  db.prepare(
    'SELECT tenant, id, title, body, revision, published, updated FROM workspace_notes_v1 LIMIT 0'
  ).all();
  /** Convert one trusted SQLite result into a detached note record.
   * @param {Record<string, unknown>} row - Existing stored scalar columns.
   * @returns {Note} Detached data; content remains inert and must be escaped by consumers.
   */
  const decode = (row: Record<string, unknown>): Note => ({
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    revision: Number(row.revision),
    published: row.published === 1,
    updatedAt: Number(row.updated),
  });
  return {
    /** List a bounded tenant snapshot in deterministic timestamp/ID order.
     * @param {boolean} publishedOnly - Restrict public-board reads to explicitly published records.
     * @returns {Note[]} At most 101 rows; the extra row allows the HTTP owner to detect the 100-note limit.
     */
    list(publishedOnly = false): Note[] {
      return db
        .prepare(
          `SELECT * FROM workspace_notes_v1 WHERE tenant = ?${publishedOnly ? ' AND published = 1' : ''} ORDER BY updated DESC, id ASC LIMIT 101`
        )
        .all(tenant)
        .map(decode);
    },
    /** Persist a validated note under an exact optimistic revision; conflicts never silently overwrite.
     * @param {object} input - Bounded inert form values; identity/tenant are never selected from this record.
     * @param {string} input.id - Empty for creation, otherwise the existing opaque note ID.
     * @param {string} input.title - Nonempty plain-text title, at most 160 code units.
     * @param {string} input.body - Plain-text body, at most 8192 code units.
     * @param {string} input.revision - Expected decimal revision, zero for creation.
     * @param {string} input.published - Explicit true/false public visibility text.
     * @returns {Note} Detached committed revision; invalid values/conflicts reject transactionally.
     */
    save(input: {
      id: string;
      title: string;
      body: string;
      revision: string;
      published: string;
    }): Note {
      if (
        !/^(?:[a-f0-9-]{36})?$/.test(input.id) ||
        !input.title.trim() ||
        input.title.length > 160 ||
        input.body.length > 8192 ||
        !/^(?:0|[1-9]\d{0,6})$/.test(input.revision) ||
        !['true', 'false'].includes(input.published)
      ) {
        throw new WorkspaceError(400, 'INVALID_NOTE');
      }
      return connection.transactionSync(() => {
        /** Expected revision is checked in the same synchronous transaction as the final write. */
        const revision = Number(input.revision),
          id = input.id || randomUUID(),
          now = Date.now();
        if (!input.id) {
          /** Tenant-local creation cap is checked under the same write transaction. */
          const count = db
            .prepare(
              'SELECT COUNT(*) AS count FROM workspace_notes_v1 WHERE tenant = ?'
            )
            .get(tenant);
          if (Number(count?.count) >= 100) {
            throw new WorkspaceError(409, 'NOTE_LIMIT');
          }
          if (revision !== 0) {
            throw new WorkspaceError(409, 'REVISION_CONFLICT');
          }
          db.prepare(
            'INSERT INTO workspace_notes_v1 VALUES (?, ?, ?, ?, 1, ?, ?)'
          ).run(
            tenant,
            id,
            input.title,
            input.body,
            input.published === 'true' ? 1 : 0,
            now
          );
        } else {
          /** Affected-row count proves the tenant/ID/revision predicate matched exactly one record. */
          const result = db
            .prepare(
              'UPDATE workspace_notes_v1 SET title = ?, body = ?, revision = revision + 1, published = ?, updated = ? WHERE tenant = ? AND id = ? AND revision = ?'
            )
            .run(
              input.title,
              input.body,
              input.published === 'true' ? 1 : 0,
              now,
              tenant,
              id,
              revision
            );
          if (result.changes !== 1) {
            throw new WorkspaceError(409, 'REVISION_CONFLICT');
          }
        }
        return {
          id,
          title: input.title,
          body: input.body,
          revision: revision + 1,
          published: input.published === 'true',
          updatedAt: now,
        };
      });
    },
  };
}
