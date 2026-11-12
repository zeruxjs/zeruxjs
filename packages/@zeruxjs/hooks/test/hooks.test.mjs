import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runWithState,
  runHooks,
  useState,
  useRef,
  useMemo,
  useReducer,
  useEffect,
  disposeHooks,
  runWithContext,
  createContext,
  useContext,
  setContext,
  withContext,
  runWithRequestHooks,
  createPathRegistry,
  resolvePath,
} from '../dist/index.js';

test('stable hooks preserve state and functional updates', () =>
  runWithState(() => {
    /** Render the synthetic component under a stable function identity.
     * @returns {unknown} Synchronous fixture render result; no UI renderer is installed. */
    const fn = () => {
      /** Positional synthetic state and captured updater; rerender is explicitly invoked by the test. */
      const [count, set] = useState(0);
      return { count, set };
    };
    assert.equal(runHooks(fn).count, 0);
    /** Captured functional/direct updater; calling it does not schedule rendering. */
    const setter = runHooks(fn).set;
    setter((x) => x + 3);
    assert.equal(runHooks(fn).count, 3);
    setter(1);
    assert.equal(runHooks(fn).count, 1);
  }));
test('undefined is a valid persisted state', () =>
  runWithState(() => {
    let initialCalls = 0;
    /** Render the synthetic component under a stable function identity.
     * @returns {unknown} Synchronous fixture render result; no UI renderer is installed. */
    const fn = () =>
      useState(() => {
        initialCalls++;
        return undefined;
      });
    runHooks(fn);
    runHooks(fn);
    assert.equal(initialCalls, 1);
  }));
test('reducer, memo and ref preserve identity', () =>
  runWithState(() => {
    let creates = 0,
      changed = 1;
    /** Render the synthetic component under a stable function identity.
     * @returns {unknown} Synchronous fixture render result; no UI renderer is installed. */
    const fn = () => {
      /** Stable synthetic mutable ref holder checked across explicit rerenders. */
      const ref = useRef({ v: 1 });
      /** Memo observation checked against shallow dependency identity. */
      const memo = useMemo(() => ++creates, [changed]);
      /** Synthetic reducer state and synchronous dispatch retained across explicit renders. */
      const [sum, dispatch] = useReducer((a, b) => a + b, 0);
      return { ref, memo, sum, dispatch };
    };
    /** Initial synchronous reducer/ref/memo result before explicit dispatch. */
    const first = runHooks(fn);
    first.dispatch(4);
    /** Explicit rerender result; ref/memo identities must remain stable. */
    const next = runHooks(fn);
    assert.equal(next.memo, first.memo);
    assert.equal(next.ref, first.ref);
    assert.equal(next.sum, 4);
    changed++;
    assert.equal(runHooks(fn).memo, 2);
  }));
test('effects clean up on dependency changes and disposal', () =>
  runWithState(() => {
    /** Ordered synthetic effect start/cleanup observations, without native subscriptions. */
    const events = [];
    let dependency = 1;
    /** Render the synthetic component under a stable function identity.
     * @returns {unknown} Synchronous fixture render result; no UI renderer is installed. */
    const fn = () =>
      useEffect(() => {
        /** Dependency value captured by this effect cleanup before the next render. */
        const v = dependency;
        events.push('start' + v);
        return () => events.push('stop' + v);
      }, [dependency]);
    runHooks(fn);
    runHooks(fn);
    dependency = 2;
    runHooks(fn);
    assert.equal(disposeHooks(fn), true);
    assert.deepEqual(events, ['start1', 'stop1', 'start2', 'stop2']);
  }));
test('hook order changes and async rendering rejected', () =>
  runWithState(() => {
    let next = false;
    /** Render the synthetic component under a stable function identity.
     * @returns {unknown} Synchronous fixture render result; no UI renderer is installed. */
    const fn = () => {
      useState(0);
      if (next) {
        useRef(0);
      }
    };
    runHooks(fn);
    next = true;
    assert.throws(() => runHooks(fn), /count changed/);
    assert.throws(() => runHooks(async () => 1), /asynchronous/);
  }));
test('context scopes are isolated across overlapping async requests', async () => {
  /** Explicit synthetic server context descriptor; no caller header identity is trusted. */
  const ctx = createContext('default');
  /** First overlapping async-local request, expected to retain its own assigned context. */
  const one = runWithContext(async () => {
    setContext(ctx, 'one');
    await new Promise((r) => setTimeout(r, 7));
    return useContext(ctx);
  });
  /** Independent overlapping request with a nested shallow context override. */
  const two = runWithContext(async () => {
    setContext(ctx, 'two');
    await Promise.resolve();
    return withContext(ctx, 'nested', () => [useContext(ctx), 'two']);
  });
  assert.deepEqual(await Promise.all([one, two]), ['one', ['nested', 'two']]);
});
test('loader specifiers without aliases resolve as misses', () =>
  assert.equal(resolvePath('react'), null));
test('path registry persists and guards prototype keys, malformed data and symlinks', () => {
  /** Owned disposable alias-registry directory; finally removes this synthetic tree. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-hooks-'));
  try {
    /** Inert per-operation path registry, not a filesystem watcher or persistent handle. */
    const reg = createPathRegistry({ directory: root });
    fs.mkdirSync(path.join(root, 'src'));
    reg.register('app:source', 'src');
    assert.equal(reg.resolve('app:source'), path.join(root, 'src'));
    assert.equal(
      createPathRegistry({ directory: root }).resolve('app:source'),
      path.join(root, 'src')
    );
    assert.throws(() => reg.register('constructor', '.'), /Invalid/);
    assert.throws(() => reg.register('__proto__:bad', '.'), /Invalid/);
    reg.unregister('app:source');
    assert.equal(reg.resolve('app:source'), null);
    fs.rmSync(path.join(root, '.zerux-paths.json'));
    fs.symlinkSync(
      path.join(root, 'src'),
      path.join(root, '.zerux-paths.json')
    );
    assert.throws(() => reg.list(), /Unsafe/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('combined request helper provides hooks and context together', () =>
  runWithRequestHooks(() => {
    /** Explicit synthetic server context descriptor; no caller header identity is trusted. */
    const ctx = createContext(7);
    setContext(ctx, 11);
    /** Render the synthetic component under a stable function identity.
     * @returns {unknown} Synchronous fixture render result; no UI renderer is installed. */
    const fn = () => {
      /** Positional synthetic state and captured updater; rerender is explicitly invoked by the test. */
      const [count, set] = useState(1);
      return { count, set, context: useContext(ctx) };
    };
    /** Initial combined state/context render before the explicit state update. */
    const initial = runHooks(fn);
    assert.equal(initial.context, 11);
    initial.set(3);
    assert.equal(runHooks(fn).count, 3);
  }));
