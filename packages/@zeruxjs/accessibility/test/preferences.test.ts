import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createPreferenceState,
  parsePreferenceSnapshot,
  serializePreferenceSnapshot,
  bindPreferenceStyles,
  createPreferencePanel,
  createSpeechController,
} from '@zeruxjs/accessibility';
/** Install deterministic matchMedia only into the explicitly supplied fixture realm.
 * @param {Window} win - Borrowed realm for native feature detection/events; not a new browser process.
 * @returns {Map<string,object>} Owned query/listener fixtures; this does not change actual system settings.
 */
function media(win) {
  /** Fixture-local media query state; no actual host system preference is changed. */
  const queries = new Map();
  win.matchMedia = (query) => {
    if (queries.has(query)) {
      return queries.get(query);
    }
    /** Owned event/style fixture target; unrelated document state must remain unchanged. */
    const target = new win.EventTarget();
    Object.assign(target, { matches: false, media: query });
    /** Fixture listener bookkeeping used to prove ownership and release. */
    const listeners = new Set();
    /** Captured native fixture event registration method for balanced listener bookkeeping. */
    const add = target.addEventListener.bind(target);
    /** Captured matching listener remover; tracking must reflect actual owned callbacks. */
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, fn) => {
      listeners.add(fn);
      add(type, fn);
    };
    target.removeEventListener = (type, fn) => {
      listeners.delete(fn);
      remove(type, fn);
    };
    target.change = (value) => {
      target.matches = value;
      /** Synthetic media-change event carrying only the explicitly controlled fixture state. */
      const event = new win.Event('change');
      Object.defineProperty(event, 'matches', { value });
      target.dispatchEvent(event);
    };
    target.listeners = listeners;
    queries.set(query, target);
    return target;
  };
  return queries;
}

test('headless preferences are stable, bounded, isolated and explicit about invalid values', () => {
  /** First independent fixture owner; state/leases must not leak into the second. */
  const first = createPreferenceState();
  /** Second independent fixture owner used for nesting/isolation checks. */
  const second = createPreferenceState();
  let changes = 0;
  /** Owned subscription disposer; stopping it must remove only this observer. */
  const stop = first.subscribe(() => changes++);
  /** Stable frozen snapshot used to verify identity retention for no-op updates. */
  const initial = first.getSnapshot();
  first.set({ textScale: 1 });
  assert.equal(first.getSnapshot(), initial);
  first.set({ textScale: 1.5 });
  assert.equal(changes, 1);
  assert.equal(second.getSnapshot().values.textScale, 1);
  first.setSystem({ reducedMotion: true, forcedColors: true });
  first.set({ motion: 'system', contrast: 'dark' });
  assert.equal(first.getSnapshot().effective.reducedMotion, true);
  assert.equal(first.getSnapshot().effective.contrast, 'forced');
  assert.throws(() => first.set({ textScale: 99 }), /preference value/);
  assert.throws(() => first.set({ unknown: true }), /preference fields/);
  assert.throws(
    () => first.setSystem({ forcedColors: 'yes' }),
    /system preference/
  );
  stop();
  first.reset();
  assert.equal(first.getSnapshot().values.textScale, 1);
  assert.equal(first.getSnapshot().system.reducedMotion, true);
  first.destroy();
  second.destroy();
  assert.throws(() => first.getSnapshot(), /destroyed/);
});

