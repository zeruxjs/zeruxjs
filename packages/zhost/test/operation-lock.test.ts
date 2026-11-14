import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireOperationLock,
  withOperationLock,
} from '../dist/portless/operation-lock.js';
import { createProcessMarker } from '../dist/portless/lifecycle.js';
/** Existing skip predicate: true only when native creation identity is unsupported on this platform. */
const supported = !['linux', 'darwin', 'win32'].includes(process.platform);
/** Run an isolated asynchronous private-lock fixture and remove its directory after actual callback settlement.
 * @param {(dir: string) => Promise<unknown>} fn Assertions over the owned private namespace.
 * @returns {Promise<void>} Callback/cleanup settlement, preserving assertion failure. */
const fixture = async (fn) => {
  /** Owned private temporary state directory removed in the fixture cleanup. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-lock-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test(
  'serializes concurrent operations, releases after callback failure',
  { skip: supported },
  async () =>
    fixture(async (dir) => {
      /** First acquired identity-verified operation lock retained until the queued callback is observed waiting. */
      const first = await acquireOperationLock(dir);
      let entered = false;
      /** Concurrent locked callback result, blocked until the first ownership receipt releases. */
      const second = withOperationLock(
        dir,
        async () => {
          entered = true;
          return 42;
        },
        { timeoutMs: 1000, pollMs: 10 }
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(entered, false);
      first.release();
      assert.equal(await second, 42);
      await assert.rejects(
        withOperationLock(dir, async () => {
          throw Error('failed');
        }),
        /failed/
      );
      assert.equal(
        fs.existsSync(path.join(dir, '.proxy-operation.lock')),
        false
      );
    })
);

test(
  'refuses to steal a live owner and releases idempotently',
  { skip: supported },
  async () =>
    fixture(async (dir) => {
      /** Owned conditional lock handle, released explicitly by the fixture. */
      const lock = await acquireOperationLock(dir);
      await assert.rejects(
        acquireOperationLock(dir, { timeoutMs: 35, pollMs: 5 }),
        /already in progress/
      );
      lock.release();
      lock.release();
      assert.equal(fs.existsSync(lock.filename), false);
    })
);

test(
  'recovers dead process lock and refuses malformed lock',
  { skip: supported },
  async () =>
    fixture(async (dir) => {
      /** Fixed synthetic lock path used for stale/malformed marker assertions. */
      const filename = path.join(dir, '.proxy-operation.lock');
      fs.writeFileSync(
        filename,
        JSON.stringify({ ...createProcessMarker(), pid: 2147483646 }) + '\n'
      );
      /** Owned conditional lock handle, released explicitly by the fixture. */
      const lock = await acquireOperationLock(dir, { timeoutMs: 100 });
      lock.release();
      fs.writeFileSync(filename, 'bad-data');
      await assert.rejects(
        acquireOperationLock(dir, { timeoutMs: 100 }),
        /Unverifiable/
      );
    })
);

test(
  'does not delete replaced lock during release',
  { skip: supported },
  async () =>
    fixture(async (dir) => {
      /** Owned conditional lock handle, released explicitly by the fixture. */
      const lock = await acquireOperationLock(dir);
      fs.writeFileSync(
        lock.filename,
        JSON.stringify(createProcessMarker()) + '\n'
      );
      lock.release();
      assert.equal(fs.existsSync(lock.filename), true);
    })
);
