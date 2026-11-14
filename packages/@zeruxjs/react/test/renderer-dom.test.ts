import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createReactStore, createReactBindings } from '../dist/index.js';
import { mountReact, hydrateReact } from '../dist/browser.js';
import { renderReactToString } from '../dist/server.js';
import {
  createReactHydrationState,
  readReactHydrationState,
} from '../dist/hydration.mjs';
/** Stateless actual/injected React hook bindings; per-user stores remain request-owned. */
const bindings = createReactBindings(React);
/** Own one isolated DOM emulator, restore original global descriptors and clean native roots before closing its window.
 * @param {function} run - Explicit synthetic callback/dependency value; not private live data.
 * @returns {Promise<void>} Explicit synthetic fixture result or intentional failure.
 */
async function environment(run) {
  /** Accepted native root handles; dispose them before destroying their emulated DOM. */
  const roots = new Set();
  /** Retain one acquired native root for failure-safe fixture cleanup.
   * @param {object} handle - Accepted native mount/hydration owner.
   * @returns {object} The same handle, with teardown ownership recorded.
   */
  const own = (handle) => {
    roots.add(handle);
    return handle;
  };
  /** Finite root-cleanup failures preserved after all owners/globals are released. */
  const cleanupFailures = [];
  /** Owned jsdom emulator, not a live browser; close its window and restore globals. */
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: 'https://app.test/',
  });
  /** Original global descriptors restored exactly after the isolated DOM fixture. */
  const saved = new Map();
  /** Explicit temporary DOM-emulation globals; no application is started. */
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  // Visit only the finite synthetic cases/archives/global descriptors owned by this fixture.
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  try {
    await run(dom.window.document.querySelector('#app'), dom.window, own);
  } catch (error) {
    cleanupFailures.push(error);
  } finally {
    // Native roots must unmount while their window and globals still exist.
    try {
      await React.act(async () => {
        for (const handle of roots) {
          try {
            handle.unmount();
          } catch (error) {
            cleanupFailures.push(error);
          }
        }
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      dom.window.close();
    } finally {
      // Visit only the finite synthetic cases/archives/global descriptors owned by this fixture.
      for (const [key, descriptor] of saved) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          delete globalThis[key];
        }
      }
    }
  }
  if (cleanupFailures.length === 1) {
    throw cleanupFailures[0];
  }
  if (cleanupFailures.length > 1) {
    throw new AggregateError(cleanupFailures);
  }
}
/** Borrowed store wrapper counting actual subscription starts/stops.
 * @param {unknown} source - Explicit synthetic source/callback/dependency value; never private live state.
 * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
 */
const tracked = (source) => {
  let live = 0,
    starts = 0,
    stops = 0;
  return {
    ...source,
    /** Borrow one source subscription and count exactly one eventual unsubscribe.
     * @param {unknown} fn - Explicit synthetic callback/dependency value; not private live data.
     * @returns {function} Explicit synthetic fixture result or intentional failure.
     */
    subscribe(fn) {
      live++;
      starts++;
      let active = true;
      /** Owned unsubscribe callback; release it on fixture teardown. */
      const stop = source.subscribe(fn);
      return () => {
        if (active) {
          active = false;
          live--;
          stops++;
          stop();
        }
      };
    },
    /** Read actual active fixture subscription count.
     * @returns {number} Explicit synthetic fixture result or intentional failure.
     */
    get live() {
      return live;
    },
    /** Read total synthetic subscription starts, including native Strict Mode probes.
     * @returns {number} Explicit synthetic fixture result or intentional failure.
     */
    get starts() {
      return starts;
    },
    /** Read total owned unsubscribe calls, not store destruction.
     * @returns {number} Explicit synthetic fixture result or intentional failure.
     */
    get stops() {
      return stops;
    },
  };
};
/** Trusted fixture-only public state projection; no network data is implicitly authorized.
 * @param {unknown} value - Explicit synthetic source/callback/dependency value; never private live state.
 * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
 */
