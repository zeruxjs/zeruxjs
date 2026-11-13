import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signal,
  ref,
  watch,
  batch,
  createEffectScope,
  onScopeDispose,
  useState,
  useEffect,
} from '../dist/index.js';
import {
  h,
  render,
  unmount,
  defineComponent,
  renderToString,
} from '../dist/dom/index.js';
import { root } from './dom-fixture.mjs';
/**
 * Test helper elements.
 * @param {unknown} node - Test input for this helper.
 * @returns {unknown} Result produced by this test helper.
 */
const elements = (node) =>
  node.childNodes.filter((child) => child.nodeType === 1);

test('keyed setup identity, current props, independent roots, effects and fragment ranges', () => {
  /**
   * Test fixture a.
   */
  const a = root(),
    b = root(),
    updates = signal(0);
  let setups = 0,
    releases = 0,
    effects = 0;
  /**
   * Test fixture Item.
   */
  const Item = defineComponent((initial) => {
    setups++;
    /**
     * Test fixture [count, setCount].
     */
    const [count, setCount] = useState(0);
    useEffect(() => {
      updates.value;
      effects++;
    });
    onScopeDispose(() => releases++);
    return (props) => [
      h(
        'button',
        { onClick: () => setCount(count() + 1), 'data-id': initial.id },
        `${props.label}:${count()}:${updates.value}`
      ),
      h('i', {}, initial.id),
    ];
  });
  /**
   * Test helper list.
   * @param {unknown} labels - Test input for this helper.
   * @returns {unknown} Result produced by this test helper.
   */
  const list = (labels) =>
    h(
      'div',
      {},
      ...labels.map(([id, label]) => h(Item, { key: id, id, label }))
    );
  render(
    list([
      [1, 'a'],
      [2, 'b'],
    ]),
    a
  );
  render(h(Item, { id: 3, label: 'c' }), b);
  /**
   * Test fixture [one, , two].
   */
  const [one, , two] = elements(a.childNodes[0]);
  one.dispatch('click');
  render(
    list([
      [2, 'B'],
      [1, 'A'],
      [4, 'D'],
    ]),
    a
  );
  assert.equal(setups, 4);
  assert.equal(elements(a.childNodes[0])[0], two);
  assert.equal(elements(a.childNodes[0])[2], one);
  updates.value++;
  assert.match(a.textContent, /A:1:1/);
  assert.match(a.textContent, /B:0:1/);
  assert.match(b.textContent, /c:0:1/);
  render(list([[1, 'A']]), a);
  assert.equal(releases, 2);
  two.dispatch('click');
  unmount(a);
  unmount(b);
  /**
   * Test fixture before.
   */
  const before = effects;
  updates.value++;
  assert.equal(effects, before);
  assert.equal(releases, 4);
  assert.equal(a.childNodes.length + b.childNodes.length, 0);
});

test('prop replacement re-tracks dependencies and listener replacement removes old callback', () => {
  /**
   * Test fixture container.
   */
  const container = root(),
    left = signal('L'),
    right = signal('R');
  let old = 0,
    next = 0,
    renders = 0;
  /**
   * Test helper View.
   * @param {unknown} props - Test input for this helper.
   * @returns {unknown} Result produced by this test helper.
   */
  const View = (props) => {
    renders++;
    return h('button', { onClick: props.click }, props.source.value);
  };
  render(h(View, { source: left, click: () => old++ }), container);
  /**
   * Test fixture button.
   */
  const button = elements(container)[0];
  render(h(View, { source: right, click: () => next++ }), container);
  /**
   * Test fixture baseline.
   */
  const baseline = renders;
  left.value = 'old';
  assert.equal(renders, baseline);
  right.value = 'new';
  assert.equal(container.textContent, 'new');
  button.dispatch('click');
  assert.equal(old, 0);
  assert.equal(next, 1);
  unmount(container);
  button.dispatch('click');
  assert.equal(next, 1);
});

test('fragments insert and remove; duplicate keys and Promise children reject', () => {
  /**
   * Test fixture container.
   */
  const container = root();
  render([h('b', {}, 'a'), h('i', {}, 'b')], container);
  render([h('i', {}, 'c')], container);
  assert.equal(container.textContent, 'c');
  assert.throws(
    () =>
      render(h('ul', {}, h('li', { key: 1 }), h('li', { key: 1 })), container),
    /unique/
  );
  assert.equal(container.textContent, 'c');
  assert.throws(() => render(Promise.resolve('bad'), container), /Promise/);
  unmount(container);
  assert.equal(container.childNodes.length, 0);
});

test('render boundary catches setup/render dependency failure; event errors still propagate', () => {
  /**
   * Test fixture container.
   */
  const container = root(),
    fail = signal(false);
  /**
   * Test fixture error.
   */
  const error = new Error('dependency unavailable');
  let cleaned = 0,
    caught = 0;
  /**
   * Test fixture View.
   */
  const View = defineComponent(
    () => {
      onScopeDispose(() => cleaned++);
      return () => {
        if (fail.value) {
          throw error;
        }
        return h(
          'button',
          {
            onClick: () => {
              throw error;
            },
          },
          'ok'
        );
      };
    },
    {
      onError: (e) => {
        assert.equal(e, error);
        caught++;
        return h('p', {}, 'unavailable');
      },
    }
  );
  render(h(View, {}), container);
  assert.throws(
    () => elements(container)[0].dispatch('click'),
    (e) => e === error
  );
  assert.equal(caught, 0);
  fail.value = true;
  assert.equal(container.textContent, 'unavailable');
  fail.value = false;
  assert.equal(container.textContent, 'ok');
  unmount(container);
  assert.equal(cleaned, 1);
  assert.throws(
    () =>
      render(
        h(
          defineComponent(() => {
            onScopeDispose(() => cleaned++);
            throw error;
          }),
          {}
        ),
        container
      ),
    (e) => e === error
  );
  assert.equal(cleaned, 2);
  assert.equal(container.childNodes.length, 0);
});

