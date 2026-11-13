import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseFragment } from 'parse5';
import {
  renderToHydratable,
  defineComponent,
  h,
  signal,
  useId,
  trustedHTML,
  useEffect,
  onScopeDispose,
} from '../dist/server.js';
import { hydrate, HydrationError } from '../dist/hydrate.js';
import { render, unmount, renderToString } from '../dist/dom/index.js';
import { root } from './dom-fixture.mjs';
/**
 * Test helper validateProps.
 * @param {unknown} input - Test input for this helper.
 * @returns {unknown} Result produced by this test helper.
 */
const validateProps = (input) => {
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.label !== 'string' ||
    Object.keys(input).some((key) => key !== 'label')
  ) {
    throw Error('invalid public props');
  }
  return { label: input.label };
};
/**
 * Test helper parsed.
 * @param {unknown} html - Test input for this helper.
 * @returns {unknown} Result produced by this test helper.
 */
function parsed(html) {
  /**
   * Test fixture container.
   */
  const container = root(),
    doc = container.ownerDocument;
  /**
   * Test helper append.
   * @param {unknown} source - Test input for this helper.
   * @param {unknown} parent - Test input for this helper.
   * @returns {unknown} Result produced by this test helper.
   */
  const append = (source, parent) => {
    if (source.nodeName === '#text') {
      parent.appendChild(doc.createTextNode(source.value));
      return;
    }
    if (source.nodeName === '#comment') {
      parent.appendChild(doc.createComment(source.data));
      return;
    }
    /**
     * Test fixture node.
     */
    const node = doc.createElement(source.tagName);
    for (const { name, value } of source.attrs) {
      node.setAttribute(name, value);
    }
    node.value = node.getAttribute('value') ?? '';
    node.checked = node.getAttribute('checked') !== null;
    node.selected = node.getAttribute('selected') !== null;
    parent.appendChild(node);
    for (const child of source.childNodes ?? []) {
      append(child, node);
    }
  };
  for (const child of parseFragment(html).childNodes) {
    append(child, container);
  }
  return container;
}
/**
 * Test helper all.
 * @param {unknown} root - Test input for this helper.
 * @param {unknown} name - Test input for this helper.
 * @returns {unknown} Result produced by this test helper.
 */
function all(root, name) {
  return root.childNodes.flatMap((node) => [
    ...(node.nodeName === name.toUpperCase() ? [node] : []),
    ...all(node, name),
  ]);
}
/**
 * Test fixture options.
 */
const options = { idPrefix: 'test', validateProps };

