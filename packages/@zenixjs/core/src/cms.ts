import { createHash } from 'node:crypto';
import {
  createConnector,
  type SqliteSyncTransaction,
} from '@zeruxjs/db-sqlite';
import { hasTenantPermission, type TenantPrincipal } from '@zeruxjs/auth';
import type { DatabaseResult, WhereClause } from '@zeruxjs/db';
import {
  CmsError,
  type CmsOptions,
  type CmsScope,
  type CmsPermission,
  type CmsSite,
  type CmsContentType,
  type CmsEntry,
  type CmsRevision,
  type CmsMediaReference,
} from './types.js';
import {
  fail,
  id,
  integer,
  record,
  scoped,
  contentType,
  values,
} from './validation.js';
const TABLE = 'zenix_content_v1',
  JOURNAL = 'zenix_schema';
const schemaColumns = [
  { name: 'key', type: 'text', primary: true },
  { name: 'tenant', type: 'text', notNull: true },
  { name: 'site', type: 'text', notNull: true },
  { name: 'kind', type: 'text', notNull: true },
  { name: 'id', type: 'text', notNull: true },
  { name: 'revision', type: 'integer', notNull: true },
  { name: 'document', type: 'text', notNull: true },
] as const;
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const checksum = hash([TABLE, schemaColumns, 'scope_kind_id_index_v1']);
const key = (s: CmsScope, kind: string, item: string) =>
  hash([s.tenant, s.site, kind, item]);
