import test from 'node:test';
import assert from 'node:assert/strict';
import * as Zyro from 'zyrojs/component';
import { render, unmount, renderToString } from 'zyrojs/dom';
import {
  createObservable,
  mapObservable,
  createAsyncObservable,
  createZyroSubscriptionScope,
} from '../dist/index.js';
import {
  createZyroRendererBridge,
  useZyroRendererBridge,
} from '../dist/renderer.js';
import { root } from '../../../zyrojs/test/dom-fixture.mjs';
/** Create an owned source with visible registration counts for teardown assertions.
 * @param {unknown} initial - Synthetic initial snapshot.
 * @returns {object} Observable fixture with an active-registration counter.
 */
const tracked = (initial) => {
  /** Owned fixture source; bridge conversions borrow it without destroying it. */
  const source = createObservable(initial);
  let active = 0;
  return {
    ...source,
    subscribe(fn) {
      active++;
      /** Owned effect or subscription disposer invoked before later mutation checks. */
      const stop = source.subscribe(fn);
      return () => {
        active--;
        stop();
      };
    },
    get active() {
      return active;
    },
  };
};

test('explicit selected snapshots, one render per batch, read-only and write-through policies', (t) => {
  /** Owned fixture source; bridge conversions borrow it without destroying it. */
  const source = tracked({ count: 0, other: 0 });
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => source.destroy());
  /** Owned manual bridge, or native-scope bridge when allocated inside component setup. */
  const bridge = createZyroRendererBridge(Zyro);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => bridge.destroy());
  /** Synthetic effect observations used to verify notification coalescing. */
  const values = [];
  /** Owned readonly selected conversion with identity-preserving equality. */
  const count = bridge.select(
    source,
    (s) => ({ count: s.count }),
    (a, b) => a.count === b.count
  );
  /** Initial cached snapshot or pending first request used for ordering assertions. */
  const initial = count.peek();
  /** Owned effect or subscription disposer invoked before later mutation checks. */
  const stop = Zyro.effect(() => values.push(count.value));
  source.set({ count: 0, other: 1 });
  assert.equal(count.peek(), initial);
  assert.equal(values.length, 1);
  source.batch(() => {
    source.set({ count: 1, other: 1 });
    source.set({ count: 2, other: 1 });
  });
  assert.equal(values.length, 2);
  assert.equal(count.peek().count, 2);
  bridge.batch(() => {
    source.set({ count: 3, other: 1 });
    source.set({ count: 4, other: 1 });
  });
  assert.equal(values.length, 3);
  assert.equal(count.peek().count, 4);
  assert.throws(() => {
    count.value = { count: 9 };
  }, /Read-only/);
  /** Owned mutable source backing explicit write-through. */
  const mutable = createObservable(1);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => mutable.destroy());
  /** Owned writable conversion of a borrowed mutable source. */
  const writable = bridge.write(mutable);
  writable.value = 4;
  assert.equal(mutable.get(), 4);
  /** Synthetic function-valued state used to verify assignment without accidental execution.
   * @returns {number} Fixed original fixture value.
   */
  const original = () => 1;
  /** Synthetic replacement function stored as inert state.
   * @returns {number} Fixed replacement fixture value.
   */
  const next = () => 2;
  /** Owned function-valued source; write-through must retain function identity. */
  const functions = createObservable(original);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => functions.destroy());
  /** Explicit writable conversion for function-valued state. */
  const functionValue = bridge.write(functions);
  functionValue.value = next;
  assert.equal(functions.get(), next);
  stop();
  count.dispose();
  assert.equal(source.active, 0);
  bridge.destroy();
  assert.equal(bridge.activeConnections, 0);
  assert.throws(() => writable.value, /destroyed/);
  mutable.set(6);
  assert.equal(mutable.get(), 6);
});

