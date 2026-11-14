import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  createLocalControl,
  sendLocalControl,
  readControlDescriptor,
} from '../dist/portless/local-control.js';
import {
  createDeploymentHistory,
  readDeploymentHistory,
} from '../dist/portless/deployment-history.js';
import { parseRollingRunArguments } from '../dist/bin/parse-rolling.js';

/** Yield between bounded fixture observations.
 * @param {number} ms Synthetic observation delay.
 * @returns {Promise<void>} Owned timer completion. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Observe an ephemeral loopback candidate and close only its temporary reservation.
 * @returns {Promise<number>} Candidate port; later fixture native bind remains authoritative.
 */
async function freePort() {
  /** Owned native temporary reservation or one-shot CLI child handle; each caller performs its explicit cleanup. */
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  /** Actual ephemeral fixture candidate port. */
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
/** Fixed trusted synthetic readiness/slow HTTP child program; never incoming application source. */
const appCode = `const http=require('node:http');const port=+process.env.PORT;
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}
if(req.url==='/slow'){setTimeout(()=>res.end(String(port)),700);return;}
res.end(String(port));});server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`;
/** Read one small synthetic response from the owned fixture proxy.
 * @param {number} port Actual owned ephemeral proxy port.
 * @param {string} host Fixed synthetic route authority.
 * @param {string} route Fixed synthetic path, default root.
 * @returns {Promise<{status: number, body: string}>} Native fixture response receipt. */
const get = (port, host, route = '/') =>
  new Promise((resolve, reject) => {
    /** Owned one-shot native HTTP request with observed errors. */
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: route,
        headers: { Host: host, Connection: 'close' },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
  });
/** Run only an explicit trusted fixture executable argument list in a private synthetic namespace without a shell.
 * @param {string[]} argv - Fixed native executable arguments for the built package CLI.
 * @param {NodeJS.ProcessEnv} env - Explicit fixture state/ephemeral port overrides.
 * @returns {object} Owned subprocess/log/termination handle; never an operator application.
 */
function runner(argv, env) {
  /** Owned native subprocess; fixture cleanup never discovers or kills arbitrary PIDs. */
  const child = spawn(process.execPath, argv, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      logs += chunk.toString();
    });
  }
  return {
    child,
    get logs() {
      return logs;
    },
    /** Request TERM then finite KILL fallback for only this owned fixture child.
     * @returns {Promise<void>} Legacy fixture observes TERM for a finite interval; final KILL is requested without a descendant-drain claim.
     */ async end() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
      let timer;
      await Promise.race([
        new Promise((r) => child.once('exit', r)),
        new Promise((r) => {
          timer = setTimeout(r, 1500);
        }),
      ]);
      clearTimeout(timer);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    },
  };
}
/** Run one built operator command only against the owned fixture namespace under a finite observation timeout.
 * @param {string} bin - Fixed built package-local CLI path.
 * @param {NodeJS.ProcessEnv} env - Explicit isolated private state/port environment.
 * @param {string[]} args - Literal trusted fixture CLI arguments.
 * @returns {Promise<{code: number, output: string}>} Actual owned CLI exit/output receipt; timeout stops only its child.
 */
async function cli(bin, env, args) {
  /** Owned native temporary reservation or one-shot CLI child handle; each caller performs its explicit cleanup. */
  const s = runner([bin, ...args], env);
  let timer;
  /** Owned finite one-shot CLI observation timeout, cleared after command completion. */
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), 20000);
  });
  /** Actual native exit code or explicit fixture timeout sentinel. */
  const code = await Promise.race([
    new Promise((resolve) => s.child.once('exit', resolve)),
    timeout,
  ]);
  clearTimeout(timer);
  if (code === 'timeout') {
    await s.end();
    throw new Error(`CLI timeout: ${args.join(' ')} ${s.logs}`);
  }
  return { code, output: s.logs };
}
/** Poll synthetic private controller state until a finite deadline, retaining its last failure for diagnosis.
 * @param {() => unknown | Promise<unknown>} fn - Explicit fixture-local observation callback.
 * @param {number} time - Finite fixture milliseconds, default seven seconds.
 * @returns {Promise<unknown>} Truthy observed value or explicit timeout rejection.
 */
async function poll(fn, time = 7000) {
  /** Finite synthetic state observation cutoff. */
  const until = Date.now() + time;
  let error;
  while (Date.now() < until) {
    try {
      /** Actual fixture predicate result; returned only after a truthy observation. */
      const result = await fn();
      if (result) {
        return result;
      }
    } catch (e) {
      error = e;
    }
    await delay(55);
  }
  throw new Error(`Timed out polling: ${error?.message ?? 'not ready'}`);
}