test('deterministic server IDs/fragments, context escaping and script data stay separate', () => {
  /**
   * Test fixture C.
   */
  const C = defineComponent(() => {
    /**
     * Test fixture id.
     */
    const id = useId();
    return (props) => [
      h('label', { for: id, title: '"`\n<&' }, props.label),
      h('input', { id, value: props.label }),
    ];
  });
  /**
   * Test fixture input.
   */
  const input = { label: '</script><script>bad()</script>\u2028&' };
  /**
   * Test fixture output.
   */
  const output = renderToHydratable(C, input, options);
  assert.deepEqual(renderToHydratable(C, input, options), output);
  assert.match(output.html, /test-c1-1/);
  assert.match(output.html, /&#xa;/);
  assert.match(output.html, /&lt;\/script&gt;/);
  assert.doesNotMatch(output.data, /<|>|&|\u2028/);
  assert.equal(JSON.parse(output.data).props.label, input.label);
  assert.match(output.html, /<!--zyro-start-->/);
  assert.equal(renderToString(h('p', {}, 'a<&')), '<p>a&lt;&amp;</p>');
  /**
   * Test fixture container.
   */
  const container = parsed(output.html),
    inputNode = all(container, 'input')[0];
  /**
   * Test fixture handle.
   */
  const handle = hydrate(C, container, { data: output.data, validateProps });
  assert.equal(all(container, 'input')[0], inputNode);
  assert.equal(inputNode.getAttribute('id'), 'test-c1-1');
  assert.equal(handle.status, 'hydrated');
  handle.dispose();
  assert.equal(container.childNodes.length, 0);
});

test('hydration retains input edits, checked state and keyed identity through reactive updates', () => {
  let names,
    text,
    checked,
    cleanups = 0;
  /**
   * Test fixture C.
   */
  const C = defineComponent(() => {
    names = signal([1, 2, 3]);
    text = signal('initial');
    checked = signal(false);
    onScopeDispose(() => cleanups++);
    return () =>
      h(
        'section',
        {},
        h('input', { 'bind:value': text }),
        h('input', { 'bind:checked': checked }),
        () => text.value,
        () =>
          names.value.map((id) =>
            h(
              'button',
              {
                key: id,
                'data-id': id,
                onClick: () => {
                  names.value = names.value.filter((x) => x !== id);
                },
              },
              String(id)
            )
          )
      );
  });
  /**
   * Test fixture output.
   */
  const output = renderToHydratable(C, { label: 'forms' }, options);
  assert.equal(cleanups, 1);
  /**
   * Test fixture container.
   */
  const container = parsed(output.html),
    [input, checkbox] = all(container, 'input'),
    buttons = all(container, 'button');
  input.value = 'user edit';
  checkbox.checked = true;
  /**
   * Test fixture handle.
   */
  const handle = hydrate(C, container, { data: output.data, validateProps });
  assert.equal(input.value, 'user edit');
  assert.equal(text.value, 'user edit');
  assert.equal(checked.value, true);
  assert.equal(all(container, 'input')[0], input);
  assert.match(container.textContent, /user edit/);
  names.value = [3, 1, 4];
  assert.equal(all(container, 'button')[0], buttons[2]);
  assert.equal(all(container, 'button')[1], buttons[0]);
  buttons[2].dispatch('click');
  assert.deepEqual(names.peek(), [1, 4]);
  handle.dispose();
  assert.equal(cleanups, 2);
  buttons[0].dispatch('click');
  assert.deepEqual(names.peek(), [1, 4]);
  assert.equal(container.childNodes.length, 0);
});

test('mismatch has redacted diagnostics, default preserves nodes and replacement is explicit', () => {
  let releases = 0;
  /**
   * Test fixture C.
   */
  const C = defineComponent(() => {
    onScopeDispose(() => releases++);
    return (p) => h('p', {}, p.label);
  });
  /**
   * Test fixture output.
   */
  const output = renderToHydratable(C, { label: 'public' }, options),
    container = parsed(output.html);
  /**
   * Test fixture p.
   */
  const p = all(container, 'p')[0];
  p.childNodes.find((n) => n.nodeType === 3).textContent = 'PRIVATE_SECRET';
  /**
   * Test fixture diagnostics.
   */
  const diagnostics = [];
  assert.throws(
    () =>
      hydrate(C, container, {
        data: output.data,
        validateProps,
        onMismatch: (d) => diagnostics.push(d),
      }),
    (e) => e.code === 'HYDRATION_MISMATCH'
  );
  assert.equal(all(container, 'p')[0], p);
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_SECRET|public/);
  assert.equal(releases, 2);
  /**
   * Test fixture handle.
   */
  const handle = hydrate(C, container, {
    data: output.data,
    validateProps,
    mismatch: 'replace',
  });
  assert.equal(handle.status, 'replaced');
  assert.notEqual(all(container, 'p')[0], p);
  assert.equal(container.textContent, 'public');
  assert.throws(
    () => hydrate(C, container, { data: output.data, validateProps }),
    (e) => e.code === 'ROOT_OWNED'
  );
  handle.dispose();
  assert.equal(container.childNodes.length, 0);
  assert.equal(releases, 4);
});

test('unsafe markup and unsupported runtime props reject without reflecting private values', () => {
  /**
   * Test helper identity.
   * @param {unknown} x - Test input for this helper.
   * @returns {unknown} Result produced by this test helper.
   */
  const identity = (x) => x;
  /**
   * Test component that forwards public props to an anchor element.
   * @param {Record<string, unknown>} props - Props passed to the anchor.
   * @returns {unknown} Rendered test VNode.
   */
  const C = (props) => h('a', props, 'text');
  for (const props of [
    { href: 'javascript:bad()' },
    { onClick: 'private script' },
    { onclick: 'bad()' },
    { srcdoc: '<script>bad()</script>' },
    { innerHTML: 'raw' },
    { href: '//untrusted.test' },
  ]) {
    assert.throws(
      () => renderToHydratable(() => h('a', props), { label: 'a' }, options),
      (e) => e instanceof HydrationError && !e.message.includes('bad()')
    );
  }
  for (const props of [
    { password: 'SECRET' },
    { value: () => 1 },
    { value: new Date() },
    { value: NaN },
    { value: undefined },
    Object.assign(Object.create({ inherited: true }), { value: 1 }),
  ]) {
    assert.throws(
      () =>
        renderToHydratable(C, props, {
          idPrefix: 'public',
          validateProps: identity,
        }),
      (e) => e instanceof HydrationError && !e.message.includes('SECRET')
    );
  }
  let getter = 0;
  /**
   * Test fixture value.
   */
  const value = {};
  Object.defineProperty(value, 'value', {
    enumerable: true,
    get() {
      getter++;
      return 'private';
    },
  });
  assert.throws(
    () =>
      renderToHydratable(C, value, {
        idPrefix: 'public',
        validateProps: identity,
      }),
    /accessors/
  );
  assert.equal(getter, 0);
  assert.throws(
    () =>
      renderToHydratable(
        () => h('script', {}, 'bad()'),
        { label: 'a' },
        options
      ),
    (e) => e.code === 'UNSUPPORTED_TAG'
  );
  assert.throws(
    () =>
      hydrate(C, root(), {
        data: '{"version":9,"idPrefix":"test","props":{}}',
        validateProps: identity,
      }),
    (e) => e.code === 'INVALID_VERSION'
  );
});

