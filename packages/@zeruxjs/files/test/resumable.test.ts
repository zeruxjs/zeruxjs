import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLocalStorage,
  createFileManager,
  createS3Storage,
  createResumableUploads,
} from '../dist/index.js';
/** Hash synthetic fixture bytes without executing their content.
 * @param {Uint8Array} bytes - Synthetic binary input.
 * @returns {string} Lowercase SHA-256. */
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Synthetic verified initiating tenant/subject supplied by the fixture host. */
const actor = { tenant: 'tenant-a', subject: 'alice' };
/** Fixed tenant-prefixed synthetic object location. */
const address = { bucket: 'test-bucket', key: 'tenant-a/file.txt' };
/** Small deterministic full-object input for interrupted/resumed transfers. */
const data = Buffer.from('hello world');
/** Create exact synthetic integrity metadata.
 * @param {Uint8Array} bytes - Inert fixture bytes.
 * @returns {object} Byte size, SHA-256 and declared text MIME. */
const declaration = (bytes) => ({
  size: bytes.length,
  sha256: sha(bytes),
  contentType: 'text/plain',
});
/** Own a local synthetic journal/manager/coordinator and close in dependency order after assertions.
 * @param {Function} fn - Borrowed async assertions over owned fixture resources.
 * @param {object} extra - Trusted synthetic coordinator overrides, such as deterministic clock/caps.
 * @returns {Promise<void>} Assertions with isolated cleanup; no live provider calls.
 */
async function fixture(fn, extra = {}) {
  /** Owned temporary journal/object root; no operator state is read or deleted. */
  const root = await mkdtemp(join(tmpdir(), 'zx-resume-'));
  /** Fixture-owned policy-aware local/injected storage manager. */
  const files = createFileManager({
    stores: [
      {
        name: 'disk',
        driver: createLocalStorage({ root: join(root, 'objects') }),
        allowedBuckets: ['test-bucket'],
        keyPrefix: 'tenant-a/',
        maxBytes: 1024,
      },
    ],
  });
  /** Trusted synthetic coordinator configuration, reused for durable reload checks. */
  const config = {
    files,
    root: join(root, 'sessions'),
    authorize: (identity) =>
      identity.tenant === 'tenant-a' && identity.subject === 'alice',
    ...extra,
  };
  /** Fixture-owned resumable coordinator closed before its borrowed manager. */
  const uploads = createResumableUploads(config);
  try {
    await fn({ root, files, uploads, config });
  } finally {
    await uploads.close();
    await files.close();
    await rm(root, { recursive: true, force: true });
  }
}
test('local resume persists accepted parts across coordinator replacement; finalization is idempotent', () =>
  fixture(async ({ files, uploads, config, root }) => {
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, declaration(data));
    /** First immutable slice of the known whole-object fixture. */
    const a = data.subarray(0, 5);
    /** Remaining immutable slice, uploaded after the interrupted request. */
    const b = data.subarray(5);
    await uploads.uploadPart(actor, session.id, 1, a, declaration(a));
    await assert.rejects(
      uploads.uploadPart(
        actor,
        session.id,
        2,
        (async function* () {
          yield b.subarray(0, 2);
          throw new Error('interrupted');
        })(),
        declaration(b)
      ),
      /interrupted/
    );
    await uploads.close();
    /** Replacement coordinator reading the same private journal after the first closes. */
    const resumed = createResumableUploads(config);
    try {
      assert.equal(
        (await resumed.listParts(actor, session.id)).parts.length,
        1
      );
      await resumed.uploadPart(actor, session.id, 2, b, declaration(b));
      await assert.rejects(resumed.finalize(actor, session.id, [2, 1]), {
        code: 'UPLOAD_PART_ORDER',
      });
      /** Committed/idempotent finalization receipt checked against stored binary bytes. */
      const result = await resumed.finalize(actor, session.id, [1, 2]);
      assert.equal(result.size, data.length);
      assert.deepEqual(
        await resumed.finalize(actor, session.id, [1, 2]),
        result
      );
      assert.deepEqual(await files.get(address), data);
      assert.deepEqual(
        (await readdir(join(root, 'sessions', session.id))).sort(),
        ['session.json']
      );
    } finally {
      await resumed.close();
    }
  }));
