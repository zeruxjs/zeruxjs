import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCms,
  cmsRolePermissions,
  CmsError,
  type Cms,
  type CmsOptions,
  type CmsContentType,
} from '@zenixjs/core/cms';
import { version, status, capabilities } from '@zenixjs/core';
import { createConnector, type SqliteConnector } from '@zeruxjs/db-sqlite';
/** Synthetic tenant/site boundary shared only by these isolated fixtures. Synthetic verified identity; the resolver accepts only this exact fixture object. */
const scope = { tenant: 'tenantA', site: 'siteA' },
  principal = {
    userId: 'operatorA',
    tenantId: 'tenantA',
    siteIds: ['siteA'],
    permissions: cmsRolePermissions.administrator,
  };
/** Bounded synthetic content type covering text, numeric and media policies. */
const schema: CmsContentType = {
  id: 'article',
  version: 1,
  fields: {
    title: { kind: 'text', maxLength: 100, required: true },
    count: { kind: 'number', min: 0, max: 100 },
    hero: { kind: 'media' },
  },
};
/** Create synthetic draft inputs without writing or evaluating them.
 * @param {string} title - Synthetic fixture title; never evaluated or treated as trusted HTML.
 * @returns {{type: string, typeVersion: number, values: {title: string}}} Fresh fixture payload for a single optimistic save.
 */
const draft = (title: string): Parameters<Cms['saveDraft']>[3] => ({
  type: 'article',
  typeVersion: 1,
  values: { title },
});
/** Require an expected stored record before examining persisted fields.
 * @param {T | null | undefined} value - Nullable public read result.
 * @returns {T} Present record; absence fails the fixture.
 * @template T
 */
function present<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}
/** Allocate an isolated file-backed SQLite fixture and explicit synthetic host policies.
 * @returns {Promise<{filename: string, dir: string, options: object, clear: () => Promise<void>}>} Owned fixture; tests close active connectors/CMS instances before clear removes its files.
 */
