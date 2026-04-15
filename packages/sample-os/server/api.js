import os from "os";
import si from "systeminformation";
import { defineDevtoolsModuleApiHandlers } from "z-dev";

const format_bytes = (bytes) => (bytes / 1e9).toFixed(1) + " GB";
const percent = (val, total) => ((val / total) * 100).toFixed(1);

const filter_network = (nets) =>
  nets.filter(
    (n) =>
      n.ip4 &&
      !n.iface.startsWith("veth") &&
      !n.iface.startsWith("br-") &&
      n.iface !== "lo"
  );

const get_system_info = async () => {
  const [
    cpu,
    load,
    temp,
    mem,
    os_info,
    disk,
    battery,
    gpu,
    network,
    processes
  ] = await Promise.all([
    si.cpu(),
    si.currentLoad(),
    si.cpuTemperature(),
    si.mem(),
    si.osInfo(),
    si.fsSize(),
    si.battery(),
    si.graphics(),
    si.networkInterfaces(),
    si.processes()
  ]);

  return {
    os: {
      name: os_info.distro,
      kernel: os_info.kernel,
      uptime: Math.floor(os.uptime() / 3600) + "h",
      hostname: os.hostname()
    },
    cpu: {
      model: cpu.brand,
      load: load.currentLoad.toFixed(1),
      temp: temp.main || 0
    },
    memory: {
      total: format_bytes(mem.total),
      used: format_bytes(mem.used),
      percent: percent(mem.used, mem.total)
    },
    disk: disk
      .filter((d) => d.size > 0)
      .map((d) => ({
        mount: d.mount,
        used: format_bytes(d.used),
        size: format_bytes(d.size),
        percent: percent(d.used, d.size)
      })),
    battery: {
      has: battery.hasBattery,
      percent: battery.percent,
      charging: battery.isCharging
    },
    gpu: gpu.controllers,
    network: filter_network(network),
    processes: processes.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 8)
      .map((p) => ({
        name: p.name,
        cpu: p.cpu,
        mem: format_bytes(p.mem)
      }))
  };
};

export default defineDevtoolsModuleApiHandlers({
  // 🔥 IMPORTANT: handler exists, but module ID comes from folder/package
  async inspect() {
    const system = await get_system_info();

    return {
      system
    };
  }
});