const validateState = (value) => {
  if (
    !value ||
    typeof value.count !== 'number' ||
    typeof value.name !== 'string' ||
    Object.keys(value).some((k) => !['count', 'name'].includes(k))
  ) {
    throw Error('invalid state');
  }
  return { count: value.count, name: value.name };
};

test('actual React Strict Mode cleans probes/subscriptions; selection and explicit root ownership remain stable', (t) =>
  environment(async (container, _window, own) => {
    /** Synthetic source/store value scoped to this fixture, never a user singleton. */
    const source = tracked(createReactStore({ count: 0, hidden: 0 }));
    // Register idempotent fixture ownership before subsequent assertions can fail.
    t.after(() => {
      source.destroy();
    });
    let renders = 0,
      disposed = 0;
    /** Stable pure fixture selector; no business side effect.
     * @param {unknown} s - Explicit synthetic source/callback/dependency value; never private live state.
     * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
     */
    const selector = (s) => ({ count: s.count });
    /** Explicit selected-value comparator preserving equal snapshot references.
     * @param {unknown} a - Explicit synthetic source/callback/dependency value; never private live state.
     * @param {unknown} b - Explicit synthetic source/callback/dependency value; never private live state.
     * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
     */
    const equal = (a, b) => a.count === b.count;
    /** Render the synthetic counter through actual native hooks; event handlers update only its explicit fixture source.
     * @returns {object} Explicit synthetic fixture result or intentional failure.
     */
    function Counter() {
      /** Borrowed derived projection; stable equality controls snapshot references. */
      const selected = bindings.useSelector(source, selector, { equal });
      renders++;
      return React.createElement(
        'button',
        { onClick: () => source.update((s) => ({ ...s, count: s.count + 1 })) },
        selected.count
      );
    }
    /** Trusted synthetic React element tree, not incoming executable data. */
    const view = React.createElement(
      React.StrictMode,
      null,
      React.createElement(Counter)
    );
    let handle;
    await React.act(async () => {
      handle = own(
        await mountReact(view, container, {
          /** Release exactly the accepted root owner resources/count; Strict Mode probes do not own store destruction.
           * @returns {void} Explicit synthetic fixture result or intentional failure.
           */
          onDispose() {
            disposed++;
            source.destroy();
          },
        })
      );
    });
    assert.equal(container.textContent, '0');
    assert.equal(source.live, 1);
    assert.ok(source.starts >= 2);
    assert.ok(source.stops >= 1);
    /** Render-count baseline used to check filtered notifications. */
    const before = renders;
    await React.act(async () => source.update((s) => ({ ...s, hidden: 1 })));
    assert.equal(renders, before);
    await React.act(async () =>
      source.batch(() => {
        source.update((s) => ({ ...s, count: 1 }));
        source.update((s) => ({ ...s, count: 2 }));
      })
    );
    assert.equal(container.textContent, '2');
    await assert.rejects(
      mountReact(view, container),
      (e) => e.code === 'ROOT_ALREADY_OWNED'
    );
    await React.act(async () =>
      handle.update(React.createElement('p', null, 'updated'))
    );
    assert.equal(container.textContent, 'updated');
    assert.equal(source.live, 0);
    await React.act(async () => handle.unmount());
    handle.unmount();
    assert.equal(disposed, 1);
    assert.equal(container.childNodes.length, 0);
    assert.equal(handle.closed, true);
    assert.throws(
      () => handle.update(view),
      (e) => e.code === 'ROOT_CLOSED'
    );
  }));