test('hooks in repeated render diagnose invalid ownership; SSR disposes setup effects', () => {
  /**
   * Test fixture container.
   */
  const container = root(),
    source = signal(0);
  let observed = 0;
  assert.throws(
    () =>
      render(
        h(() => {
          useState(0);
          return 'bad';
        }, {}),
        container
      ),
    /during render/
  );
  assert.equal(container.childNodes.length, 0);
  /**
   * Test fixture View.
   */
  const View = defineComponent(() => {
    useEffect(() => {
      source.value;
      observed++;
    });
    return () => h('p', {}, source.value);
  });
  assert.equal(renderToString(h(View, {})), '<p>0</p>');
  source.value++;
  assert.equal(observed, 1);
  assert.throws(() => renderToString(Promise.resolve('bad')), /Promise/);
});

test('refs detach, failed construction rolls back listeners, and cleanup errors do not strand siblings', () => {
  /**
   * Test fixture container.
   */
  const container = root(),
    holder = { current: null };
  let detached,
    clicks = 0;
  render(h('button', { ref: holder, onClick: () => clicks++ }), container);
  detached = holder.current;
  assert.ok(detached);
  unmount(container);
  assert.equal(holder.current, null);
  detached.dispatch('click');
  assert.equal(clicks, 0);
  assert.throws(
    () =>
      render(
        h(
          'div',
          {},
          h('button', {
            ref: (el) => {
              if (el) {
                detached = el;
              }
            },
            onClick: () => clicks++,
          }),
          h('bad tag', {})
        ),
        container
      ),
    /Invalid/
  );
  detached.dispatch('click');
  assert.equal(clicks, 0);
  assert.equal(container.childNodes.length, 0);
  /**
   * Test fixture Broken.
   */
  const Broken = defineComponent(() => {
    onScopeDispose(() => {
      throw Error('cleanup');
    });
    return () => 'x';
  });
  render(
    h(
      'div',
      {},
      h(Broken, {}),
      h('button', { ref: holder, onClick: () => clicks++ })
    ),
    container
  );
  detached = holder.current;
  assert.throws(() => unmount(container), AggregateError);
  assert.equal(container.childNodes.length, 0);
  assert.equal(holder.current, null);
  detached.dispatch('click');
  assert.equal(clicks, 0);
  unmount(container);
});

test('watch tracks only source, cleans on change/stop, and belongs to setup scopes', () => {
  /**
   * Test fixture source.
   */
  const source = ref(0),
    incidental = signal(0),
    values = [];
  let cleaned = 0;
  /**
   * Test fixture scope.
   */
  const scope = createEffectScope();
  scope.run(() =>
    watch(
      () => source.value,
      (value, old) => {
        incidental.value;
        values.push([value, old]);
        return () => cleaned++;
      },
      { immediate: true }
    )
  );
  incidental.value++;
  assert.equal(values.length, 1);
  batch(() => {
    source.value = 1;
    source.value = 2;
  });
  assert.deepEqual(values, [
    [0, undefined],
    [2, 0],
  ]);
  scope.dispose();
  source.value = 3;
  assert.equal(values.length, 2);
  assert.equal(cleaned, 2);
});

test('failed setup releases effects before fallback and replacement cleanup cannot leak new subtree', () => {
  /**
   * Test fixture container.
   */
  const container = root(),
    state = signal(0);
  let observed = 0,
    replacement = null;
  /**
   * Test fixture Broken.
   */
  const Broken = defineComponent(
    () => {
      useEffect(() => {
        state.value;
        observed++;
      });
      throw Error('missing dependency');
    },
    { onError: () => 'fallback' }
  );
  render(h(Broken, {}), container);
  state.value++;
  assert.equal(observed, 1);
  assert.equal(container.textContent, 'fallback');
  unmount(container);
  /**
   * Test fixture BadCleanup.
   */
  const BadCleanup = defineComponent(() => {
    onScopeDispose(() => {
      throw Error('failed cleanup');
    });
    return () => 'old';
  });
  render(h(BadCleanup, {}), container);
  assert.throws(
    () =>
      render(
        h(
          'button',
          {
            ref: (value) => {
              if (value) {
                replacement = value;
              }
            },
            onClick: () => {
              throw Error('listener leaked');
            },
          },
          'new'
        ),
        container
      ),
    AggregateError
  );
  assert.equal(container.childNodes.length, 0);
  assert.doesNotThrow(() => replacement.dispatch('click'));
  unmount(container);
});

test('asynchronous event rejection remains owned by the handler caller', async () => {
  /**
   * Test fixture container.
   */
  const container = root(),
    failure = Error('async dependency failed');
  let caught = 0;
  /**
   * Test helper handler.
   * @returns {unknown} Result produced by this test helper.
   */
  const handler = async () => {
    throw failure;
  };
  /**
   * Test fixture View.
   */
  const View = defineComponent(() => () => h('button', { onClick: handler }), {
    onError: () => {
      caught++;
      return 'fallback';
    },
  });
  render(h(View, {}), container);
  /**
   * Test fixture registered.
   */
  const registered = [...elements(container)[0].listeners.get('click')][0];
  assert.equal(registered, handler);
  await assert.rejects(registered({ type: 'click' }), (e) => e === failure);
  assert.equal(caught, 0);
  unmount(container);
});