test('component setup owns conversion and async resources through nested updates/unmount', async (t) => {
  /** Owned synthetic standalone DOM root; component unmount owns renderer cleanup. */
  const container = root();
  /** Owned fixture source; bridge conversions borrow it without destroying it. */
  const source = tracked(0);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => source.destroy());
  /** Synthetic unresolved loaders explicitly settled by the test; no remote work is started. */
  const jobs = [];
  let bridge,
    resource,
    selected,
    renders = 0;
  /** Trusted authored component whose setup allocates the scoped bridge. */
  const View = Zyro.defineComponent(() => {
    bridge = useZyroRendererBridge(Zyro);
    selected = bridge.read(source);
    resource = bridge.resource(
      (signal) => new Promise((resolve) => jobs.push({ signal, resolve }))
    );
    /** Owned conversion reading the async resource status inside component setup. */
    const state = bridge.read(resource);
    return () => {
      renders++;
      return Zyro.h(
        'button',
        { onClick: () => source.set((n) => n + 1) },
        String(selected.value),
        () => state.value.status
      );
    };
  });
  render(Zyro.h(View, {}), container);
  assert.equal(source.active, 1);
  assert.equal(container.textContent, '0idle');
  source.batch(() => {
    source.set(1);
    source.set(2);
  });
  assert.equal(renders, 2);
  /** Owned in-flight refresh promise, explicitly settled after cancellation. */
  const pending = resource.refresh();
  assert.equal(container.textContent, '2loading');
  unmount(container);
  assert.equal(bridge.destroyed, true);
  assert.equal(source.active, 0);
  assert.equal(jobs[0].signal.aborted, true);
  jobs[0].resolve('stale');
  assert.equal(await pending, 'stale');
  assert.equal(resource.get().data, undefined);
  assert.equal(container.childNodes.length, 0);
  source.set(3);
  assert.equal(container.childNodes.length, 0);
});

test('async replacement/AbortSignal fences stale results and bounds unsettled loaders', async (t) => {
  /** Owned parent cancellation controller for the manual bridge lifetime. */
  const parent = new AbortController();
  /** Owned manual bridge, or native-scope bridge when allocated inside component setup. */
  const bridge = createZyroRendererBridge(Zyro, { signal: parent.signal });
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => bridge.destroy());
  /** Synthetic unresolved loaders explicitly settled by the test; no remote work is started. */
  const jobs = [];
  /** Owned async resource; replacement/cancel fences commits but not raw promise values. */
  const resource = bridge.resource(
    (signal) => new Promise((resolve) => jobs.push({ signal, resolve })),
    { maxPending: 2 }
  );
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => resource.destroy());
  /** First pending refresh whose slot lasts until the loader settles. */
  const one = resource.refresh();
  /** Second pending refresh completed before the stale first result. */
  const two = resource.refresh();
  assert.equal(jobs[0].signal.aborted, true);
  await assert.rejects(resource.refresh(), /pending limit/);
  jobs[1].resolve(2);
  await two;
  assert.equal(resource.get().data, 2);
  jobs[0].resolve(1);
  await one;
  assert.equal(resource.get().data, 2);
  /** Later refresh used to test parent cancellation after a committed result. */
  const third = resource.refresh();
  parent.abort(Error('request closed'));
  assert.equal(jobs[2].signal.aborted, true);
  assert.equal(bridge.destroyed, true);
  jobs[2].resolve(3);
  await third;
  assert.equal(resource.get().data, 2);
  await assert.rejects(resource.refresh(), /destroyed/);
  /** Owned cancellation controller for the direct resource fixture. */
  const external = new AbortController();
  /** Owned async observable using the explicit external parent lifetime. */
  const direct = createAsyncObservable(
    (signal) => new Promise((resolve) => jobs.push({ signal, resolve })),
    { signal: external.signal }
  );
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => direct.destroy());
  /** Direct loader promise explicitly settled after parent cancellation. */
  const work = direct.refresh();
  external.abort('owner stopped');
  assert.equal(jobs[3].signal.reason, 'owner stopped');
  jobs[3].resolve(4);
  await work;
  assert.equal(direct.get().status, 'idle');
  assert.equal(direct.get().data, undefined);
  await assert.rejects(
    direct.refresh(),
    (e) => e.name === 'AbortError' && e.cause === 'owner stopped'
  );
  direct.destroy();
});

