const qs = (root, sel) => root.querySelector(sel);

const to_num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

export const mount = async ({ root, api }) => {
  if (!root) return;

  let destroyed = false;

  const update = async () => {
    try {
      const res = await api("inspect");
      const s = res?.system;

      if (!s || destroyed) return;

      // OS
      qs(root, "[data-os]").textContent =
        `${s.os.name} • ${s.os.kernel}`;
      qs(root, "[data-host]").textContent = s.os.hostname;

      // CPU
      const cpu_load = to_num(s.cpu.load);

      qs(root, "[data-cpu-model]").textContent = s.cpu.model;
      qs(root, "[data-cpu-stats]").textContent =
        `${cpu_load}% • ${s.cpu.temp}°C`;

      qs(root, ".bar-fill").style.width = cpu_load + "%";

      // Memory
      const mem_percent = to_num(s.memory.percent);

      qs(root, "[data-mem-text]").textContent =
        `${s.memory.used} / ${s.memory.total}`;
      qs(root, "[data-mem-percent]").textContent =
        mem_percent + "%";

      root.querySelectorAll(".bar-fill")[1].style.width =
        mem_percent + "%";

      // Disk
      qs(root, "[data-disk]").innerHTML = s.disk
        .filter((d) => d.size !== "0.0 GB")
        .map((d) => {
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
        .join("");

      // GPU (enhanced)
      qs(root, "[data-gpu]").innerHTML = s.gpu
        .map(
          (g) => `
          <div class="kv">
            <span>${g.model}</span>
            <b>${g.vram} MB • ${g.temperatureGpu ? g.temperatureGpu + "°C" : ""
            }</b>
          </div>
        `
        )
        .join("");

      // Network (only useful)
      qs(root, "[data-network]").innerHTML = s.network
        .filter((n) => n.ip4 && n.iface !== "lo")
        .map(
          (n) => `
          <div class="kv">
            <span>${n.iface}</span>
            <b>${n.ip4}</b>
          </div>
        `
        )
        .join("");

      // Battery
      qs(root, "[data-battery]").innerHTML = s.battery.has
        ? `
        <div class="kv">
          <span>${s.battery.charging ? "Charging" : "Discharging"}</span>
          <b>${s.battery.percent}%</b>
        </div>
        <div class="bar">
          <div class="bar-fill" style="width:${s.battery.percent}%"></div>
        </div>
      `
        : `<p>No battery</p>`;

      // Processes
      qs(root, "[data-proc]").innerHTML = s.processes
        .map(
          (p) => `
          <tr>
            <td>${p.name}</td>
            <td>${p.cpu.toFixed(1)}</td>
            <td>${p.mem}</td>
          </tr>
        `
        )
        .join("");
    } catch (err) {
      console.error("System module error:", err);
    }
  };

  // ✅ only once (no polling)
  await update();

  return {
    destroy() {
      destroyed = true;
    }
  };
};

export default { mount };