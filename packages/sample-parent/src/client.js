export const mount = ({ root, api }) => {
  const resultEl = root.querySelector('#parent-result');

  async function parentCall(handler) {
    if (!resultEl) return;
    resultEl.style.display = 'block';
    resultEl.textContent = 'Loading...';
    
    try {
      const res = await api(handler);
      resultEl.textContent = JSON.stringify(res, null, 2);
    } catch(e) {
      resultEl.textContent = 'Error: ' + e.message;
    }
  }

  // Attach listeners to buttons within the module root
  root.querySelector('#parent-btn-data')?.addEventListener('click', () => parentCall('getData'));
  root.querySelector('#parent-btn-secret')?.addEventListener('click', () => parentCall('getSecret'));

  return {
    destroy: () => {
      // Clean up if needed
    }
  };
};
