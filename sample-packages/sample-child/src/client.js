export const mount = ({ root, api }) => {
  const resultEl = root.querySelector('#child-result');

  async function childCall(handler) {
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

  async function childCallParentScope(handler) {
    if (!resultEl) return;
    resultEl.style.display = 'block';
    resultEl.textContent = 'Loading...';
    
    try {
      // We manually use window.zdev.api to call ANOTHER module (the parent)
      // The framework will still intervene and use our hijacking logic!
      const res = await window.zdev.api('parent-module', handler);
      resultEl.textContent = JSON.stringify(res, null, 2);
    } catch(e) {
      resultEl.textContent = 'Error: ' + e.message;
    }
  }

  // Attach listeners to buttons within the module root
  root.querySelector('#child-btn-ext')?.addEventListener('click', () => childCall('getChildOnlyData'));
  root.querySelector('#child-btn-hijack')?.addEventListener('click', () => childCallParentScope('getData'));

  return {
    destroy: () => {
      // Clean up
    }
  };
};
