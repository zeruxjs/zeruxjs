import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as React from 'react';
import {
  createReactBindings,
  createReactStore,
  selectReactStore,
} from '../dist/index.js';
import {
  renderReactToString,
  renderReactToStaticMarkup,
  getReactServerCapabilities,
} from '../dist/server.js';
import {
  createReactHydrationState,
  readReactHydrationState,
} from '../dist/hydration.mjs';
/** Stateless actual/injected React hook bindings; per-user stores remain request-owned. */
const bindings = createReactBindings(React);
/** Trusted fixture-only public state projection; no network data is implicitly authorized.
 * @param {unknown} input - Explicit synthetic source/callback/dependency value; never private live state.
 * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
 */
const validateState = (input) => {
  if (!input || typeof input.text !== 'string') {
    throw Error('private schema error');
  }
  return { text: input.text };
};

test('real server rendering escapes output, uses request snapshots and reports installed capabilities', async (t) => {
  /** Render a synthetic borrowed store through actual native hooks using the declared SSR snapshot.
   * @param {object} props - Explicit trusted fixture props.
   * @param {object} props.store - Borrowed request/fixture store.
   * @returns {object} Explicit synthetic fixture result or intentional failure.
   */
  function View({ store }) {
    /** Owned synthetic public state disposed per request/test; never a module singleton. */
    const state = bindings.useStore(store);
    return React.createElement('p', null, state.text);
  }
  /** Finite independent request results used to check state isolation. */
  const outputs = await Promise.all(
    ['one', 'two'].map(async (text) => {
      /** Owned synthetic public state disposed per request/test; never a module singleton. */
      const state = createReactHydrationState(
        { text },
        { identifierPrefix: text, validateState }
      );
      // Register idempotent fixture ownership before subsequent assertions can fail.
      t.after(() => {
        state.dispose();
      });
      try {
        /** Native synthetic SSR output; expected fixtures remain literal and independently checked. */
        const html = await renderReactToString(
          React.createElement(View, { store: state.store }),
          { identifierPrefix: state.identifierPrefix }
        );
        return { html, data: state.data };
      } finally {
        state.dispose();
      }
    })
  );
  assert.deepEqual(
    outputs.map((x) => x.html),
    ['<p>one</p>', '<p>two</p>']
  );
  assert.notEqual(outputs[0].data, outputs[1].data);
  assert.equal(
    await renderReactToStaticMarkup(React.createElement('b', null, '<script>')),
    '<b>&lt;script&gt;</b>'
  );
  /** Actually installed peer capability snapshot; no streaming support is inferred. */
  const caps = await getReactServerCapabilities();
  assert.equal(caps.version, React.version);
  assert.equal(caps.streaming, false);
  /** Throw an intentional private fixture rendering cause; it must not enter public diagnostics.
   * @returns {never} Explicit synthetic fixture result or intentional failure.
   */
  function Broken() {
    throw Error('private dependency failed');
  }
  await assert.rejects(
    renderReactToString(React.createElement(Broken)),
    (e) =>
      e.code === 'REACT_RENDER_FAILED' &&
      e.cause.message === 'private dependency failed'
  );
  await assert.rejects(
    renderReactToString(React.createElement('p', null, 'large'), {
      maxBytes: 1,
    }),
    (e) => e.code === 'HTML_BYTE_LIMIT'
  );
  /** Fixture cancellation controller; no force-interruption claim. */
  const controller = new AbortController();
  controller.abort('private reason');
  await assert.rejects(
    renderReactToString(null, { signal: controller.signal }),
    (e) => e.code === 'RENDER_ABORTED' && e.cause === 'private reason'
  );
});

test('public state codec matches script-breaking payloads without serializing executable/private data', (t) => {
  /** Synthetic script-breaking public string; never executed. */
  const value = { text: '</script><script>bad()</script>\u2028\u2029&' };
  /** Owned synthetic public state disposed per request/test; never a module singleton. */
  const state = createReactHydrationState(value, {
    identifierPrefix: 'safe',
    validateState,
  });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    state.dispose();
  });
  assert.doesNotMatch(state.data, /<|>|&|\u2028|\u2029/);
  /** Owned decoded public hydration state; dispose on owner teardown. */
  const restored = readReactHydrationState(state.data, { validateState });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    restored.dispose();
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.store.getServerSnapshot())),
    value
  );
  assert.equal(
    restored.store.getServerSnapshot(),
    restored.store.getSnapshot()
  );
  assert.ok(Object.isFrozen(restored.store.getServerSnapshot()));
  assert.throws(
    () =>
      readReactHydrationState(state.data, {
        validateState: (x) => ({ text: x.text + 'changed' }),
      }),
    (e) => e.code === 'HYDRATION_STATE_CHANGED'
  );

  // Visit only the finite synthetic cases/archives/global descriptors owned by this fixture.

  for (const input of [
    { password: 'private' },
    { x: new Date() },
    { x: () => 1 },
    { x: undefined },
    { x: NaN },
    // eslint-disable-next-line no-sparse-arrays -- Deliberately sparse input verifies that the public boundary rejects array holes.
    { x: [, 1] },
  ]) {
    assert.throws(() =>
      createReactHydrationState(input, {
        identifierPrefix: 'safe',
        validateState: (x) => x,
      })
    );
  }
  let invoked = 0;
  /** Synthetic invalid value or emulated input node; never an operator record. */
  const input = {};
  Object.defineProperty(input, 'x', {
    enumerable: true,
    /** Expose the intentionally unsafe getter only to prove serialization never invokes it.
     * @returns {string} Explicit synthetic fixture result or intentional failure.
     */
    get() {
      invoked++;
      return 'private';
    },
  });
  assert.throws(() =>
    createReactHydrationState(input, {
      identifierPrefix: 'safe',
      validateState: (x) => x,
    })
  );
  assert.equal(invoked, 0);
  assert.throws(
    () =>
      createReactHydrationState(
        { text: 'x'.repeat(50) },
        { identifierPrefix: 'safe', validateState, maxBytes: 10 }
      ),
    (e) => e.code === 'STATE_BYTE_LIMIT'
  );
  state.dispose();
  restored.dispose();
});

