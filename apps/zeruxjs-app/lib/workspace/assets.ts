import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';
import type { StorageManager } from '@zeruxjs/files';
import { AssetManager, type AssetSnapshot } from '@zeruxjs/asset-manager';
import { createAssetStorage } from '@zeruxjs/asset-manager/storage';
import { WorkspaceError } from './store.js';

/** Request-local catalogs + durable snapshot CAS: no mutable catalog is shared across processes. */
/** Bind request-local asset adapters to durable tenant catalog CAS and explicit binary ownership.
 * @param {SqliteConnector} connection - Borrowed persistent synchronous connector.
 * @param {StorageManager} files - Borrowed named local storage manager, never closed by this facade.
 * @param {string} tenant - Verified fixed host tenant/site namespace.
 * @param {string} subject - Verified fixed operator identity.
 * @param {boolean} migrate - Explicit operator schema permission; false for ordinary startup.
 * @returns {object} Bounded metadata/version/upload/download operations with per-operation adapter cleanup.
 */
export function createWorkspaceAssets(
  connection: SqliteConnector,
  files: StorageManager,
  tenant: string,
  subject: string,
  migrate: boolean
) {
  /** Borrowed native synchronous handle; every catalog/orphan statement includes the fixed tenant. */
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
  /** Server-verified tenant/subject tuple; request data never chooses the principal. */
  const who = { tenant, subject };
  /** Load one bounded tenant snapshot into an independent catalog instance.
   * @returns {{ catalog: AssetManager; revision: number }} Detached catalog and exact expected durable revision.
   */
  function load() {
    /** Current tenant snapshot, validated for bounded serialized size before loading. */
    const row = db
      .prepare(
        'SELECT revision, document FROM workspace_catalog_v1 WHERE tenant = ?'
      )
      .get(tenant);
    /** Fresh request-local catalog; durable revision CAS is authoritative across processes. */
    const catalog = new AssetManager();
    if (row) {
      if (
        typeof row.document !== 'string' ||
        Buffer.byteLength(row.document) > 1_048_576
      ) {
        throw new Error('CATALOG_INVALID');
      }
      catalog.load(JSON.parse(row.document) as AssetSnapshot);
    }
    return { catalog, revision: row ? Number(row.revision) : 0 };
  }
  /** Bind only the local tenant prefix and verified subject to the package storage adapter.
   * @param {AssetManager} catalog - Operation-local catalog candidate.
   * @returns {object} Owned adapter accepting bounded text/plain objects under the borrowed files manager.
   */
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
    /** Project bounded immutable version references and the recorded tenant orphan count.
     * @returns {object} Revision plus at most 100 records; no binary bodies or signed access URLs.
     */
    list() {
      /** Detached catalog candidate and its exact durable revision, loaded before the operation. */
      const { catalog, revision } = load();
      /** Bounded immutable version references projected without binary content or signed URLs. */
      const records = catalog
        .snapshot()
        .assets.filter((asset) => asset.id.startsWith('storage.version/'))
        .slice(0, 100)
        .map((asset) => {
          /** Catalog-owned stored version metadata; historical bytes retain explicit version identity. */
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
    /** Commit validated binary bytes first, then persist the catalog under optimistic revision CAS.
     * @param {string} name - Nonempty inert display name, at most 100 code units.
     * @param {string} text - Inert bounded text payload; never executed or interpreted as HTML.
     * @param {string} expected - Exact decimal durable catalog revision observed by the editor.
     * @param {AbortSignal} signal - Cooperative caller cancellation; ambiguous writes are never automatically retried.
     * @returns {Promise<object>} Actual committed version receipt; a later catalog conflict reports retained binary state.
     */
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
      ) {
        throw new WorkspaceError(400, 'ASSET_INVALID');
      }
      /** Detached catalog candidate and its exact durable revision, loaded before the operation. */
      const { catalog, revision } = load();
      if (revision !== Number(expected)) {
        throw new WorkspaceError(409, 'CATALOG_CONFLICT');
      }
      /** Per-operation asset adapter; files manager remains borrowed and is not closed here. */
      const storage = adapter(catalog),
        bytes = Buffer.from(text),
        id = randomUUID();
      try {
        /** Binary/version receipt exists before attempting the separate durable catalog commit. */
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
        /** Bounded complete catalog snapshot; storage and SQLite are not a distributed transaction. */
        const document = JSON.stringify(catalog.snapshot());
        if (Buffer.byteLength(document) > 1_048_576) {
          throw new WorkspaceError(409, 'CATALOG_LIMIT');
        }
        /** Durable revision-CAS outcome; conflicts record a binary orphan candidate instead of deleting bytes. */
        const saved = connection.transactionSync(() => {
          /** Native affected-row count proves whether the exact expected catalog revision was persisted. */
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
          if (result.changes === 1) {
            return true;
          }
          db.prepare(
            'INSERT INTO workspace_asset_orphans_v1 VALUES (?, ?) ON CONFLICT DO NOTHING'
          ).run(tenant, committed.reference.versionId);
          return false;
        });
        if (!saved) {
          throw new WorkspaceError(409, 'CATALOG_CONFLICT_BINARY_RETAINED');
        }
        return committed;
      } finally {
        await storage.close();
      }
    },
    /** Read scoped immutable version history through an operation-local adapter.
     * @param {string} assetId - Explicit asset identity, still subject to the adapter’s tenant/subject checks.
     * @returns {Promise<unknown>} Actual scoped version records; the temporary adapter closes in finally.
     */
    async versions(assetId: string) {
      /** Fresh local catalog for this scoped version lookup/download; no shared mutable catalog is reused. */
      const { catalog } = load(),
        storage = adapter(catalog);
      try {
        return await storage.versions(who, assetId);
      } finally {
        await storage.close();
      }
    },
    /** Resolve only an authorized immutable version through the package integrity contract.
     * @param {string} versionId - Explicit immutable version reference, not an arbitrary filesystem path.
     * @param {AbortSignal} signal - Caller cancellation propagated to storage.
     * @returns {Promise<unknown>} Actual download result; the HTTP owner remains responsible for consuming/cancelling its body.
     */
    async download(versionId: string, signal: AbortSignal) {
      /** Fresh local catalog for this scoped version lookup/download; no shared mutable catalog is reused. */
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
