import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireOperationLock, withOperationLock } from '../dist/portless/operation-lock.js';
import { createProcessMarker } from '../dist/portless/lifecycle.js';
const supported = !['linux','darwin','win32'].includes(process.platform);
const fixture = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-lock-'));
  try { await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('serializes concurrent operations, releases after callback failure', { skip: supported }, async () => fixture(async dir => {
  const first = await acquireOperationLock(dir);
  let entered = false;
  const second = withOperationLock(dir, async () => { entered = true; return 42; }, { timeoutMs: 1000, pollMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(entered, false);
  first.release();
  assert.equal(await second, 42);
  await assert.rejects(withOperationLock(dir, async () => { throw Error('failed'); }), /failed/);
  assert.equal(fs.existsSync(path.join(dir, '.proxy-operation.lock')), false);
}));

test('refuses to steal a live owner and releases idempotently', { skip: supported }, async () => fixture(async dir => {
  const lock = await acquireOperationLock(dir);
  await assert.rejects(acquireOperationLock(dir, { timeoutMs: 35, pollMs: 5 }), /already in progress/);
  lock.release(); lock.release();
  assert.equal(fs.existsSync(lock.filename), false);
}));

test('recovers dead process lock and refuses malformed lock', { skip: supported }, async () => fixture(async dir => {
  const filename = path.join(dir, '.proxy-operation.lock');
  fs.writeFileSync(filename, JSON.stringify({...createProcessMarker(), pid: 2147483646}) + '\n');
  const lock = await acquireOperationLock(dir, { timeoutMs: 100 });
  lock.release();
  fs.writeFileSync(filename, 'bad-data');
  await assert.rejects(acquireOperationLock(dir, { timeoutMs: 100 }), /Unverifiable/);
}));

test('does not delete replaced lock during release', { skip: supported }, async () => fixture(async dir => {
  const lock = await acquireOperationLock(dir);
  fs.writeFileSync(lock.filename, JSON.stringify(createProcessMarker()) + '\n');
  lock.release();
  assert.equal(fs.existsSync(lock.filename), true);
}));
