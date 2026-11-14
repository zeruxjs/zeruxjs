import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Fixed built package-local CLI entry for owned subprocess fixtures. */
const cli = fileURLToPath(new URL('../dist/bin/zerux.js', import.meta.url));
/** Yield between finite synthetic readiness observations.
 * @param {number} ms Bounded fixture delay.
 * @returns {Promise<void>} Owned timer settlement. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Observe an ephemeral candidate port and close the temporary reservation.
 * @returns {Promise<number>} Candidate only; the later fixture child bind remains authoritative.
 */
async function port() {
  /** Owned temporary loopback port reservation, closed before returning its candidate. */
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  /** Actual temporary reservation port. */
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
/** Launch only the fixed built package CLI as an owned subprocess with explicit private state and ephemeral ports.
 * @param {string[]} args - Literal trusted fixture CLI arguments, never untrusted code.
 * @param {NodeJS.ProcessEnv} env - Fixture environment explicitly overriding the private proxy namespace.
 * @returns {object} Owned native child, actual completion and captured synthetic output; caller owns termination.
 */
function launch(args, env) {
  /** Owned native fixture subprocess, never an operator application. */
  const child = spawn(process.execPath, [cli, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  for (const s of [child.stdout, child.stderr]) {
    s.on('data', (chunk) => (out += chunk));
  }
  /** Native close receipt preserving this fixture child’s exit code and signal. */
  const completed = new Promise((r) =>
    child.once('close', (code, signal) => r({ code, signal }))
  );
  return { child, completed, output: () => out };
}
/** Poll only synthetic fixture state until a finite deadline while tolerating transient not-ready observations.
 * @param {() => Promise<unknown>} check - Explicit local fixture readiness/status predicate.
 * @param {number} ms - Bounded fixture wait, default seven seconds.
 * @returns {Promise<void>} Successful observation or explicit fixture timeout rejection.
 */
async function waitUntil(check, ms = 7000) {
  /** Finite synthetic state observation cutoff. */
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      /* This optional failure is intentionally ignored. */
    }
    await sleep(35);
  }
  throw Error('Timed out waiting for state');
}
/** Read one bounded synthetic response through the owned local proxy.
 * @param {number} portNumber - Actual ephemeral proxy port.
 * @param {string} host - Fixed synthetic route authority.
 * @returns {Promise<{status: number, body: string}>} Native response receipt; request timeout destroys only this fixture request.
 */
async function get(portNumber, host) {
  return new Promise((res, rej) => {
    /** Owned local status/HTTP request with explicit native timeout. */
    const req = http.get(
      {
        host: '127.0.0.1',
        port: portNumber,
        headers: { Host: host },
        timeout: 500,
      },
      (response) => {
        let body = '';
        response.on('data', (x) => (body += x));
        response.on('end', () => res({ status: response.statusCode, body }));
      }
    );
    req.on('error', rej);
    req.on('timeout', () => req.destroy());
  });
}
/** Invoke the fixture CLI status reader against only the isolated synthetic namespace.
 * @param {NodeJS.ProcessEnv} env - Explicit private fixture environment.
 * @returns {Promise<object[]>} Parsed actual local CLI status, after asserting its owned process succeeded.
 */
async function status(env) {
  /** Owned one-shot status CLI subprocess using only the fixture namespace. */
  const cliProcess = launch(['status', 'demo', '--json'], env);
  /** Actual owned status-process completion checked before parsing its output. */
  const done = await cliProcess.completed;
  assert.equal(done.code, 0, cliProcess.output());
  return JSON.parse(cliProcess.output());
}

test(
  'CLI status reads live process and SIGUSR2 reload transitions to the next generation',
  { timeout: 18000 },
  async () => {
    if (process.platform === 'win32') {
      return;
    }
    /** Owned synthetic private state directory removed only after this fixture’s children are stopped. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-reload-int-'));
    /** Observed private ephemeral proxy candidate. */
    const proxyPort = await port();
    /** Observed private ephemeral child backend candidate. */
    const appPort = await port();
    /** Synthetic restart-count file inside the owned private namespace. */
    const countFile = path.join(dir, 'counter');
    /** Explicit environment overrides isolating all proxy/app state for this fixture. */
    const env = {
      ...process.env,
      PORTLESS_STATE_DIR: dir,
      PORTLESS_PORT: String(proxyPort),
    };
    /** Owned fixture proxy CLI subprocess with actual completion tracking. */
    const proxy = launch(['proxy', 'start', '--port', String(proxyPort)], env);
    let app;
    try {
      await waitUntil(async () => {
        try {
          return (await get(proxyPort, 'none.localhost')).status > 0;
        } catch {
          return false;
        }
      }, 6500);
      /** Fixed trusted synthetic restart-counting child program; not application/model data. */
      const code = `const fs=require('node:fs');let n=0;try{n=Number(fs.readFileSync(${JSON.stringify(countFile)},'utf8'))}catch{};n++;fs.writeFileSync(${JSON.stringify(countFile)},String(n));const server=require('node:http').createServer((req,res)=>res.end('instance-'+n));server.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close());`;
      app = launch(
        [
          'run',
          '--name',
          'demo',
          '--app-port',
          String(appPort),
          '--ready-timeout',
          '3000',
          '--reload-signal',
          '--restart',
          'never',
          '--',
          process.execPath,
          '-e',
          code,
        ],
        env
      );
      await waitUntil(async () => {
        /** Actual isolated CLI status rows observed while polling owned child generations. */
        const rows = await status(env);
        return (
          rows.length === 1 &&
          rows[0].alive &&
          rows[0].status.phase === 'running' &&
          rows[0].status.generation === 1
        );
      });
      assert.equal((await get(proxyPort, 'demo.localhost')).body, 'instance-1');
      app.child.kill('SIGUSR2');
      await waitUntil(async () => {
        /** Actual isolated CLI status rows observed while polling owned child generations. */
        const rows = await status(env);
        return rows.some(
          (x) =>
            x.alive && x.status.generation === 2 && x.status.phase === 'running'
        );
      }, 8000);
      assert.equal((await get(proxyPort, 'demo.localhost')).body, 'instance-2');
      assert.equal(fs.readFileSync(countFile, 'utf8'), '2');
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(dir, 'routes.json'), 'utf8')
        ).filter((x) => x.hostname === 'demo.localhost').length,
        1
      );
      app.child.kill('SIGTERM');
      assert.equal((await app.completed).code, 0, app.output());
      await waitUntil(async () => {
        /** Actual isolated CLI status rows observed while polling owned child generations. */
        const rows = await status(env);
        return (
          rows.length === 1 &&
          rows[0].status.phase === 'stopped' &&
          !rows[0].alive
        );
      });
    } finally {
      if (app?.child.exitCode === null) {
        app.child.kill('SIGKILL');
        await app.completed;
      }
      proxy.child.kill('SIGTERM');
      await Promise.race([proxy.completed, sleep(2000)]);
      if (proxy.child.exitCode === null) {
        proxy.child.kill('SIGKILL');
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
