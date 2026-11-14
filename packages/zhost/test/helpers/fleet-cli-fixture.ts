import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
/** Built package-local CLI path used by explicit owned test subprocesses. */
export const bin = new URL('../../dist/bin/zerux.js', import.meta.url).pathname;
/** Fixed trusted synthetic HTTP child source, not arbitrary request/model-supplied code. */
export const appCode = String.raw`
const http=require('node:http');const port=+process.env.PORT;
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}res.end('backend:'+port)});
server.listen(port,'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
/** Yield for a bounded synthetic observation interval.
 * @param {number} ms Fixture delay in milliseconds.
 * @returns {Promise<void>} Owned one-shot timer settlement. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Acquire one owned fixture CLI child without a shell, using an explicit isolated environment.
 * @param {string[]} args Literal trusted fixture arguments.
 * @param {NodeJS.ProcessEnv} env Explicit private namespace and ephemeral port environment.
 * @returns {object} Owned child/log/termination helper; caller must invoke end in finally. */
export const runner = (args, env) => {
  /** Owned native fixture subprocess; no user-managed app is signalled. */
  const child = spawn(process.execPath, [bin, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const s of [child.stdout, child.stderr]) {
    s.on('data', (b) => (logs += b.toString()));
  }
  return {
    child,
    get logs() {
      return logs;
    },
    /** Request TERM then bounded KILL fallback for only this fixture child.
     * @returns {Promise<void>} Legacy fixture waits TERM observation; final KILL is requested without claiming arbitrary descendants settled.
     */ async end() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill('SIGTERM');
      let timer;
      await Promise.race([
        new Promise((r) => child.once('exit', r)),
        new Promise((r) => {
          timer = setTimeout(r, 2500);
        }),
      ]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    },
  };
};
/** Run one isolated fixed fixture CLI command and await its owned child outcome under a finite timeout.
 * @param {string[]} args - Fixed trusted fixture CLI arguments; no caller/model input is executed.
 * @param {NodeJS.ProcessEnv} env - Fixture environment with explicit private state path and ephemeral proxy port.
 * @param {number} timeout - Fixture timeout in milliseconds, default twenty-five seconds.
 * @returns {Promise<string>} Captured synthetic operator output; finally terminates only the owned child.
 */
export async function cli(args, env, timeout = 25000) {
  /** Owned one-command subprocess/log handle closed in finally. */
  const p = runner(args, env);
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) =>
        p.child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`exit ${code}: ${p.logs}`))
        )
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`CLI timeout: ${args.join(' ')}`)),
          timeout
        );
      }),
    ]);
    return p.logs.trim();
  } finally {
    clearTimeout(timer);
    await p.end();
  }
}
/** Poll a synthetic asynchronous condition until a finite fixture deadline, retaining its last observed cause.
 * @param {() => unknown | Promise<unknown>} fn - Explicit local fixture predicate.
 * @param {number} timeout - Finite fixture deadline, default fifteen seconds.
 * @returns {Promise<unknown>} Truthy predicate value or a descriptive timeout rejection.
 */
export async function poll(fn, timeout = 15000) {
  let err;
  /** Finite local predicate observation cutoff. */
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      /** Actual predicate result, returned only when truthy. */
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (e) {
      err = e;
    }
    await wait(70);
  }
  throw new Error('timeout: ' + (err?.message || 'not ready'));
}
/** Read one small synthetic response from the owned loopback proxy.
 * @param {number} port Actual owned proxy listener port.
 * @param {string} hostname Fixed synthetic route label.
 * @returns {Promise<{status: number, body: string}>} Native bounded fixture response. */
export const request = (port, hostname) =>
  new Promise((resolve, reject) => {
    /** Owned local synthetic HTTP request with explicit fixed host header. */
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        headers: { Host: hostname, Connection: 'close' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.once('error', reject);
  });
/** Reserve simultaneous ephemeral fixture sockets, copy their ports and close all reservations in finally.
 * @param {number} n - Small explicit fixture inventory count.
 * @returns {Promise<number[]>} Observed free candidate ports; eventual native binds still handle races.
 */
async function freePorts(n) {
  /** Simultaneous owned ephemeral port reservations, all closed after inventory selection. */
  const servers = Array.from({ length: n }, () => net.createServer());
  try {
    await Promise.all(
      servers.map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r)))
    );
    return servers.map((s) => s.address().port);
  } finally {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  }
}
/** Own one isolated proxy/fleet subprocess fixture with private state and ephemeral ports, then terminate only its children and remove its namespace.
 * @param {(fixture: object) => Promise<unknown>} testFn - Assertions over only these owned synthetic resources.
 * @returns {Promise<unknown>} Callback result after actual fixture cleanup.
 */
export async function cliFixture(testFn) {
  /** Owned synthetic private namespace; cleanup never targets operator proxy/application state. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-scale-cli-'));
  /** Disjoint synthetic proxy and backend candidate ports reserved together. */
  const [proxyPort, ...ports] = await freePorts(6);
  /** Fixture environment overriding private proxy state and selected ephemeral listener port. */
  const env = {
    ...process.env,
    PORTLESS_STATE_DIR: dir,
    PORTLESS_PORT: String(proxyPort),
  };
  /** Owned synthetic shared-proxy subprocess; finally terminates only this handle. */
  const proxy = runner(['proxy', 'start', '--port', String(proxyPort)], env);
  let fleet;
  try {
    await poll(async () => {
      try {
        return (await request(proxyPort, 'scale.localhost')).status === 404;
      } catch {
        return false;
      }
    });
    /** Start an explicit fixture fleet and await a real synthetic HTTP readiness response.
     * @param {string[]} extra Literal optional trusted fixture flags.
     * @returns {Promise<object>} Owned fleet wrapper handle retained by the outer fixture. */
    const start = async (extra = []) => {
      fleet = runner(
        [
          'fleet',
          'run',
          '--name',
          'scale',
          '--ports',
          ports.join(','),
          '--replicas',
          '2',
          '--health-path',
          '/health',
          '--health-interval',
          '30000',
          '--ready-timeout',
          '2000',
          '--shutdown-timeout',
          '1000',
          ...extra,
          '--',
          process.execPath,
          '-e',
          appCode,
        ],
        env
      );
      await poll(async () => {
        try {
          return (await request(proxyPort, 'scale.localhost')).status === 200;
        } catch {
          return false;
        }
      });
      return fleet;
    };
    return await testFn({
      dir,
      env,
      proxyPort,
      ports,
      start,
      get fleet() {
        return fleet;
      },
    });
  } finally {
    if (fleet) {
      await fleet.end();
    }
    await proxy.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