test('wrong tenant/subject, denied writes, size/hash mismatches and immutable part conflicts reject', () =>
  fixture(async ({ uploads, files }) => {
    await assert.rejects(
      uploads.initiate(
        actor,
        { ...address, key: 'other/key' },
        declaration(data)
      ),
      /Key not allowed/
    );
    await assert.rejects(
      uploads.initiate(actor, address, { ...declaration(data), size: 1025 }),
      /size exceeds/
    );
    await assert.rejects(
      uploads.initiate(
        { ...actor, subject: 'mallory' },
        address,
        declaration(data)
      ),
      { code: 'UPLOAD_FORBIDDEN' }
    );
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, declaration(data));
    // Forged tenant or subject contexts must not inspect the accepted session.
    for (const identity of [
      { ...actor, tenant: 'tenant-b' },
      { ...actor, subject: 'mallory' },
    ]) {
      await assert.rejects(uploads.listParts(identity, session.id), {
        code: 'UPLOAD_FORBIDDEN',
      });
    }
    await assert.rejects(
      uploads.uploadPart(actor, session.id, 1, data, {
        size: data.length,
        sha256: '0'.repeat(64),
      }),
      { code: 'UPLOAD_INTEGRITY' }
    );
    await assert.rejects(
      uploads.uploadPart(actor, session.id, 1, data, {
        size: data.length - 1,
        sha256: sha(data),
      }),
      { code: 'UPLOAD_LENGTH' }
    );
    await uploads.uploadPart(actor, session.id, 1, data, declaration(data));
    assert.equal(
      (
        await uploads.uploadPart(
          actor,
          session.id,
          1,
          new Uint8Array(),
          declaration(data)
        )
      ).number,
      1,
      'identical receipt retries do not replace accepted content'
    );
    await assert.rejects(
      uploads.uploadPart(actor, session.id, 1, data, {
        size: data.length,
        sha256: '0'.repeat(64),
      }),
      { code: 'UPLOAD_PART_CONFLICT' }
    );
    await assert.rejects(uploads.listParts(actor, '../escape'), {
      code: 'UPLOAD_ID',
    });
    assert.equal(await files.stat(address), null);
  }));
test('full-object hash mismatch and staged symlinks never commit', () =>
  fixture(async ({ uploads, files, root }) => {
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, {
      ...declaration(data),
      sha256: '0'.repeat(64),
    });
    await uploads.uploadPart(actor, session.id, 1, data, declaration(data));
    await assert.rejects(uploads.finalize(actor, session.id, [1]), {
      code: 'UPLOAD_INTEGRITY',
    });
    assert.equal(await files.stat(address), null);
    /** Owned staged part path deliberately replaced with a symlink before verification. */
    const part = join(root, 'sessions', session.id, '1.part');
    await rm(part);
    await symlink('/etc/passwd', part);
    await assert.rejects(uploads.finalize(actor, session.id, [1]));
    assert.equal(await files.stat(address), null);
  }));
