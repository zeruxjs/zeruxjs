import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as Vue from '@vue/runtime-dom';
import { createVueBindings } from '../dist/index.js';
import { createVueView, VUE_RENDER_CONTEXT } from '../dist/rendering.js';
import { renderVueToString, getVueServerCapabilities } from '../dist/server.js';
/** Inert runtime-only bridge; SSR explicitly uses one-shot snapshots. */
const bridge = createVueBindings(Vue);
test('actual Vue SSR creates isolated applications and snapshot bindings with no external listeners', async () => {
  /** Per-render subscriber readers used to prove no external registration survives. */
  const sources = [];
  /** Synthetic labels recorded by per-render teardown callbacks. */
  const closed = [];
  /** Trusted authored component for this isolated SSR behavior fixture. */
  const Component = Vue.defineComponent({
    props: ['label'],
    setup(props) {
      /** Per-render injected lifecycle context; never shared across concurrent apps. */
      const context = Vue.inject(VUE_RENDER_CONTEXT);
      assert.equal(context.ssr, true);
      let subscribers = 0;
      /** Borrowed synchronous fixture store with explicit subscription counting. */
      const store = {
        getSnapshot: () => props.label,
        subscribe() {
          subscribers++;
          return () => subscribers--;
        },
      };
      sources.push(() => subscribers);
      /** One-shot SSR snapshot; no external change registration is created. */
      const selected = bridge.useStore(store, { ssr: context.ssr });
      context.onDispose(() => closed.push(props.label));
      /** Native ref owned by this fresh server component. */
      const value = Vue.ref(2);
      /** Native computed value used to verify real render semantics. */
      const doubled = Vue.computed(() => value.value * 2);
      return () => Vue.h('p', null, selected.value + ':' + doubled.value);
    },
  });
  /** Completed concurrent HTML results compared in deterministic request order. */
  const output = await Promise.all(
    ['one', 'two'].map((label) =>
      renderVueToString(createVueView(Component, { label }))
    )
  );
  assert.deepEqual(output, ['<p>one:4</p>', '<p>two:4</p>']);
  assert.ok(sources.every((read) => read() === 0));
  assert.deepEqual(closed.sort(), ['one', 'two']);
  /** Verified adapter capability snapshot from the installed matching peers. */
  const caps = await getVueServerCapabilities();
  assert.equal(caps.version, Vue.version);
  assert.equal(caps.templates, 'precompiled-only');
});

test('SSR rejects templates, unsafe runtime inputs and oversized output; failures still dispose resources', async () => {
  assert.throws(
    () => createVueView({ template: '<p>private</p>' }),
    (e) =>
      e.code === 'TEMPLATE_BUILD_REQUIRED' && !e.message.includes('private')
  );
  assert.throws(
    () =>
      createVueView(
        { render: () => null },
        {
          get bad() {
            return 'private';
          },
        }
      ),
    (e) => e.code === 'INVALID_PROPS'
  );
  await assert.rejects(
    renderVueToString(
      createVueView({ render: () => Vue.h('p', null, 'large') }),
      { maxBytes: 1 }
    ),
    (e) => e.code === 'HTML_BYTE_LIMIT'
  );
  let disposed = 0;
  /** Private synthetic component failure; must not appear in serialized diagnostics. */
  const failure = Error('PRIVATE_SETUP_FAILURE');
  /** Trusted component intentionally throwing after registering cleanup. */
  const Broken = Vue.defineComponent({
    setup() {
      Vue.inject(VUE_RENDER_CONTEXT).onDispose(() => disposed++);
      throw failure;
    },
  });
  await assert.rejects(
    renderVueToString(createVueView(Broken)),
    (e) =>
      e.code === 'VUE_RENDER_FAILED' &&
      !JSON.stringify(e).includes('PRIVATE_SETUP_FAILURE')
  );
  assert.equal(disposed, 1);
  /** Trusted component intentionally returning an unsupported template child. */
  const Dynamic = Vue.defineComponent({
    setup() {
      return () => Vue.h({ template: '<p>{{value}}</p>' });
    },
  });
  await assert.rejects(
    renderVueToString(createVueView(Dynamic)),
    (e) => e.code === 'VUE_RENDER_FAILED'
  );
});