async function fixture(): Promise<{
  filename: string;
  dir: string;
  options: CmsOptions;
  clear(): Promise<void>;
}> {
  /** Owned temporary SQLite directory removed by fixture cleanup. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zx083-'));
  /** Private file-backed SQLite path inside the owned temporary directory. */
  const filename = path.join(dir, 'cms.sqlite');
  return {
    filename,
    dir,
    options: {
      adapter: 'sqlite',
      filename,
      migrate: true,
      resolvePrincipal: (p: unknown) => (p === principal ? principal : null),
      authorizeMedia: () => false,
    },
    /** Remove only the fixture-owned temporary SQLite directory after resources are closed.
     * @returns {Promise<void>} Resolves after owned fixture files are removed.
     */
    async clear() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
/** Create the synthetic site/schema through the real authorized domain API.
 * @param {import("@zenixjs/core/cms").Cms} cms - Borrowed domain instance; this helper does not close it.
 * @returns {Promise<void>} Resolves after two separate committed fixture operations; not one atomic batch.
 * @throws {Error} Propagates the relevant authorization, validation, revision, native-store or cancellation failure; private causes remain restricted.
 */
async function initialize(cms: Cms): Promise<void> {
  await cms.createSite(scope, 'Test site', principal);
  await cms.registerContentType(scope, schema, principal);
}
test('draft conflicts, immutable publication/history, restore and file-backed durable reopen', async () => {
  /** Owned fixture paths/configuration; finally closes resources before removing its files. */
  const f = await fixture();
  let cms: Cms | undefined;
  try {
    cms = await createCms(f.options);
    await initialize(cms);
    /** First committed draft proving initial revision numbering and detached persisted state. */
    const first = await cms.saveDraft(
      scope,
      'hello',
      null,
      draft('First'),
      principal
    );
    assert.equal(first.revision.revision, 1);
    /** Concurrent revision contenders; exactly one may replace the expected head. */
    const attempts = await Promise.allSettled([
      cms.saveDraft(scope, 'hello', 1, draft('Second'), principal),
      cms.saveDraft(scope, 'hello', 1, draft('Concurrent'), principal),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    /** Losing writer must receive a real revision conflict. */
    const rejected = attempts.find((r) => r.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.ok(rejected.reason instanceof CmsError);
    assert.equal(rejected.reason.code, 'REVISION_CONFLICT');
    /** Published commit receipt with a distinct immutable revision and pointer. */
    const published = await cms.publish(scope, 'hello', 2, principal);
    assert.equal(published.entry.publishedRevision, 3);
    await cms.restoreDraft(scope, 'hello', 3, 1, principal);
    assert.equal(
      present(await cms.readEntry(scope, 'hello', principal)).revision.values
        .title,
      'First'
    );
    assert.equal(
      present(await cms.readPublished(scope, 'hello', principal)).revision,
      3
    );
    assert.equal(
      present(await cms.readRevision(scope, 'hello', 1, principal)).values
        .title,
      'First'
    );
    await cms.close();
    /** Separate-process read result proving that the closed file-backed store reloads durably. */
    const head = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {createCms,cmsRolePermissions} from '@zenixjs/core/cms';const cms=await createCms({adapter:'sqlite',filename:process.argv[1],migrate:false,resolvePrincipal:p=>p,authorizeMedia:()=>false});try{const p={userId:'reader',tenantId:'tenantA',siteIds:['siteA'],permissions:cmsRolePermissions.reader};console.log((await cms.readEntry({tenant:'tenantA',site:'siteA'},'hello',p)).entry.head);}finally{await cms.close();}`,
        f.filename,
      ],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(head, '4');
    cms = await createCms({ ...f.options, migrate: false });
    assert.equal(
      present(await cms.readEntry(scope, 'hello', principal)).entry.head,
      4
    );
    assert.equal(
      present(await cms.readContentType(scope, 'article', 1, principal)).fields
        .title.kind,
      'text'
    );
    assert.equal(
      present(await cms.readSite(scope, principal)).name,
      'Test site'
    );
    assert.equal(version, '0.0.4');
    assert.equal(status, 'placeholder');
    assert.equal(capabilities.durableAdapter, 'sqlite');
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('fresh identity/site permissions, malformed schemas/content and unowned media fail closed', async () => {
  /** Owned fixture paths/configuration; finally closes resources before removing its files. */
  const f = await fixture();
  let cms: Cms | undefined;
  try {
    cms = await createCms(f.options);
    await initialize(cms);
    await assert.rejects(
      cms.readSite({ tenant: 'tenantB', site: 'siteA' }, principal),
      (e: unknown) => e instanceof CmsError && e.code === 'DENIED'
    );
    await assert.rejects(
      cms.readSite({ tenant: 'tenantA', site: 'siteB' }, principal),
      (e: unknown) => e instanceof CmsError && e.code === 'DENIED'
    );
    await assert.rejects(
      cms.readSite(scope, { ...principal }),
      (e: unknown) => e instanceof CmsError && e.code === 'DENIED'
    );
    await assert.rejects(
      Reflect.apply(cms.registerContentType, cms, [
        scope,
        {
          id: 'broken',
          version: 1,
          fields: { title: { kind: 'execute', source: 'eval' } },
        },
        principal,
      ]),
      (e: unknown) => e instanceof CmsError && e.code === 'INVALID_SCHEMA'
    );
    await assert.rejects(
      cms.saveDraft(
        scope,
        'bad',
        null,
        { ...draft('A'), values: { count: 5 } },
        principal
      ),
      (e: unknown) => e instanceof CmsError && e.code === 'INVALID_CONTENT'
    );
    await assert.rejects(
      cms.saveDraft(
        scope,
        'bad',
        null,
        { ...draft('A'), values: { title: 'A', extra: 'X' } },
        principal
      ),
      (e: unknown) => e instanceof CmsError && e.code === 'INVALID_CONTENT'
    );
    await assert.rejects(
      cms.saveDraft(
        scope,
        'bad',
        null,
        {
          ...draft('A'),
          values: {
            title: 'A',
            hero: {
              bucket: 'private',
              key: 'tenantA/image',
              versionId: 'v1',
              sha256: 'a'.repeat(64),
            },
          },
        },
        principal
      ),
      (e: unknown) => e instanceof CmsError && e.code === 'MEDIA_DENIED'
    );
    assert.equal(await cms.readEntry(scope, 'bad', principal), null);
    await assert.rejects(
      Reflect.apply(createCms, undefined, [
        { ...f.options, adapter: 'postgres' },
      ]),
      (e: unknown) => e instanceof CmsError && e.code === 'UNSUPPORTED_ADAPTER'
    );
    await assert.rejects(
      createCms({ ...f.options, filename: ':memory:' }),
      (e: unknown) =>
        e instanceof CmsError && e.code === 'DURABLE_FILENAME_REQUIRED'
    );
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('real SQLite rollback removes an inserted revision when head update fails; borrowed connection stays open', async () => {
  /** Owned fixture paths/configuration; finally closes resources before removing its files. */
  const f = await fixture();
  /** Fixture-owned native SQLite connector; borrowed CMS instances must leave it open. */
  const db = await createConnector({ filename: f.filename, driver: 'node' });
  let cms: Cms | undefined;
  let fail = false;
  /** Injected connector wrapper simulating one native failure without replacing transaction ownership. */
  const connection: SqliteConnector = {
    ...db,
    transactionSync: (run) =>
      db.transactionSync((tx) =>
        run({
          ...tx,
          update: (op) => {
            if (fail) {
              throw Error('private database credential');
            }
            return tx.update(op);
          },
        })
      ),
  };
  try {
    cms = await createCms({ ...f.options, filename: undefined, connection });
    await initialize(cms);
    await cms.saveDraft(scope, 'hello', null, draft('First'), principal);
    fail = true;
    await assert.rejects(
      cms.saveDraft(scope, 'hello', 1, draft('Never committed'), principal),
      (e: unknown) =>
        e instanceof CmsError &&
        e.code === 'DATABASE_UNAVAILABLE' &&
        !e.message.includes('credential')
    );
    assert.equal(
      present(await cms.readEntry(scope, 'hello', principal)).entry.head,
      1
    );
    await assert.rejects(
      cms.readRevision(scope, 'hello', 2, principal),
      (e: unknown) => e instanceof CmsError && e.code === 'REVISION_NOT_FOUND'
    );
    await cms.close();
    assert.equal(
      db.transactionSync((tx) => tx.select({ table: 'zenix_schema' })).ok,
      true
    );
  } finally {
    await cms?.close();
    await db.disconnect();
    await f.clear();
  }
});
test('plugin setup failure rolls back acquired resources, no routes; close drains resolver and closes admission', async () => {
  /** Owned fixture paths/configuration; finally closes resources before removing its files. */
  const f = await fixture();
  let cleaned = 0;
  let cms: Cms | undefined;
  try {
    await assert.rejects(
      createCms({
        ...f.options,
        plugins: [
          {
            id: 'first',
            setup({ onDispose, signal }) {
              onDispose(() => {
                assert.equal(signal.aborted, true);
                cleaned++;
              });
            },
          },
          {
            id: 'broken',
            setup() {
              throw Error('private startup detail');
            },
          },
        ],
      }),
      (e: unknown) =>
        e instanceof CmsError &&
        e.code === 'STARTUP_FAILED' &&
        !e.message.includes('private startup')
    );
    assert.equal(cleaned, 1);
    cms = await createCms({
      ...f.options,
      migrate: false,
      plugins: [
        {
          id: 'owned',
          setup({ onDispose }) {
            onDispose(() => {
              cleaned++;
            });
          },
        },
      ],
    });
    await cms.close();
    await cms.close();
    assert.equal(cleaned, 2);
    await assert.rejects(
      cms.readSite(scope, principal),
      (e: unknown) => e instanceof CmsError && e.code === 'CLOSED'
    );
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('migration DDL and journal rollback together on dependency failure; future schemas reject', async () => {
  /** Owned fixture paths/configuration; finally closes resources before removing its files. */
  const f = await fixture();
  /** Fixture-owned native SQLite connector; borrowed CMS instances must leave it open. */
  const db = await createConnector({ filename: f.filename, driver: 'node' });
  try {
    /** Injected connector wrapper simulating one native failure without replacing transaction ownership. */
    const connection: SqliteConnector = {
      ...db,
      transactionSync: (run) =>
        db.transactionSync((tx) =>
          run({
            ...tx,
            execute: (op) => {
              if (op.op === 'createIndex') {
                throw Error('migration failure');
              }
              return tx.execute(op);
            },
          })
        ),
    };
    await assert.rejects(
      createCms({ ...f.options, filename: undefined, connection }),
      (e: unknown) => e instanceof CmsError && e.code === 'STARTUP_FAILED'
    );
    assert.throws(
      () =>
        db.transactionSync((tx) => {
          /** Actual native result inspected for rollback or migration correctness. */
          const result = tx.select({ table: 'zenix_schema' });
          if (!result.ok) {
            throw Error('table absent');
          }
        }),
      /table absent|no such table/
    );
    /** Owned CMS instance closed before the fixture connector/files are removed. */
    const cms = await createCms({
      ...f.options,
      filename: undefined,
      connection: db,
    });
    await cms.close();
    db.transactionSync((tx) => {
      /** Actual native result inspected for rollback or migration correctness. */
      const result = tx.update({
        table: 'zenix_schema',
        values: { id: 2 },
        where: { field: 'id', operator: 'eq', value: 1 },
      });
      assert.equal(result.ok, true);
    });
    await assert.rejects(
      createCms({ ...f.options, filename: undefined, connection: db }),
      (e: unknown) => e instanceof CmsError && e.code === 'SCHEMA_VERSION'
    );
  } finally {
    await db.disconnect();
    await f.clear();
  }
});
test('closing cancels and drains actual principal lookup before disposal', async () => {
  /** Owned fixture paths/configuration; finally closes resources before removing its files. */
  const f = await fixture();
  let started: (() => void) | undefined;
  let retained:
    | Parameters<
        NonNullable<CmsOptions['plugins']>[number]['setup']
      >[0]['onDispose']
    | undefined;
  /** Synchronization barrier proving the principal resolver has started before close. */
  const begun = new Promise<void>((r) => {
    started = r;
  });
  let disposed = false;
  let cms: Cms | undefined;
  try {
    cms = await createCms({
      ...f.options,
      resolvePrincipal: (_p, { signal }) =>
        new Promise((resolve, reject) => {
          assert.ok(started);
          started();
          signal.addEventListener('abort', () => reject(Error('aborted')), {
            once: true,
          });
        }),
      plugins: [
        {
          id: 'lifecycle',
          setup({ onDispose }) {
            retained = onDispose;
            onDispose(() => {
              disposed = true;
            });
          },
        },
      ],
    });
    /** Admitted read promise; close must cancel/drain it before plugin cleanup. */
    const pending = cms.readSite(scope, principal);
    await begun;
    assert.equal(cms.status().pending, 1);
    await cms.close();
    await assert.rejects(
      pending,
      (e: unknown) => e instanceof CmsError && e.code === 'CANCELLED'
    );
    assert.equal(cms.status().pending, 0);
    assert.equal(disposed, true);
    /** Snapshot the retained callback after setup before invoking it after closure. */
    const registerAfterClose = retained;
    assert.ok(registerAfterClose);
    assert.throws(
      () => registerAfterClose(() => {}),
      (e: unknown) => e instanceof CmsError && e.code === 'INVALID_CLEANUP'
    );
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('media authorization is rechecked at publish and immutable content remains detached', async () => {
  /** Owned fixture paths/configuration; finally closes resources before removing its files. */
  const f = await fixture();
  let allow = true;
  let calls = 0;
  let cms: Cms | undefined;
  try {
    cms = await createCms({
      ...f.options,
      authorizeMedia: (ref) => {
        calls++;
        return allow && ref.sha256 === 'a'.repeat(64);
      },
    });
    await initialize(cms);
    /** Commit receipt mutated only outside the store to verify detached revision data. */
    const saved = await cms.saveDraft(
      scope,
      'photo',
      null,
      {
        type: 'article',
        typeVersion: 1,
        values: {
          title: 'Image',
          hero: {
            bucket: 'private',
            key: 'tenantA/image',
            versionId: 'v1',
            sha256: 'a'.repeat(64),
          },
        },
      },
      principal
    );
    saved.revision.values.title = 'Changed outside store';
    assert.equal(
      present(await cms.readRevision(scope, 'photo', 1, principal)).values
        .title,
      'Image'
    );
    allow = false;
    await assert.rejects(
      cms.publish(scope, 'photo', 1, principal),
      (e: unknown) => e instanceof CmsError && e.code === 'MEDIA_DENIED'
    );
    assert.equal(
      present(await cms.readEntry(scope, 'photo', principal)).entry.head,
      1
    );
    allow = true;
    await cms.publish(scope, 'photo', 1, principal);
    /** Published media metadata must be a reference, not another scalar field shape. */
    const hero = present(await cms.readPublished(scope, 'photo', principal))
      .values.hero;
    assert.ok(hero && typeof hero === 'object');
    assert.equal(hero.versionId, 'v1');
    assert.equal(calls, 3);
  } finally {
    await cms?.close();
    await f.clear();
  }
});
