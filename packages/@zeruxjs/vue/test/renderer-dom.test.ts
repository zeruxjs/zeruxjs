import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createVueBindings } from '../dist/index.js';
import { createVueView, VUE_RENDER_CONTEXT } from '../dist/rendering.js';
import { mountVue, hydrateVue } from '../dist/browser.js';
import { renderVueToString } from '../dist/server.js';
/** Owned jsdom realm; after hook closes it and restores borrowed global descriptors. */
const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'https://app.test/',
});
/** Original global property descriptors restored after the entire fixture. */
const saved = new Map();
for (const name of [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'SVGElement',
  'HTMLInputElement',
]) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  /** Select the corresponding synthetic DOM global without altering unrelated globals. */
  let value;
  if (name === 'window') {
    value = dom.window;
  } else if (name === 'document') {
    value = dom.window.document;
  } else {
    value = dom.window[name];
  }
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}
after(() => {
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  }
});
/** Runtime-only peer imported after installing the synthetic DOM globals. */
const Vue = await import('@vue/runtime-dom');
/** Inert bridge using the same native runtime as the test components. */
const bridge = createVueBindings(Vue);
/** Allocate an owned fixture DOM node; each test removes its root.
 * @returns {Element} Newly attached synthetic root element.
 */
const container = () => {
  /** Owned synthetic root element appended to the fixture body. */
  const element = document.createElement('main');
  document.body.appendChild(element);
  return element;
};
/** Create a synchronous borrowed-store fixture with observable subscription counts.
 * @param {unknown} initial - Initial synthetic state retained by reference.
 * @returns {object} Mutable snapshot fixture with explicit unsubscribe functions.
 */
function store(initial) {
  let value = initial;
  /** Synthetic store registrations used to verify native scope cleanup. */
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next) {
      value = next;
      for (const fn of [...listeners]) {
        fn();
      }
    },
    get active() {
      return listeners.size;
    },
  };
}

test('real Vue ref/computed/scoped watch updates survive prop update and stop on unmount', async (t) => {
  /** Owned synthetic container removed after native teardown. */
  const host = container();
  /** Borrowed fixture store with visible active subscription count. */
  const source = store(1);
  let count,
    watched = 0,
    setups = 0,
    disposed = 0;
  /** Trusted render-only component exercising native reactive scope ownership. */
  const Component = Vue.defineComponent({
    props: ['label', 'source'],
    setup(props) {
      setups++;
      count = Vue.ref(1);
      /** Native computed value owned by the component effect scope. */
      const doubled = Vue.computed(() => count.value * 2);
      /** Scope-owned bridge snapshot of the borrowed external store. */
      const external = bridge.useStore(props.source);
      Vue.watch(count, () => watched++, { flush: 'sync' });
      return () =>
        Vue.h(
          'p',
          null,
          props.label + ':' + doubled.value + ':' + external.value
        );
    },
  });
  /** Owned native mount/hydration handle; await unmount before removing its host. */
  const root = await mountVue(
    createVueView(Component, { label: 'first', source }),
    host,
    { onDispose: () => disposed++ }
  );
  // Failure paths also release the native root; repeated unmount shares its settled result.
  t.after(async () => {
    await root.unmount();
    host.remove();
  });
  assert.equal(host.textContent, 'first:2:1');
  assert.equal(source.active, 1);
  count.value = 3;
  source.set(4);
  await Vue.nextTick();
  assert.equal(host.textContent, 'first:6:4');
  /** Original DOM child identity used to detect unintended replacement. */
  const node = host.firstChild;
  await root.update(createVueView(Component, { label: 'next', source }));
  assert.equal(host.firstChild, node);
  assert.equal(setups, 1);
  assert.equal(host.textContent, 'next:6:4');
  await assert.rejects(
    mountVue(createVueView(Component, { source }), host),
    (e) => e.code === 'ROOT_ALREADY_OWNED'
  );
  await root.unmount();
  await root.unmount();
  assert.equal(source.active, 0);
  /** Watcher count captured before a post-teardown mutation. */
  const before = watched;
  count.value++;
  assert.equal(watched, before);
  assert.equal(disposed, 1);
  assert.equal(host.childNodes.length, 0);
  await assert.rejects(
    root.update(createVueView(Component)),
    (e) => e.code === 'ROOT_CLOSED'
  );
  host.remove();
});

