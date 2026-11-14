import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProcessMarker } from '../dist/portless/lifecycle.js';
import { RouteStore } from '../dist/portless/routes.js';
import { acquireRouteLock } from '../dist/portless/route-lock.js';

/** Run an asynchronous lease assertion over only an owned synthetic route namespace.
 * @param {(store: RouteStore, dir: string) => unknown | Promise<unknown>} fn Trusted local assertion callback.
 * @returns {Promise<unknown>} Callback result after unconditional private-directory cleanup. */
const fixture = async (fn) => {
  /** Owned private synthetic route namespace, never the operator route state. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-lease-'));
  try {
    return await fn(new RouteStore(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('an old process cannot release a newer forced route', () =>
  fixture((store) => {
    /** Owned earlier route lease that must not release later forced ownership. */
    const first = store.registerRoute('app.localhost', 4000, process.pid);
    /** Owned replacement lease whose exact ownership controls removal. */
    const next = store.registerRoute('app.localhost', 4001, 0, true);
    assert.equal(first.release(), false);
    assert.equal(store.loadRoutes()[0].port, 4001);
    assert.equal(next.release(), true);
    assert.equal(next.release(), false);
    assert.deepEqual(store.loadRoutes(), []);
  }));

test('replacements in the same process cannot be deleted by earlier cleanup', () =>
  fixture((store) => {
    /** Owned earlier same-process lease, distinct from the newer conditional UUID. */
    const old = store.registerRoute('app.localhost', 4000, process.pid);
    /** Owned replacement lease whose exact ownership controls removal. */
    const next = store.registerRoute('app.localhost', 4002, process.pid);
    assert.equal(old.release(), false);
    assert.equal(store.loadRoutes()[0].leaseId, next.leaseId);
    assert.equal(next.release(), true);
  }));

test('legacy route registrations retain their shape and aliases require force', () =>
  fixture((store) => {
    store.addRoute('app.localhost', 4000, process.pid);
    assert.throws(
      () => store.loadRoutes(true),
      /requires holding the route lock/
    );
    assert.deepEqual(store.loadRoutes()[0], {
      hostname: 'app.localhost',
      port: 4000,
      pid: process.pid,
    });
    store.addRoute('alias.localhost', 4555, 0);
    assert.throws(
      () => store.registerRoute('alias.localhost', 4003, process.pid),
      /already registered/
    );
    /** Explicit forced alias replacement receipt, released after the assertion. */
    const lease = store.registerRoute(
      'alias.localhost',
      4003,
      process.pid,
      true
    );
    assert.equal(lease.release(), true);
  }));

test('registry mutations fail closed on corrupt, duplicated, or oversized data', () =>
  fixture((store, dir) => {
    store.ensureDir();
    /** Fixed routes.json fixture path used only for staged corruption/byte-limit checks. */
    const file = path.join(dir, 'routes.json');
    for (const raw of [
      '{broken',
      JSON.stringify([
        { hostname: 'x.localhost', port: 4444, pid: 0 },
        { hostname: 'x.localhost', port: 4455, pid: 0 },
      ]),
      JSON.stringify([
        { hostname: 'x.localhost', port: 4000, pid: 0, leaseId: 'bad' },
      ]),
    ]) {
      fs.writeFileSync(file, raw);
      assert.throws(() => store.addRoute('new.localhost', 4444, process.pid));
      assert.equal(fs.readFileSync(file, 'utf8'), raw);
    }
    fs.writeFileSync(file, ' '.repeat(4 * 1024 * 1024 + 1));
    assert.throws(() => store.removeRoute('new.localhost'), /oversized/);
    assert.equal(fs.statSync(file).size, 4 * 1024 * 1024 + 1);
  }));

test('registry symlinks are rejected and never overwritten', () =>
  fixture((store, dir) => {
    store.ensureDir();
    /** Owned synthetic symlink target whose bytes must never be overwritten. */
    const target = path.join(dir, 'target.json');
    fs.writeFileSync(target, '[]');
    fs.symlinkSync(target, path.join(dir, 'routes.json'));
    assert.throws(
      () => store.addRoute('app.localhost', 4000, process.pid),
      /Unsafe/
    );
    assert.equal(fs.readFileSync(target, 'utf8'), '[]');
  }));

test('route lock is not stolen based on age and released only by its owner', () =>
  fixture((store, dir) => {
    store.ensureDir();
    /** Owned process-identity route mutation lock released idempotently. */
    const lock = acquireRouteLock(dir);
    /** Fixed fixture routes.lock directory used to test old/live/ownerless lock policy. */
    const lockDir = path.join(dir, 'routes.lock');
    fs.utimesSync(lockDir, new Date(0), new Date(0));
    assert.throws(() => acquireRouteLock(dir, { attempts: 1 }), /locked/);
    lock.release();
    assert.equal(fs.existsSync(lockDir), false);
    lock.release();
  }));

test('route locks recover verified stale owners but reject ownerless locks', () =>
  fixture((store, dir) => {
    store.ensureDir();
    /** Fixed fixture routes.lock directory used to test old/live/ownerless lock policy. */
    const lockDir = path.join(dir, 'routes.lock');
    fs.mkdirSync(lockDir);
    assert.throws(() => acquireRouteLock(dir, { attempts: 1 }), /locked/);
    /** Synthetic stale native marker using an explicitly absent PID; no real process is signalled. */
    const marker = createProcessMarker();
    marker.identity = 'linux:0'; // known mismatch on Linux; use dead PID for other platforms
    marker.pid = 2147483647;
    fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(marker));
    /** Owned process-identity route mutation lock released idempotently. */
    const lock = acquireRouteLock(dir, { attempts: 3, delayMs: 0 });
    lock.release();
    assert.equal(fs.existsSync(lockDir), false);
  }));