test('actual React SSR hydrates with the exact pinned snapshot/prefix and preserves existing input edits', (t) =>
  environment(async (container, _window, own) => {
    /** Owned request-specific public snapshot encoded independently of HTML. */
    const serverState = createReactHydrationState(
      { count: 2, name: 'initial' },
      { identifierPrefix: 'counter', validateState }
    );
    // Register idempotent fixture ownership before subsequent assertions can fail.
    t.after(() => {
      serverState.dispose();
    });
    /** Stable pure fixture selector; no business side effect.
     * @param {unknown} s - Explicit synthetic source/callback/dependency value; never private live state.
     * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
     */
    const selector = (s) => s.count;
    /** Render a synthetic borrowed store through actual native hooks using the declared SSR snapshot.
     * @param {object} props - Explicit trusted fixture props.
     * @param {object} props.store - Borrowed request/fixture store.
     * @returns {object} Explicit synthetic fixture result or intentional failure.
     */
    function View({ store }) {
      /** Selected synthetic count read only through the native hook. */
      const count = bindings.useSelector(store, selector);
      /** Native useId identity shared by label/input across SSR and hydration. */
      const id = React.useId();
      return React.createElement(
        'section',
        null,
        React.createElement('label', { htmlFor: id }, 'Name'),
        React.createElement('input', { id, defaultValue: 'initial' }),
        React.createElement('b', null, count)
      );
    }
    /** Native synthetic SSR output; expected fixtures remain literal and independently checked. */
    const html = await renderReactToString(
      React.createElement(View, { store: serverState.store }),
      { identifierPrefix: serverState.identifierPrefix }
    );
    serverState.dispose();
    container.innerHTML = html;
    /** Synthetic invalid value or emulated input node; never an operator record. */
    const input = container.querySelector('input');
    /** Existing emulated SSR node used to verify native adoption. */
    const bold = container.querySelector('b');
    /** Native useId identity shared by label/input across SSR and hydration. */
    const id = input.id;
    input.value = 'edited before hydration';
    input.focus();
    input.setSelectionRange(1, 4);
    /** Owned decoded public hydration state; dispose on owner teardown. */
    const restored = readReactHydrationState(serverState.data, {
      validateState,
    });
    // Register idempotent fixture ownership before subsequent assertions can fail.
    t.after(() => {
      restored.dispose();
    });
    /** Synthetic source/store value scoped to this fixture, never a user singleton. */
    const source = tracked(restored.store);
    source.set({ count: 3, name: 'initial' });
    assert.equal(source.getServerSnapshot().count, 2);
    let handle;
    await React.act(async () => {
      handle = own(
        await hydrateReact(
          React.createElement(View, { store: source }),
          container,
          {
            identifierPrefix: restored.identifierPrefix,
            onDispose: restored.dispose,
          }
        )
      );
    });
    assert.equal(container.querySelector('input'), input);
    assert.equal(container.querySelector('b'), bold);
    assert.equal(input.value, 'edited before hydration');
    assert.equal(input.id, id);
    assert.equal(container.querySelector('label').htmlFor, id);
    assert.equal(container.textContent, 'Name3');
    assert.equal(handle.errors.length, 0);
    assert.equal(source.live, 1);
    await React.act(async () => handle.unmount());
    assert.equal(source.live, 0);
    assert.equal(container.childNodes.length, 0);
  }));

