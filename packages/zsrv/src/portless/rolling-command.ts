/** Cross-process rolling application controller. The CLI process owns children;
 * authenticated loopback commands operate on this one verified owner. */
import { discoverStateWithRecovery, isProxyRunning, waitForProxy } from './cli-utils.js';
import { portlessProxy } from './portless.js';
import { RouteStore } from './routes.js';
import { launchRollingApplication, type RollingApplication, type RollingStatus } from './rolling-app.js';
import { RemoteBackendConnections } from './proxy-control.js';
import { createLocalControl, sendLocalControl, ensureControlDirectory, readControlDescriptor, type LocalControl } from './local-control.js';
import { createDeploymentHistory, readDeploymentHistory } from './deployment-history.js';
import { withOperationLock } from './operation-lock.js';
import { formatUrl, parseHostname } from './utils.js';
import { processIdentity, processExists } from './lifecycle.js';
import { createGenerationRegistry, readGenerationRecord, recoverRollingGenerations, recoverRollingGenerationsLocked } from './generation-registry.js';
import { pruneDeploymentHistory } from './deployment-history.js';
import { reconcileRollingControllers } from './rolling-reconciler.js';
import type { RollingRunArguments } from '../bin/parse-rolling.js';

export async function startRollingFromCLI(options: RollingRunArguments): Promise<void> {
  const { dir, port, tls, tld } = await discoverStateWithRecovery();
  if (!(await isProxyRunning(port, tls))) {
    if (!(await portlessProxy(port, { https: tls, tld })) || !(await waitForProxy(port, undefined, undefined, tls))) {
      throw new Error('Proxy is not ready');
    }
  }
  // A rolling CLI wrapper runs outside the proxy process, so its observer must
  // come from the actual proxy. Never use a fresh in-memory tracker here.
  const connections = new RemoteBackendConnections(dir);
  // Probe access before spawning a child. Port 1 is harmless when idle.
  await connections.waitForIdle('probe.localhost', 1, 0);
  const hostname = parseHostname(options.name, tld);
  const routeStore = new RouteStore(dir);
  let app: RollingApplication | undefined;
  let control: LocalControl | undefined;
  let reporter: ReturnType<typeof createDeploymentHistory> | undefined;
  let registry: ReturnType<typeof createGenerationRegistry> | undefined;
  let stopped = false;
  const onStatus = (snapshot: Readonly<RollingStatus>) => reporter?.update(snapshot);
  try {
    // Serialize wrapper publication across processes while leaving long-running
    // deployment operations to the owning process's controller.
    await withOperationLock(ensureControlDirectory(dir, true), async () => {
      // Recover a dead wrapper under the same lock used for fresh publication.
      // A live or unverifiable owner blocks takeover.
      await recoverRollingGenerations(dir, hostname);
      registry = createGenerationRegistry(dir, hostname);
      app = await launchRollingApplication(options.command, {
        store: routeStore, hostname, ports: options.ports, connections,
        health: { path: options.healthPath }, force: options.force,
        readyTimeoutMs: options.readyTimeoutMs, shutdownTimeoutMs: options.shutdownTimeoutMs,
        drainTimeoutMs: options.drainTimeoutMs, verificationChecks: options.verificationChecks,
        verificationIntervalMs: options.verificationIntervalMs,
        onStatus,
        onLease: leaseId => registry!.lease(leaseId),
        onSpawn: (child, childPort) => {
          if (!child.pid || !registry) throw new Error('Cannot track rolling child');
          registry.track(child.pid, childPort);
          child.once('close', () => { try { registry?.untrack(child.pid!); }
            catch (error) { console.error('Rolling generation bookkeeping failed:', error); } });
        },
        env: { ...process.env, HOST: '127.0.0.1', PORTLESS_URL: formatUrl(hostname, port, tls) },
      });
      reporter = createDeploymentHistory(dir, hostname, app.status);
      reporter.record('started', { toPort: options.ports[0] });
      control = await createLocalControl(dir, hostname, async (action) => {
        if (!app || !reporter) throw new Error('Application controller unavailable');
        if (action === 'status') return reporter.current;
        if (action === 'deploy') {
          try {
            const result = await app.deploy();
            reporter.record('deployed', result);
            watchCurrent();
            return result;
          } catch (error) {
            reporter.record('failed', { error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        }
        if (action === 'stop') {
          await stop();
          return reporter.current;
        }
        throw new Error('Unknown rolling operation');
      });
    });
  } catch (error) {
    await app?.stop().catch(() => {});
    await control?.close().catch(() => {});
    // Leave the record for recovery if a child could not be stopped.
    if (!app || !app.current?.running) registry?.close();
    throw error;
  }
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await app!.stop();
      reporter!.record('stopped');
      registry?.close();
    } finally {
      // Don't tear down the response socket before a remote stop is acknowledged.
      setImmediate(() => { void control?.close().catch(() => {}); });
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  };
  const onSignal = () => { void stop().catch(error => { console.error('Rolling shutdown failed:', error); process.exitCode = 1; }); };
  function watchCurrent() {
    const child = app?.current;
    void child?.completed.then(() => {
      // Ignore expected termination of an old generation during deployment.
      if (!stopped && app?.current === child && app.status.phase === 'running') {
        void stop().catch(error => { console.error('Rolling crash cleanup failed:', error); process.exitCode = 1; });
      }
    });
  }
  watchCurrent();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  console.log(`Rolling application ready: ${formatUrl(hostname, port, tls)} (${options.ports.join(', ')})`);
}

export async function rollingReconcileAll(json = false, dryRun = false): Promise<boolean> {
  const { dir } = await discoverStateWithRecovery();
  const report = await reconcileRollingControllers(dir, { dryRun });
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Rolling reconciliation: scanned=${report.scanned} recovered=${report.recovered} failed=${report.failed}`);
    for (const item of report.items) console.log(`  ${item.hostname}: ${item.state}${item.error ? ` (${item.error})` : ''}`);
  }
  return report.failed === 0;
}

export async function rollingCLIAction(action: 'deploy' | 'stop' | 'status' | 'history' | 'recover' | 'prune' | 'backends', name: string, json = false, retention?: { days?: number; maxEvents?: number }, dryRun = false): Promise<boolean> {
  const { dir, tld } = await discoverStateWithRecovery();
  const hostname = parseHostname(name, tld);
  if (action === 'backends') {
    const results = await new RemoteBackendConnections(dir).status(hostname);
    if (json) console.log(JSON.stringify(results, null, 2));
    else if (!results.length) console.log(`${hostname}: no active backends`);
    else for (const item of results) console.log(`${hostname}:${item.port} ${item.healthy ? 'healthy' : 'isolated'} failures=${item.failures} weight=${item.weight}`);
    return true;
  }
  if (action === 'recover') {
    const result = await recoverRollingGenerationsLocked(dir, hostname, { dryRun });
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.dryRun ? `${hostname}: dry run; ${result.wouldTerminate?.length ?? 0} verified child(ren) would be stopped` : result.recovered ? `${hostname}: recovered; terminated ${result.terminated.length} orphan child(ren)` : `${hostname}: no recovery required`);
    return true;
  }
  if (action === 'prune') {
    const result = await withOperationLock(ensureControlDirectory(dir, true), async () => {
      const owner = readControlDescriptor(dir, hostname);
      if (owner && (processIdentity(owner.pid) === owner.identity ||
          (processIdentity(owner.pid) === null && processExists(owner.pid)))) {
        throw new Error('Cannot prune history while controller is online or unverifiable');
      }
      return pruneDeploymentHistory(dir, hostname, retention);
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${hostname}: ${result.removed} history event(s) pruned`);
    return true;
  }
  if (action === 'history' || action === 'status') {
    const history = readDeploymentHistory(dir, hostname);
    if (!history) {
      const pending = readGenerationRecord(dir, hostname);
      if (action === 'status' && pending) {
        const output = { hostname, online: false, recoveryRequired: true, orphanGenerations: pending.children.length };
        if (json) console.log(JSON.stringify(output, null, 2));
        else console.log(`${hostname}: controller interrupted; recovery required (${pending.children.length} generation(s))`);
        return true;
      }
      console.error(`No deployment history: ${hostname}`); return false;
    }
    // History is a last-known snapshot, not a guarantee of current health.
    const owner = readControlDescriptor(dir, hostname);
    const online = !!(owner && processIdentity(owner.pid) === owner.identity);
    const generations = !online ? readGenerationRecord(dir, hostname) : null;
    const output = action === 'history' ? history.history : { ...history, online, recoveryRequired: !!generations, orphanGenerations: generations?.children.length ?? 0 };
    if (json) console.log(JSON.stringify(output, null, 2));
    else console.log(action === 'history' ? history.history.map(h => `${h.timestamp} ${h.outcome} generation=${h.generation}${h.error ? ` (${h.error})` : ''}`).join('\n') : `${hostname}: ${history.status.phase} generation=${history.status.generation} port=${history.status.port ?? '-'} (${online ? 'controller online' : generations ? 'recovery required' : 'last known; controller offline'})`);
    return true;
  }
  const result = await sendLocalControl(dir, hostname, action, undefined, 615000);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${hostname}: ${action} completed`, result);
  return true;
}
