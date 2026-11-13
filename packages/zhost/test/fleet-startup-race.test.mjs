import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { canConnect } from '../dist/portless/process-supervisor.js';

/** Fixed trusted fixture code; native children terminate themselves if their wrapper crashes. */
const CHILD_SOURCE = `
const net = require('node:net');
// The first replica passes readiness and exits while the second is still starting.
const first = process.env.PORT === process.env.FIRST_PORT;
const server = net.createServer((socket) => socket.end());
setTimeout(() => server.listen(Number(process.env.PORT), '127.0.0.1'), first ? 0 : 450);
setTimeout(() => process.exit(first ? 7 : 0), first ? 260 : 1600);
`;

/** Static built modules under test, never caller/model-selected import destinations. */
const FLEET_MODULE = new URL(
  '../dist/portless/instance-fleet.js',
  import.meta.url
).href;
/** Static route-store module used only for private synthetic fixture state. */
const ROUTES_MODULE = new URL('../dist/portless/routes.js', import.meta.url)
  .href;
/** Trusted wrapper isolates a regression's uncaught microtask from the test runner. */
const WRAPPER_SOURCE = `
import { launchInstanceFleet } from ${JSON.stringify(FLEET_MODULE)};
import { RouteStore } from ${JSON.stringify(ROUTES_MODULE)};
let fleet;
try {
  fleet = await launchInstanceFleet([process.execPath, '-e', process.env.FIXTURE_PROGRAM], {
    store: new RouteStore(process.env.FIXTURE_STATE),
    hostname: 'startup-race.localhost',
    ports: JSON.parse(process.env.FIXTURE_PORTS),
    replicas: 2,
    // Startup must fail before there is traffic to drain; this is not a proxy-drain test.
    connections: { waitForIdle: async () => true },
    healthIntervalMs: 1000,
    readyTimeoutMs: 1200,
    shutdownTimeoutMs: 400,
    stdio: 'ignore',
    env: { FIRST_PORT: process.env.FIRST_PORT },
  });
  console.log(JSON.stringify({ outcome: 'returned' }));
} catch (error) {
  console.log(JSON.stringify({ outcome: 'rejected', message: error.message }));
} finally {
  await fleet?.stop();
}
`;

/**
 * Allocate distinct ephemeral fixture ports and release every temporary listener.
 *
 * @returns {Promise<number[]>} Previously free ports; no operator port is selected.
 */
async function fixturePorts() {
  /** Simultaneous reservations prevent duplicate ports within this fixture allocation. */
  const servers = Array.from({ length: 3 }, () => net.createServer());
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      )
    );
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve)))
    );
  }
}

test(
  'replica exit during initial readiness rejects startup without an uncaught reconcile or published route',
  { timeout: 7000 },
  async (t) => {
    /** Private synthetic route root; no operator state is discovered or changed. */
    const dir = await mkdtemp(join(tmpdir(), 'zhost-fleet-startup-'));
    /** Distinct local fixture capacity, including the required unused spare. */
    const ports = await fixturePorts();
    /** Only fixture/OS-loader settings are inherited; credentials and NODE_OPTIONS are excluded. */
    const env = {
      FIRST_PORT: String(ports[0]),
      FIXTURE_STATE: dir,
      FIXTURE_PORTS: JSON.stringify(ports),
      FIXTURE_PROGRAM: CHILD_SOURCE,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    };
    /** Owned wrapper; its fixed children have independent bounded fallback lifetimes. */
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', WRAPPER_SOURCE],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-16384);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16384);
    });
    /** Cancel only the owned wrapper; never signal a PID obtained from external state. @returns {void} Requests native fixture termination. */
    const abort = () => {
      child.kill('SIGKILL');
    };
    t.signal.addEventListener('abort', abort, { once: true });
    /** Fixed upper bound on waiting for a broken wrapper, cleared on actual close. */
    const timer = setTimeout(abort, 3000);
    try {
      /** Native close receipt includes pipe settlement before parsing the bounded fixture output. */
      const outcome = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      assert.equal(outcome.code, 0, stderr);
      assert.equal(outcome.signal, null);
      assert.deepEqual(JSON.parse(stdout.trim()), {
        outcome: 'rejected',
        message: 'Fleet member exited before initial route publication',
      });
      assert.deepEqual(
        await Promise.all(ports.slice(0, 2).map((port) => canConnect(port))),
        [false, false]
      );
      await assert.rejects(stat(join(dir, 'routes.json')), { code: 'ENOENT' });
    } finally {
      clearTimeout(timer);
      t.signal.removeEventListener('abort', abort);
      if (child.exitCode === null && child.signalCode === null) abort();
      // Bound fallback children even if a regression crashed their wrapper before its own cleanup.
      await new Promise((resolve) => setTimeout(resolve, 1800));
      await rm(dir, { recursive: true, force: true });
    }
  }
);
