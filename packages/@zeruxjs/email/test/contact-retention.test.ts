import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryMailingContactStore,
  createMailingListService,
  sweepMailingContactRetention,
} from '../dist/index.js';
test('retention is dry-run by default, bounded, authorization-gated and version fenced', async () => {
  /** Synthetic process-local contact store; only fixture records may be erased. */
  const store = createMemoryMailingContactStore();
  /** Synthetic audience with a fixed clock for repeatable cutoff/continuation checks. */
  const contacts = createMailingListService({ store, now: () => 1000 });
  // Seed a finite synthetic audience; retention checks never touch operator records.
  for (let i = 0; i < 10; i++) {
    await contacts.upsert(`contact${i}@example.org`, ['old'], {
      cohort: 'old',
    });
  }
  /** Explicit held-recipient set consulted by host policy before erasure. */
  const blocked = new Set();
  let canErase = 0;
  /**
   * Enforce the explicit synthetic retention hold and count fresh policy checks.
   *
   * @param {object} contact - Private synthetic contact with a mailbox identity.
   * @returns {Promise<boolean>} True only when the contact is not held in this fixture.
   */
  const policy = async (contact) => {
    canErase++;
    return !blocked.has(contact.email);
  };
  /** Default preview receipt; it must perform no recipient deletion. */
  const dry = await sweepMailingContactRetention({
    store,
    olderThan: 2000,
    canErase: policy,
    pageSize: 3,
    maxScanned: 20,
  });
  assert.equal(dry.eligible, 10);
  assert.equal(dry.erased, 0);
  assert.equal((await contacts.page('old')).contacts.length, 10);
  /** First bounded approved deletion page; explicit continuation permits resumption. */
  const page = await sweepMailingContactRetention({
    store,
    olderThan: 2000,
    canErase: policy,
    dryRun: false,
    maxScanned: 4,
    pageSize: 2,
    now: () => 2000,
  });
  assert.equal(page.scanned, 4);
  assert.equal(page.erased, 4);
  assert.equal(page.done, false);
  /** Resumed approved page; previous deletions are not replayed. */
  const remaining = await sweepMailingContactRetention({
    store,
    olderThan: 2000,
    canErase: policy,
    dryRun: false,
    cursor: page.nextCursor,
    maxScanned: 20,
  });
  assert.equal(remaining.erased, 6);
  assert.equal((await contacts.page('old')).contacts.length, 0);
  await assert.rejects(
    sweepMailingContactRetention({ store, olderThan: 2000 }),
    /Invalid contact retention/
  );
  assert.ok(canErase >= 20);
});
test('retention respects policy, recent updates, CAS conflicts and does not leak PII into metrics', async () => {
  /** Synthetic process-local contact store; only fixture records may be erased. */
  const store = createMemoryMailingContactStore();
  /** Synthetic contact manager; membership is not consent or authorization. */
  const c = createMailingListService({ store, now: () => 100 });
  await c.upsert('recent@example.org', ['retained']);
  await c.upsert('held@example.org', ['retained']);
  /** Approved synthetic retention receipt checked for policy holds and address-free counters. */
  const result = await sweepMailingContactRetention({
    store,
    olderThan: 200,
    canErase: (person) => person.email !== 'held@example.org',
    dryRun: false,
  });
  assert.equal(result.erased, 1);
  assert.equal(result.skipped, 1);
  assert.equal(JSON.stringify(result).includes('@example.org'), false);
  await c.upsert('new@example.org', ['fresh']);
  /** Cutoff before fixture updates; no newer record is eligible. */
  const later = await sweepMailingContactRetention({
    store,
    olderThan: 50,
    canErase: () => true,
    dryRun: false,
  });
  assert.equal(later.erased, 0);
});

test('SQLite retention uses version-checked deletion across two independent connections', async () => {
  /** Standard ESM bridge for the existing CommonJS SQLite fixture export. */
  const { createRequire } = await import('node:module');
  /** Fixed module loader; never load caller-selected packages. */
  const require = createRequire(import.meta.url);
  /** Public built SQLite factory used only with an owned temporary database. */
  const { createConnector } = require('../../db-sqllite/dist/index.js');
  /** Public database contact adapter; native lifetime remains with the fixture. */
  const { createDatabaseMailingContactStore } =
    await import('../dist/index.js');
  /** Explicit temporary-directory ownership functions; never operate on user data. */
  const { mkdtemp, rm } = await import('node:fs/promises');
  /** Host temporary-directory locator for synthetic test state. */
  const { tmpdir } = await import('node:os');
  /** Native path composition for fixed names inside the owned temporary directory. */
  const { join } = await import('node:path');
  /** Owned temporary directory removed after both native handles settle. */
  const folder = await mkdtemp(join(tmpdir(), 'retention-'));
  /** Synthetic SQLite database path inside the owned temporary directory. */
  const file = join(folder, 'contacts.db');
  let c1;
  let c2;
  try {
    // Acquire inside cleanup ownership so partial startup cannot leak the first handle.
    c1 = await createConnector({ filename: file, driver: 'node' });
    c2 = await createConnector({ filename: file, driver: 'node' });
    /** Fixed private database context, unrelated to operator workspace storage. */
    const ctx = {
      connection: {
        slug: 'main',
        name: 'main',
        connector: '@zeruxjs/db-sqlite',
        options: {},
      },
    };
    /**
     * Borrow structured native operations from one owned synthetic SQLite handle.
     *
     * @param {object} c - Owned connector closed by the surrounding finally block.
     * @returns {object} Borrowed contact-store database port; no independent resource ownership.
     */
    const adapter = (c) =>
      Object.fromEntries(
        ['createTable', 'insert', 'select', 'update', 'delete'].map((op) => [
          op,
          (args) => c.execute({ op, ...args }, ctx),
        ])
      );
    /** First borrowed native contact-store port over the synthetic database. */
    const s1 = createDatabaseMailingContactStore(adapter(c1));
    /** Second connection port used to verify committed retention visibility. */
    const s2 = createDatabaseMailingContactStore(adapter(c2));
    /** Synthetic contact manager containing only generated old/held test records. */
    const contact = createMailingListService({ store: s1, now: () => 1000 });
    await contact.upsert('old@example.org', ['list']);
    await contact.upsert('hold@example.org', ['list']);
    /** Native retention receipt; held records must remain after authorized synthetic deletion. */
    const results = await sweepMailingContactRetention({
      store: s2,
      olderThan: 1500,
      canErase: (v) => v.email !== 'hold@example.org',
      dryRun: false,
    });
    assert.equal(results.erased, 1);
    assert.equal(results.skipped, 1);
    assert.equal((await contact.page('list')).contacts.length, 1);
    assert.equal(
      (await contact.page('list')).contacts[0].email,
      'hold@example.org'
    );
  } finally {
    // Attempt every owned cleanup even when an earlier disconnect rejects.
    try {
      await c1?.disconnect();
    } finally {
      try {
        await c2?.disconnect();
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    }
  }
});