test('timeout leaves loading without claiming forced cancellation; producer failures retry', async (t) => {
  let finish, signal;
  /** Owned async resource; replacement/cancel fences commits but not raw promise values. */
  const resource = createAsyncObservable(
    (s) => {
      signal = s;
      return new Promise((resolve) => (finish = resolve));
    },
    { timeoutMs: 5, maxPending: 1 }
  );
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => resource.destroy());
  /** Owned in-flight refresh promise, explicitly settled after cancellation. */
  const pending = resource.refresh();
  await new Promise((resolve) =>
    signal.addEventListener('abort', resolve, { once: true })
  );
  assert.equal(resource.get().status, 'idle');
  await assert.rejects(resource.refresh(), /pending limit/);
  finish('late');
  await pending;
  assert.equal(resource.get().data, undefined);
  resource.destroy();
  let calls = 0;
  /** Owned manual bridge, or native-scope bridge when allocated inside component setup. */
  const bridge = createZyroRendererBridge(Zyro);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => bridge.destroy());
  /** Private synthetic loader failure compared by identity without logging its contents. */
  const failure = Error('dependency unavailable');
  /** Owned bridge resource explicitly refreshed after a declared first failure. */
  const retry = bridge.resource(async () => {
    if (calls++ === 0) {
      throw failure;
    }
    return 'ready';
  });
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => retry.destroy());
  await assert.rejects(retry.refresh(), (error) => error === failure);
  assert.equal(retry.get().status, 'error');
  assert.equal(await retry.refresh(), 'ready');
  bridge.destroy();
});

test('denied inputs, connection bounds, initial failure rollback and all cleanup attempts', (t) => {
  assert.throws(() => createZyroRendererBridge({}), /primitives/);
  /** Owned manual bridge, or native-scope bridge when allocated inside component setup. */
  const bridge = createZyroRendererBridge(Zyro, { maxConnections: 1 });
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => bridge.destroy());
  assert.throws(() => bridge.read(Zyro.signal(0)), /get\/subscribe/);
  /** First conversion occupying the configured capacity until individually disposed. */
  const first = bridge.read(createObservable(0));
  assert.throws(() => bridge.read(createObservable(1)), /limit/);
  first.dispose();
  assert.throws(
    () =>
      bridge.read({
        get: () => 1,
        subscribe() {
          throw Error('subscribe unavailable');
        },
      }),
    /subscribe unavailable/
  );
  assert.equal(bridge.activeConnections, 0);
  /** Synthetic teardown trace proving failure does not retain registration capacity. */
  const stopped = [];
  bridge.read({
    get: () => 1,
    subscribe() {
      return () => {
        stopped.push(1);
        throw Error('cleanup failed');
      };
    },
  });
  assert.throws(() => bridge.destroy(), AggregateError);
  assert.deepEqual(stopped, [1]);
  assert.equal(bridge.activeConnections, 0);
  /** Owned subscription scope used to exercise rollback and aggregate cleanup. */
  const scope = createZyroSubscriptionScope();
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => scope.destroy());
  let native = 0;
  assert.throws(
    () =>
      scope.observe(
        {
          get: () => 1,
          subscribe(fn) {
            native++;
            fn(1);
            return () => native--;
          },
        },
        () => {
          throw Error('initial failed');
        }
      ),
    /initial failed/
  );
  assert.equal(native, 0);
  scope.destroy();
  assert.throws(() => useZyroRendererBridge(Zyro), /active scope/);
});

test('failed selectors retry a snapshot instead of poisoning memoization', (t) => {
  /** Owned fixture source; bridge conversions borrow it without destroying it. */
  const source = createObservable(0);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => source.destroy());
  let permitted = true,
    attempts = 0;
  /** Borrowed projection or owned bridge conversion under the current fixture. */
  const selected = mapObservable(source, (value) => {
    attempts++;
    if (!permitted) {
      throw Error('denied');
    }
    return value;
  });
  source.set(1);
  permitted = false;
  assert.throws(() => selected.get(), /denied/);
  assert.throws(() => selected.get(), /denied/);
  permitted = true;
  assert.equal(selected.get(), 1);
  assert.equal(attempts, 4);
});

