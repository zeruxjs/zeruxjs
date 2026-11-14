import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRovingTabIndex,
  createLiveAnnouncer,
  createAccessibleDialog,
  createFocusTrap,
} from '../dist/index.js';
/** Create a minimal attribute/focus mock for ownership fixtures, not native browser qualification.
 * @param {object} opts - Synthetic mock overrides; no native DOM conformance is implied.
 * @returns {object} New isolated mock; callers own any fixture-specific overrides.
 */
type MockNode = {
  tabIndex: number;
  hidden: boolean;
  focused?: boolean;
  attributes: Map<string, string>;
  focus(): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
};

/** Create a minimal attribute/focus mock for ownership fixtures, not native browser qualification.
 * @param {Partial<MockNode>} opts - Synthetic mock overrides; no native DOM conformance is implied.
 * @returns {MockNode} New isolated mock; callers own any fixture-specific overrides.
 */
function node(opts: Partial<MockNode> = {}): MockNode {
  return {
    tabIndex: 0,
    hidden: false,
    attributes: new Map(),
    focus() {
      this.focused = true;
    },
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    hasAttribute(name) {
      return this.attributes.has(name);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    ...opts,
  };
}
test('roving index skips disabled, supports Home, End and RTL', () => {
  /** Synthetic focusable candidates used to assert tabindex/disabled behavior, not browser coverage. */
  const nodes = [node(), node(), node(), node()];
  nodes[1].setAttribute('aria-disabled', 'true');
  let prevented = 0;
  /** Owned roving handle for the fixture; real DOM lifetime is checked in dedicated component/browser tests. */
  const roving = createRovingTabIndex(() => nodes, { direction: 'rtl' });
  roving.refresh();
  assert.deepEqual(
    nodes.map((n) => n.tabIndex),
    [0, -1, -1, -1]
  );
  roving.onKey({
    key: 'ArrowLeft',
    target: nodes[0],
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(roving.index, 1);
  assert.equal(nodes[2].focused, true);
  roving.onKey({
    key: 'End',
    target: nodes[2],
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(roving.index, 2);
  assert.equal(nodes[3].focused, true);
  roving.onKey({
    key: 'Home',
    target: nodes[3],
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(roving.index, 0);
  assert.equal(prevented, 3);
  assert.throws(() => roving.setIndex(-1), RangeError);
});
test('roving respects no-loop and ignores modifiers', () => {
  /** Synthetic focusable candidates used to assert tabindex/disabled behavior, not browser coverage. */
  const nodes = [node(), node()];
  /** Owned controller or native select inspected for the current fixture behavior. */
  const control = createRovingTabIndex(() => nodes, {
    loop: false,
    orientation: 'vertical',
  });
  control.refresh();
  let prevented = 0;
  control.onKey({
    key: 'ArrowUp',
    target: nodes[0],
    preventDefault() {
      prevented++;
    },
  });
  control.onKey({
    key: 'ArrowRight',
    target: nodes[0],
    preventDefault() {
      prevented++;
    },
  });
  control.onKey({
    key: 'ArrowDown',
    target: nodes[0],
    ctrlKey: true,
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(control.index, 0);
  assert.equal(prevented, 0);
});
test('live announcer has semantics and destroys node', () => {
  /** Synthetic owned element used to verify attribute/text/focus effects. */
  const el = node({
    style: {},
    textContent: '',
    remove() {
      this.removed = true;
    },
  });
  /** Fixture-owned document or mock document; no operator/user application is attached. */
  const doc = {
    createElement() {
      return el;
    },
    body: {
      appendChild(child) {
        assert.equal(child, el);
      },
    },
  };
  /** Owned live-region fixture handle; teardown removes its exact element. */
  const live = createLiveAnnouncer(doc);
  live.announce('urgent', true);
  assert.equal(el.getAttribute('role'), 'alert');
  assert.equal(el.textContent, 'urgent');
  live.clear();
  assert.equal(el.textContent, '');
  live.destroy();
  live.announce('ignored');
  assert.equal(el.removed, true);
  assert.equal(el.textContent, '');
});
/** Build an isolated mock document/opener and explicit listener tracking.
 * @returns {object} Fixture-owned document/element/listener state; never touches an operator window.
 */
function docElement() {
  /** Fixture listener bookkeeping used to prove ownership and release. */
  const listeners = new Map();
  /** Synthetic opener used to assert restoration without relying on a user document. */
  const previous = node({ isConnected: true });
  /** Fixture-owned document or mock document; no operator/user application is attached. */
  const doc = {
    activeElement: previous,
    addEventListener(key, fn) {
      listeners.set(key, fn);
    },
    removeEventListener(key) {
      listeners.delete(key);
    },
  };
  /** Owned fixture element/factory used for explicit focus or modal acquisition. */
  const element = node({
    ownerDocument: doc,
    isConnected: true,
    hidden: true,
    querySelectorAll() {
      return [];
    },
    contains(target) {
      return target === element;
    },
  });
  element.focus = () => {
    doc.activeElement = element;
  };
  previous.focus = () => {
    doc.activeElement = previous;
  };
  return { element, doc, listeners, previous };
}
test('accessible dialog opens, traps focus, closes and restores attributes', () => {
  /** Owned mock element/document and captured opener for isolated focus restoration checks. */
  const { element, doc, previous } = docElement();
  /** Owned dialog fixture; destroy must release its attributes and listeners. */
  const dialog = createAccessibleDialog(element, { labelledBy: 'heading' });
  assert.equal(element.hidden, true);
  dialog.show();
  assert.equal(element.hidden, false);
  assert.equal(element.getAttribute('aria-modal'), 'true');
  assert.equal(doc.activeElement, element);
  dialog.close();
  assert.equal(element.hidden, true);
  assert.equal(doc.activeElement, previous);
  dialog.destroy();
  assert.equal(element.getAttribute('role'), null);
  assert.throws(() => dialog.show(), /destroyed/);
});
test('nested focus traps restore their own focus', () => {
  /** Owned mock element/document and captured opener for isolated focus restoration checks. */
  const { element, doc, previous } = docElement();
  element.hidden = false;
  /** Owned nested trap/dialog fixture; only the top layer handles focus. */
  const inner = node({
    ownerDocument: doc,
    isConnected: true,
    querySelectorAll() {
      return [];
    },
    contains(target) {
      return target === inner;
    },
  });
  inner.focus = () => {
    doc.activeElement = inner;
  };
  /** First independent fixture owner; state/leases must not leak into the second. */
  const first = createFocusTrap(element);
  /** Second independent fixture owner used for nesting/isolation checks. */
  const second = createFocusTrap(inner);
  first.activate();
  second.activate();
  assert.equal(doc.activeElement, inner);
  second.deactivate();
  assert.equal(doc.activeElement, element);
  first.deactivate();
  assert.equal(doc.activeElement, previous);
});
test('Escape closes only the topmost accessible dialog', () => {
  /** Fixture event registry; known listener sets permit deterministic top-layer dispatch. */
  const events = new Map();
  /** Synthetic opener used to assert restoration without relying on a user document. */
  const previous = node({
    isConnected: true,
    focus() {
      document.activeElement = this;
    },
  });
  /** Mock focus owner used only by this isolated test. */
  const document = {
    activeElement: previous,
    addEventListener(name, fn) {
      if (!events.has(name)) {
        events.set(name, new Set());
      }
      events.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      events.get(name)?.delete(fn);
    },
  };
  /** Owned fixture element/factory used for explicit focus or modal acquisition.
   * @returns {object} New mock modal candidate with explicit focus tracking.
   */
  const element = () => {
    /** Synthetic owned element used to verify attribute/text/focus effects. */
    const el = node({
      ownerDocument: document,
      hidden: true,
      isConnected: true,
      querySelectorAll() {
        return [];
      },
      contains(other) {
        return other === el;
      },
    });
    el.focus = () => {
      document.activeElement = el;
    };
    return el;
  };
  /** First independent fixture owner; state/leases must not leak into the second. */
  const first = createAccessibleDialog(element());
  /** Second independent fixture owner used for nesting/isolation checks. */
  const second = createAccessibleDialog(element());
  first.show();
  second.show();
  let prevented = 0;
  /** Synthetic key event/dispatch helper; real default keyboard behavior is checked separately. */
  const key = {
    key: 'Escape',
    preventDefault() {
      prevented++;
    },
  };
  // handler belongs to the synthetic current document snapshot; only the top dialog should consume Escape.
  for (const handler of [...events.get('keydown')]) {
    handler(key);
  }
  assert.equal(first.open, true);
  assert.equal(second.open, false);
  assert.equal(prevented, 1);
  // handler belongs to the synthetic current document snapshot; only the top dialog should consume Escape.
  for (const handler of [...events.get('keydown')]) {
    handler(key);
  }
  assert.equal(first.open, false);
  assert.equal(prevented, 2);
  first.destroy();
  second.destroy();
});