test('hydration mismatches record fixed diagnostics; cancellation and render failure release subscriptions', (t) =>
  environment(async (container, _window, own) => {
    container.innerHTML = '<p>PRIVATE_SERVER_VALUE</p>';
    let handle;
    await React.act(async () => {
      handle = own(
        await hydrateReact(React.createElement('p', null, 'client'), container)
      );
    });
    assert.equal(container.textContent, 'client');
    assert.ok(handle.errors.some((e) => e.code === 'REACT_RECOVERABLE_ERROR'));
    assert.doesNotMatch(JSON.stringify(handle.errors), /PRIVATE_SERVER_VALUE/);
    await React.act(async () => handle.unmount());
    /** Fixture cancellation controller used to verify explicit root ownership. */
    const signal = new AbortController();
    /** Synthetic source/store value scoped to this fixture, never a user singleton. */
    const source = tracked(createReactStore(1));
    // Register idempotent fixture ownership before subsequent assertions can fail.
    t.after(() => {
      source.destroy();
    });
    let disposed = 0;
    /** Render a synthetic borrowed store through the actual native hook contract.
     * @returns {object} Explicit synthetic fixture result or intentional failure.
     */
    function Good() {
      return React.createElement('p', null, bindings.useStore(source));
    }
    await React.act(async () => {
      handle = own(
        await mountReact(React.createElement(Good), container, {
          signal: signal.signal,
          /** Release exactly the accepted root owner resources/count; Strict Mode probes do not own store destruction.
           * @returns {void} Explicit synthetic fixture result or intentional failure.
           */
          onDispose() {
            disposed++;
            source.destroy();
          },
        })
      );
    });
    assert.equal(source.live, 1);
    await React.act(async () => signal.abort());
    assert.equal(source.live, 0);
    assert.equal(disposed, 1);
    assert.equal(handle.closed, true);
    /** Throw an intentional private fixture rendering cause; it must not enter public diagnostics.
     * @returns {never} Explicit synthetic fixture result or intentional failure.
     */
    function Broken() {
      throw Error('PRIVATE_RENDER_CAUSE');
    }
    let notify;
    /** Observed native diagnostic callback promise; its fixture timer is cleared. */
    const reported = new Promise((resolve) => (notify = resolve));
    let timer;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      handle = own(
        await mountReact(React.createElement(Broken), container, {
          onError: (error) => notify(error),
        })
      );
      await Promise.race([
        reported,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('React error callback timed out')),
            1000
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    }
    assert.ok(
      handle.errors.some(
        (e) =>
          e.code === 'REACT_UNCAUGHT_ERROR' &&
          e.cause.message === 'PRIVATE_RENDER_CAUSE'
      )
    );
    assert.doesNotMatch(JSON.stringify(handle.errors), /PRIVATE_RENDER_CAUSE/);
    await React.act(async () => handle.unmount());
  }));

test('pending root abort, invalid input, observer and cleanup errors have explicit ownership', () =>
  environment(async (container, _window, own) => {
    let disposed = 0;
    /** Fixture cancellation controller; no force-interruption claim. */
    const controller = new AbortController();
    /** Pending native root acquisition observed through cancellation. */
    const pending = mountReact(React.createElement('p', null, 'x'), container, {
      signal: controller.signal,
      onDispose: () => disposed++,
    });
    controller.abort();
    await assert.rejects(pending, (e) => e.code === 'RENDER_ABORTED');
    assert.equal(disposed, 1);
    assert.equal(container.childNodes.length, 0);
    await assert.rejects(
      mountReact(null, {}),
      (e) => e.code === 'INVALID_CONTAINER'
    );
    let handle;
    await React.act(async () => {
      handle = own(
        await mountReact(React.createElement('p', null, 'ok'), container, {
          onDispose: () => {
            throw Error('cleanup dependency failed');
          },
        })
      );
    });
    await React.act(async () =>
      assert.throws(
        () => handle.unmount(),
        (e) => e.code === 'REACT_UNMOUNT_FAILED'
      )
    );
    assert.equal(handle.closed, true);
    assert.equal(container.childNodes.length, 0);
    // A previous failed owner cannot remove a new one.
    let next;
    await React.act(async () => {
      next = own(
        await mountReact(React.createElement('p', null, 'new'), container)
      );
    });
    handle.unmount();
    assert.equal(container.textContent, 'new');
    await React.act(async () => next.unmount());
  }));

test('throwing diagnostic observers remain visible without preventing root cleanup', () =>
  environment(async (container, _window, own) => {
    container.innerHTML = '<p>server</p>';
    /** Private injected observer failure; enumerable diagnostics must remain redacted. */
    const failure = Error('PRIVATE_OBSERVER_DETAIL');
    let handle;
    await React.act(async () => {
      handle = own(
        await hydrateReact(
          React.createElement('p', null, 'client'),
          container,
          {
            /** Throw the intentional private observer failure to verify bounded diagnostic isolation.
             * @returns {never} Explicit synthetic fixture result or intentional failure.
             */
            onError() {
              throw failure;
            },
          }
        )
      );
    });
    assert.ok(
      handle.errors.some(
        (error) =>
          error.code === 'REACT_OBSERVER_FAILED' && error.cause === failure
      )
    );
    assert.doesNotMatch(
      JSON.stringify(handle.errors),
      /PRIVATE_OBSERVER_DETAIL/
    );
    await React.act(async () => handle.unmount());
    assert.equal(container.childNodes.length, 0);
  }));