test('expired cleanup is paged, approval-gated, revision checked and retains healthy sessions', () => {
  let now = 1000;
  return fixture(
    async ({ uploads, config, root }) => {
      /** Session intentionally expired under the injected deterministic clock. */
      const first = await uploads.initiate(actor, address, declaration(data));
      await uploads.uploadPart(actor, first.id, 1, data, declaration(data));
      now = 1101;
      /** Healthy unexpired session which cleanup must preserve. */
      const current = await uploads.initiate(
        actor,
        { ...address, key: 'tenant-a/live.txt' },
        declaration(data)
      );
      await assert.rejects(
        uploads.uploadPart(actor, first.id, 2, data, declaration(data)),
        { code: 'UPLOAD_EXPIRED' }
      );
      let preview = await uploads.previewCleanup({ limit: 1 });
      if (!preview.items.length) {
        preview = await uploads.previewCleanup({
          cursor: preview.nextCursor,
          limit: 1,
        });
      }
      assert.equal(preview.items[0].id, first.id);
      await assert.rejects(uploads.cleanup(preview.items), {
        code: 'UPLOAD_FORBIDDEN',
      });
      await uploads.abort(actor, first.id);
      /** Separate coordinator with explicit trusted cleanup approval. */
      const approved = createResumableUploads({
        ...config,
        approveCleanup: () => true,
      });
      try {
        assert.equal(
          await approved.cleanup(preview.items),
          0,
          'changed session cannot be deleted using stale approval'
        );
        /** Fresh revision-bound cleanup preview replacing stale approval evidence. */
        const fresh = await approved.previewCleanup();
        assert.equal(await approved.cleanup(fresh.items), 1);
        assert.equal(
          (await approved.listParts(actor, current.id)).status,
          'open'
        );
        await assert.rejects(
          readFile(join(root, 'sessions', first.id, 'session.json')),
          { code: 'ENOENT' }
        );
      } finally {
        await approved.close();
      }
    },
    { now: () => now, ttlMs: 100 }
  );
});
test('concurrent create-only sessions produce one committed destination and preserve winner', () =>
  fixture(async ({ uploads, files }) => {
    /** First authorized create-only session racing for the same destination. */
    const a = await uploads.initiate(actor, address, declaration(data));
    /** Independent competing session; both may stage bytes but only one destination can win. */
    const b = await uploads.initiate(actor, address, declaration(data));
    await uploads.uploadPart(actor, a.id, 1, data, declaration(data));
    await uploads.uploadPart(actor, b.id, 1, data, declaration(data));
    /** Settled concurrent create-only outcomes; exactly one synthetic destination wins. */
    const results = await Promise.allSettled([
      uploads.finalize(actor, a.id, [1]),
      uploads.finalize(actor, b.id, [1]),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'FILE_EXISTS'
    );
    assert.deepEqual(await files.get(address), data);
  }));
test('pending ownership drains interruption and close preserves borrowed manager and resumable sessions', () =>
  fixture(async ({ uploads, files }) => {
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, declaration(data));
    let release, started;
    /** Start barrier proving ingestion holds actual pending capacity before close. */
    const ready = new Promise((r) => {
      started = r;
    });
    /** Fixture-controlled settlement barrier, released before draining the manager. */
    const wait = new Promise((r) => {
      release = r;
    });
    /** Held synthetic ingestion; release/settle it in finally before coordinator drain. */
    const part = uploads.uploadPart(
      actor,
      session.id,
      1,
      (async function* () {
        started();
        await wait;
        yield data;
      })(),
      declaration(data)
    );
    try {
      await ready;
      await assert.rejects(uploads.abort(actor, session.id), {
        code: 'UPLOAD_BUSY',
      });
      let closed = false;
      /** Observed coordinator drain; it must await the held source settlement. */
      const closing = uploads.close().then(() => (closed = true));
      await Promise.resolve();
      assert.equal(closed, false);
      await assert.rejects(uploads.listParts(actor, session.id), {
        code: 'UPLOAD_CLOSED',
      });
      release();
      await part;
      await closing;
      assert.equal(await files.stat(address), null);
    } finally {
      // Assertion failures must release the held source before outer coordinator drain.
      release();
      await part.catch(() => {});
    }
  }));
/** Emulate multipart integrity/commit/abort outcomes, including lost acknowledgement after commit.
 * @returns {object} Injected SDK fixture with bounded test objects and observable command history.
 */