test('versioned migration writes only the declared current schema and reset removes only the scoped key', () => {
  /** Synthetic scoped persistence records; reset must preserve the unrelated key. */
  const rows = new Map([
    [
      'app:a11y',
      JSON.stringify({
        version: 1,
        preferences: { textSize: 125, contrast: 'high', reducedMotion: true },
      }),
    ],
    ['other', 'unchanged'],
  ]);
  /** Explicit in-memory storage fixture; not a claimed production persistence provider. */
  const storage = {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
  /** Owned preference state; no cross-instance or remote storage is enabled implicitly. */
  const state = createPreferenceState({
    persistence: { key: 'app:a11y', storage },
  });
  assert.deepEqual(state.getSnapshot().values, {
    textScale: 1.25,
    contrast: 'high',
    motion: 'reduce',
  });
  state.set({ textScale: 1.5 });
  assert.equal(JSON.parse(rows.get('app:a11y')).version, 2);
  assert.equal(
    parsePreferenceSnapshot(rows.get('app:a11y')).values.textScale,
    1.5
  );
  state.reset();
  assert.equal(rows.has('app:a11y'), false);
  assert.equal(rows.get('other'), 'unchanged');
  state.destroy();
  assert.throws(
    () => parsePreferenceSnapshot('{"version":99,"values":{}}'),
    /Unsupported/
  );
  assert.throws(() => parsePreferenceSnapshot('x'.repeat(4097)), /byte limit/);
  assert.throws(
    () =>
      parsePreferenceSnapshot(
        '{"version":2,"values":{"textScale":1,"contrast":"system","motion":"system","__proto__":{}}}'
      ),
    /fields/
  );
  assert.equal(
    serializePreferenceSnapshot({
      textScale: 1,
      contrast: 'system',
      motion: 'system',
    }),
    '{"version":2,"values":{"textScale":1,"contrast":"system","motion":"system"}}'
  );
});

test('blocked storage, corrupt data and failing observers stay local and report fixed codes', () => {
  /** Fixed-code fixture diagnostics checked not to contain private sentinel payloads. */
  const errors = [];
  /** Owned preference state; no cross-instance or remote storage is enabled implicitly. */
  const state = createPreferenceState({
    persistence: {
      key: 'app',
      storage: () => {
        throw new Error('PRIVATE_SENTINEL');
      },
    },
    onError: (code) => errors.push(code),
  });
  assert.equal(state.getStatus().persistence, 'failed');
  state.set({ contrast: 'dark' });
  assert.equal(state.getSnapshot().values.contrast, 'dark');
  assert.deepEqual(errors, ['STORAGE_READ']);
  assert.equal(JSON.stringify(errors).includes('PRIVATE_SENTINEL'), false);
  state.destroy();
  /** Owned preference state with deliberate storage/observer failures. */
  const failing = createPreferenceState({
    persistence: {
      key: 'app',
      storage: {
        getItem: () => '{broken',
        setItem() {
          throw new Error();
        },
        removeItem() {
          throw new Error();
        },
      },
    },
    onError: (code) => errors.push(code),
  });
  failing.subscribe(() => {
    throw new Error('private observer');
  });
  failing.set({ motion: 'reduce' });
  assert.equal(failing.getStatus().persistence, 'failed');
  failing.reset();
  assert.ok(errors.includes('INVALID_SNAPSHOT'));
  assert.ok(errors.includes('STORAGE_WRITE'));
  assert.ok(errors.includes('STORAGE_RESET'));
  assert.ok(errors.includes('SUBSCRIBER_FAILED'));
  failing.destroy();
});

test('scoped styles respect media state, preserve outside containers and remove listeners/styles/attributes', () => {
  /** Owned jsdom environment; tests destroy controllers before closing this window. */
  const env = new JSDOM(
    '<div id="target" data-zx-text="author"><p>Inside</p></div><p id="outside">Outside</p>'
  );
  /** Owned jsdom realm used for media/speech capability simulation. */
  const win = env.window;
  /** Fixture-owned document or mock document; no operator/user application is attached. */
  const doc = win.document;
  /** Fixture-local media query state; no actual host system preference is changed. */
  const queries = media(win);
  /** Owned preference state; no cross-instance or remote storage is enabled implicitly. */
  const state = createPreferenceState();
  let binding;
  try {
    /** Owned event/style fixture target; unrelated document state must remain unchanged. */
    const target = doc.getElementById('target');
    binding = bindPreferenceStyles(target, state);
    assert.equal(doc.querySelectorAll('style').length, 1);
    assert.equal(doc.getElementById('outside').attributes.length, 1);
    queries.get('(prefers-reduced-motion: reduce)').change(true);
    assert.equal(state.getSnapshot().effective.reducedMotion, true);
    assert.equal(target.getAttribute('data-zx-motion'), 'reduce');
    queries.get('(forced-colors: active)').change(true);
    assert.equal(state.getSnapshot().effective.contrast, 'forced');
    assert.throws(() => bindPreferenceStyles(target, state), /already bound/);
    binding.destroy();
    assert.equal(target.getAttribute('data-zx-text'), 'author');
    assert.equal(doc.querySelectorAll('style').length, 0);
    assert.ok(
      [...queries.values()].every((query) => query.listeners.size === 0)
    );
    state.set({ textScale: 2 });
    assert.equal(target.getAttribute('data-zx-text'), 'author');
  } finally {
    binding?.destroy();
    state.destroy();
    win.close();
  }
});

test('panel uses real labels/native controls, survives storage failure and handles unavailable speech', () => {
  /** Owned jsdom environment; tests destroy controllers before closing this window. */
  const env = new JSDOM(
    '<button id="before">Before</button><main id="host"></main>',
    { pretendToBeVisual: true }
  );
  /** Owned jsdom realm used for media/speech capability simulation. */
  const win = env.window;
  /** Fixture-owned document or mock document; no operator/user application is attached. */
  const doc = win.document;
  /** Fixture-local media query state; no actual host system preference is changed. */
  const queries = media(win);
  /** Owned preference state; no cross-instance or remote storage is enabled implicitly. */
  const state = createPreferenceState({
    persistence: {
      key: 'app',
      storage: () => {
        throw new Error();
      },
    },
  });
  /** Borrowed-by-panel but fixture-owned speech controller; destroy it explicitly. */
  const speech = createSpeechController(win, { ownership: 'exclusive' });
  let panel;
  try {
    doc.getElementById('before').focus();
    let reads = 0;
    panel = createPreferencePanel(doc.getElementById('host'), state, {
      speech,
      speechText: () => {
        reads++;
        return 'public';
      },
    });
    /** Owned native selects checked for labels, keyboard focus and current values. */
    const selects = panel.element.querySelectorAll('select');
    // control is a native fixture select and must retain an actual associated label.
    for (const control of selects) {
      assert.equal(control.labels.length, 1);
    }
    panel.focus();
    assert.equal(doc.activeElement, selects[0]);
    selects[0].value = '1.5';
    selects[0].dispatchEvent(new win.Event('change'));
    assert.equal(state.getSnapshot().values.textScale, 1.5);
    assert.match(panel.element.textContent, /storage is unavailable/);
    /** Owned native buttons; unavailable speech must not invoke approved-text providers. */
    const buttons = panel.element.querySelectorAll('button');
    assert.equal(buttons[1].disabled, true);
    buttons[1].click();
    assert.equal(reads, 0);
    assert.equal(speech.speak('public', new win.Event('click')), 'unavailable');
    queries.get('(forced-colors: active)').change(true);
    assert.equal(selects[1].disabled, true);
    buttons[0].click();
    assert.equal(state.getSnapshot().values.textScale, 1);
    panel.destroy();
    assert.equal(doc.getElementById('host').children.length, 0);
    assert.equal(doc.activeElement.id, 'before');
    assert.ok(
      [...queries.values()].every((query) => query.listeners.size === 0)
    );
  } finally {
    panel?.destroy();
    speech.destroy();
    state.destroy();
    win.close();
  }
});

test('speech refuses synthetic actions, remote-only voices and foreign ownership without cancelling shared work', () => {
  /** Owned jsdom environment; tests destroy controllers before closing this window. */
  const env = new JSDOM('');
  /** Owned jsdom realm used for media/speech capability simulation. */
  const win = env.window;
  let cancelled = 0,
    spoken = 0;
  /** Synthetic native-shaped speech engine used to test ownership, never audible output. */
  const engine = new win.EventTarget();
  Object.assign(engine, {
    speaking: true,
    pending: false,
    paused: false,
    getVoices: () => [{ localService: true, voiceURI: 'local' }],
    speak() {
      spoken++;
    },
    cancel() {
      cancelled++;
    },
    pause() {},
    resume() {},
  });
  Object.defineProperty(win, 'speechSynthesis', { value: engine });
  win.SpeechSynthesisUtterance = class extends win.EventTarget {};
  /** Owned speech controller under an explicit exclusive lease policy. */
  const controller = createSpeechController(win, { ownership: 'exclusive' });
  assert.equal(controller.getStatus().available, true);
  assert.equal(
    controller.speak('public', new win.MouseEvent('click')),
    'denied'
  );
  controller.stop();
  controller.destroy();
  assert.equal(cancelled, 0);
  assert.equal(spoken, 0);
  engine.getVoices = () => [{ localService: false, voiceURI: 'remote' }];
  /** Controller with only remote reported voices; it must remain unavailable. */
  const remote = createSpeechController(win, { ownership: 'exclusive' });
  assert.equal(remote.getStatus().available, false);
  assert.equal(
    remote.speak('text', new win.MouseEvent('click')),
    'unavailable'
  );
  remote.destroy();
  win.close();
});
