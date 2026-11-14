import os from 'os';
import si from 'systeminformation';
import { defineDevtoolsModuleApiHandlers } from 'zforge';

/**
 * Format a byte count for the dashboard.
 *
 * @param {number} bytes - Byte count returned by the system provider.
 * @returns {string} Human-readable gigabyte value.
 */
const format_bytes = (bytes: number): string =>
  (bytes / 1e9).toFixed(1) + ' GB';

/**
 * Calculate a one-decimal percentage.
 *
 * @param {number} val - Measured value.
 * @param {number} total - Total value used as the denominator.
 * @returns {string} Percentage formatted for display.
 */
const percent = (val: number, total: number): string =>
  ((val / total) * 100).toFixed(1);

/**
 * Keep useful non-loopback IPv4 network interfaces.
 *
 * @param {Array<{ip4?: string, iface: string}>} nets - Interfaces returned by the provider.
 * @returns {Array<object>} Filtered interfaces safe for the dashboard response.
 */
const filter_network = (
  nets: si.Systeminformation.NetworkInterfacesData[]
): si.Systeminformation.NetworkInterfacesData[] =>
  nets.filter(
    (n) =>
      n.ip4 &&
      !n.iface.startsWith('veth') &&
      !n.iface.startsWith('br-') &&
      n.iface !== 'lo'
  );

/**
 * Collect the bounded system snapshot exposed by the sample API.
 *
 * @returns {Promise<object>} CPU, memory, disk, battery, GPU, network and process data.
 */
const get_system_info = async () => {
  /** Concurrent provider results assembled into one dashboard snapshot. */
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
    processes,
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
    si.processes(),
  ]);

  return {
    os: {
      name: os_info.distro,
      kernel: os_info.kernel,
      uptime: Math.floor(os.uptime() / 3600) + 'h',
      hostname: os.hostname(),
    },
    cpu: {
      model: cpu.brand,
      load: load.currentLoad.toFixed(1),
      temp: temp.main || 0,
    },
    memory: {
      total: format_bytes(mem.total),
      used: format_bytes(mem.used),
      percent: percent(mem.used, mem.total),
    },
    disk: disk
      .filter((d) => d.size > 0)
      .map((d) => ({
        mount: d.mount,
        used: format_bytes(d.used),
        size: format_bytes(d.size),
        percent: percent(d.used, d.size),
      })),
    battery: {
      has: battery.hasBattery,
      percent: battery.percent,
      charging: battery.isCharging,
    },
    gpu: gpu.controllers,
    network: filter_network(Array.isArray(network) ? network : [network]),
    processes: processes.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 8)
      .map((p) => ({
        name: p.name,
        cpu: p.cpu,
        mem: format_bytes(p.mem),
      })),
  };
};

export default defineDevtoolsModuleApiHandlers({
  // 🔥 IMPORTANT: handler exists, but module ID comes from folder/package
  async inspect() {
    /** Sample package value or fixture named system. */
    const system = await get_system_info();

    return {
      system,
    };
  },
});