function nativeFixture() {
  let id = 0,
    failPart = false,
    lostComplete = false,
    failAbort = false;
  /** In-memory provider multipart sessions, separate from durable coordinator journals. */
  const sessions = new Map();
  /** In-memory committed native objects, independent of active multipart sessions. */
  const objects = new Map();
  /** Recorded injected SDK commands used to prove no ambiguous completion replay. */
  const calls = [];
  return {
    calls,
    sessions,
    objects,
    set failPart(value) {
      failPart = value;
    },
    set lostComplete(value) {
      lostComplete = value;
    },
    set failAbort(value) {
      failAbort = value;
    },
    async send(command) {
      /** Trusted SDK command name used by the injected multipart dispatcher. */
      const name = command.constructor.name;
      /** Synthetic SDK command fields; these are never sent to a real endpoint. */
      const p = command.input;
      calls.push({ name, input: p });
      /** In-memory native object identity built from the fixed fixture bucket/key. */
      const key = p.Bucket + '/' + p.Key;
      if (name === 'CreateMultipartUploadCommand') {
        /** Synthetic native provider ID, distinct from the public coordinator ID. */
        const UploadId = 'native-' + ++id;
        sessions.set(UploadId, {
          metadata: p.Metadata,
          contentType: p.ContentType,
          parts: new Map(),
        });
        return { UploadId };
      }
      if (name === 'HeadObjectCommand') {
        /** Previously committed synthetic native object bytes/metadata. */
        const object = objects.get(key);
        if (!object) {
          throw { name: 'NotFound' };
        }
        return {
          ...object,
          ContentLength: object.body.length,
          ETag: '"native-object"',
          LastModified: new Date(),
        };
      }
      if (name === 'GetObjectCommand') {
        /** Previously committed synthetic native object bytes/metadata. */
        const object = objects.get(key);
        return {
          Body: (async function* () {
            yield object.body;
          })(),
        };
      }
      /** Authorized public session receipt; its ID alone is not a permission. */
      const session = sessions.get(p.UploadId);
      if (!session) {
        throw { name: 'NoSuchUpload' };
      }
      if (name === 'UploadPartCommand') {
        if (failPart) {
          failPart = false;
          throw new Error('backend unavailable');
        }
        session.parts.set(p.PartNumber, {
          PartNumber: p.PartNumber,
          Size: p.Body.length,
          body: Buffer.from(p.Body),
          ETag: '"part-' + p.PartNumber + '"',
          ChecksumSHA256: p.ChecksumSHA256,
        });
        return session.parts.get(p.PartNumber);
      }
      if (name === 'ListPartsCommand') {
        return { Parts: [...session.parts.values()], IsTruncated: false };
      }
      if (name === 'CompleteMultipartUploadCommand') {
        if (p.IfNoneMatch === '*' && objects.has(key)) {
          throw { name: 'PreconditionFailed' };
        }
        objects.set(key, {
          body: Buffer.concat(
            p.MultipartUpload.Parts.map(
              (part) => session.parts.get(part.PartNumber).body
            )
          ),
          Metadata: session.metadata,
          ContentType: session.contentType,
        });
        sessions.delete(p.UploadId);
        if (lostComplete) {
          lostComplete = false;
          throw new Error('response lost after commit');
        }
        return {};
      }
      if (name === 'AbortMultipartUploadCommand') {
        if (failAbort) {
          failAbort = false;
          throw new Error('abort backend unavailable');
        }
        sessions.delete(p.UploadId);
        return {};
      }
      throw new Error('unexpected command ' + name);
    },
  };
}
/** Own a disposable journal and injected native-multipart workflow for one test.
 * @param {Function} fn - Borrowed async assertions; coordinator drains before manager/temp cleanup.
 * @returns {Promise<void>} Synthetic test result; no cloud acceptance claim.
 */
async function nativeTest(fn) {
  /** Owned temporary journal/object root; no operator state is read or deleted. */
  const root = await mkdtemp(join(tmpdir(), 'zx-native-resume-'));
  /** Injected native multipart fixture; no broker/cloud transport is opened. */
  const client = nativeFixture();
  /** Fixture-owned policy-aware local/injected storage manager. */
  const files = createFileManager({
    stores: [{ name: 's3', driver: createS3Storage({ client }) }],
  });
  /** Fixture-owned resumable coordinator closed before its borrowed manager. */
  const uploads = createResumableUploads({
    files,
    root: join(root, 'sessions'),
    authorize: () => true,
  });
  try {
    await fn({ client, files, uploads });
  } finally {
    await uploads.close();
    await files.close();
    await rm(root, { recursive: true, force: true });
  }
}
test('native SDK multipart uses checksums/ordered receipts/conditional complete and reconciles lost response once', () =>
  nativeTest(async ({ client, files, uploads }) => {
    /** Exactly 5 MiB nonfinal native part meeting the provider minimum. */
    const first = Buffer.alloc(5 * 1024 * 1024, 7);
    /** Small final native part exempt from the nonfinal 5 MiB minimum. */
    const last = Buffer.from('end');
    /** Known aggregate bytes assembled only for the bounded native fixture. */
    const full = Buffer.concat([first, last]);
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, declaration(full));
    client.failPart = true;
    await assert.rejects(
      uploads.uploadPart(actor, session.id, 1, first, declaration(first)),
      /backend unavailable/
    );
    assert.equal((await uploads.listParts(actor, session.id)).parts.length, 0);
    await uploads.uploadPart(actor, session.id, 1, first, declaration(first));
    await uploads.uploadPart(actor, session.id, 2, last, declaration(last));
    client.lostComplete = true;
    await assert.rejects(
      uploads.finalize(actor, session.id, [1, 2]),
      /response lost/
    );
    await assert.rejects(uploads.abort(actor, session.id), {
      code: 'UPLOAD_UNCERTAIN',
    });
    assert.equal(
      (await uploads.finalize(actor, session.id, [1, 2])).size,
      full.length
    );
    assert.equal(
      client.calls.filter((c) => c.name === 'CompleteMultipartUploadCommand')
        .length,
      1
    );
    assert.equal(
      client.calls.find((c) => c.name === 'CompleteMultipartUploadCommand')
        .input.IfNoneMatch,
      '*'
    );
    assert.equal(
      client.calls.find((c) => c.name === 'CreateMultipartUploadCommand').input
        .ChecksumType,
      'COMPOSITE'
    );
    assert.deepEqual(await files.get(address), full);
  }));