test('native hydration matches IDs and controlled forms follow Vue model/event semantics', async (t) => {
  /** Owned synthetic container removed after native teardown. */
  const host = container();
  let state;
  /** Trusted controlled-input fixture with matching native IDs across SSR and hydration. */
  const Form = Vue.defineComponent({
    props: ['initial'],
    setup(props) {
      state = Vue.ref(props.initial);
      /** Per-app injected lifecycle context used to fence retained event callbacks. */
      const context = Vue.inject(VUE_RENDER_CONTEXT);
      /** Native deterministic input ID compared across hydration. */
      const id = Vue.useId();
      return () =>
        Vue.h('section', null, [
          Vue.h('label', { for: id }, 'Name'),
          Vue.h('input', {
            id,
            value: state.value,
            onInput: (event) => {
              if (!context.signal.aborted) {
                state.value = event.target.value;
              }
            },
          }),
          Vue.h('b', null, state.value),
        ]);
    },
  });
  host.innerHTML = await renderVueToString(
    createVueView(Form, { initial: 'initial' }),
    { idPrefix: 'form' }
  );
  /** Borrowed input node retained to test detached event behavior. */
  const input = host.querySelector('input');
  /** Native deterministic input ID compared across hydration. */
  const id = input.id;
  input.value = 'pre-hydration edit';
  /** Owned native mount/hydration handle; await unmount before removing its host. */
  const root = await hydrateVue(
    createVueView(Form, { initial: 'initial' }),
    host,
    { idPrefix: 'form' }
  );
  // Failure paths also release the native root; repeated unmount shares its settled result.
  t.after(async () => {
    await root.unmount();
    host.remove();
  });
  assert.equal(host.querySelector('input'), input);
  assert.equal(input.id, id);
  assert.equal(host.querySelector('label').htmlFor, id);
  assert.equal(input.value, 'initial');
  input.value = 'typed';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await Vue.nextTick();
  assert.equal(state.value, 'typed');
  assert.equal(host.querySelector('b').textContent, 'typed');
  await root.unmount();
  /** State captured after teardown; detached events must leave it unchanged. */
  const previous = state.value;
  input.value = 'detached';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(state.value, previous);
  host.remove();
});

test('abort and failed setup own cleanup; templates cannot be compiled during mount/update', async (t) => {
  /** Owned synthetic container removed after native teardown. */
  const host = container();
  /** Borrowed fixture store with visible active subscription count. */
  const source = store(1);
  /** Owned cancellation controller for this fixture mount. */
  const signal = new AbortController();
  let disposed = 0;
  /** Trusted successful render-only component used before failure or abort. */
  const Good = Vue.defineComponent({
    setup() {
      /** Scope-owned readonly external snapshot used by the fixture component. */
      const value = bridge.useStore(source);
      Vue.inject(VUE_RENDER_CONTEXT).onDispose(() => disposed++);
      return () => Vue.h('p', null, value.value);
    },
  });
  /** Owned native mount/hydration handle; await unmount before removing its host. */
  const root = await mountVue(createVueView(Good), host, {
    signal: signal.signal,
  });
  // Failure paths also release the native root; repeated unmount shares its settled result.
  t.after(async () => {
    await root.unmount();
    host.remove();
  });
  signal.abort();
  await root.unmount();
  assert.equal(source.active, 0);
  assert.equal(disposed, 1);
  /** Trusted component intentionally throwing during native setup. */
  const Broken = Vue.defineComponent({
    setup() {
      bridge.useStore(source);
      throw Error('PRIVATE_FAILURE');
    },
  });
  await assert.rejects(
    mountVue(createVueView(Broken), host),
    (e) => e.code === 'VUE_MOUNT_FAILED'
  );
  assert.equal(source.active, 0);
  assert.equal(host.childNodes.length, 0);
  /** Second owned root proving an earlier teardown released the container. */
  const next = await mountVue(createVueView(Good), host);
  // Failure paths also release the native root; repeated unmount shares its settled result.
  t.after(async () => {
    await next.unmount();
    host.remove();
  });
  await assert.rejects(
    next.update({ component: { template: '<p>bad</p>' } }),
    (e) => e.code === 'TEMPLATE_BUILD_REQUIRED'
  );
  assert.equal(host.textContent, '1');
  await next.unmount();
  host.remove();
});

