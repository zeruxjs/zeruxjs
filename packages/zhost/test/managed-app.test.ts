import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchManagedApplication,
  validateManagedOptions,
} from '../dist/portless/managed-app.js';
import {
  probeApplicationHealth,
  validateHealthCheck,
} from '../dist/portless/health.js';

/** Allocate then close an owned ephemeral loopback listener for a synthetic child.
 * @returns {Promise<number>} Previously free fixture port; no operator port is selected or reserved.
 */
async function freePort() {
  /** Owned ephemeral loopback probe fixture, closed in finally or before returning its allocated port. */
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  /** Operating-system-assigned fixture port, independent of user-managed apps. */
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
/** Fixed trusted synthetic child program; never derived from request data and preserved byte-for-byte. */
const app = `const fs=require('node:fs'); const http=require('node:http');
let tries=0;try{tries=Number(fs.readFileSync(process.env.COUNT_FILE,'utf8'))}catch{};
fs.writeFileSync(process.env.COUNT_FILE,String(++tries));
const launched=Date.now(); const server=http.createServer((req,res)=>{res.statusCode=(process.env.BAD_HEALTH==='1'&&req.url==='/health'&&Date.now()-launched>300)?503:200;res.end('ok')});
server.listen(Number(process.env.PORT),'127.0.0.1',()=>{
if(tries<=Number(process.env.FAIL_UNTIL||0))setTimeout(()=>process.exit(7),180);
});
process.on('SIGTERM',()=>server.close()); process.on('SIGINT',()=>server.close());`;

/** Own a private temporary directory used only by synthetic child attempt counters.
 * @returns {{dir: string; countFile: string; dispose: () => void}} Fixture paths and explicit cleanup, invoked after child settlement.
 */
function harness() {
  /** Owned private temporary directory for synthetic restart-count state. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-managed-'));
  return {
    dir,
    countFile: path.join(dir, 'count.txt'),
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
test('health probes validate input and require healthy local HTTP response', async () => {
  /** Owned ephemeral loopback probe fixture, closed in finally or before returning its allocated port. */
  const server = createHttpServer((req, res) => {
    res.statusCode = req.url === '/health' ? 204 : 503;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  /** Operating-system-assigned fixture port, independent of user-managed apps. */
  const port = server.address().port;
  try {
    assert.equal(await probeApplicationHealth(port), true);
    assert.equal(await probeApplicationHealth(port, { path: '/health' }), true);
    assert.equal(
      await probeApplicationHealth(port, { path: '/unhealthy' }),
      false
    );
    assert.throws(() => validateHealthCheck({ path: '//evil.test/' }), /path/);
    assert.throws(
      () => validateHealthCheck({ path: '/hello\nInjected' }),
      /path/
    );
    assert.throws(() => validateHealthCheck({ timeoutMs: 0 }), /timeout/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test(
  'managed app restarts after crash, publishes only ready children, then cleans up',
  { timeout: 12000 },
  async () => {
    /** Owned attempt-counter fixture, disposed only after its child completes/stops. */
    const h = harness();
    let appHandle;
    let published = 0,
      released = 0,
      finals = 0;
    /** Operating-system-assigned fixture port, independent of user-managed apps. */
    const port = await freePort();
    try {
      appHandle = await launchManagedApplication(
        [process.execPath, '-e', app],
        {
          port,
          health: { path: '/health', timeoutMs: 500 },
          env: { COUNT_FILE: h.countFile, PORT: String(port), FAIL_UNTIL: '1' },
          stdio: 'ignore',
          restartPolicy: 'on-failure',
          maxRestarts: 2,
          restartDelayMs: 100,
          onReady: () => {
            published++;
            return () => {
              released++;
            };
          },
          onExit: () => finals++,
        }
      );
      /** Bounded observation deadline for the synthetic automatic replacement. */
      const until = Date.now() + 5000;
      while (published < 2 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(published, 2);
      assert.equal(released, 1);
      assert.equal(appHandle.running, true);
      assert.equal(
        await probeApplicationHealth(port, { path: '/health' }),
        true
      );
      /** Observed native terminal result after explicit manager stop. */
      const finished = await appHandle.stop();
      assert.equal(finished.code, 0);
      assert.equal(released, 2);
      assert.equal(finals, 1);
      assert.equal(appHandle.running, false);
      assert.equal(Number(fs.readFileSync(h.countFile, 'utf8')), 2);
    } finally {
      if (appHandle?.running) {
        await appHandle.stop();
      }
      h.dispose();
    }
  }
);
test(
  'restart limit prevents infinite crash loops and releases every published route',
  { timeout: 12000 },
  async () => {
    /** Owned attempt-counter fixture, disposed only after its child completes/stops. */
    const h = harness();
    /** Operating-system-assigned fixture port, independent of user-managed apps. */
    const port = await freePort();
    let published = 0,
      released = 0;
    try {
      /** Owned manager whose completion is awaited before deleting its synthetic state. */
      const handle = await launchManagedApplication(
        [process.execPath, '-e', app],
        {
          port,
          env: {
            COUNT_FILE: h.countFile,
            PORT: String(port),
            FAIL_UNTIL: '100',
          },
          stdio: 'ignore',
          restartPolicy: 'on-failure',
          maxRestarts: 1,
          restartDelayMs: 100,
          onReady: () => {
            published++;
            return () => released++;
          },
        }
      );
      /** Observed final child outcome under the tested restart or health policy. */
      const result = await handle.completed;
      assert.match(result.error?.message ?? '', /budget exhausted/);
      assert.equal(published, 2);
      assert.equal(released, 2);
      assert.equal(handle.running, false);
    } finally {
      h.dispose();
    }
  }
);
test(
  'health monitor stops unhealthy application and marks failure',
  { timeout: 12000 },
  async () => {
    /** Owned attempt-counter fixture, disposed only after its child completes/stops. */
    const h = harness();
    /** Operating-system-assigned fixture port, independent of user-managed apps. */
    const port = await freePort();
    try {
      /** Owned manager whose completion is awaited before deleting its synthetic state. */
      const handle = await launchManagedApplication(
        [process.execPath, '-e', app],
        {
          port,
          env: { COUNT_FILE: h.countFile, PORT: String(port), BAD_HEALTH: '1' },
          stdio: 'ignore',
          health: { path: '/health' },
          healthIntervalMs: 100,
          unhealthyThreshold: 2,
          restartPolicy: 'never',
          shutdownTimeoutMs: 1000,
        }
      );
      /** Observed final child outcome under the tested restart or health policy. */
      const result = await handle.completed;
      assert.match(result.error?.message ?? '', /health checks/);
      assert.equal(handle.running, false);
    } finally {
      h.dispose();
    }
  }
);
test('refuses invalid restart configuration before launching', () => {
  assert.throws(
    () => validateManagedOptions({ restartPolicy: 'infinite' }),
    /policy/
  );
  assert.throws(
    () => validateManagedOptions({ maxRestarts: 101 }),
    /maxRestarts/
  );
  assert.throws(
    () => validateManagedOptions({ healthIntervalMs: 100, port: undefined }),
    /port/
  );
});
