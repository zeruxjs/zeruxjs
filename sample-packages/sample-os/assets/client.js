/**
 * Find one element within the module root.
 *
 * @param {HTMLElement} root - Module-owned DOM root.
 * @param {string} sel - CSS selector for the element.
 * @returns {Element|null} Matching element, if present.
 */
const qs = (root, sel) => root.querySelector(sel);

/**
 * Convert a display value to a finite numeric value.
 *
 * @param {unknown} v - Value returned by the system-information provider.
 * @returns {number} Parsed number, or zero for non-numeric input.
 */
const to_num = (v) => {
  /** Sample package value or fixture named n. */
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/**
 * Mount the system dashboard and fetch one snapshot.
 *
 * @param {{root: HTMLElement, api: (handler: string) => Promise<object>}} options - Module mount context.
 * @param {HTMLElement} options.root - Module-owned DOM root.
 * @param {(handler: string) => Promise<object>} options.api - Server API caller.
 * @returns {Promise<{destroy: () => void}|undefined>} Dashboard lifecycle handle.
 */
export const mount = async ({ root, api }) => {
  if (!root) {
    return;
  }

  let destroyed = false;

  /**
   * Fetch and render one system snapshot.
   *
   * @returns {Promise<void>} Resolves after the snapshot is rendered or logged.
   */
  const update = async () => {
    try {
      /** Sample package value or fixture named res. */
      const res = await api('inspect');
      /** Sample package value or fixture named s. */
      const s = res?.system;

      if (!s || destroyed) {
        return;
      }

      // OS
      qs(root, '[data-os]').textContent = `${s.os.name} • ${s.os.kernel}`;
      qs(root, '[data-host]').textContent = s.os.hostname;

      // CPU
      /** Sample package value or fixture named cpu_load. */
      const cpu_load = to_num(s.cpu.load);

      qs(root, '[data-cpu-model]').textContent = s.cpu.model;
      qs(root, '[data-cpu-stats]').textContent =
        `${cpu_load}% • ${s.cpu.temp}°C`;

      qs(root, '.bar-fill').style.width = cpu_load + '%';

      // Memory
      /** Sample package value or fixture named mem_percent. */
      const mem_percent = to_num(s.memory.percent);

      qs(root, '[data-mem-text]').textContent =
        `${s.memory.used} / ${s.memory.total}`;
      qs(root, '[data-mem-percent]').textContent = mem_percent + '%';

      root.querySelectorAll('.bar-fill')[1].style.width = mem_percent + '%';

      // Disk
      qs(root, '[data-disk]').innerHTML = s.disk
        .filter((d) => d.size !== '0.0 GB')
        .map((d) => {
          /** Sample package value or fixture named p. */
          const p = to_num(d.percent);
          return `
          <div class="kv">
            <span>${d.mount}</span>
            <b>${d.used} / ${d.size}</b>
          </div>
          <div class="bar">
            <div class="bar-fill" style="width:${p}%"></div>
          </div>
        `;
        })
        .join('');

      // GPU (enhanced)
      qs(root, '[data-gpu]').innerHTML = s.gpu
        .map(
          (g) => `
          <div class="kv">
            <span>${g.model}</span>
            <b>${g.vram} MB • ${
              g.temperatureGpu ? g.temperatureGpu + '°C' : ''
            }</b>
          </div>
        `
        )
        .join('');

      // Network (only useful)
      qs(root, '[data-network]').innerHTML = s.network
        .filter((n) => n.ip4 && n.iface !== 'lo')
        .map(
          (n) => `
          <div class="kv">
            <span>${n.iface}</span>
            <b>${n.ip4}</b>
          </div>
        `
        )
        .join('');

      // Battery
      qs(root, '[data-battery]').innerHTML = s.battery.has
        ? `
        <div class="kv">
          <span>${s.battery.charging ? 'Charging' : 'Discharging'}</span>
          <b>${s.battery.percent}%</b>
        </div>
        <div class="bar">
          <div class="bar-fill" style="width:${s.battery.percent}%"></div>
        </div>
      `
        : `<p>No battery</p>`;

      // Processes
      qs(root, '[data-proc]').innerHTML = s.processes
        .map(
          (p) => `
          <tr>
            <td>${p.name}</td>
            <td>${p.cpu.toFixed(1)}</td>
            <td>${p.mem}</td>
          </tr>
        `
        )
        .join('');
    } catch (err) {
      console.error('System module error:', err);
    }
  };

  // ✅ only once (no polling)
  await update();

  return {
    destroy() {
      destroyed = true;
    },
  };
};

export default { mount };
