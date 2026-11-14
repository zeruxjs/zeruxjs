import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { RouteStore } from '../../dist/portless/routes.js';
import { createProxyServer } from '../../dist/portless/proxy.js';
import { launchInstanceFleet } from '../../dist/portless/instance-fleet.js';
/** Fixed trusted synthetic HTTP child program; never evaluated from incoming application data. */
const code = String.raw`
const http=require('node:http');
const fs=require('node:fs');
if(process.env.FLEET_TEST_DIR && fs.existsSync(process.env.FLEET_TEST_DIR+'/block-'+process.env.PORT)) process.exit(4);
const port=Number(process.env.PORT);
const server=http.createServer((req,res)=>{
 if(req.url==='/health'){res.end('ok');return;}
 if(req.url==='/slow'){setTimeout(()=>res.end('slow'),180);return;}
 res.end('node:'+port);
});
server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
/** Observe a small simultaneous ephemeral port inventory and release all temporary reservations.
 * @param {number} count - Explicit small fixture inventory count.
 * @returns {Promise<number[]>} Native candidate ports; later binds remain authoritative.
 */
async function freePorts(count: number): Promise<number[]> {
  /** Owned simultaneous ephemeral port reservations, all closed in finally. */
  const sockets = Array.from({ length: count }, () => net.createServer());
  try {
    await Promise.all(
      sockets.map(
        (s) =>
          new Promise((resolve, reject) => {
            s.once('error', reject);
            s.listen(0, '127.0.0.1', resolve);
          })
      )
    );
    return sockets.map((socket) => {
      // Native servers can return string addresses or null before/after listening.
      const address = socket.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a bound TCP listener address');
      }
      return address.port;
    });
  } finally {
    await Promise.all(sockets.map((s) => new Promise((r) => s.close(r))));
  }
}
/** Own a synthetic loopback proxy, two ready child replicas and a private route namespace for one asynchronous scaling assertion.
 * @param {(fixture: object) => Promise<unknown>} testFn - Assertions over only owned synthetic resources.
 * @param {object} extra - Explicit trusted fixture launch-policy overrides.
 * @returns {Promise<unknown>} Callback result after fleet stop, native proxy close and private state removal.
 */
export async function fleetFixture(testFn, extra = {}) {
  /** Owned synthetic private namespace; cleanup never targets operator proxy/application state. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-scale-test-'));
  /** Fixture-private conditional route registry, isolated from operator state. */
  const store = new RouteStore(dir);
  /** Owned ephemeral proxy providing the actual backend drain observer. */
  const proxy = createProxyServer({
    getRoutes: () => store.loadRoutes(),
    proxyPort: 0,
    onError: () => {},
  });
  /** Observed small private backend candidate inventory. */
  const ports = await freePorts(5);
  let fleet;
  try {
    await new Promise((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    fleet = await launchInstanceFleet([process.execPath, '-e', code], {
      store,
      hostname: 'scale.localhost',
      ports,
      replicas: 2,
      connections: proxy.backendConnections,
      health: { path: '/health' },
      healthIntervalMs: 30000,
      readyTimeoutMs: 2500,
      shutdownTimeoutMs: 800,
      drainTimeoutMs: 1000,
      replacementDelayMs: 0,
      stdio: 'ignore',
      env: { FLEET_TEST_DIR: dir },
      ...extra,
    });
    return await testFn({ store, proxy, ports, fleet, dir });
  } finally {
    await fleet?.stop().catch(() => {});
    await new Promise((r) => proxy.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