test('server failure/abort/budgets dispose effects, hydrated abort releases listeners', () => {
  /**
   * Test fixture source.
   */
  const source = signal(0);
  let observed = 0,
    releases = 0;
  /**
   * Test fixture controller.
   */
  const controller = new AbortController();
  /**
   * Test fixture C.
   */
  const C = defineComponent(() => {
    useEffect(() => {
      source.value;
      observed++;
    });
    onScopeDispose(() => releases++);
    return () => {
      controller.abort(Error('private reason'));
      return 'never';
    };
  });
  assert.throws(
    () =>
      renderToHydratable(
        C,
        { label: 'a' },
        { ...options, signal: controller.signal }
      ),
    (e) =>
      e.name === 'AbortError' &&
      e.cause === controller.signal.reason &&
      !e.message.includes('private')
  );
  source.value++;
  assert.equal(observed, 1);
  assert.equal(releases, 1);
  /**
   * Test fixture Broken.
   */
  const Broken = defineComponent(() => {
    onScopeDispose(() => releases++);
    throw Error('dependency unavailable');
  });
  assert.throws(
    () => renderToHydratable(Broken, { label: 'a' }, options),
    /dependency unavailable/
  );
  assert.equal(releases, 2);
  assert.throws(
    () =>
      renderToHydratable(
        () => Array(20).fill('x'),
        { label: 'a' },
        { ...options, maxNodes: 5 }
      ),
    (e) => e.code === 'RENDER_LIMIT'
  );
  let clicks = 0;
  /**
   * Test helper View.
   * @returns {unknown} Result produced by this test helper.
   */
  const View = () => h('button', { onClick: () => clicks++ }, 'ok');
  /**
   * Test fixture output.
   */
  const output = renderToHydratable(View, { label: 'a' }, options),
    container = parsed(output.html),
    button = all(container, 'button')[0],
    abort = new AbortController();
  hydrate(View, container, {
    data: output.data,
    validateProps,
    signal: abort.signal,
  });
  button.dispatch('click');
  abort.abort();
  button.dispatch('click');
  assert.equal(clicks, 1);
  assert.equal(container.childNodes.length, 0);
  /**
   * Test fixture before.
   */
  const before = new AbortController();
  before.abort();
  assert.throws(
    () =>
      hydrate(View, parsed(output.html), {
        data: output.data,
        validateProps,
        signal: before.signal,
      }),
    (e) => e.name === 'AbortError'
  );
});

test('server entry imports/renders without reading DOM globals or loading DOM renderer', () => {
  /**
   * Test fixture visited.
   */
  const visited = new Set();
  /**
   * Test helper visit.
   * @param {unknown} url - Test input for this helper.
   * @returns {unknown} Result produced by this test helper.
   */
  const visit = (url) => {
    if (visited.has(url.href)) {
      return;
    }
    visited.add(url.href);
    assert.doesNotMatch(
      url.pathname,
      /\/(?:hydrate|render|hydration-runtime)\.js$|\/network\//
    );
    /**
     * Test fixture source.
     */
    const source = readFileSync(url, 'utf8');
    for (const match of source.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
      visit(new URL(match[1], url));
    }
  };
  visit(new URL('../dist/server.js', import.meta.url));
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `for(const key of ['document','window','HTMLElement','Node'])Object.defineProperty(globalThis,key,{get(){throw Error('DOM global accessed')}});const {renderToHydratable,h}=await import('zyrojs/server');const result=renderToHydratable(()=>h('p',{},'ok'),{label:'a'},{idPrefix:'node',validateProps:x=>x});if(!result.html.includes('ok'))throw Error('server render failed');`,
    ],
    { cwd: process.cwd(), stdio: 'pipe' }
  );
});

