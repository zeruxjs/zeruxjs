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
/** Private domain-record table; its name participates in the migration checksum. Private migration journal; initialized on the same transaction as the content schema. */
const TABLE = 'zenix_content_v1',
  JOURNAL = 'zenix_schema';
/** Ordered v1 columns; changing this data changes the migration checksum, not just formatting. */
const schemaColumns = [
  { name: 'key', type: 'text', primary: true },
  { name: 'tenant', type: 'text', notNull: true },
  { name: 'site', type: 'text', notNull: true },
  { name: 'kind', type: 'text', notNull: true },
  { name: 'id', type: 'text', notNull: true },
  { name: 'revision', type: 'integer', notNull: true },
  { name: 'document', type: 'text', notNull: true },
] as const;
/** Hash trusted schema/key JSON for identity without claiming permission or authorship.
 * @param {unknown} v - Trusted JSON-serializable schema/key data; not arbitrary executable content.
 * @returns {string} Lowercase SHA-256 of the serialized trusted value.
 */
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Deterministic v1 migration identity, independent of build time and application secrets. */
const checksum = hash([TABLE, schemaColumns, 'scope_kind_id_index_v1']);
/** Derive a stable record key from an already validated tenant/site/kind/item tuple.
 * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
 * @param {string} kind - Internal record kind participating in key and SQL scope predicates.
 * @param {string} item - Internal record identifier including any explicit schema/revision suffix.
 * @returns {string} Scoped tuple digest; explicit SQL scope predicates remain required.
 */
const key = (s: CmsScope, kind: string, item: string) =>
  hash([s.tenant, s.site, kind, item]);
/** Require native database success before inspecting rows or write counts.
 * @param {DatabaseResult} r - Native result checked without echoing stored values to public errors.
 * @returns {DatabaseResult} The same successful native result; no result values are copied or executed.
 * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
function ok(r: DatabaseResult) {
  if (!r || !r.ok) {
    throw fail('DATABASE_UNAVAILABLE');
  }
  return r;
}
/** Require exactly one affected row for create-only or optimistic domain writes.
 * @param {DatabaseResult} r - Native result checked without echoing stored values to public errors.
 * @returns {void} No value; throws when the write did not prove exactly one changed row.
 * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
function one(r: DatabaseResult) {
  /** Validated native result whose affected-row count must prove exactly one write. */
  const x = ok(r);
  if ((x.affectedCount ?? x.rowCount) !== 1) {
    throw fail('REVISION_CONFLICT');
  }
}
/** Build explicit scope predicates in addition to the hashed lookup key.
 * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
 * @param {string} kind - Internal record kind participating in key and SQL scope predicates.
 * @param {string} item - Internal record identifier including any explicit schema/revision suffix.
 * @returns {WhereClause} Structured key/tenant/site/kind predicates; no raw SQL is produced.
 * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
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
/** Read at most one scoped JSON record through the current transaction.
 * @param {SqliteSyncTransaction} tx - Borrowed synchronous transaction; never start async work or close it here.
 * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
 * @param {string} kind - Internal record kind participating in key and SQL scope predicates.
 * @param {string} item - Internal record identifier including any explicit schema/revision suffix.
 * @returns {T | null} Detached parsed document, or null when the exact scoped key is absent.
 * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
function read<T>(
  tx: SqliteSyncTransaction,
  s: CmsScope,
  kind: string,
  item: string
): T | null {
  /** Native result or stored revision inspected before returning scoped domain data. */
  const r = ok(
    tx.select({ table: TABLE, where: where(s, kind, item), limit: 2 })
  );
  if (!Array.isArray(r.rows) || r.rows.length > 1) {
    throw fail('CORRUPT_STORE');
  }
  if (!r.rows.length) {
    return null;
  }
  /** Single persisted JSON document; size/type checks precede JSON parsing. */
  const row = r.rows[0] as { document: unknown };
  if (
    typeof row.document !== 'string' ||
    Buffer.byteLength(row.document) > 65536
  ) {
    throw fail('CORRUPT_STORE');
  }
  try {
    return JSON.parse(row.document) as T;
  } catch (error) {
    throw fail('CORRUPT_STORE', error);
  }
}
/** Insert a scoped document only when its key does not already exist.
 * @param {SqliteSyncTransaction} tx - Borrowed synchronous transaction; never start async work or close it here.
 * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
 * @param {string} kind - Internal record kind participating in key and SQL scope predicates.
 * @param {string} item - Internal record identifier including any explicit schema/revision suffix.
 * @param {object} document - Trusted validated data serialized inside the caller transaction.
 * @param {number} revision - Stored optimistic row revision; defaults to 1.
 * @returns {void} No value; the caller transaction owns commit/rollback for this insert.
 * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
function insert(
  tx: SqliteSyncTransaction,
  s: CmsScope,
  kind: string,
  item: string,
  document: object,
  revision = 1
) {
  if (read(tx, s, kind, item)) {
    throw fail('REVISION_CONFLICT');
  }
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
    })
  );
}
/** Require an existing site in the same transaction and scope.
 * @param {SqliteSyncTransaction} tx - Borrowed synchronous transaction; never start async work or close it here.
 * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
 * @returns {void} No value; a missing scoped site fails before dependent content writes.
 * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
function site(tx: SqliteSyncTransaction, s: CmsScope) {
  if (!read<CmsSite>(tx, s, 'site', s.site)) {
    throw fail('SITE_NOT_FOUND');
  }
}
/** Open or borrow the explicitly selected SQLite domain store and initialize owned plugin resources.
 * @param {CmsOptions} options - Explicit host configuration, policies and ownership limits; never HTTP-selected input.
 * @returns {Promise<Cms>} Instance API after schema verification/plugin setup; the host must await close on shutdown.
 * @throws {CmsError} Rejects for invalid configuration, unsupported adapters, migration/version failures or plugin startup failure; partial resources are closed.
 */
