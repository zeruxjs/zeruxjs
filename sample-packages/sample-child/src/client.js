/**
 * Mount the child module controls and expose their cleanup hook.
 *
 * @param {{root: HTMLElement, api: (handler: string) => Promise<unknown>}} options - Module mount context.
 * @param {HTMLElement} options.root - Module-owned DOM root.
 * @param {(handler: string) => Promise<unknown>} options.api - Parent-aware API caller.
 * @returns {{destroy: () => void}} Child module lifecycle handle.
 */
export const mount = ({ root, api }) => {
  /** Sample package value or fixture named resultEl. */
  const resultEl = root.querySelector('#child-result');

  /**
   * Call an API handler through the child module scope.
   *
   * @param {string} handler - Handler identifier registered by the module.
   * @returns {Promise<void>} Resolves after the result is rendered.
   */
  async function childCall(handler) {
    if (!resultEl) {
      return;
    }
    resultEl.style.display = 'block';
    resultEl.textContent = 'Loading...';

    try {
      /** Sample package value or fixture named res. */
      const res = await api(handler);
      resultEl.textContent = JSON.stringify(res, null, 2);
    } catch (e) {
      resultEl.textContent = 'Error: ' + e.message;
    }
  }

  /**
   * Call a parent-module handler through the shared development API.
   *
   * @param {string} handler - Parent handler identifier to invoke.
   * @returns {Promise<void>} Resolves after the parent result is rendered.
   */
  async function childCallParentScope(handler) {
    if (!resultEl) {
      return;
    }
    resultEl.style.display = 'block';
    resultEl.textContent = 'Loading...';

    try {
      // We manually use window.zdev.api to call ANOTHER module (the parent)
      // The framework will still intervene and use our hijacking logic!
      /** Sample package value or fixture named res. */
      const res = await window.zdev.api('parent-module', handler);
      resultEl.textContent = JSON.stringify(res, null, 2);
    } catch (e) {
      resultEl.textContent = 'Error: ' + e.message;
    }
  }

  // Attach listeners to buttons within the module root
  root
    .querySelector('#child-btn-ext')
    ?.addEventListener('click', () => childCall('getChildOnlyData'));
  root
    .querySelector('#child-btn-hijack')
    ?.addEventListener('click', () => childCallParentScope('getData'));

  return {
    destroy: () => {
      // Clean up
    },
  };
};