test('server import/render never reads DOM globals', () => {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `for(const key of ['window','document','HTMLElement'])Object.defineProperty(globalThis,key,{get(){throw Error('DOM global read')}});const React=await import('react');const {renderReactToString}=await import('@zeruxjs/react/server');const html=await renderReactToString(React.createElement('p',null,'safe'));if(html!=='<p>safe</p>')throw Error('SSR failed');`,
    ],
    { cwd: process.cwd(), stdio: 'pipe' }
  );
});

test('server selector override is cached and failed selectors do not poison client/server snapshots', (t) => {
  /** Owned synthetic public state disposed per request/test; never a module singleton. */
  const state = createReactStore({ x: 1 });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    state.destroy();
  });
  let pass = true;
  /** Borrowed derived projection; stable equality controls snapshot references. */
  const selected = selectReactStore(
    state,
    (value) => {
      if (!pass) {
        throw Error('selector failed');
      }
      return { x: value.x };
    },
    (a, b) => a.x === b.x
  );
  state.set({ x: 2 });
  pass = false;
  assert.throws(() => selected.getSnapshot(), /selector failed/);
  assert.throws(() => selected.getSnapshot(), /selector failed/);
  pass = true;
  assert.equal(selected.getSnapshot().x, 2);
  /** Explicit stable server snapshot distinct from mutable client state. */
  const server = { x: 9 };
  /** Stable pure fixture selector; no business side effect.
   * @param {unknown} x - Explicit synthetic source/callback/dependency value; never private live state.
   * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
   */
  const selector = (x) => ({ x: x.x });
  let memo,
    deps = [];
  /** Injected hook memoization fixture, not a substitute for native React acceptance. */
  const runtime = {
    useSyncExternalStore: (_subscribe, _get, server) => server(),
    /** Retain one projected fixture value for a stable dependency set, mirroring the injected memo contract.
     * @param {function} create - Explicit synthetic callback/dependency value; not private live data.
     * @param {unknown} next - Explicit synthetic callback/dependency value; not private live data.
     * @returns {unknown} Explicit synthetic fixture result or intentional failure.
     */
    useMemo(create, next) {
      if (!memo || next.some((x, i) => x !== deps[i])) {
        memo = create();
        deps = next;
      }
      return memo;
    },
  };
  /** Stable server-read callback matching the explicit fixture snapshot.
   * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
   */
  const override = () => server;
  /** Inert injected bindings; only actual hook calls subscribe. */
  const hook = createReactBindings(runtime);
  /** First stable selected/server snapshot reference. */
  const a = hook.useSelector(state, selector, { serverSnapshot: override });
  /** Repeated selected/server snapshot reference. */
  const b = hook.useSelector(state, selector, { serverSnapshot: override });
  assert.equal(a, b);
});

test('peer capability policy rejects mixed, unsupported and prerelease versions', async () => {
  /** Private implementation guard imported only by the focused package regression test. */
  const { validateReactVersions } = await import('../dist/render-errors.js');
  // Visit only the finite synthetic cases/archives/global descriptors owned by this fixture.
  for (const pair of [
    ['19.3.1', '19.2.0'],
    ['17.0.2', '17.0.2'],
    ['18.0.0', '18.0.0'],
    ['19.4.0-canary', '19.4.0-canary'],
  ]) {
    assert.throws(
      () => validateReactVersions(...pair),
      (e) => e.code === 'REACT_PEER_VERSION_MISMATCH'
    );
  }
  assert.equal(validateReactVersions('18.3.1', '18.3.1'), 18);
  assert.equal(validateReactVersions(React.version, React.version), 19);
});

test('incomplete native SSR cannot return a development template with a private cause', async () => {
  /** Throw inside a native Suspense boundary so incomplete SSR cannot expose private details.
   * @returns {never} Explicit synthetic fixture result or intentional failure.
   */
  function Failure() {
    throw Error('PRIVATE_SUSPENSE_DETAIL');
  }
  /** Trusted synthetic React element tree, not incoming executable data. */
  const view = React.createElement(
    React.Suspense,
    { fallback: React.createElement('p', null, 'unavailable') },
    React.createElement(Failure)
  );
  await assert.rejects(
    renderReactToString(view),
    (error) =>
      error.code === 'REACT_INCOMPLETE_SSR' &&
      !JSON.stringify(error).includes('PRIVATE_SUSPENSE_DETAIL')
  );
});