export async function createCms(options: CmsOptions) {
  if (!options || options.adapter !== 'sqlite') {
    throw fail('UNSUPPORTED_ADAPTER');
  }
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
  ) {
    throw fail('INVALID_CONFIGURATION');
  }
  if (
    !options.connection &&
    (typeof options.filename !== 'string' ||
      !options.filename ||
      options.filename === ':memory:' ||
      options.filename.startsWith('file:') ||
      options.filename.includes('\0'))
  ) {
    throw fail('DURABLE_FILENAME_REQUIRED');
  }
  /** Validated pending-operation capacity; cancellation retains admission until real settlement. Validated deadline forwarded only to synchronous SQLite transactions. */
  const max = options.maxPending ?? 16,
    timeout = options.timeoutMs ?? 5000;
  integer(max, 1, 64);
  integer(timeout, 1, 60000);
  if (options.plugins !== undefined && !Array.isArray(options.plugins)) {
    throw fail('INVALID_PLUGINS');
  }
  /** Snapshot of explicit trusted startup plugins, validated before opening an owned database. */
  const plugins: NonNullable<CmsOptions['plugins']> = [
    ...(options.plugins ?? []),
  ];
  if (
    plugins.length > 16 ||
    plugins.some((p) => {
      if (!p || typeof p !== 'object') {
        throw fail('INVALID_PLUGINS');
      }
      id(p.id);
      return typeof p.setup !== 'function';
    }) ||
    new Set(plugins.map((p) => p.id)).size !== plugins.length
  ) {
    throw fail('INVALID_PLUGINS');
  }
  /** Owned or borrowed SQLite connector; only owned connections are disconnected by CMS cleanup. */
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
  /** Whether this instance opened the connector and therefore owns disconnect. */
  const owned = !options.connection;
  let closed = false,
    closing: Promise<void> | undefined;
  /** Instance-owned cancellation scope shared with host auth/media/plugin callbacks. Admitted work promises retained until actual settlement, including rejected/cancelled calls. Instance-owned plugin disposers, invoked LIFO after admitted work settles. */
  const controller = new AbortController(),
    pending = new Set<Promise<unknown>>(),
    cleanup: (() => void | Promise<void>)[] = [];
  /** Run one immediate synchronous transaction with the instance cancellation/deadline policy.
   * @param {(tx: SqliteSyncTransaction) => T} run - Synchronous work on the borrowed transaction; promises are not supported.
   * @returns {T} Callback result after the connector commits; callback/native failure rolls back.
   * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
   */
  // Keep auth/media awaits outside this synchronous transaction boundary.
  const transaction = <T>(run: (tx: SqliteSyncTransaction) => T) => {
    if (closed) {
      throw fail('CLOSED');
    }
    return db.transactionSync(run as any, {
      mode: 'immediate',
      timeoutMs: timeout,
      signal: controller.signal,
    }) as T;
  };
  /** Resolve a fresh host principal and enforce exact tenant/site permission.
   * @param {CmsScope} scope - Host-selected tenant/site boundary; no permission is inferred from its syntax.
   * @param {CmsPermission} permission - Required capability for this operation, separate from caller role strings.
   * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
   * @returns {Promise<TenantPrincipal>} Verified principal after cancellation checks; authentication remains host-owned.
   * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
   */
  const authorize = async (
    scope: CmsScope,
    permission: CmsPermission,
    principal: unknown
  ) => {
    controller.signal.throwIfAborted();
    /** Fresh host-verified principal; caller-supplied role or identity claims are never accepted directly. */
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
    ) {
      throw fail('DENIED');
    }
    controller.signal.throwIfAborted();
    return p;
  };
  /** Admit bounded scoped work, resolve fresh authorization and retain its slot until settlement.
   * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
   * @param {CmsPermission} permission - Required capability for this operation, separate from caller role strings.
   * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
   * @param {(s: CmsScope, p: TenantPrincipal) => T | Promise<T>} work - Admitted work executed only after fresh scoped authorization.
   * @returns {Promise<T>} Operation result; non-CMS failures become fixed-code errors with private causes.
   * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
   */
  const run = <T>(
    s: CmsScope,
    permission: CmsPermission,
    principal: unknown,
    work: (s: CmsScope, p: TenantPrincipal) => T | Promise<T>
  ): Promise<T> => {
    if (closed) {
      return Promise.reject(fail('CLOSED'));
    }
    if (pending.size >= max) {
      return Promise.reject(fail('OVERLOAD'));
    }
    let scope: CmsScope;
    try {
      scope = scoped(s);
    } catch (error) {
      return Promise.reject(error);
    }
    /** Owned operation promise; its finally releases capacity only after actual settlement. */
    const task = Promise.resolve()
      .then(async () => {
        /** Fresh host-verified principal; caller-supplied role or identity claims are never accepted directly. */
        const p = await authorize(scope, permission, principal);
        return work(scope, p);
      })
      .catch((e) => {
        throw e instanceof CmsError
          ? e
          : fail(
              controller.signal.aborted ? 'CANCELLED' : 'DATABASE_UNAVAILABLE',
              e
            );
      })
      .finally(() => pending.delete(task));
    pending.add(task);
    return task;
  };
  /** Authorize detached media references through the host files boundary before a write.
   * @param {CmsRevision['values']} data - Validated/detached content or media metadata, not trusted HTML.
   * @param {TenantPrincipal} principal - Already verified principal detached before the host media check; writes reauthorize again before commit.
   * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
   * @returns {Promise<void>} Resolves only when every media reference is allowed and cancellation has not intervened.
   * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
   */
  const verifyMedia = async (
    data: CmsRevision['values'],
    principal: TenantPrincipal,
    s: CmsScope
  ) => {
    // v is already validated scalar/media data; only media-shaped objects invoke host I/O.
    for (const v of Object.values(data)) {
      if (v && typeof v === 'object') {
        if (
          (await options.authorizeMedia(
            Object.freeze(structuredClone(v)),
            Object.freeze(structuredClone(principal)),
            Object.freeze({ ...s }),
            controller.signal
          )) !== true
        ) {
          throw fail('MEDIA_DENIED');
        }
        controller.signal.throwIfAborted();
      }
    }
  };
  /** Load and cross-check one immutable revision against its tenant/site/entry/version tuple.
   * @param {SqliteSyncTransaction} tx - Borrowed synchronous transaction; never start async work or close it here.
   * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
   * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
   * @param {number} n - Positive immutable revision number.
   * @returns {CmsRevision} Matching detached historical revision; absence or inconsistent identity rejects.
   * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
   */
  function revision(
    tx: SqliteSyncTransaction,
    s: CmsScope,
    entryId: string,
    n: number
  ) {
    /** Native result or stored revision inspected before returning scoped domain data. */
    const r = read<CmsRevision>(tx, s, 'revision', entryId + ':' + n);
    if (
      !r ||
      r.tenant !== s.tenant ||
      r.site !== s.site ||
      r.entryId !== entryId ||
      r.revision !== n
    ) {
      throw fail('REVISION_NOT_FOUND');
    }
    return r;
  }
  /** Atomically append an immutable revision and advance its optimistic entry head.
   * @param {SqliteSyncTransaction} tx - Borrowed synchronous transaction; never start async work or close it here.
   * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
   * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
   * @param {number | null} expected - Exact current head; null permits create-only draft insertion.
   * @param {Pick<CmsRevision, 'type' | 'typeVersion' | 'values'>} data - Validated/detached content or media metadata, not trusted HTML.
   * @param {'draft' | 'published'} state - State for the new immutable revision; it does not erase a prior published pointer.
   * @param {TenantPrincipal} p - Fresh host-verified principal recorded as actor for this commit.
   * @param {number} sourceRevision - Optional immutable source revision retained as publication/restore provenance.
   * @returns {{entry: CmsEntry, revision: CmsRevision}} New head and revision receipt; the enclosing synchronous transaction owns durability.
   * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
   */
  function commit(
    tx: SqliteSyncTransaction,
    s: CmsScope,
    entryId: string,
    expected: number | null,
    data: Pick<CmsRevision, 'type' | 'typeVersion' | 'values'>,
    state: 'draft' | 'published',
    p: TenantPrincipal,
    sourceRevision?: number
  ) {
    site(tx, s);
    /** Persisted entry/revision snapshot; optimistic checks and immutable history remain authoritative. */
    const old = read<CmsEntry>(tx, s, 'entry', entryId);
    if (expected === null ? !!old : !old || old.head !== expected) {
      throw fail('REVISION_CONFLICT');
    }
    if (
      old &&
      (old.type !== data.type || old.typeVersion !== data.typeVersion)
    ) {
      throw fail('TYPE_CHANGE_UNSUPPORTED');
    }
    /** Next immutable revision number, validated before any revision/head write. */
    const n = (old?.head ?? 0) + 1;
    integer(n);
    /** Detached new revision carrying verified actor/time and optional restore/publication provenance. */
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
    /** New head document; its published pointer remains independent of draft state. */
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
        })
      );
    } else {
      insert(tx, s, 'entry', entryId, entry, n);
    }
    return { entry, revision: next };
  }
  /** Instance-scoped API closures; merely importing this module does not open or mount anything. */
  const api = {
    /** Create a site under a fresh host-authorized tenant/site grant.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} name - Inert nonblank site name, at most 200 characters.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<CmsSite>} Detached committed site document; duplicates conflict rather than overwrite.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    createSite(s: CmsScope, name: string, principal: unknown) {
      return run(s, 'cms:site-manage', principal, (s) => {
        if (typeof name !== 'string' || !name.trim() || name.length > 200) {
          throw fail('INVALID_SITE');
        }
        return transaction((tx) => {
          /** Detached site document committed inside the current synchronous transaction. */
          const value: CmsSite = { ...s, name, createdAt: Date.now() };
          insert(tx, s, 'site', s.site, value);
          return value;
        });
      });
    },
    /** Read a private site after fresh scoped authorization.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<CmsSite | null>} Detached site document or null; this is not anonymous public delivery.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    readSite(s: CmsScope, principal: unknown) {
      return run(s, 'cms:read', principal, (s) =>
        transaction((tx) => read<CmsSite>(tx, s, 'site', s.site))
      );
    },
    /** Register an immutable numbered content schema with contiguous history.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {CmsContentType} input - Untrusted own data fields validated before they enter persistent state.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<CmsContentType>} Validated committed schema; earlier versions remain unchanged.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    registerContentType(
      s: CmsScope,
      input: CmsContentType,
      principal: unknown
    ) {
      return run(s, 'cms:type-manage', principal, (s) => {
        /** Immutable numbered content schema read or validated before deriving stored values. */
        const schema = contentType(input);
        return transaction((tx) => {
          site(tx, s);
          if (
            schema.version > 1 &&
            !read(tx, s, 'type', schema.id + ':' + (schema.version - 1))
          ) {
            throw fail('SCHEMA_HISTORY_REQUIRED');
          }
          insert(
            tx,
            s,
            'type',
            schema.id + ':' + schema.version,
            schema,
            schema.version
          );
          return schema;
        });
      });
    },
    /** Read one private immutable schema version under the exact scope.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} type - Registered content type identifier.
     * @param {number} version - Explicit immutable schema version, between 1 and 10,000.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<CmsContentType | null>} Detached schema or null for an absent version.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    readContentType(
      s: CmsScope,
      type: string,
      version: number,
      principal: unknown
    ) {
      return run(s, 'cms:read', principal, (s) => {
        id(type);
        integer(version, 1, 10000);
        return transaction((tx) =>
          read<CmsContentType>(tx, s, 'type', type + ':' + version)
        );
      });
    },
    /** Validate draft data, authorize referenced media, reauthorize and commit an optimistic revision.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
     * @param {number | null} expected - Exact current head; null permits create-only draft insertion.
     * @param {{ type: string; typeVersion: number; values: CmsRevision['values']; }} input - Untrusted own data fields validated before they enter persistent state.
     * @param {string} input.type - Registered immutable content type ID.
     * @param {number} input.typeVersion - Explicit existing schema version, 1 through 10,000.
     * @param {CmsRevision['values']} input.values - Inert field values checked against the schema and 32 KiB budget.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<{entry: CmsEntry, revision: CmsRevision}>} New draft/head receipt; an existing published pointer remains unchanged.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    saveDraft(
      s: CmsScope,
      entryId: string,
      expected: number | null,
      input: {
        type: string;
        typeVersion: number;
        values: CmsRevision['values'];
      },
      principal: unknown
    ) {
      return run(s, 'cms:write', principal, async (s, p) => {
        id(entryId);
        if (expected !== null) {
          integer(expected);
        }
        record(input, ['type', 'typeVersion', 'values']);
        id(input.type);
        integer(input.typeVersion, 1, 10000);
        /** Immutable numbered content schema read or validated before deriving stored values. */
        const schema = transaction((tx) =>
          read<CmsContentType>(
            tx,
            s,
            'type',
            input.type + ':' + input.typeVersion
          )
        );
        if (!schema) {
          throw fail('TYPE_NOT_FOUND');
        }
        /** Validated draft payload detached from request input before media authorization and commit. */
        const data = {
          type: input.type,
          typeVersion: input.typeVersion,
          values: values(contentType(schema), input.values),
        };
        await verifyMedia(data.values, p, s);
        // Media I/O may outlive a permission change; reauthorize immediately before commit.
        p = await authorize(s, 'cms:write', principal);
        return transaction((tx) =>
          commit(tx, s, entryId, expected, data, 'draft', p)
        );
      });
    },
    /** Read the private current entry head and its immutable revision.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<{entry: CmsEntry, revision: CmsRevision} | null>} Detached head/revision pair or null for an absent entry.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    readEntry(s: CmsScope, entryId: string, principal: unknown) {
      return run(s, 'cms:read', principal, (s) => {
        id(entryId);
        return transaction((tx) => {
          /** Persisted scoped head used to resolve the requested head or published revision. */
          const e = read<CmsEntry>(tx, s, 'entry', entryId);
          return e
            ? { entry: e, revision: revision(tx, s, entryId, e.head) }
            : null;
        });
      });
    },
    /** Read one private historical revision without mutating its contents.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
     * @param {number} n - Positive immutable revision number.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<CmsRevision>} Matching immutable historical record as a detached object.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    readRevision(s: CmsScope, entryId: string, n: number, principal: unknown) {
      return run(s, 'cms:read', principal, (s) => {
        id(entryId);
        integer(n);
        return transaction((tx) => revision(tx, s, entryId, n));
      });
    },
    /** Resolve the published pointer through a fresh private read permission check.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<CmsRevision | null>} Detached published revision or null; host routes still own public delivery policy.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    readPublished(s: CmsScope, entryId: string, principal: unknown) {
      return run(s, 'cms:read', principal, (s) => {
        id(entryId);
        return transaction((tx) => {
          /** Persisted scoped head used to resolve the requested head or published revision. */
          const e = read<CmsEntry>(tx, s, 'entry', entryId);
          return e?.publishedRevision
            ? revision(tx, s, entryId, e.publishedRevision)
            : null;
        });
      });
    },
    /** Reauthorize media and publish a new revision from the specified expected head.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
     * @param {number} expected - Exact positive current head; a stale head rejects without overwriting history.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<{entry: CmsEntry, revision: CmsRevision}>} New published revision/head receipt; a stale expected head cannot silently win.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    publish(
      s: CmsScope,
      entryId: string,
      expected: number,
      principal: unknown
    ) {
      return run(s, 'cms:publish', principal, async (s, p) => {
        id(entryId);
        integer(expected);
        /** Persisted entry/revision snapshot; optimistic checks and immutable history remain authoritative. */
        const old = transaction((tx) => revision(tx, s, entryId, expected));
        await verifyMedia(old.values, p, s);
        // Recheck permission after external media policy work, then commit under the head guard.
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
            expected
          )
        );
      });
    },
    /** Copy an authorized historical revision into a new optimistic draft.
     * @param {CmsScope} s - Validated exact tenant/site tuple; authorization is still checked by the owning operation.
     * @param {string} entryId - Bounded entry identifier in the exact tenant/site scope.
     * @param {number} expected - Exact positive current head; a stale head rejects without overwriting history.
     * @param {number} source - Existing historical revision copied into a new draft; never overwritten.
     * @param {unknown} principal - Opaque host session/proof, resolved freshly; never trusted principal JSON.
     * @returns {Promise<{entry: CmsEntry, revision: CmsRevision}>} New draft/head receipt with sourceRevision; prior history and publication remain intact.
     * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
     */
    restoreDraft(
      s: CmsScope,
      entryId: string,
      expected: number,
      source: number,
      principal: unknown
    ) {
      return run(s, 'cms:write', principal, async (s, p) => {
        id(entryId);
        integer(expected);
        integer(source);
        /** Persisted entry/revision snapshot; optimistic checks and immutable history remain authoritative. */
        const old = transaction((tx) => revision(tx, s, entryId, source));
        await verifyMedia(old.values, p, s);
        // Media I/O may outlive a permission change; reauthorize immediately before commit.
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
            source
          )
        );
      });
    },
    /** Inspect fixed instance counters without exposing tenant, path or content data.
     * @returns {{closed: boolean, pending: number, adapter: string, schemaVersion: number}} Snapshot of admission state and actual pending-work count.
     */
    status() {
      return {
        closed,
        pending: pending.size,
        adapter: 'sqlite',
        schemaVersion: 1,
      };
    },
    /** Stop admission, abort cooperative work, drain actual settlement and dispose owned resources.
     * @returns {Promise<void>} Cached cleanup promise; borrowed services/connectors are not closed.
     * @throws {CmsError} Rejects with CLEANUP_FAILED after attempting every owned resource cleanup.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      controller.abort();
      return (closing = (async () => {
        /** Cleanup failures collected after all owned resources have been attempted. */
        const errors: unknown[] = [];
        // Closed admission freezes this set of owners; signals alone do not prove settlement.
        await Promise.allSettled([...pending]);
        // dispose belongs to this instance and runs after actual admitted work settles.
        for (const dispose of cleanup.reverse()) {
          try {
            await dispose();
          } catch (error) {
            errors.push(error);
          }
        }
        cleanup.length = 0;
        if (owned) {
          try {
            await db.disconnect();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) {
          throw fail('CLEANUP_FAILED', new AggregateError(errors));
        }
      })());
    },
  };
  try {
    if (
      db.synchronousTransactions !== true ||
      typeof db.transactionSync !== 'function'
    ) {
      throw fail('UNSUPPORTED_ADAPTER');
    }
    // DDL, scope index and journal identity share the same native transaction.
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
          })
        );
      }
      /** Bounded migration journal rows; unknown/future identities reject instead of being repaired. */
      const versions = ok(tx.select({ table: JOURNAL, limit: 2 }))
        .rows as Array<{ id: number; checksum: string }>;
      if (
        !Array.isArray(versions) ||
        versions.length > 1 ||
        (versions.length === 1 &&
          (versions[0].id !== 1 || versions[0].checksum !== checksum))
      ) {
        throw fail('SCHEMA_VERSION');
      }
      if (!versions.length) {
        if (!options.migrate) {
          throw fail('MIGRATION_REQUIRED');
        }
        ok(
          tx.execute({
            op: 'createTable',
            table: TABLE,
            columns: schemaColumns.map((c) => ({ ...c })),
          })
        );
        ok(
          tx.execute({
            op: 'createIndex',
            table: TABLE,
            name: 'zenix_content_scope_v1',
            columns: ['tenant', 'site', 'kind', 'id'],
          })
        );
        one(tx.insert({ table: JOURNAL, values: { id: 1, checksum } }));
      } else {
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
          })
        );
      }
    });
    // plugin is explicitly host-registered trusted code; register cleanup immediately on acquisition.
    for (const plugin of plugins) {
      await plugin.setup({
        cms: api,
        signal: controller.signal,
        /** Register a plugin-owned disposer for reverse-order cleanup after work drains.
         * @param {() => void | Promise<void>} callback - Owned resource cleanup registered immediately after acquisition.
         * @returns {void} No value; callbacks are retained until close/startup rollback.
         * @throws {CmsError} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
         */
        onDispose(callback: () => void | Promise<void>) {
          if (
            closed ||
            typeof callback !== 'function' ||
            cleanup.length >= 64
          ) {
            throw fail('INVALID_CLEANUP');
          }
          cleanup.push(callback);
        },
      });
    }
    if (closed) {
      throw fail('CLOSED');
    }
    return api;
  } catch (error) {
    try {
      await api.close();
    } catch {
      /* Preserve the startup failure after attempting cleanup of partially acquired resources. */
    }
    throw error instanceof CmsError ? error : fail('STARTUP_FAILED', error);
  }
}
/** Instance contract inferred from the opt-in factory; no global singleton is created. */
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
