import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';

export interface Note {
  id: string;
  title: string;
  body: string;
  revision: number;
  published: boolean;
  updatedAt: number;
}
export class WorkspaceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function createNotebook(
  connection: SqliteConnector,
  tenant: string,
  migrate: boolean
) {
  const db = connection.getNativeConnection() as DatabaseSync;
  if (migrate)
    db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_notes_v1 (tenant TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, published INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(tenant, id))'
    );
  db.prepare(
    'SELECT tenant, id, title, body, revision, published, updated FROM workspace_notes_v1 LIMIT 0'
  ).all();
  const decode = (row: Record<string, unknown>): Note => ({
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    revision: Number(row.revision),
    published: row.published === 1,
    updatedAt: Number(row.updated),
  });
  return {
    list(publishedOnly = false): Note[] {
      return db
        .prepare(
          `SELECT * FROM workspace_notes_v1 WHERE tenant = ?${publishedOnly ? ' AND published = 1' : ''} ORDER BY updated DESC, id ASC LIMIT 101`
        )
        .all(tenant)
        .map(decode);
    },
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
      )
        throw new WorkspaceError(400, 'INVALID_NOTE');
      return connection.transactionSync(() => {
        const revision = Number(input.revision),
          id = input.id || randomUUID(),
          now = Date.now();
        if (!input.id) {
          const count = db
            .prepare(
              'SELECT COUNT(*) AS count FROM workspace_notes_v1 WHERE tenant = ?'
            )
            .get(tenant);
          if (Number(count?.count) >= 100)
            throw new WorkspaceError(409, 'NOTE_LIMIT');
          if (revision !== 0)
            throw new WorkspaceError(409, 'REVISION_CONFLICT');
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
          if (result.changes !== 1)
            throw new WorkspaceError(409, 'REVISION_CONFLICT');
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