test('SSR async cancellation propagates to cooperative setup and drains after settlement', async () => {
  /** Owned request cancellation controller for the pending SSR fixture. */
  const controller = new AbortController();
  let signal,
    release,
    closed = 0,
    entered;
  /** Barrier proving async setup started before abort is tested. */
  const ready = new Promise((resolve) => (entered = resolve));
  /** Trusted async setup fixture; explicit release cooperatively settles native work. */
  const Async = Vue.defineComponent({
    async setup() {
      /** Per-render injected lifecycle context; never shared across concurrent apps. */
      const context = Vue.inject(VUE_RENDER_CONTEXT);
      signal = context.signal;
      context.onDispose(() => closed++);
      entered();
      await new Promise((resolve) => (release = resolve));
      return () => Vue.h('p', null, 'late');
    },
  });
  /** Owned pending SSR promise; released and awaited after cancellation. */
  const work = renderVueToString(createVueView(Async), {
    signal: controller.signal,
  });
  await ready;
  controller.abort('request closed');
  assert.equal(signal.aborted, true);
  assert.equal(closed, 0);
  release();
  await assert.rejects(work, (e) => e.code === 'RENDER_ABORTED');
  assert.equal(closed, 1);
});

test('native SSR watchers stop and a Node server import needs no DOM globals', async () => {
  /** Native reactive input used to verify SSR watchers are not retained. */
  const state = Vue.ref(0);
  let watched = 0;
  /** Trusted authored component for this isolated SSR behavior fixture. */
  const Component = Vue.defineComponent({
    setup() {
      Vue.watch(state, () => watched++, { flush: 'sync' });
      return () => Vue.h('b', null, state.value);
    },
  });
  await renderVueToString(createVueView(Component));
  state.value++;
  assert.equal(watched, 0);
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `if(typeof document!=='undefined'||typeof window!=='undefined')throw Error('unexpected DOM');const Vue=await import('@vue/runtime-dom');const {renderVueToString}=await import('@zeruxjs/vue/server');const {createVueView}=await import('@zeruxjs/vue/rendering');const html=await renderVueToString(createVueView({render:()=>Vue.h('p',null,'safe')}));if(html!=='<p>safe</p>')throw Error('SSR failed');`,
    ],
    { cwd: process.cwd(), stdio: 'pipe' }
  );
});

test('explicit cleanup drains all disposers and reports failures with private causes', async () => {
  /** Synthetic reverse-order cleanup trace without private payloads. */
  const calls = [];
  /** Trusted authored component for this isolated SSR behavior fixture. */
  const Component = Vue.defineComponent({
    setup() {
      /** Per-render injected lifecycle context; never shared across concurrent apps. */
      const context = Vue.inject(VUE_RENDER_CONTEXT);
      context.onDispose(() => calls.push(1));
      context.onDispose(() => {
        calls.push(2);
        throw Error('PRIVATE_CLEANUP');
      });
      return () => Vue.h('p', null, 'ok');
    },
  });
  await assert.rejects(
    renderVueToString(createVueView(Component)),
    (e) =>
      e.code === 'VUE_CLEANUP_FAILED' &&
      !JSON.stringify(e).includes('PRIVATE_CLEANUP')
  );
  assert.deepEqual(calls, [2, 1]);
});

test('full-compiler realms and inheritance cycles reject before rendering', () => {
  /** Trusted self-referential inheritance fixture; validation must reject its cycle. */
  const component = { render: () => null };
  component.extends = component;
  assert.throws(
    () => createVueView(component),
    (error) => error.code === 'COMPONENT_OPTIONS_CYCLE'
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';await import('vue');const {renderVueToString}=await import('@zeruxjs/vue/server');const {createVueView}=await import('@zeruxjs/vue/rendering');let closed=0;await assert.rejects(renderVueToString(createVueView({render:()=>null}),{onDispose:()=>closed++}),error=>error.code==='RUNTIME_ONLY_BUILD_REQUIRED');assert.equal(closed,1);`,
    ],
    { cwd: process.cwd(), stdio: 'pipe' }
  );
});

test('SSR teleport targets reject rather than silently dropping target output', async () => {
  /** Trusted authored component for this isolated SSR behavior fixture. */
  const Component = Vue.defineComponent({
    render: () =>
      Vue.h(Vue.Teleport, { to: '#outside' }, Vue.h('p', null, 'teleported')),
  });
  await assert.rejects(
    renderVueToString(createVueView(Component)),
    (error) => error.code === 'SSR_TELEPORTS_UNSUPPORTED'
  );
});
