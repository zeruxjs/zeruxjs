import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
/** Locally authored package client program executed only in the controlled VM fixture. */
const script = readFileSync(
  new URL('../assets/app.js', import.meta.url),
  'utf8'
);
test('theme messages require the reviewed parent origin and source', () => {
  /** Owned fake window event handlers used to trigger explicit origin/source checks. */
  const callbacks = new Map();
  /** Synthetic local preference state, isolated from operator browser storage. */
  const storage = new Map();
  /** Parent postMessage receipts checked for exact target origins rather than wildcards. */
  const messages = [];
  /** Synthetic root attributes recording only theme application. */
  const attributes = new Map();
  /** Fixed parent-window identity required independently from the approved origin. */
  const parent = {
    /** Record a synthetic parent message and its exact target origin.
     * @param {object} data - Inert theme message.
     * @param {string} origin - Explicit target origin, which must never be wildcard.
     * @returns {void} Adds a fixture message receipt without cross-window communication.
     */
    postMessage(data, origin) {
      messages.push({ data, origin });
    },
  };
  /** Minimal synthetic window preventing any native browser/socket work. */
  const window = {
    parent,
    location: { origin: 'http://localhost:9000' },
    zdev: { config: { themeParentOrigins: ['https://app.example'] } },
    /** Provide a fixed light-theme media result without native browser globals.
     * @returns {object} Synthetic media query list with inert listener registration.
     */
    matchMedia() {
      return {
        matches: false /** Record only named synthetic window callbacks; media registration remains inert.
         * @returns {void} Updates the fixture callback map when arguments are supplied.
         */,
        addEventListener() {},
      };
    },
    /** Record only named synthetic window callbacks; media registration remains inert.
     * @param {string} name - Registered fixture event name.
     * @param {Function} callback - Locally authored listener used by the explicit test invocation.
     * @returns {void} Updates the fixture callback map when arguments are supplied.
     */
    addEventListener(name, callback) {
      callbacks.set(name, callback);
    },
  };
  /** Minimal synthetic document exposing only the theme nodes required by this fixture. */
  const document = {
    documentElement: {
      /** Record the synthetic document root theme attribute.
       * @param {string} name - Authored attribute key.
       * @param {string} value - Inert theme attribute value.
       * @returns {void} Updates only the fixture attribute map.
       */
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    },
    /** Report no optional theme label in the minimal document fixture.
     * @returns {null} No native DOM node is allocated.
     */
    querySelector() {
      return null;
    },
  };
  vm.runInNewContext(script, {
    window,
    document,
    URL,
    localStorage: {
      /** Read isolated synthetic preference storage.
       * @param {string} key - Theme storage key.
       * @returns {unknown} Previously stored fixture value, or undefined.
       */
      getItem(key) {
        return storage.get(key);
      },
      /** Write isolated synthetic preference storage.
       * @param {string} key - Theme storage key.
       * @param {string} value - Approved mode selected by the theme listener.
       * @returns {void} Updates only this test map.
       */
      setItem(key, value) {
        storage.set(key, value);
      },
    },
  });
  assert(messages.every((value) => value.origin !== '*'));
  /** Captured theme listener invoked explicitly with trusted and forged synthetic events. */
  const message = callbacks.get('message');
  /** Fixed inert theme message payload used across source/origin denial cases. */
  const data = {
    type: 'zdev:theme-sync',
    mode: 'dark',
    effectiveTheme: 'dark',
  };
  message({ origin: 'https://attacker.example', source: parent, data });
  message({ origin: 'https://app.example', source: {}, data });
  assert.equal(attributes.get('data-theme'), 'light');
  assert.equal(storage.size, 0);
  message({ origin: 'https://app.example', source: parent, data });
  assert.equal(attributes.get('data-theme'), 'dark');
  assert.equal(storage.get('zdev:devtools:theme'), 'dark');
});