test('SSR instances create independent bridge scopes and release subscriptions on success/failure', async (t) => {
  /** Per-render source fixtures inspected after successful SSR teardown. */
  const stores = [];
  /** Per-render bridge owners inspected after SSR teardown. */
  const bridges = [];
  /** Trusted authored component whose setup allocates the scoped bridge. */
  const View = Zyro.defineComponent((props) => {
    /** Owned fixture source; bridge conversions borrow it without destroying it. */
    const source = tracked(props.name);
    stores.push(source);
    /** Owned manual bridge, or native-scope bridge when allocated inside component setup. */
    const bridge = useZyroRendererBridge(Zyro);
    bridges.push(bridge);
    /** Readonly conversion owned by this request component scope. */
    const view = bridge.read(source);
    return () => Zyro.h('p', {}, view.value);
  });
  /** Completed HTML from independent synthetic SSR calls. */
  const results = await Promise.all(
    ['one', 'two'].map((name) =>
      Promise.resolve().then(() => renderToString(Zyro.h(View, { name })))
    )
  );
  assert.deepEqual(results, ['<p>one</p>', '<p>two</p>']);
  assert.ok(stores.every((store) => store.active === 0));
  assert.ok(bridges.every((bridge) => bridge.destroyed));
  /** Owned fixture source; bridge conversions borrow it without destroying it. */
  const source = tracked(0);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => source.destroy());
  /** Trusted component intentionally throwing during render to test rollback. */
  const Broken = Zyro.defineComponent(() => {
    /** Owned manual bridge, or native-scope bridge when allocated inside component setup. */
    const bridge = useZyroRendererBridge(Zyro);
    bridge.read(source);
    return () => {
      throw Error('render failed');
    };
  });
  assert.throws(() => renderToString(Zyro.h(Broken, {})), /render failed/);
  assert.equal(source.active, 0);
});

test('bridge projections remain untracked and invalid render-time registration is denied', (t) => {
  /** Owned fixture source; bridge conversions borrow it without destroying it. */
  const source = createObservable(0);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => source.destroy());
  /** Native signal read inside projection; it must remain untracked. */
  const incidental = Zyro.signal(0);
  /** Native effect trigger controlling intentional source updates. */
  const trigger = Zyro.signal(0);
  /** Owned manual bridge, or native-scope bridge when allocated inside component setup. */
  const bridge = createZyroRendererBridge(Zyro);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => bridge.destroy());
  let runs = 0;
  /** Borrowed projection or owned bridge conversion under the current fixture. */
  const selected = bridge.select(source, (n) => {
    incidental.value;
    return n;
  });
  /** Owned effect or subscription disposer invoked before later mutation checks. */
  const stop = Zyro.effect(() => {
    runs++;
    source.set(trigger.value);
  });
  trigger.value = 1;
  assert.equal(selected.peek(), 1);
  /** Effect count captured before unrelated native signal mutation. */
  const before = runs;
  incidental.value++;
  assert.equal(runs, before);
  stop();
  bridge.destroy();
  /** Trusted invalid render-time bridge allocation fixture.
   * @returns {null} No component output after the expected scope rejection.
   */
  const Bad = () => {
    useZyroRendererBridge(Zyro);
    return null;
  };
  /** Owned synthetic standalone DOM root; component unmount owns renderer cleanup. */
  const container = root();
  assert.throws(() => render(Zyro.h(Bad, {}), container), /during render/);
  assert.equal(container.childNodes.length, 0);
});

test('abort-listener reentrancy cannot give two loaders the same active generation', async (t) => {
  /** Synthetic unresolved loaders explicitly settled by the test; no remote work is started. */
  const jobs = [];
  let nested;
  /** Owned async resource; replacement/cancel fences commits but not raw promise values. */
  const resource = createAsyncObservable(
    (signal) => new Promise((resolve) => jobs.push({ signal, resolve }))
  );
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => resource.destroy());
  /** Initial cached snapshot or pending first request used for ordering assertions. */
  const initial = resource.refresh();
  jobs[0].signal.addEventListener(
    'abort',
    () => {
      nested = resource.refresh();
    },
    { once: true }
  );
  await assert.rejects(
    resource.refresh(),
    (error) => error.name === 'AbortError'
  );
  assert.equal(jobs.length, 2);
  jobs[1].resolve('newest');
  await nested;
  jobs[0].resolve('old');
  await initial;
  assert.equal(resource.get().data, 'newest');
  resource.destroy();
});

test('initial source failure retains both its cause and unsubscribe failure', (t) => {
  /** Owned subscription scope used to exercise rollback and aggregate cleanup. */
  const scope = createZyroSubscriptionScope();
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => scope.destroy());
  /** Private synthetic source read failure retained in the aggregate cause. */
  const read = Error('dependency read failed');
  /** Private synthetic disposer failure retained alongside the read failure. */
  const cleanup = Error('dependency cleanup failed');
  assert.throws(
    () =>
      scope.observe(
        {
          get() {
            throw read;
          },
          subscribe() {
            return () => {
              throw cleanup;
            };
          },
        },
        () => {}
      ),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === read &&
      error.errors[1] === cleanup
  );
  scope.destroy();
});
