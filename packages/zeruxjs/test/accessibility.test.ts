import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindAccessibleTabs,
  prefersReducedMotion,
} from '../dist/accessibility.js';
/** Create a minimal semantic tab fixture without requiring DOM globals.
 * @returns {object} Synthetic document, tabs, panels and event trigger.
 */
function fixture() {
  /** Synthetic tab panels carrying authored semantic relationships. */
  const panels = [];
  /** Fixed synthetic tab collection used by the binding; no live browser is involved. */
  const tabs = [];
  /** Event registrations retained so destroy can be checked for exact cleanup. */
  const listeners = new Map();
  /** Minimal injected document recording focus and validating referenced panel membership. */
  const doc = {
    active: null,
    getElementById: (id) => panels.find((p) => p.id === id) || null,
    contains: (panel) => panels.includes(panel),
    defaultView: { getComputedStyle: () => ({ direction: 'ltr' }) },
  };
  for (let i = 0; i < 3; i++) {
    /** Authored attribute map for this synthetic tab. */
    const attrs = new Map([
      ['role', 'tab'],
      ['aria-controls', 'p' + i],
      ['aria-selected', i === 0 ? 'true' : 'false'],
    ]);
    /** Focusable tab fixture retaining its authored role and control reference. */
    const tab = {
      id: 't' + i,
      attrs,
      hasAttribute: (k) => attrs.has(k),
      getAttribute: (k) => attrs.get(k) || null,
      setAttribute: (k, v) => attrs.set(k, v),
      /** Record the focused tab on the injected document.
       * @returns {void} Updates fixture focus without native browser behavior.
       */
      focus() {
        doc.active = this;
      },
      contains: () => false,
      tabIndex: 0,
    };
    tabs.push(tab);
    /** Panel fixture with an explicit label reference and observable hidden state. */
    const panel = {
      id: 'p' + i,
      attrs: new Map([
        ['role', 'tabpanel'],
        ['aria-labelledby', 't' + i],
      ]),
      /** Read one authored panel attribute without synthesizing a label.
       * @param {string} k - Requested attribute name.
       * @returns {string | null} Stored attribute value or null.
       */
      getAttribute(k) {
        return this.attrs.get(k) || null;
      },
      hidden: false,
    };
    panels.push(panel);
  }
  /** Tab-list event target borrowing the synthetic document and tab collection. */
  const list = {
    ownerDocument: doc,
    querySelectorAll: () => tabs,
    getAttribute: () => null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  return {
    list,
    doc,
    panels,
    tabs,
    listeners,
    /** Dispatch one synthetic event through the binding listener.
     * @param {string} type - Registered event type.
     * @param {number} index - Tab index used as the event target.
     * @param {string} key - Keyboard key, when applicable.
     * @returns {boolean} Whether the binding prevented the synthetic default action.
     */
    trigger(type, index, key) {
      let prevented = false;
      listeners.get(type)?.({
        target: tabs[index],
        key,
        /** Record prevention of the synthetic event default.
         * @returns {void} Marks this fixture event as prevented.
         */
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}
test('ARIA tabs maintain focus, keyboard roving tabindex and skip disabled tabs', () => {
  /** Isolated semantic tab fixture used for keyboard and validation assertions. */
  const f = fixture();
  f.tabs[2].attrs.set('aria-disabled', 'true');
  /** Owned tab binding destroyed after its event and focus assertions. */
  const binding = bindAccessibleTabs(f.list);
  assert.equal(f.tabs[0].tabIndex, 0);
  assert.equal(f.tabs[1].tabIndex, -1);
  assert.equal(f.trigger('keydown', 0, 'ArrowRight'), true);
  assert.equal(f.doc.active, f.tabs[1]);
  assert.equal(f.panels[0].hidden, true);
  assert.equal(f.panels[1].hidden, false);
  assert.equal(f.tabs[1].attrs.get('aria-selected'), 'true');
  assert.equal(f.trigger('keydown', 1, 'ArrowRight'), true);
  assert.equal(f.doc.active, f.tabs[0]);
  binding.destroy();
  binding.destroy();
  assert.equal(f.listeners.size, 0);
});
test('accessibility validation is strict; motion preference is SSR-safe', () => {
  /** Isolated semantic tab fixture used for keyboard and validation assertions. */
  const f = fixture();
  f.tabs[0].attrs.delete('aria-controls');
  assert.throws(() => bindAccessibleTabs(f.list), /tabpanel/);
  assert.equal(prefersReducedMotion(undefined), false);
  assert.equal(
    prefersReducedMotion({ matchMedia: () => ({ matches: true }) }),
    true
  );
});
test('RTL horizontal navigation reverses arrow direction and vertical navigation uses Up/Down', () => {
  /** Isolated semantic tab fixture used for keyboard and validation assertions. */
  const f = fixture();
  /** Owned tab binding destroyed after its event and focus assertions. */
  const binding = bindAccessibleTabs(f.list, { direction: 'rtl' });
  assert.equal(f.trigger('keydown', 0, 'ArrowLeft'), true);
  assert.equal(f.doc.active, f.tabs[1]);
  assert.equal(f.trigger('keydown', 1, 'ArrowRight'), true);
  assert.equal(f.doc.active, f.tabs[0]);
  binding.destroy();
  /** Independent vertical tab fixture avoiding shared selection state. */
  const vertical = fixture();
  /** Vertical binding owner destroyed after Home and arrow-key assertions. */
  const v = bindAccessibleTabs(vertical.list, { orientation: 'vertical' });
  assert.equal(vertical.trigger('keydown', 0, 'ArrowDown'), true);
  assert.equal(vertical.doc.active, vertical.tabs[1]);
  assert.equal(vertical.trigger('keydown', 1, 'Home'), true);
  assert.equal(vertical.doc.active, vertical.tabs[0]);
  v.destroy();
});
