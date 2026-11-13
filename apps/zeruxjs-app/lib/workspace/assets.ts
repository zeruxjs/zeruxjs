import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';
import type { StorageManager } from '@zeruxjs/files';
import { AssetManager, type AssetSnapshot } from '@zeruxjs/asset-manager';
import { createAssetStorage } from '@zeruxjs/asset-manager/storage';
import { WorkspaceError } from './store.js';

/** Request-local catalogs + durable snapshot CAS: no mutable catalog is shared across processes. */
export function createWorkspaceAssets(
  connection: SqliteConnector,
  files: StorageManager,
  tenant: string,
  subject: string,
  migrate: boolean
) {
  const db = connection.getNativeConnection() as DatabaseSync;
  if (migrate) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_catalog_v1 (tenant TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)'
    );
    db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_asset_orphans_v1 (tenant TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY(tenant, version))'
    );
  }
  db.prepare(
    'SELECT tenant, revision, document FROM workspace_catalog_v1 LIMIT 0'
  ).all();
  db.prepare(
    'SELECT tenant, version FROM workspace_asset_orphans_v1 LIMIT 0'
  ).all();
  const who = { tenant, subject };
  function load() {
    const row = db
      .prepare(
        'SELECT revision, document FROM workspace_catalog_v1 WHERE tenant = ?'
      )
      .get(tenant);
    const catalog = new AssetManager();
    if (row) {
      if (
        typeof row.document !== 'string' ||
        Buffer.byteLength(row.document) > 1_048_576
      )
        throw new Error('CATALOG_INVALID');
      catalog.load(JSON.parse(row.document) as AssetSnapshot);
    }
    return { catalog, revision: row ? Number(row.revision) : 0 };
  }
  function adapter(catalog: AssetManager) {
    return createAssetStorage({
      catalog,
      files,
      namespace: 'workspace',
      location: () => ({
        storage: 'local',
        bucket: 'workspace',
        prefix: tenant + '/assets/',
      }),
      authorize: async (identity) =>
        identity.tenant === tenant && identity.subject === subject,
      allowedTypes: ['text/plain'],
      maxBytes: 32768,
      maxRecords: 200,
    });
  }
  return {
    list() {
      const { catalog, revision } = load();
      const records = catalog
        .snapshot()
        .assets.filter((asset) => asset.id.startsWith('storage.version/'))
        .slice(0, 100)
        .map((asset) => {
          const reference = JSON.parse(
            asset.metadata!['asset.storage.version']!
          ) as { assetId: string; versionId: string };
          return {
            id: reference.assetId,
            versionId: reference.versionId,
            name: asset.name,
          };
        });
      return {
        revision,
        records,
        orphans: Number(
          db
            .prepare(
              'SELECT COUNT(*) AS count FROM workspace_asset_orphans_v1 WHERE tenant = ?'
            )
            .get(tenant)?.count ?? 0
        ),
      };
    },
    async upload(
      name: string,
      text: string,
      expected: string,
      signal: AbortSignal
    ) {
      if (
        !name.trim() ||
        name.length > 100 ||
        text.length > 8192 ||
        !/^\d{1,7}$/.test(expected)
      )
        throw new WorkspaceError(400, 'ASSET_INVALID');
      const { catalog, revision } = load();
      if (revision !== Number(expected))
        throw new WorkspaceError(409, 'CATALOG_CONFLICT');
      const storage = adapter(catalog),
        bytes = Buffer.from(text),
        id = randomUUID();
      try {
        const committed = await storage.upload(
          who,
          {
            asset: { id, name, type: 'document' },
            size: bytes.length,
            contentType: 'text/plain',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            expectedRevision: catalog.revision,
          },
          bytes,
          signal
        );
        const document = JSON.stringify(catalog.snapshot());
        if (Buffer.byteLength(document) > 1_048_576)
          throw new WorkspaceError(409, 'CATALOG_LIMIT');
        const saved = connection.transactionSync(() => {
          const result =
            revision === 0
              ? db
                  .prepare(
                    'INSERT INTO workspace_catalog_v1 VALUES (?, 1, ?) ON CONFLICT(tenant) DO NOTHING'
                  )
                  .run(tenant, document)
              : db
                  .prepare(
                    'UPDATE workspace_catalog_v1 SET revision = revision + 1, document = ? WHERE tenant = ? AND revision = ?'
                  )
                  .run(document, tenant, revision);
          if (result.changes === 1) return true;
          db.prepare(
            'INSERT INTO workspace_asset_orphans_v1 VALUES (?, ?) ON CONFLICT DO NOTHING'
          ).run(tenant, committed.reference.versionId);
          return false;
        });
        if (!saved)
          throw new WorkspaceError(409, 'CATALOG_CONFLICT_BINARY_RETAINED');
        return committed;
      } finally {
        await storage.close();
      }
    },
    async versions(assetId: string) {
      const { catalog } = load(),
        storage = adapter(catalog);
      try {
        return await storage.versions(who, assetId);
      } finally {
        await storage.close();
      }
    },
    async download(versionId: string, signal: AbortSignal) {
      const { catalog } = load(),
        storage = adapter(catalog);
      try {
        return await storage.download(who, versionId, signal);
      } finally {
        await storage.close();
      }
    },
  };
}
