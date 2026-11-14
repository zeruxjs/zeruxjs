import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  symlink,
  chmod,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  watchDirectory,
  scan,
  activeWatcherCount,
  watcherDiagnostics,
} from 'zlook';
/** Allocate an isolated filesystem tree for a bounded watcher test.
 * @returns {Promise<string>} Owned temporary directory path.
 */
const fixture = () => mkdtemp(join(tmpdir(), 'zlook-bounded-'));
/** Polling-only fixture settings prevent native notifications from racing explicit flush assertions. */
const options = { pollingOnly: true, pollIntervalMs: 60000 };

test('burst writes reconcile final state; rename is delete/new and nested ignore rules remain local', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Events retained by the filtered subscriber for deterministic assertions. */
  const events = [];
  /** Events retained by the unfiltered subscriber sharing the same scan owner. */
  const all = [];
  await mkdir(join(root, 'nested'));
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'node_modules'));
  /** First independent subscriber; its close operation must not stop the second subscriber. */
  const a = watchDirectory(root, (event) => events.push(event), {
    ...options,
    ignored: (file) => file === 'dist',
  });
  /** Second independent subscriber sharing compatible root/settings resources. */
  const b = watchDirectory(root, (event) => all.push(event), options);
  try {
    await a.ready;
    for (let index = 0; index < 10; index++) {
      await writeFile(join(root, 'nested', 'a.txt'), String(index));
    }
    await writeFile(join(root, 'dist', 'output.js'), 'built');
    await writeFile(join(root, 'node_modules', 'dependency.js'), 'ignored');
    /** Visible event result after subscriber-specific filtering. */
    const visible = await a.flush();
    assert.deepEqual(
      visible.map((event) => event.file),
      ['nested/a.txt']
    );
    assert.equal(all.length, 2);
    await rename(join(root, 'nested', 'a.txt'), join(root, 'nested', 'b.txt'));
    await a.flush();
    assert.deepEqual(events.slice(-2), [
      { file: 'nested/a.txt', type: 'delete' },
      { file: 'nested/b.txt', type: 'new' },
    ]);
    await rm(join(root, 'nested', 'b.txt'));
    assert.equal((await a.flush())[0].type, 'delete');
  } finally {
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    await rm(root, { recursive: true, force: true });
  }
});

test('scan limits fail without replacing baseline; dropped events differ from coalesced requests', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Private fixture failures collected for error-isolation and redaction assertions. */
  const errors = [];
  /** Owned watcher subscription; close and await settlement before removing its tree. */
  const handle = watchDirectory(root, () => {}, {
    ...options,
    maxEntries: 2,
    maxPendingEvents: 1,
    onError: (error) => errors.push(error),
  });
  try {
    await handle.ready;
    await writeFile(join(root, 'a'), 'a');
    await writeFile(join(root, 'b'), 'b');
    /** Concurrent refresh requests used to verify bounded trailing reconciliation. */
    const flushes = Array.from({ length: 20 }, () => handle.flush());
    await Promise.all(flushes);
    assert.equal(handle.diagnostics().dropped, 1);
    assert.ok(handle.diagnostics().coalesced >= 19);
    assert.ok(errors.some((error) => error.code === 'PENDING_EVENT_LIMIT'));
    await writeFile(join(root, 'c'), 'c');
    await handle.flush();
    assert.ok(errors.some((error) => error.code === 'SCAN_ENTRY_LIMIT'));
    await rm(join(root, 'c'));
    await writeFile(join(root, 'a'), 'a changed');
    assert.deepEqual(await handle.flush(), [{ file: 'a', type: 'update' }]);
    assert.ok(!JSON.stringify(handle.diagnostics()).includes(root));
  } finally {
    handle.close();
    await handle.closed;
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical aliases share only identical settings; options are snapshotted', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Owned symlink alias testing canonical identity rather than lexical path sharing. */
  const alias = root + '-alias';
  await symlink(root, alias, 'dir');
  /** Initial shared-owner count restored after the fixture releases its subscriptions. */
  const base = activeWatcherCount();
  /** Caller options intentionally mutated after subscription to verify snapshot isolation. */
  const mutable = { ...options, ignored: () => false };
  /** First independent subscriber; its close operation must not stop the second subscriber. */
  const a = watchDirectory(root, () => {}, mutable);
  /** Second independent subscriber sharing compatible root/settings resources. */
  const b = watchDirectory(alias, () => {}, options);
  /** Subscriber with different debounce settings, requiring a separate shared owner. */
  const c = watchDirectory(root, () => {}, { ...options, debounceMs: 123 });
  try {
    await Promise.all([a.ready, b.ready, c.ready]);
    assert.equal(activeWatcherCount(), base + 2);
    mutable.ignored = () => true;
    await writeFile(join(root, 'visible'), 'yes');
    assert.equal((await a.flush()).length, 1);
    assert.equal(a.diagnostics().subscriptions, 2);
  } finally {
    a.close();
    b.close();
    c.close();
    await Promise.all([a.closed, b.closed, c.closed]);
    await rm(alias, { force: true });
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(activeWatcherCount(), base);
});

test('close and abort during startup release work with no late native handle', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Initial shared-owner count restored after the fixture releases its subscriptions. */
  const base = activeWatcherCount();
  for (let index = 0; index < 100; index++) {
    await writeFile(join(root, String(index)), 'x');
  }
  /** Owned watcher subscription; close and await settlement before removing its tree. */
  const handle = watchDirectory(root, () => {
    throw Error('late event');
  });
  handle.close();
  handle.close();
  await handle.closed;
  assert.equal(handle.diagnostics().nativeHandles, 0);
  assert.equal(handle.diagnostics().pollingHandles, 0);
  assert.equal(activeWatcherCount(), base);
  /** Caller cancellation controller, used to close a subscription during startup. */
  const controller = new AbortController();
  /** Subscription closed by its initiating signal, including any startup scan. */
  const aborted = watchDirectory(root, () => {}, { signal: controller.signal });
  controller.abort();
  await aborted.closed;
  assert.equal(activeWatcherCount(), base);
  /** Cancellation controller for the standalone scanner rather than a watcher subscription. */
  const direct = new AbortController();
  let visits = 0;
  await assert.rejects(
    scan(
      root,
      () => {
        if (++visits === 1) {
          direct.abort();
        }
        return false;
      },
      { signal: direct.signal }
    ),
    (error) => error.name === 'AbortError'
  );
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(watcherDiagnostics(), []);
});

