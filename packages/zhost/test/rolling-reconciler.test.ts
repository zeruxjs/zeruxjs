import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createGenerationRegistry,
  generationRecordPath,
  readGenerationRecord,
} from '../dist/portless/generation-registry.js';
import {
  inspectRollingControllers,
  reconcileRollingControllers,
} from '../dist/portless/rolling-reconciler.js';

/** Create a private synthetic recovery namespace; callers always remove it in finally.
 * @returns {string} Owned temporary directory. */
const fixture = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-reconcile-'));
/** Yield between finite fixture observations.
 * @param {number} ms Bounded synthetic wait milliseconds.
 * @returns {Promise<void>} Owned one-shot timer settlement. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Wait for a synthetic fixture child/journal observation under a finite deadline.
 * @param {() => unknown | Promise<unknown>} fn - Trusted local predicate over owned fixture state.
 * @param {number} timeout - Finite observation milliseconds, default four seconds.
 * @returns {Promise<void>} Predicate success or explicit timeout.
 */
async function waitUntil(fn, timeout = 4000) {
  /** Finite local fixture observation cutoff. */
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    if (await fn()) {
      return;
    }
    await delay(30);
  }
  throw new Error('Timed out');
}

// Force a supervisor crash while preserving its recorded child.
/** Create and crash only an owned synthetic controller, retaining its explicitly journaled detached child for recovery assertions.
 * @param {string} state - Owned private fixture state directory.
 * @param {string} name - Fixed synthetic route namespace.
 * @returns {Promise<{pid: number, owner: import("node:child_process").ChildProcess}>} Owned orphan/controller handles; finally kills only this recorded synthetic group.
 */
async function spawnOrphan(state, name) {
  /** Fixed trusted built journal module imported by only this fixture child. */
  const moduleURL = new URL(
    '../dist/portless/generation-registry.js',
    import.meta.url
  ).href;
  /** Fixed trusted synthetic orphan-controller source with JSON-quoted fixture paths. */
  const code = `import {spawn} from 'node:child_process';\nimport {createGenerationRegistry} from ${JSON.stringify(moduleURL)};\nconst reg=createGenerationRegistry(${JSON.stringify(state)},${JSON.stringify(name)});\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});\nreg.track(child.pid,4400);\nconsole.log(child.pid);\nsetInterval(()=>{},1000);`;
  /** Owned synthetic controller subprocess terminated only by the fixture. */
  const owner = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  owner.stdout.on('data', (value) => (stdout += value.toString()));
  await waitUntil(() => Number(stdout.trim()) > 1);
  /** Actual owned detached child PID read from the fixed controller output. */
  const pid = Number(stdout.trim());
  owner.kill('SIGKILL');
  await new Promise((resolve) => owner.once('exit', resolve));
  return { pid, owner };
}

test('bulk reconciliation reports live controllers, refuses overwrite of unverified records', async () => {
  /** Owned private synthetic reconciliation namespace. */
  const state = fixture();
  try {
    /** Owned private live-controller journal proving recovery will not steal ownership. */
    const registry = createGenerationRegistry(state, 'active.localhost');
    assert.deepEqual(
      inspectRollingControllers(state).map((x) => [x.hostname, x.state]),
      [['active.localhost', 'live']]
    );
    /** Actual bounded reconciliation receipt preserving live/failed/recovered states. */
    const report = await reconcileRollingControllers(state);
    assert.deepEqual(
      [report.scanned, report.recovered, report.failed],
      [1, 0, 0]
    );
    assert.ok(readGenerationRecord(state, 'active.localhost'));
    registry.close();
    /** Fixed hashed private fixture path used for the unsafe-symlink record test. */
    const invalid = generationRecordPath(state, 'broken.localhost');
    fs.symlinkSync('/etc/passwd', invalid);
    /** Explicit read-only inspection/recovery receipt retaining orphan state. */
    const preview = inspectRollingControllers(state);
    assert.equal(preview[0].state, 'invalid');
    assert.equal((await reconcileRollingControllers(state)).failed, 1);
    assert.throws(() => inspectRollingControllers(state, 0), /maxRecords/);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test(
  'reconcile dry-run does not terminate orphans; real reconciliation cleans verified child',
  { timeout: 16000 },
  async () => {
    /** Owned private synthetic reconciliation namespace. */
    const state = fixture();
    let fixtureProcess;
    try {
      fixtureProcess = await spawnOrphan(state, 'crashed.localhost');
      /** Explicit read-only inspection/recovery receipt retaining orphan state. */
      const preview = await reconcileRollingControllers(state, {
        dryRun: true,
      });
      assert.equal(preview.recovered, 0);
      assert.equal(preview.items[0].state, 'recoverable');
      assert.deepEqual(preview.items[0].recovery.wouldTerminate, [
        fixtureProcess.pid,
      ]);
      /** Actual trusted synthetic recovery receipt checked for child termination and journal removal. */
      const live = await reconcileRollingControllers(state, { waitMs: 2500 });
      assert.equal(live.recovered, 1);
      assert.deepEqual(live.items[0].recovery.terminated, [fixtureProcess.pid]);
      assert.equal(inspectRollingControllers(state).length, 0);
    } finally {
      if (fixtureProcess) {
        try {
          process.kill(-fixtureProcess.pid, 'SIGKILL');
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
      fs.rmSync(state, { recursive: true, force: true });
    }
  }
);
