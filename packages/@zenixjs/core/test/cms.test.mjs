import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCms, cmsRolePermissions } from '@zenixjs/core/cms';
import { version, status, capabilities } from '@zenixjs/core';
import { createConnector } from '@zeruxjs/db-sqlite';
const scope = { tenant: 'tenantA', site: 'siteA' },
  principal = {
    userId: 'operatorA',
    tenantId: 'tenantA',
    siteIds: ['siteA'],
    permissions: cmsRolePermissions.administrator,
  };
const schema = {
  id: 'article',
  version: 1,
  fields: {
    title: { kind: 'text', maxLength: 100, required: true },
    count: { kind: 'number', min: 0, max: 100 },
    hero: { kind: 'media' },
  },
};
const draft = (title) => ({
  type: 'article',
  typeVersion: 1,
  values: { title },
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zx083-'));
  const filename = path.join(dir, 'cms.sqlite');
  return {
    filename,
    dir,
    options: {
      adapter: 'sqlite',
      filename,
      migrate: true,
      resolvePrincipal: (p) => (p === principal ? principal : null),
      authorizeMedia: () => false,
    },
    async clear() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function initialize(cms) {
  await cms.createSite(scope, 'Test site', principal);
  await cms.registerContentType(scope, schema, principal);
}
test('draft conflicts, immutable publication/history, restore and file-backed durable reopen', async () => {
  const f = await fixture();
  let cms;
  try {
    cms = await createCms(f.options);
    await initialize(cms);
    const first = await cms.saveDraft(
      scope,
      'hello',
      null,
      draft('First'),
      principal,
    );
    assert.equal(first.revision.revision, 1);
    const attempts = await Promise.allSettled([
      cms.saveDraft(scope, 'hello', 1, draft('Second'), principal),
      cms.saveDraft(scope, 'hello', 1, draft('Concurrent'), principal),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      attempts.filter((r) => r.status === 'rejected')[0].reason.code,
      'REVISION_CONFLICT',
    );
    const published = await cms.publish(scope, 'hello', 2, principal);
    assert.equal(published.entry.publishedRevision, 3);
    await cms.restoreDraft(scope, 'hello', 3, 1, principal);
    assert.equal(
      (await cms.readEntry(scope, 'hello', principal)).revision.values.title,
      'First',
    );
    assert.equal(
      (await cms.readPublished(scope, 'hello', principal)).revision,
      3,
    );
    assert.equal(
      (await cms.readRevision(scope, 'hello', 1, principal)).values.title,
      'First',
    );
    await cms.close();
    const head = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {createCms,cmsRolePermissions} from '@zenixjs/core/cms';const cms=await createCms({adapter:'sqlite',filename:process.argv[1],migrate:false,resolvePrincipal:p=>p,authorizeMedia:()=>false});try{const p={userId:'reader',tenantId:'tenantA',siteIds:['siteA'],permissions:cmsRolePermissions.reader};console.log((await cms.readEntry({tenant:'tenantA',site:'siteA'},'hello',p)).entry.head);}finally{await cms.close();}`,
        f.filename,
      ],
      { encoding: 'utf8' },
    ).trim();
    assert.equal(head, '4');
    cms = await createCms({ ...f.options, migrate: false });
    assert.equal(
      (await cms.readEntry(scope, 'hello', principal)).entry.head,
      4,
    );
    assert.equal(
      (await cms.readContentType(scope, 'article', 1, principal)).fields.title
        .kind,
      'text',
    );
    assert.equal((await cms.readSite(scope, principal)).name, 'Test site');
    assert.equal(version, '0.0.4');
    assert.equal(status, 'placeholder');
    assert.equal(capabilities.durableAdapter, 'sqlite');
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('fresh identity/site permissions, malformed schemas/content and unowned media fail closed', async () => {
  const f = await fixture();
  let cms;
  try {
    cms = await createCms(f.options);
    await initialize(cms);
    await assert.rejects(
      cms.readSite({ tenant: 'tenantB', site: 'siteA' }, principal),
      (e) => e.code === 'DENIED',
    );
    await assert.rejects(
      cms.readSite({ tenant: 'tenantA', site: 'siteB' }, principal),
      (e) => e.code === 'DENIED',
    );
    await assert.rejects(
      cms.readSite(scope, { ...principal }),
      (e) => e.code === 'DENIED',
    );
    await assert.rejects(
      cms.registerContentType(
        scope,
        {
          id: 'broken',
          version: 1,
          fields: { title: { kind: 'execute', source: 'eval' } },
        },
        principal,
      ),
      (e) => e.code === 'INVALID_SCHEMA',
    );
    await assert.rejects(
      cms.saveDraft(
        scope,
        'bad',
        null,
        { ...draft('A'), values: { count: 5 } },
        principal,
      ),
      (e) => e.code === 'INVALID_CONTENT',
    );
    await assert.rejects(
      cms.saveDraft(
        scope,
        'bad',
        null,
        { ...draft('A'), values: { title: 'A', extra: 'X' } },
        principal,
      ),
      (e) => e.code === 'INVALID_CONTENT',
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
        principal,
      ),
      (e) => e.code === 'MEDIA_DENIED',
    );
    assert.equal(await cms.readEntry(scope, 'bad', principal), null);
    await assert.rejects(
      createCms({ ...f.options, adapter: 'postgres' }),
      (e) => e.code === 'UNSUPPORTED_ADAPTER',
    );
    await assert.rejects(
      createCms({ ...f.options, filename: ':memory:' }),
      (e) => e.code === 'DURABLE_FILENAME_REQUIRED',
    );
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('real SQLite rollback removes an inserted revision when head update fails; borrowed connection stays open', async () => {
  const f = await fixture();
  const db = await createConnector({ filename: f.filename, driver: 'node' });
  let cms,
    fail = false;
  const connection = {
    ...db,
    transactionSync: (run) =>
      db.transactionSync((tx) =>
        run({
          ...tx,
          update: (op) => {
            if (fail) throw Error('private database credential');
            return tx.update(op);
          },
        }),
      ),
  };
  try {
    cms = await createCms({ ...f.options, filename: undefined, connection });
    await initialize(cms);
    await cms.saveDraft(scope, 'hello', null, draft('First'), principal);
    fail = true;
    await assert.rejects(
      cms.saveDraft(scope, 'hello', 1, draft('Never committed'), principal),
      (e) =>
        e.code === 'DATABASE_UNAVAILABLE' && !e.message.includes('credential'),
    );
    assert.equal(
      (await cms.readEntry(scope, 'hello', principal)).entry.head,
      1,
    );
    await assert.rejects(
      cms.readRevision(scope, 'hello', 2, principal),
      (e) => e.code === 'REVISION_NOT_FOUND',
    );
    await cms.close();
    assert.equal(
      db.transactionSync((tx) => tx.select({ table: 'zenix_schema' })).ok,
      true,
    );
  } finally {
    await cms?.close();
    await db.disconnect();
    await f.clear();
  }
});
test('plugin setup failure rolls back acquired resources, no routes; close drains resolver and closes admission', async () => {
  const f = await fixture();
  let cleaned = 0,
    cms;
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
      (e) =>
        e.code === 'STARTUP_FAILED' && !e.message.includes('private startup'),
    );
    assert.equal(cleaned, 1);
    cms = await createCms({
      ...f.options,
      migrate: false,
      plugins: [
        {
          id: 'owned',
          setup({ onDispose }) {
            onDispose(() => cleaned++);
          },
        },
      ],
    });
    await cms.close();
    await cms.close();
    assert.equal(cleaned, 2);
    await assert.rejects(
      cms.readSite(scope, principal),
      (e) => e.code === 'CLOSED',
    );
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('migration DDL and journal rollback together on dependency failure; future schemas reject', async () => {
  const f = await fixture();
  const db = await createConnector({ filename: f.filename, driver: 'node' });
  try {
    const connection = {
      ...db,
      transactionSync: (run) =>
        db.transactionSync((tx) =>
          run({
            ...tx,
            execute: (op) => {
              if (op.op === 'createIndex') throw Error('migration failure');
              return tx.execute(op);
            },
          }),
        ),
    };
    await assert.rejects(
      createCms({ ...f.options, filename: undefined, connection }),
      (e) => e.code === 'STARTUP_FAILED',
    );
    assert.throws(
      () =>
        db.transactionSync((tx) => {
          const result = tx.select({ table: 'zenix_schema' });
          if (!result.ok) throw Error('table absent');
        }),
      /table absent|no such table/,
    );
    const cms = await createCms({
      ...f.options,
      filename: undefined,
      connection: db,
    });
    await cms.close();
    db.transactionSync((tx) => {
      const result = tx.update({
        table: 'zenix_schema',
        values: { id: 2 },
        where: { field: 'id', operator: 'eq', value: 1 },
      });
      assert.equal(result.ok, true);
    });
    await assert.rejects(
      createCms({ ...f.options, filename: undefined, connection: db }),
      (e) => e.code === 'SCHEMA_VERSION',
    );
  } finally {
    await db.disconnect();
    await f.clear();
  }
});
test('closing cancels and drains actual principal lookup before disposal', async () => {
  const f = await fixture();
  let started, retained;
  const begun = new Promise((r) => (started = r));
  let disposed = false,
    cms;
  try {
    cms = await createCms({
      ...f.options,
      resolvePrincipal: (_p, { signal }) =>
        new Promise((resolve, reject) => {
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
    const pending = cms.readSite(scope, principal);
    await begun;
    assert.equal(cms.status().pending, 1);
    await cms.close();
    await assert.rejects(pending, (e) => e.code === 'CANCELLED');
    assert.equal(cms.status().pending, 0);
    assert.equal(disposed, true);
    assert.throws(
      () => retained(() => {}),
      (e) => e.code === 'INVALID_CLEANUP',
    );
  } finally {
    await cms?.close();
    await f.clear();
  }
});
test('media authorization is rechecked at publish and immutable content remains detached', async () => {
  const f = await fixture();
  let allow = true,
    calls = 0,
    cms;
  try {
    cms = await createCms({
      ...f.options,
      authorizeMedia: (ref) => {
        calls++;
        return allow && ref.sha256 === 'a'.repeat(64);
      },
    });
    await initialize(cms);
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
      principal,
    );
    saved.revision.values.title = 'Changed outside store';
    assert.equal(
      (await cms.readRevision(scope, 'photo', 1, principal)).values.title,
      'Image',
    );
    allow = false;
    await assert.rejects(
      cms.publish(scope, 'photo', 1, principal),
      (e) => e.code === 'MEDIA_DENIED',
    );
    assert.equal(
      (await cms.readEntry(scope, 'photo', principal)).entry.head,
      1,
    );
    allow = true;
    await cms.publish(scope, 'photo', 1, principal);
    assert.equal(
      (await cms.readPublished(scope, 'photo', principal)).values.hero
        .versionId,
      'v1',
    );
    assert.equal(calls, 3);
  } finally {
    await cms?.close();
    await f.clear();
  }
});