test('native bridges roll back a failing subscription re-read and preserve proxy prop semantics', async (t) => {
  let calls = 0,
    active = 0;
  /** Borrowed store intentionally failing the subscription-gap re-read. */
  const broken = {
    getSnapshot() {
      if (calls++ === 0) {
        return 1;
      }
      throw Error('dependency read failed');
    },
    subscribe() {
      active++;
      return () => active--;
    },
  };
  assert.throws(() => bridge.connect(broken), /dependency read failed/);
  assert.equal(active, 0);
  /** Owned synthetic container removed after native teardown. */
  const host = container();
  /** Native ref retained inside a reactive prop fixture. */
  const count = Vue.ref(2);
  /** Borrowed native reactive prop bag whose values are not deeply cloned. */
  const props = Vue.reactive({ count });
  /** Trusted authored component proving native prop/class normalization. */
  const View = Vue.defineComponent({
    props: ['count'],
    setup(p) {
      return () => Vue.h('b', null, String(p.count));
    },
  });
  /** Owned native mount/hydration handle; await unmount before removing its host. */
  const root = await mountVue(createVueView(View, props), host);
  // Failure paths also release the native root; repeated unmount shares its settled result.
  t.after(async () => {
    await root.unmount();
    host.remove();
  });
  assert.equal(host.textContent, '2');
  await root.unmount();
  host.remove();
});

test('native class/style normalization uses a mutable Vue prop copy and dynamic templates fail closed', async (t) => {
  /** Owned synthetic container removed after native teardown. */
  const host = container();
  /** Trusted authored component proving native prop/class normalization. */
  const View = Vue.defineComponent({ render: () => Vue.h('p', null, 'class') });
  /** Owned native mount/hydration handle; await unmount before removing its host. */
  const root = await mountVue(
    createVueView(View, {
      class: ['one', { two: true }],
      style: { color: 'red' },
    }),
    host
  );
  // Failure paths also release the native root; repeated unmount shares its settled result.
  t.after(async () => {
    await root.unmount();
    host.remove();
  });
  assert.equal(host.firstChild.className, 'one two');
  assert.equal(host.firstChild.style.color, 'red');
  await root.unmount();
  /** Trusted component intentionally returning an unsupported template child. */
  const Dynamic = Vue.defineComponent({
    setup() {
      return () => Vue.h({ template: '<p>blocked</p>' });
    },
  });
  await assert.rejects(
    mountVue(createVueView(Dynamic), host),
    (error) => error.code === 'TEMPLATE_BUILD_REQUIRED'
  );
  assert.equal(host.childNodes.length, 0);
  host.remove();
});

test('failed native updates reject and scoped fromRef watchers stop with their Vue owner', async (t) => {
  /** Borrowed native ref watched within an explicitly owned effect scope. */
  const native = Vue.ref(0);
  /** Owned native effect scope stopped before post-disposal mutations. */
  const scope = Vue.effectScope();
  let observed = 0;
  scope.run(() => {
    bridge.fromRef(native).subscribe(() => observed++);
  });
  native.value++;
  assert.equal(observed, 1);
  scope.stop();
  native.value++;
  assert.equal(observed, 1);
  /** Owned synthetic container removed after native teardown. */
  const host = container();
  /** Trusted successful render-only component used before failure or abort. */
  const Good = Vue.defineComponent({ render: () => Vue.h('p', null, 'ok') });
  /** Trusted component intentionally failing during a native update. */
  const Bad = Vue.defineComponent({
    setup() {
      throw Error('dependency unavailable');
    },
  });
  /** Owned native mount/hydration handle; await unmount before removing its host. */
  const root = await mountVue(createVueView(Good), host);
  // Failure paths also release the native root; repeated unmount shares its settled result.
  t.after(async () => {
    await root.unmount();
    host.remove();
  });
  await assert.rejects(
    root.update(createVueView(Bad)),
    (error) => error.code === 'VUE_UPDATE_FAILED'
  );
  await root.unmount();
  assert.equal(host.childNodes.length, 0);
  host.remove();
});