function ok(r: DatabaseResult) {
  if (!r || !r.ok) throw fail('DATABASE_UNAVAILABLE');
  return r;
}
function one(r: DatabaseResult) {
  const x = ok(r);
  if ((x.affectedCount ?? x.rowCount) !== 1) throw fail('REVISION_CONFLICT');
}
function where(s: CmsScope, kind: string, item: string): WhereClause {
  return {
    and: [
      { field: 'key', operator: 'eq', value: key(s, kind, item) },
      { field: 'tenant', operator: 'eq', value: s.tenant },
      { field: 'site', operator: 'eq', value: s.site },
      { field: 'kind', operator: 'eq', value: kind },
    ],
  };
}
function read<T>(
  tx: SqliteSyncTransaction,
  s: CmsScope,
  kind: string,
  item: string,
): T | null {
  const r = ok(
    tx.select({ table: TABLE, where: where(s, kind, item), limit: 2 }),
  );
  if (!Array.isArray(r.rows) || r.rows.length > 1) throw fail('CORRUPT_STORE');
  if (!r.rows.length) return null;
  const row = r.rows[0] as { document: unknown };
  if (
    typeof row.document !== 'string' ||
    Buffer.byteLength(row.document) > 65536
  )
    throw fail('CORRUPT_STORE');
  try {
    return JSON.parse(row.document) as T;
  } catch (error) {
    throw fail('CORRUPT_STORE', error);
  }
}
function insert(
  tx: SqliteSyncTransaction,
  s: CmsScope,
  kind: string,
  item: string,
  document: object,
  revision = 1,
) {
  if (read(tx, s, kind, item)) throw fail('REVISION_CONFLICT');
  one(
    tx.insert({
      table: TABLE,
      values: {
        key: key(s, kind, item),
        ...s,
        kind,
        id: item,
        revision,
        document: JSON.stringify(document),
      },
    }),
  );
}
function site(tx: SqliteSyncTransaction, s: CmsScope) {
  if (!read<CmsSite>(tx, s, 'site', s.site)) throw fail('SITE_NOT_FOUND');
}
/** One file-backed SQLite adapter. No async pinned-transaction or arbitrary SQL fallback. */
export async function createCms(options: CmsOptions) {
  if (!options || options.adapter !== 'sqlite')
    throw fail('UNSUPPORTED_ADAPTER');
  record(options, [
    'adapter',
    'filename',
    'connection',
    'migrate',
    'resolvePrincipal',
    'authorizeMedia',
    'plugins',
    'maxPending',
    'timeoutMs',
  ]);
  if (
    typeof options.resolvePrincipal !== 'function' ||
    typeof options.authorizeMedia !== 'function' ||
    (options.migrate !== undefined && typeof options.migrate !== 'boolean') ||
    (options.filename !== undefined && options.connection !== undefined)
  )
    throw fail('INVALID_CONFIGURATION');
  if (
    !options.connection &&
    (typeof options.filename !== 'string' ||
      !options.filename ||
      options.filename === ':memory:' ||
      options.filename.startsWith('file:') ||
      options.filename.includes('\0'))
  )
    throw fail('DURABLE_FILENAME_REQUIRED');
  const max = options.maxPending ?? 16,
    timeout = options.timeoutMs ?? 5000;
  integer(max, 1, 64);
  integer(timeout, 1, 60000);
  if (options.plugins !== undefined && !Array.isArray(options.plugins))
    throw fail('INVALID_PLUGINS');
  const plugins: NonNullable<CmsOptions['plugins']> = [
    ...(options.plugins ?? []),
  ];
  if (
    plugins.length > 16 ||
    plugins.some((p) => {
      if (!p || typeof p !== 'object') throw fail('INVALID_PLUGINS');
      id(p.id);
      return typeof p.setup !== 'function';
    }) ||
    new Set(plugins.map((p) => p.id)).size !== plugins.length
  )
    throw fail('INVALID_PLUGINS');
  const db =
    options.connection ??
    (await createConnector({
      filename: options.filename!,
      driver: 'node',
      busyTimeoutMs: 1000,
      journalMode: 'wal',
    }).catch((error) => {
      throw fail('STARTUP_FAILED', error);
    }));
  const owned = !options.connection;
  let closed = false,
    closing: Promise<void> | undefined;
  const controller = new AbortController(),
    pending = new Set<Promise<unknown>>(),
    cleanup: (() => void | Promise<void>)[] = [];
  const transaction = <T>(run: (tx: SqliteSyncTransaction) => T) => {
    if (closed) throw fail('CLOSED');
    return db.transactionSync(run as any, {
      mode: 'immediate',
      timeoutMs: timeout,
      signal: controller.signal,
    }) as T;
  };
  const authorize = async (
    scope: CmsScope,
    permission: CmsPermission,
    principal: unknown,
  ) => {
    controller.signal.throwIfAborted();
    const p = await options.resolvePrincipal(principal, {
      signal: controller.signal,
    });
    if (
      !p ||
      !hasTenantPermission(p, {
        tenantId: scope.tenant,
        siteId: scope.site,
        permission,
      }) ||
      (typeof p.userId === 'string' && p.userId.length > 128)
    )
      throw fail('DENIED');
    controller.signal.throwIfAborted();
    return p;
  };
  const run = <T>(
    s: CmsScope,
    permission: CmsPermission,
    principal: unknown,
    work: (s: CmsScope, p: TenantPrincipal) => T | Promise<T>,
  ): Promise<T> => {
    if (closed) return Promise.reject(fail('CLOSED'));
    if (pending.size >= max) return Promise.reject(fail('OVERLOAD'));
    let scope: CmsScope;
    try {
      scope = scoped(s);
    } catch (error) {
      return Promise.reject(error);
    }
    const task = Promise.resolve()
      .then(async () => {
        const p = await authorize(scope, permission, principal);
        return work(scope, p);
      })
      .catch((e) => {
        throw e instanceof CmsError
          ? e
          : fail(
              controller.signal.aborted ? 'CANCELLED' : 'DATABASE_UNAVAILABLE',
              e,
            );
      })
      .finally(() => pending.delete(task));
    pending.add(task);
    return task;
  };
  const verifyMedia = async (
    data: CmsRevision['values'],
    principal: TenantPrincipal,
    s: CmsScope,
  ) => {
    for (const v of Object.values(data))
      if (v && typeof v === 'object') {
        if (
          (await options.authorizeMedia(
            Object.freeze(structuredClone(v)),
            Object.freeze(structuredClone(principal)),
            Object.freeze({ ...s }),
            controller.signal,
          )) !== true
        )
          throw fail('MEDIA_DENIED');
        controller.signal.throwIfAborted();
      }
  };
  function revision(
    tx: SqliteSyncTransaction,
    s: CmsScope,
    entryId: string,
    n: number,
  ) {
    const r = read<CmsRevision>(tx, s, 'revision', entryId + ':' + n);
    if (
      !r ||
      r.tenant !== s.tenant ||
      r.site !== s.site ||
      r.entryId !== entryId ||
      r.revision !== n
    )
      throw fail('REVISION_NOT_FOUND');
    return r;
  }
  function commit(
    tx: SqliteSyncTransaction,
    s: CmsScope,
    entryId: string,
    expected: number | null,
    data: Pick<CmsRevision, 'type' | 'typeVersion' | 'values'>,
    state: 'draft' | 'published',
    p: TenantPrincipal,
    sourceRevision?: number,
  ) {
    site(tx, s);
    const old = read<CmsEntry>(tx, s, 'entry', entryId);
    if (expected === null ? !!old : !old || old.head !== expected)
      throw fail('REVISION_CONFLICT');
    if (old && (old.type !== data.type || old.typeVersion !== data.typeVersion))
      throw fail('TYPE_CHANGE_UNSUPPORTED');
    const n = (old?.head ?? 0) + 1;
    integer(n);
    const next: CmsRevision = {
      ...s,
      entryId,
      revision: n,
      state,
      ...data,
      actor: String(p.userId),
      createdAt: Date.now(),
      ...(sourceRevision ? { sourceRevision } : {}),
    };
    insert(tx, s, 'revision', entryId + ':' + n, next, n);
    const entry: CmsEntry = {
      ...s,
      id: entryId,
      type: data.type,
      typeVersion: data.typeVersion,
      head: n,
      state,
      publishedRevision:
        state === 'published' ? n : (old?.publishedRevision ?? null),
    };
    if (old) {
      one(
        tx.update({
          table: TABLE,
          values: { revision: n, document: JSON.stringify(entry) },
          where: {
            and: [
              where(s, 'entry', entryId),
              { field: 'revision', operator: 'eq', value: expected! },
            ],
          },
        }),
      );
    } else insert(tx, s, 'entry', entryId, entry, n);
    return { entry, revision: next };
  }
  const api = {
    createSite(s: CmsScope, name: string, principal: unknown) {
      return run(s, 'cms:site-manage', principal, (s) => {
        if (typeof name !== 'string' || !name.trim() || name.length > 200)
          throw fail('INVALID_SITE');
        return transaction((tx) => {
          const value: CmsSite = { ...s, name, createdAt: Date.now() };
          insert(tx, s, 'site', s.site, value);
          return value;
        });
      });
    },
    readSite(s: CmsScope, principal: unknown) {
      return run(s, 'cms:read', principal, (s) =>
        transaction((tx) => read<CmsSite>(tx, s, 'site', s.site)),
      );
    },
    registerContentType(
      s: CmsScope,
      input: CmsContentType,
      principal: unknown,
    ) {
      return run(s, 'cms:type-manage', principal, (s) => {
        const schema = contentType(input);
        return transaction((tx) => {
          site(tx, s);
          if (
            schema.version > 1 &&
            !read(tx, s, 'type', schema.id + ':' + (schema.version - 1))
          )
            throw fail('SCHEMA_HISTORY_REQUIRED');
          insert(
            tx,
            s,
            'type',
            schema.id + ':' + schema.version,
            schema,
            schema.version,
          );
          return schema;
        });
      });
    },
    readContentType(
      s: CmsScope,
      type: string,
      version: number,
      principal: unknown,
    ) {
      return run(s, 'cms:read', principal, (s) => {
        id(type);
        integer(version, 1, 10000);
        return transaction((tx) =>
          read<CmsContentType>(tx, s, 'type', type + ':' + version),
        );
      });
    },
    saveDraft(
      s: CmsScope,
      entryId: string,
      expected: number | null,
      input: {
        type: string;
        typeVersion: number;
        values: CmsRevision['values'];
      },
      principal: unknown,
    ) {
      return run(s, 'cms:write', principal, async (s, p) => {
        id(entryId);
        if (expected !== null) integer(expected);
        record(input, ['type', 'typeVersion', 'values']);
        id(input.type);
        integer(input.typeVersion, 1, 10000);
        const schema = transaction((tx) =>
          read<CmsContentType>(
            tx,
            s,
            'type',
            input.type + ':' + input.typeVersion,
          ),
        );
        if (!schema) throw fail('TYPE_NOT_FOUND');
        const data = {
          type: input.type,
          typeVersion: input.typeVersion,
          values: values(contentType(schema), input.values),
        };
        await verifyMedia(data.values, p, s);
        p = await authorize(s, 'cms:write', principal);
        return transaction((tx) =>
          commit(tx, s, entryId, expected, data, 'draft', p),
        );
      });
    },
    readEntry(s: CmsScope, entryId: string, principal: unknown) {
      return run(s, 'cms:read', principal, (s) => {
        id(entryId);
        return transaction((tx) => {
          const e = read<CmsEntry>(tx, s, 'entry', entryId);
          return e
            ? { entry: e, revision: revision(tx, s, entryId, e.head) }
            : null;
        });
      });
    },
    readRevision(s: CmsScope, entryId: string, n: number, principal: unknown) {
      return run(s, 'cms:read', principal, (s) => {
        id(entryId);
        integer(n);
        return transaction((tx) => revision(tx, s, entryId, n));
      });
    },
    readPublished(s: CmsScope, entryId: string, principal: unknown) {
      return run(s, 'cms:read', principal, (s) => {
        id(entryId);
        return transaction((tx) => {
          const e = read<CmsEntry>(tx, s, 'entry', entryId);
          return e?.publishedRevision
            ? revision(tx, s, entryId, e.publishedRevision)
            : null;
        });
      });
    },
    publish(
      s: CmsScope,
      entryId: string,
      expected: number,
      principal: unknown,
    ) {
      return run(s, 'cms:publish', principal, async (s, p) => {
        id(entryId);
        integer(expected);
        const old = transaction((tx) => revision(tx, s, entryId, expected));
        await verifyMedia(old.values, p, s);
        p = await authorize(s, 'cms:publish', principal);
        return transaction((tx) =>
          commit(
            tx,
            s,
            entryId,
            expected,
            {
              type: old.type,
              typeVersion: old.typeVersion,
              values: old.values,
            },
            'published',
            p,
            expected,
          ),
        );
      });
    },
    restoreDraft(
      s: CmsScope,
      entryId: string,
      expected: number,
      source: number,
      principal: unknown,
    ) {
      return run(s, 'cms:write', principal, async (s, p) => {
        id(entryId);
        integer(expected);
        integer(source);
        const old = transaction((tx) => revision(tx, s, entryId, source));
        await verifyMedia(old.values, p, s);
        p = await authorize(s, 'cms:write', principal);
        return transaction((tx) =>
          commit(
            tx,
            s,
            entryId,
            expected,
            {
              type: old.type,
              typeVersion: old.typeVersion,
              values: old.values,
            },
            'draft',
            p,
            source,
          ),
        );
      });
    },
    status() {
      return {
        closed,
        pending: pending.size,
        adapter: 'sqlite',
        schemaVersion: 1,
      };
    },
    close() {
      if (closing) return closing;
      closed = true;
      controller.abort();
      return (closing = (async () => {
        const errors: unknown[] = [];
        await Promise.allSettled([...pending]);
        for (const dispose of cleanup.reverse())
          try {
            await dispose();
          } catch (error) {
            errors.push(error);
          }
        cleanup.length = 0;
        if (owned)
          try {
            await db.disconnect();
          } catch (error) {
            errors.push(error);
          }
        if (errors.length)
          throw fail('CLEANUP_FAILED', new AggregateError(errors));
      })());
    },
  };
  try {
    if (
      db.synchronousTransactions !== true ||
      typeof db.transactionSync !== 'function'
    )
      throw fail('UNSUPPORTED_ADAPTER');
    transaction((tx) => {
      if (options.migrate) {
        ok(
          tx.execute({
            op: 'createTable',
            table: JOURNAL,
            ifNotExists: true,
            columns: [
              { name: 'id', type: 'integer', primary: true },
              { name: 'checksum', type: 'text', notNull: true },
            ],
          }),
        );
      }
      const versions = ok(tx.select({ table: JOURNAL, limit: 2 }))
        .rows as Array<{ id: number; checksum: string }>;
      if (
        !Array.isArray(versions) ||
        versions.length > 1 ||
        (versions.length === 1 &&
          (versions[0].id !== 1 || versions[0].checksum !== checksum))
      )
        throw fail('SCHEMA_VERSION');
      if (!versions.length) {
        if (!options.migrate) throw fail('MIGRATION_REQUIRED');
        ok(
          tx.execute({
            op: 'createTable',
            table: TABLE,
            columns: schemaColumns.map((c) => ({ ...c })),
          }),
        );
        ok(
          tx.execute({
            op: 'createIndex',
            table: TABLE,
            name: 'zenix_content_scope_v1',
            columns: ['tenant', 'site', 'kind', 'id'],
          }),
        );
        one(tx.insert({ table: JOURNAL, values: { id: 1, checksum } }));
      } else
        ok(
          tx.select({
            table: TABLE,
            columns: [
              'key',
              'tenant',
              'site',
              'kind',
              'id',
              'revision',
              'document',
            ],
            limit: 1,
          }),
        );
    });
    for (const plugin of plugins)
      await plugin.setup({
        cms: api,
        signal: controller.signal,
        onDispose(callback: () => void | Promise<void>) {
          if (closed || typeof callback !== 'function' || cleanup.length >= 64)
            throw fail('INVALID_CLEANUP');
          cleanup.push(callback);
        },
      });
    if (closed) throw fail('CLOSED');
    return api;
  } catch (error) {
    try {
      await api.close();
    } catch { /* Preserve the startup failure after attempting cleanup of partially acquired resources. */ }
    throw error instanceof CmsError ? error : fail('STARTUP_FAILED', error);
  }
}
export type Cms = Awaited<ReturnType<typeof createCms>>;

export { CmsError, cmsRolePermissions } from './types.js';
export type {
  CmsOptions,
  CmsScope,
  CmsSite,
  CmsContentType,
  CmsEntry,
  CmsRevision,
  CmsMediaReference,
  CmsPermission,
  CmsField,
  CmsPlugin,
} from './types.js';
