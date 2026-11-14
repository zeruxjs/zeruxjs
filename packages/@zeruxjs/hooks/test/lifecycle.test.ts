import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestHookScope,
  createContext,
  useContext,
  setContext,
  withContext,
  runHooks,
  useEffect,
  disposeHooks,
  createServerLifecycleHooks,
} from '../dist/index.js';
test('owned request scopes invalidate escaped contexts/state and clean every effect once despite failure', async (t) => {
  /** Owned synthetic request context/state scope, disposed before escaped continuations resume. */
  const scope = createRequestHookScope();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(() => scope.dispose());
  /** Synthetic context identity whose borrowed value becomes inaccessible after owner disposal. */
  const key = createContext('default');
  /** Ordered synchronous cleanup observations, including an intentionally throwing disposer. */
  const events: string[] = [];
  let release: (() => void) | undefined;
  /** Escaped synthetic async continuation retained until owner invalidation and explicit release. */
  const work = scope.run(async () => {
    setContext(key, 'PRIVATE');
    /** Allocate synthetic effect cleanups under one stable render identity.
     * @returns {void} No asynchronous resource is acquired; cleanup order/failure is observed. */
    const component = () => {
      useEffect(
        () => () => {
          events.push('one');
          throw Error('cleanup failed');
        },
        []
      );
      useEffect(() => () => events.push('two'), []);
    };
    runHooks(component);
    assert.throws(() => disposeHooks(component), /cleanup failed/);
    assert.equal(disposeHooks(component), false);
    runHooks(() => useEffect(() => () => events.push('owned'), []));
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    assert.throws(() => useContext(key), /disposed/);
    assert.throws(() => runHooks(() => 1), /disposed/);
  });
  try {
    scope.dispose();
    try {
      scope.dispose();
      release?.();
      await work;
    } finally {
      try {
        scope.dispose();
      } finally {
        release?.();
        await work.catch(() => {});
      }
    }
    assert.deepEqual(events, ['one', 'two', 'owned']);
    assert.throws(() => scope.run(() => 1), /disposed/);
  } finally {
    try {
      scope.dispose();
    } finally {
      release?.();
      await work.catch(() => {});
    }
  }
});
test('nested contexts cannot outlive their owned parent; synchronous lifecycle registrations are explicit', async (t) => {
  /** Owned synthetic request context/state scope, disposed before escaped continuations resume. */
  const scope = createRequestHookScope();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(() => scope.dispose());
  /** Child synthetic context linked to the owned parent lifetime. */
  const context = createContext('none');
  let release: (() => void) | undefined;
  /** Escaped synthetic async continuation retained until owner invalidation and explicit release. */
  const work = scope.run(() =>
    withContext(context, 'child', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      assert.throws(() => useContext(context), /disposed/);
    })
  );
  scope.dispose();
  release?.();
  await work;
  /** Owned typed synchronous bus; it does not implement an HTTP server by declaration. */
  const hooks = createServerLifecycleHooks();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(() => hooks.dispose());
  assert.throws(() => hooks.register('request:before', async () => {}), {
    code: 'HOOK_ASYNC_IN_SYNC',
  });
  assert.throws(() => hooks.register('request:before', null as never), {
    code: 'HOOK_INVALID',
  });
  /** Observed generation correlation values, excluding private request payloads. */
  const values: string[] = [];
  /** Exact once-registration token, removed before its first invocation. */
  const token = hooks.register(
    'generation:ready',
    (value) => values.push(value.generationId),
    { once: true }
  );
  hooks.dispatch('generation:ready', { generationId: 'one' });
  hooks.dispatch('generation:ready', { generationId: 'two' });
  assert.deepEqual(values, ['one']);
  assert.equal(token.active, false);
  hooks.dispose();
});