test('raw HTML requires an explicit host sanitizer token and owns an opaque leaf', () => {
  /**
   * Test fixture policy.
   */
  const policy = {
    sanitize: (input) => {
      if (input !== '<b>approved</b>') {
        throw Error('not approved');
      }
      return input;
    },
  };
  /**
   * Test fixture token.
   */
  const token = trustedHTML('<b>approved</b>', policy);
  /**
   * Test helper C.
   * @returns {unknown} Result produced by this test helper.
   */
  const C = () => h('div', { trustedHTML: token });
  /**
   * Test fixture output.
   */
  const output = renderToHydratable(C, { label: 'raw' }, options);
  assert.match(output.html, /<div><b>approved<\/b><\/div>/);
  assert.equal(
    renderToString(h('div', { trustedHTML: token })),
    '<div><b>approved</b></div>'
  );
  /**
   * Test fixture container.
   */
  const container = parsed(output.html),
    div = all(container, 'div')[0],
    b = all(container, 'b')[0];
  Object.defineProperty(div, 'innerHTML', { get: () => '<b>approved</b>' });
  /**
   * Test fixture handle.
   */
  const handle = hydrate(C, container, { data: output.data, validateProps });
  assert.equal(all(container, 'b')[0], b);
  handle.dispose();
  assert.throws(
    () =>
      renderToHydratable(
        () => h('div', { trustedHTML: 'raw' }),
        { label: 'a' },
        options
      ),
    (e) => e.code === 'INVALID_TRUSTED_HTML'
  );
  assert.throws(
    () =>
      renderToHydratable(
        () => h('div', { trustedHTML: token }, 'child'),
        { label: 'a' },
        options
      ),
    (e) => e.code === 'INVALID_TRUSTED_HTML'
  );
  assert.throws(
    () =>
      renderToHydratable(
        () => null,
        { value: token },
        { ...options, validateProps: (x) => x }
      ),
    (e) => e.code === 'PRIVATE_PUBLIC_PROPS'
  );
  assert.throws(
    () => trustedHTML('<!--zyro-->', { sanitize: (x) => x }),
    (e) => e.code === 'INVALID_TRUSTED_HTML'
  );
});

test('hydration handles do not dispose a replacement owner; malformed and oversized payloads fail closed', () => {
  /**
   * Test helper C.
   * @returns {unknown} Result produced by this test helper.
   */
  const C = () => h('p', {}, 'old'),
    output = renderToHydratable(C, { label: 'a' }, options),
    container = parsed(output.html);
  /**
   * Test fixture handle.
   */
  const handle = hydrate(C, container, { data: output.data, validateProps });
  render(h('b', {}, 'new owner'), container);
  handle.dispose();
  assert.equal(container.textContent, 'new owner');
  unmount(container);
  assert.throws(
    () =>
      renderToHydratable(
        () => null,
        {
          // eslint-disable-next-line no-sparse-arrays -- Deliberately sparse input verifies that the public boundary rejects array holes.
          value: [, 1],
        },
        { ...options, validateProps: (x) => x }
      ),
    (e) => e.code === 'INVALID_PUBLIC_PROPS'
  );
  assert.throws(
    () =>
      renderToHydratable(
        () => null,
        { label: 'a' },
        { ...options, maxPropsBytes: 10 }
      ),
    (e) => e.code === 'PROPS_LIMIT'
  );
  assert.throws(
    () =>
      renderToHydratable(
        () => h('input', { type: 'password', value: 'PRIVATE' }),
        { label: 'a' },
        options
      ),
    (e) => e.code === 'PRIVATE_FORM_VALUE' && !e.message.includes('PRIVATE')
  );
});

test('replacement depth is bounded; schema and observer failure do not remount', () => {
  /**
   * Test helper original.
   * @returns {unknown} Result produced by this test helper.
   */
  const original = () => h('p', {}, 'ok'),
    output = renderToHydratable(original, { label: 'a' }, options);
  /**
   * Test helper loop.
   * @returns {unknown} Result produced by this test helper.
   */
  const loop = () => h(loop, {});
  /**
   * Test fixture container.
   */
  const container = parsed(output.html),
    p = all(container, 'p')[0];
  /**
   * Test fixture deep.
   */
  const deep = parsed(output.html);
  assert.throws(
    () =>
      hydrate(loop, deep, {
        data: output.data,
        validateProps,
        maxDepth: 4,
        mismatch: 'replace',
      }),
    (e) => e.code === 'RENDER_LIMIT'
  );
  assert.equal(deep.childNodes.length, 0);
  assert.equal(all(container, 'p')[0], p);
  let constructions = 0;
  /**
   * Test helper C.
   * @returns {unknown} Result produced by this test helper.
   */
  const C = () => {
    constructions++;
    return 'x';
  };
  assert.throws(
    () =>
      hydrate(C, container, {
        data: output.data,
        validateProps: () => {
          throw Error('schema unavailable');
        },
      }),
    /schema unavailable/
  );
  assert.equal(constructions, 0);
  assert.throws(
    () =>
      hydrate(C, container, {
        data: output.data,
        validateProps,
        mismatch: 'replace',
        onMismatch: () => {
          throw Error('observer failed');
        },
      }),
    /observer failed/
  );
  assert.equal(all(container, 'p')[0], p);
});