test('native abort confirms removal, min-part limits reject and unsupported custom backends stay inert', () =>
  nativeTest(async ({ client, uploads }) => {
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, declaration(data));
    await uploads.uploadPart(
      actor,
      session.id,
      1,
      data.subarray(0, 5),
      declaration(data.subarray(0, 5))
    );
    await uploads.uploadPart(
      actor,
      session.id,
      2,
      data.subarray(5),
      declaration(data.subarray(5))
    );
    await assert.rejects(uploads.finalize(actor, session.id, [1, 2]), {
      code: 'UPLOAD_PART_SIZE',
    });
    await uploads.abort(actor, session.id);
    await uploads.abort(actor, session.id);
    assert.equal(client.sessions.size, 0);
    assert.equal(
      (await uploads.listParts(actor, session.id)).status,
      'aborted'
    );
    assert.equal(
      createS3Storage({ endpoint: 'https://unverified.example', client })
        .multipartOperations,
      undefined
    );
  }));

test('native abort failure keeps accepted parts and session for an explicit retry', () =>
  nativeTest(async ({ client, uploads }) => {
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, declaration(data));
    await uploads.uploadPart(actor, session.id, 1, data, declaration(data));
    client.failAbort = true;
    await assert.rejects(
      uploads.abort(actor, session.id),
      /abort backend unavailable/
    );
    assert.equal((await uploads.listParts(actor, session.id)).parts.length, 1);
    assert.equal(client.sessions.size, 1);
    await uploads.abort(actor, session.id);
    assert.equal(client.sessions.size, 0);
  }));
test('cancelled ingestion, session capacity and symlinked roots reject without a committed object', () =>
  fixture(async ({ uploads, files, root, config }) => {
    /** Authorized public session receipt; its ID alone is not a permission. */
    const session = await uploads.initiate(actor, address, declaration(data));
    /** Caller-owned already-aborted request signal; cancellation does not imply session abandonment. */
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      uploads.uploadPart(actor, session.id, 1, data, {
        ...declaration(data),
        signal: controller.signal,
      })
    );
    assert.equal((await uploads.listParts(actor, session.id)).parts.length, 0);
    /** Coordinator with a one-session ceiling used to test capacity rejection. */
    const bounded = createResumableUploads({ ...config, maxSessions: 1 });
    try {
      await assert.rejects(
        bounded.initiate(actor, address, declaration(data)),
        { code: 'UPLOAD_SESSION_LIMIT' }
      );
    } finally {
      await bounded.close();
    }
    /** Owned symlink path pointing at the temporary journal directory. */
    const alias = join(root, 'alias');
    await symlink(join(root, 'sessions'), alias);
    /** Coordinator rooted at the synthetic symlink, expected to reject before persistence. */
    const unsafe = createResumableUploads({ ...config, root: alias });
    try {
      await assert.rejects(unsafe.initiate(actor, address, declaration(data)), {
        code: 'UPLOAD_UNSAFE_PATH',
      });
    } finally {
      await unsafe.close();
    }
    assert.equal(await files.stat(address), null);
  }));