test('missing root and persistent permission failures report without synthetic deletes', async (t) => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Private fixture failures collected for error-isolation and redaction assertions. */
  const errors = [];
  /** Owned watcher subscription; close and await settlement before removing its tree. */
  const handle = watchDirectory(root, () => {}, {
    ...options,
    onError: (error) => errors.push(error),
  });
  try {
    await handle.ready;
    await writeFile(join(root, 'kept'), 'x');
    await handle.flush();
    await rename(root, root + '-moved');
    assert.deepEqual(await handle.flush(), []);
    assert.equal(errors.at(-1).code, 'ENOENT');
    assert.ok(!errors.at(-1).message.includes(root));
    await rename(root + '-moved', root);
    assert.deepEqual(await handle.flush(), []);
    if (process.getuid?.() === 0) {
      t.diagnostic(
        'Permission mode check requires an unprivileged user; missing-root failure still verified'
      );
      return;
    }
    await chmod(root, 0);
    await handle.flush();
    await handle.flush();
    assert.equal(errors.at(-1).code, 'EACCES');
    assert.ok(handle.diagnostics().scanErrors >= 3);
  } finally {
    await chmod(root, 0o700);
    handle.close();
    await handle.closed;
    await rm(root, { recursive: true, force: true });
    await rm(root + '-moved', { recursive: true, force: true });
  }
});

test('native backend failure falls back to polling with a redacted error and closes cleanly', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Private fixture failures collected for error-isolation and redaction assertions. */
  const errors = [];
  /** Initial shared-owner count restored after the fixture releases its subscriptions. */
  const base = activeWatcherCount();
  /** Injected native-watch failure with a deliberately private cause message. */
  const failure = Object.assign(new Error('private backend path ' + root), {
    code: 'ENOSYS',
  });
  /** Restorable native-watch mock; always restored during fixture cleanup. */
  const replacement = mock.method(fs, 'watch', () => {
    throw failure;
  });
  /** Events retained by the filtered subscriber for deterministic assertions. */
  const events = [];
  /** Owned watcher subscription; close and await settlement before removing its tree. */
  const handle = watchDirectory(root, (event) => events.push(event), {
    pollIntervalMs: 100,
    onError: (error) => errors.push(error),
  });
  try {
    await handle.ready;
    replacement.mock.restore();
    await writeFile(join(root, 'fallback'), 'x');
    await new Promise((resolve, reject) => {
      /** Start time bounding polling wait independently of the watcher’s own timers. */
      const started = Date.now();
      /** Owned polling assertion timer, cleared on success or timeout. */
      const timer = setInterval(() => {
        if (events.length) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 2000) {
          clearInterval(timer);
          reject(Error('poll timeout'));
        }
      }, 20);
    });
    assert.equal(errors[0].cause, failure);
    assert.doesNotMatch(errors[0].message, /private/);
    assert.equal(handle.diagnostics().nativeHandles, 0);
  } finally {
    replacement.mock.restore();
    handle.close();
    await handle.closed;
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(activeWatcherCount(), base);
});

