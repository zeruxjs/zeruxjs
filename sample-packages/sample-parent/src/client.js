/**
 * Mount the parent module controls and expose their cleanup hook.
 *
 * @param {{root: HTMLElement, api: (handler: string) => Promise<unknown>}} options - Module mount context.
 * @param {HTMLElement} options.root - Module-owned DOM root.
 * @param {(handler: string) => Promise<unknown>} options.api - Parent API caller.
 * @returns {{destroy: () => void}} Parent module lifecycle handle.
 */
export const mount = ({ root, api }) => {
  /** Sample package value or fixture named resultEl. */
  const resultEl = root.querySelector('#parent-result');

  /**
   * Call one parent handler and render its response.
   *
   * @param {string} handler - Handler identifier to invoke.
   * @returns {Promise<void>} Resolves after the result is rendered.
   */
  async function parentCall(handler) {
    if (!resultEl) return;
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

  // Attach listeners to buttons within the module root
  root
    .querySelector('#parent-btn-data')
    ?.addEventListener('click', () => parentCall('getData'));
  root
    .querySelector('#parent-btn-secret')
    ?.addEventListener('click', () => parentCall('getSecret'));

  return {
    destroy: () => {
      // Clean up if needed
    },
  };
};