test('rolling options preserve application flags and reject unsafe or duplicate values', () => {
  /** Parsed trusted CLI argument fixture; no supplied program executes in this assertion. */
  const args = parseRollingRunArguments([
    '--name',
    'api',
    '--ports',
    '4300,4301',
    '--health-path',
    '/health',
    '--',
    'node',
    'app.js',
    '--force',
  ]);
  assert.deepEqual(args.command, ['node', 'app.js', '--force']);
  assert.deepEqual(args.ports, [4300, 4301]);
  assert.throws(
    () =>
      parseRollingRunArguments([
        '--name',
        'api',
        '--ports',
        '4300,4300',
        '--',
        'node',
        'app',
      ]),
    /distinct/
  );
  assert.throws(
    () =>
      parseRollingRunArguments([
        '--name',
        'api',
        '--ports',
        '4300,4301',
        '--health-path',
        '//evil',
        '--',
        'node',
      ]),
    /health/
  );
});

test('local control authenticates requests, protects private descriptors and closes correctly', async () => {
  /** Owned private synthetic namespace removed in finally after child/endpoint cleanup. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-rpc-'));
  try {
    /** Owned authenticated loopback private control endpoint. */
    const service = await createLocalControl(
      dir,
      'example.localhost',
      (action, data) => {
        if (action === 'echo') {
          return data;
        }
        throw Error('Unknown');
      }
    );
    assert.deepEqual(
      await sendLocalControl(dir, 'example.localhost', 'echo', { answer: 42 }),
      { answer: 42 }
    );
    /** Private fixture control descriptor containing a secret token; never returned as public diagnostics. */
    const meta = readControlDescriptor(dir, 'example.localhost');
    assert.equal(meta.port, service.descriptor.port);
    await assert.rejects(
      sendLocalControl(dir, 'example.localhost', 'invalid'),
      /Unknown/
    );
    assert.equal(
      fs
        .statSync(
          path.dirname(
            path.join(dir, 'app-controls-' + (process.getuid?.() ?? 'user'))
          )
        )
        .isDirectory(),
      true
    );
    assert.equal(
      fs.statSync(
        path.join(dir, `app-controls-${process.getuid?.() ?? 'user'}`)
      ).mode & 0o077,
      0
    );
    /** Actual raw denied control reply to a fixed forged fixture token. */
    const unauthorized = await new Promise((resolve) => {
      /** Owned raw fixture control client, not an operator endpoint. */
      const socket = net.connect({ host: '127.0.0.1', port: meta.port });
      let raw = '';
      socket.on('connect', () =>
        socket.write(
          JSON.stringify({
            action: 'echo',
            token: '0'.repeat(64),
            data: 'secret',
          }) + '\n'
        )
      );
      socket.on('data', (chunk) => (raw += chunk));
      socket.on('end', () => resolve(raw));
      socket.on('error', () => resolve(raw));
    });
    assert.match(unauthorized, /Unauthorized/);
    await service.close();
    assert.equal(readControlDescriptor(dir, 'example.localhost'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deployment history bounds events, retains generations, refuses symlink replacement', () => {
  /** Owned private synthetic namespace removed in finally after child/endpoint cleanup. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-deploy-hist-'));
  try {
    /** Synthetic initial rolling observation without private user/request payloads. */
    const initial = {
      phase: 'running',
      generation: 1,
      port: 4000,
      pid: process.pid,
      previousPort: null,
      updatedAt: new Date().toISOString(),
    };
    /** Owned private single-writer diagnostic-history callbacks. */
    const journal = createDeploymentHistory(dir, 'history.localhost', initial);
    for (let i = 0; i < 60; i++) {
      journal.record('deployed', {
        fromPort: 4000,
        toPort: 4001,
        generation: 2,
      });
    }
    journal.update({ ...initial, generation: 2, port: 4001 });
    assert.equal(
      readDeploymentHistory(dir, 'history.localhost').history.length,
      50
    );
    assert.equal(
      readDeploymentHistory(dir, 'history.localhost').status.port,
      4001
    );
    /** Actual verified synthetic control directory name discovered only inside the fixture namespace. */
    const directory = fs
      .readdirSync(dir)
      .find((f) => f.startsWith('app-controls'));
    /** Fixed synthetic diagnostic history filename inside that private directory. */
    const file = fs
      .readdirSync(path.join(dir, directory))
      .find((f) => f.endsWith('.history.json'));
    /** Owned fixture file replaced with a malicious symlink to prove no overwrite. */
    const target = path.join(dir, directory, file);
    fs.unlinkSync(target);
    fs.symlinkSync('/etc/passwd', target);
    assert.throws(
      () => readDeploymentHistory(dir, 'history.localhost'),
      /Unsafe/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'separate proxy and rolling wrapper coordinate deploy, drain in-flight traffic, history and shutdown',
  { timeout: 60000 },
  async () => {
    /** Owned private synthetic namespace removed in finally after child/endpoint cleanup. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-cli-rolling-'));
    /** Observed private ephemeral proxy candidate. */
    const p = await freePort();
    /** Observed first private backend candidate. */
    const a = await freePort();
    /** Observed replacement private backend candidate. */
    const b = await freePort();
    /** Fixed built package-local operator CLI entry. */
    const bin = new URL('../dist/bin/zerux.js', import.meta.url).pathname;
    /** Explicit private proxy namespace/ephemeral port environment overrides. */
    const env = {
      ...process.env,
      PORTLESS_PORT: String(p),
      PORTLESS_STATE_DIR: dir,
    };
    /** Owned fixture proxy subprocess, terminated in outer finally. */
    const proxy = runner([bin, 'proxy', 'start', '--port', String(p)], env);
    let wrapper;
    try {
      await poll(async () => {
        try {
          /** Actual synthetic HTTP response while polling native readiness. */
          const r = await get(p, 'hello.localhost');
          return r.status === 404;
        } catch {
          return false;
        }
      });
      wrapper = runner(
        [
          bin,
          'rolling',
          'run',
          '--name',
          'hello',
          '--ports',
          `${a},${b}`,
          '--health-path',
          '/health',
          '--drain-timeout',
          '2500',
          '--',
          'node',
          '-e',
          appCode,
        ],
        env
      );
      await poll(async () => {
        try {
          /** Actual synthetic HTTP response while polling native readiness. */
          const r = await get(p, 'hello.localhost');
          return r.body === String(a);
        } catch {
          return false;
        }
      });
      /** Actual slow synthetic request retaining the old backend through cutover. */
      const held = get(p, 'hello.localhost', '/slow');
      await delay(75);
      /** Actual authenticated fixture deployment receipt. */
      const deployment = await cli(bin, env, ['rolling', 'deploy', 'hello']);
      assert.equal(deployment.code, 0, deployment.output + ' ' + wrapper.logs);
      /** Actual held response proving in-flight traffic stayed on the previous generation. */
      const first = await held;
      assert.equal(first.body, String(a));
      /** Actual post-cutover response proving new requests reached the new generation. */
      const newer = await get(p, 'hello.localhost');
      assert.equal(newer.body, String(b));
      /** Actual private fixture CLI status output. */
      const status = await cli(bin, env, [
        'rolling',
        'status',
        'hello',
        '--json',
      ]);
      assert.equal(status.code, 0, status.output);
      /** Decoded synthetic controller status checked for new generation and verified online state. */
      const parsed = JSON.parse(status.output);
      assert.equal(parsed.status.generation, 2);
      assert.equal(parsed.online, true);
      /** Actual private bounded lifecycle history output. */
      const history = await cli(bin, env, [
        'rolling',
        'history',
        'hello',
        '--json',
      ]);
      assert.equal(history.code, 0, history.output);
      assert.equal(JSON.parse(history.output).at(-1).outcome, 'deployed');
      assert.equal(JSON.parse(history.output).at(-1).drained, true);
      /** Actual authenticated stop receipt for only the owned fixture controller. */
      const stopped = await cli(bin, env, ['rolling', 'stop', 'hello']);
      assert.equal(stopped.code, 0, stopped.output + ' ' + wrapper.logs);
      await poll(async () => {
        /** Actual synthetic HTTP response while polling native readiness. */
        const r = await get(p, 'hello.localhost');
        return r.status === 404;
      });
      /** Actual private status after owned stop proving explicit offline coverage. */
      const after = await cli(bin, env, [
        'rolling',
        'status',
        'hello',
        '--json',
      ]);
      assert.equal(JSON.parse(after.output).online, false);
    } finally {
      if (wrapper) {
        await wrapper.end();
      }
      await proxy.end();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