test('invalid options and throwing/async ignores are contained per subscriber', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Initial shared-owner count restored after the fixture releases its subscriptions. */
  const base = activeWatcherCount();
  for (const invalid of [
    null,
    { maxEntries: 0 },
    { maxPendingEvents: Infinity },
    { ignored: true },
    { pollingOnly: 'yes' },
    { signal: {} },
  ]) {
    assert.throws(() => watchDirectory(root, () => {}, invalid));
  }
  assert.equal(activeWatcherCount(), base);
  /** Private fixture failures collected for error-isolation and redaction assertions. */
  const errors = [];
  /** Visible event result after subscriber-specific filtering. */
  const visible = [];
  /** First independent subscriber; its close operation must not stop the second subscriber. */
  const a = watchDirectory(
    root,
    () => {
      throw Error('should be filtered');
    },
    {
      ...options,
      ignored: () => Promise.reject(new Error('invalid async ignore')),
      onError: (error) => errors.push(error),
    }
  );
  /** Second independent subscriber sharing compatible root/settings resources. */
  const b = watchDirectory(root, (event) => visible.push(event), options);
  try {
    await a.ready;
    await writeFile(join(root, 'file'), 'x');
    await b.flush();
    assert.equal(visible.length, 1);
    assert.match(errors[0].message, /boolean/);
  } finally {
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    await rm(root, { recursive: true, force: true });
  }
});

test('process-local scan admission bounds concurrency/queue and queued cancellation releases its slot', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  await writeFile(join(root, 'one'), 'x');
  await writeFile(join(root, 'two'), 'x');
  let current = 0,
    peak = 0;
  try {
    /** Concurrent scan attempts exceeding the process-local admission queue. */
    const calls = Array.from({ length: 140 }, () => {
      let entered = false;
      return scan(root, () => {
        if (!entered) {
          entered = true;
          current++;
          peak = Math.max(peak, current);
        }
        return false;
      }).finally(() => {
        if (entered) {
          current--;
        }
      });
    });
    /** Settled admission results, including explicit capacity rejection. */
    const results = await Promise.allSettled(calls);
    assert.ok(peak <= 4, `peak scans: ${peak}`);
    assert.ok(
      results.some(
        (result) =>
          result.status === 'rejected' &&
          result.reason.code === 'SCAN_QUEUE_LIMIT'
      )
    );
    assert.equal(current, 0);
    /** Independent signals testing cancellation of a queued scan. */
    const controllers = Array.from({ length: 10 }, () => new AbortController());
    /** In-flight scan promises awaited before fixture cleanup. */
    const pending = controllers.map((controller) =>
      scan(root, () => false, { signal: controller.signal })
    );
    controllers.at(-1).abort();
    /** Settled results distinguishing caller cancellation from successful scans. */
    const cancelled = await Promise.allSettled(pending);
    assert.equal(cancelled.at(-1).status, 'rejected');
    assert.equal(cancelled.at(-1).reason.name, 'AbortError');
    assert.equal((await scan(root, () => false)).size, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('native bursts coalesce without drops and backend error releases its handle once', async () => {
  /** Native-handle test double implementation loaded without a real watch backend. */
  const { EventEmitter } = await import('node:events');
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  /** Events retained by the filtered subscriber for deterministic assertions. */
  const events = [];
  /** Private fixture failures collected for error-isolation and redaction assertions. */
  const errors = [];
  /** Event-emitting native watcher double with observable close ownership. */
  const native = new EventEmitter();
  let closes = 0,
    notify;
  native.close = () => {
    closes++;
    queueMicrotask(() => native.emit('close'));
  };
  /** Restorable native-watch mock; always restored during fixture cleanup. */
  const replacement = mock.method(fs, 'watch', (_root, _options, callback) => {
    notify = callback;
    return native;
  });
  /** Owned watcher subscription; close and await settlement before removing its tree. */
  const handle = watchDirectory(root, (event) => events.push(event), {
    debounceMs: 10,
    pollIntervalMs: 60000,
    onError: (error) => errors.push(error),
  });
  try {
    await handle.ready;
    replacement.mock.restore();
    await writeFile(join(root, 'burst'), 'changed');
    for (let index = 0; index < 20; index++) {
      notify('change', 'burst');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    await handle.flush();
    assert.deepEqual(events, [{ file: 'burst', type: 'new' }]);
    assert.ok(handle.diagnostics().coalesced >= 19);
    assert.equal(handle.diagnostics().dropped, 0);
    native.emit(
      'error',
      Object.assign(new Error('private native path'), { code: 'EIO' })
    );
    assert.equal(errors.at(-1).code, 'EIO');
    handle.close();
    handle.close();
    await handle.closed;
    assert.equal(closes, 1);
  } finally {
    replacement.mock.restore();
    handle.close();
    await handle.closed;
    await rm(root, { recursive: true, force: true });
  }
});

test('disappearing child and symlink cycle do not invalidate a complete scan', async () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = await fixture();
  await writeFile(join(root, 'vanishing'), 'x');
  await writeFile(join(root, 'kept'), 'y');
  await symlink(root, join(root, 'cycle'), 'dir');
  try {
    /** Complete scan after a child disappears and a symlink cycle is excluded. */
    const snapshot = await scan(root, (file) => {
      if (file === 'vanishing') {
        fs.unlinkSync(join(root, file));
      }
      return false;
    });
    assert.deepEqual([...snapshot.keys()], ['kept']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
