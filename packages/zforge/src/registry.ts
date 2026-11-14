import { createSecurityPolicy } from '@zeruxjs/security';
import fs from 'node:fs';
import net from 'node:net';

import { DEFAULT_SHARED_PORT, SHARED_DEV_FILE } from './constants.js';
import { readJsonFile, writeJsonFile } from './fs.js';
import type {
  SharedDevRegistration,
  SharedDevRegistrationOptions,
  SharedDevRegistry,
  SharedDevStartResult,
} from './types.js';

/** Normalize a trusted display name into the legacy registry route namespace.
 * @param {string} value - Host-provided application name.
 * @returns {string} Nonempty normalized label; it is not an authenticated app identity.
 */
const sanitizeAppName = (value: string) => {
  /** Normalized intermediate label before trimming boundary underscores. */
  const name = value
    .trim()
    .replace(/^@/, '')
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9_-]+/g, '_');
  let start = 0,
    end = name.length;
  while (start < end && name[start] === '_') {
    start++;
  }
  while (end > start && name[end - 1] === '_') {
    end--;
  }
  return name.slice(start, end) || 'app';
};

/** Probe legacy recorded process liveness without signaling it.
 * @param {number} [pid] - Recorded owner process ID.
 * @returns {boolean} Whether signal-zero probing succeeds; this alone does not prove server identity.
 */
const isPidAlive = (pid?: number) => {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Probe an ephemeral loopback bind and release it before returning.
 * @param {number} port - Candidate development port.
 * @returns {Promise<boolean>} Whether the probe could listen; the result does not reserve the port.
 */
export const isPortFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    /** Short-lived native port probe closed before resolving a successful result. */
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });

/** Search upward from the trusted preferred port using sequential released probes.
 * @param {number} start - Initial host-selected port.
 * @returns {Promise<number>} First successfully probed port; native listen errors still bound valid port numbers.
 */
export const findPort = async (start: number) => {
  let port = start;
  while (!(await isPortFree(port))) {
    port += 1;
  }
  return port;
};

/** Read and minimally normalize the bounded private legacy registry.
 * @returns {SharedDevRegistry} Current persisted registrations; this is not a transactional distributed store.
 */
export const readRegistry = (): SharedDevRegistry => {
  /** Current private registry snapshot; writes remain explicit legacy host operations. */
  const registry = readJsonFile<SharedDevRegistry>(SHARED_DEV_FILE, {
    apps: [],
  });
  return {
    port: registry.port,
    serverPid: registry.serverPid,
    updatedAt: registry.updatedAt,
    apps: Array.isArray(registry.apps) ? registry.apps : [],
  };
};

/** Timestamp and atomically replace the private legacy registry document.
 * @param {SharedDevRegistry} registry - Caller-owned record whose updatedAt is intentionally refreshed.
 * @returns {void} Completes the file replacement; no cross-process update lock is implied.
 */
export const writeRegistry = (registry: SharedDevRegistry) => {
  registry.updatedAt = new Date().toISOString();
  writeJsonFile(SHARED_DEV_FILE, registry);
};

/** Select a free application namespace against the supplied registry snapshot.
 * @param {string} appName - Host-provided display name.
 * @param {SharedDevRegistration[]} apps - Existing registration snapshot.
 * @param {string} rootDir - Current application root excluded from collisions.
 * @param {string} serviceName - Reserved service namespace.
 * @returns {string} Available normalized label within this snapshot only.
 */
const resolveRouteName = (
  appName: string,
  apps: SharedDevRegistration[],
  rootDir: string,
  serviceName: string
) => {
  /** Base route namespace derived from the authored application name. */
  const sanitized = sanitizeAppName(appName);
  /** Other application route names excluded from this registration candidate. */
  const taken = new Set(
    apps.filter((app) => app.rootDir !== rootDir).map((app) => app.routeName)
  );

  let candidate = sanitized;
  let index = 1;
  while (taken.has(candidate) || candidate === `__${serviceName}`) {
    candidate = `${sanitized}_${index++}`;
  }

  return candidate;
};

/** Find one application by its exact normalized legacy route name.
 * @param {string} routeName - Exact registered route namespace.
 * @returns {SharedDevRegistration | null} Parsed registry record, or null when absent.
 */
export const getRegistryApp = (routeName: string) => {
  /** Current private registry snapshot; writes remain explicit legacy host operations. */
  const registry = readRegistry();
  return registry.apps.find((app) => app.routeName === routeName) ?? null;
};

/** Find one application by its explicit host root path.
 * @param {string} rootDir - Registered root path compared exactly.
 * @returns {SharedDevRegistration | null} Parsed registry record, or null when absent.
 */
export const getRegistryAppByRoot = (rootDir: string) => {
  /** Current private registry snapshot; writes remain explicit legacy host operations. */
  const registry = readRegistry();
  return registry.apps.find((app) => app.rootDir === rootDir) ?? null;
};

/** Persist explicit legacy app registration after validating configured framing grants.
 * @param {SharedDevRegistrationOptions} options - Trusted host registration settings.
 * @returns {Promise<SharedDevStartResult>} Address receipt only; the caller still owns server startup and eventual unregister.
 */
export const registerSharedDevApp = async (
  options: SharedDevRegistrationOptions
): Promise<SharedDevStartResult> => {
  if (options.devtools?.frameAncestors !== undefined) {
    createSecurityPolicy({
      mode: 'development',
      developmentFrameAncestors: options.devtools.frameAncestors,
    });
  }
  /** Current private registry snapshot; writes remain explicit legacy host operations. */
  const registry = readRegistry();
  /** One ISO timestamp reused for this registration creation/update receipt. */
  const now = new Date().toISOString();
  /** Initial preferred port when the private registry does not already select one. */
  const basePort =
    options.preferredPort ?? registry.port ?? DEFAULT_SHARED_PORT;
  /** Existing registry port or newly probed candidate; registration itself does not bind it. */
  const port = registry.port ?? (await findPort(basePort));

  /** Existing applications excluding the current root to preserve replacement behavior. */
  const filteredApps = registry.apps.filter(
    (app) => app.rootDir !== options.rootDir
  );
  /** Explicit development namespace with the legacy zdev fallback. */
  const serviceName = options.serviceName || 'zdev';
  /** Selected namespace checked against other app names and the reserved service path. */
  const routeName = resolveRouteName(
    options.appName,
    filteredApps,
    options.rootDir,
    serviceName
  );
  /** Private persisted registration, separate from request authorization and listener ownership. */
  const nextApp: SharedDevRegistration = {
    appName: options.appName,
    routeName,
    serviceName,
    appPort: options.appPort,
    rootDir: options.rootDir,
    dataFilePath: options.dataFilePath ?? null,
    logFilePath: options.logFilePath ?? null,
    runtimeManifestPath: options.runtimeManifestPath ?? null,
    allowedDomains: options.allowedDomains ?? [],
    allowedDevDomain: options.allowedDevDomain ?? null,
    devtools: options.devtools ?? { modules: [] },
    startedAt: now,
    updatedAt: now,
  };

  registry.port = port;
  registry.apps = [...filteredApps, nextApp].sort((left, right) =>
    left.routeName.localeCompare(right.routeName)
  );
  writeRegistry(registry);

  return {
    port,
    routeName,
    allowedDevDomain: nextApp.allowedDevDomain,
    urls: {
      devtools: `http://127.0.0.1:${port}/${routeName}`,
      websocket: `ws://127.0.0.1:${port}/__${serviceName}/ws?app=${encodeURIComponent(routeName)}`,
    },
  };
};

/** Remove the explicit root registration and update or delete the private legacy registry.
 * @param {string} rootDir - Exact host-owned root to unregister.
 * @returns {boolean} True only when the final registry file was removed; false also covers remaining apps or deletion failure.
 */
export const unregisterSharedDevApp = (rootDir: string) => {
  if (!fs.existsSync(SHARED_DEV_FILE)) {
    return false;
  }

  /** Current private registry snapshot; writes remain explicit legacy host operations. */
  const registry = readRegistry();
  /** Registrations remaining after the exact root removal. */
  const nextApps = registry.apps.filter((app) => app.rootDir !== rootDir);

  if (nextApps.length === 0) {
    try {
      fs.unlinkSync(SHARED_DEV_FILE);
    } catch {
      return false;
    }
    return true;
  }

  writeRegistry({
    ...registry,
    apps: nextApps,
    serverPid: isPidAlive(registry.serverPid) ? registry.serverPid : undefined,
  });
  return false;
};

/** Read the normalized route namespace for one registered root.
 * @param {string} rootDir - Exact root key in the legacy registry.
 * @returns {string | null} Current route name or null.
 */
export const readSharedDevRouteName = (rootDir: string) =>
  getRegistryAppByRoot(rootDir)?.routeName ?? null;
