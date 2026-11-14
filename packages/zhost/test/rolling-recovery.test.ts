import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createGenerationRegistry,
  readGenerationRecord,
  generationRecordPath,
  recoverRollingGenerationsLocked,
} from '../dist/portless/generation-registry.js';
import {
  createDeploymentHistory,
  readDeploymentHistory,
  pruneDeploymentHistory,
} from '../dist/portless/deployment-history.js';
import { RouteStore } from '../dist/portless/routes.js';
import { processIdentity } from '../dist/portless/lifecycle.js';
import { launchSupervisedCommand } from '../dist/portless/process-supervisor.js';
/** Yield between finite fixture observations.
 * @param {number} ms Bounded synthetic wait milliseconds.
 * @returns {Promise<void>} Owned one-shot timer settlement. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/** Create a private synthetic recovery namespace; callers always remove it in finally.
 * @returns {string} Owned temporary directory. */
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-recovery-'));
/** Probe existence of only an owned fixture PID without sending a termination signal.
 * @param {number} pid Known owned synthetic child PID.
 * @returns {boolean} Native signal-zero existence observation, not process ownership proof. */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** Observe only an owned synthetic process condition until a finite deadline.
 * @param {() => unknown} check - Trusted local fixture predicate.
 * @param {number} timeout - Finite fixture timeout, default five seconds.
 * @returns {Promise<void>} Successful observation or explicit fixture timeout.
 */
async function waitFor(check, timeout = 5000) {
  /** Finite local owned-process observation cutoff. */
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await delay(25);
  }
  throw Error('Timed out waiting for process');
}

// The detached child and its tracking state are deliberately owned by a process
// that will be SIGKILLed, simulating a hard crash rather than normal shutdown.
/** Own a synthetic controller and detached child with private journal state so killing this controller reproduces a hard crash safely.
 * @param {string} state - Owned private temporary namespace.
 * @param {string} name - Fixed synthetic route label.
 * @param {number} port - Synthetic recorded backend port; this idle child does not bind it.
 * @returns {Promise<object>} Owned controller/child identity and explicit crash action; finally signals only these fixture handles.
 */
async function crashFixture(state, name, port = 4300) {
  /** Fixed built journal-module file URL imported only by trusted fixture source. */
  const moduleURL = new URL(
    '../dist/portless/generation-registry.js',
    import.meta.url
  ).href;
  /** Fixed trusted synthetic controller program; interpolated paths/names come only from the private fixture. */
  const workerCode = `import {spawn} from 'node:child_process';
 import {createGenerationRegistry} from ${JSON.stringify(moduleURL)};
 const reg=createGenerationRegistry(${JSON.stringify(state)},${JSON.stringify(name)});
 const child=spawn(process.execPath,['-e', 'setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 reg.track(child.pid, ${port});
 console.log(child.pid);
 setInterval(()=>{},1000);`;
  /** Owned synthetic controller subprocess, never an operator application. */
  const owner = spawn(
    process.execPath,
    ['--input-type=module', '-e', workerCode],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  owner.stdout.on('data', (b) => (output += b.toString()));
  await waitFor(
    () => Number.isInteger(Number(output.trim())) && Number(output.trim()) > 1
  );
  return {
    owner,
    pid: Number(output.trim()),
    /** Kill only the owned synthetic controller and await its native exit.
     * @returns {Promise<void>} Actual controller exit receipt; detached child remains for explicit recovery testing.
     */ /** Kill only the owned synthetic controller and await its native exit.
     * @returns {Promise<void>} Actual controller exit receipt; detached child remains for explicit recovery testing.
     */
    async crash() {
      owner.kill('SIGKILL');
      await new Promise((r) => owner.once('exit', r));
    },
  };
}

test(
  'crashed controller can recover identified detached child without leaving a route',
  { timeout: 20000 },
  async () => {
    /** Owned private synthetic recovery directory removed in finally. */
    const state = dir();
    let fixture;
    try {
      fixture = await crashFixture(state, 'orphan.localhost');
      /** Validated private fixture journal checked against known owned controller/child handles. */
      const record = readGenerationRecord(state, 'orphan.localhost');
      assert.equal(record.children[0].pid, fixture.pid);
      assert.equal(record.owner.pid, fixture.owner.pid);
      await fixture.crash();
      /** Explicit read-only recovery receipt; the child/journal must remain intact. */
      const preview = await recoverRollingGenerationsLocked(
        state,
        'orphan.localhost',
        { dryRun: true }
      );
      assert.equal(preview.dryRun, true);
      assert.deepEqual(preview.wouldTerminate, [fixture.pid]);
      assert.ok(readGenerationRecord(state, 'orphan.localhost'));
      /** Actual trusted recovery/retention receipt checked against the known synthetic state. */
      const result = await recoverRollingGenerationsLocked(
        state,
        'orphan.localhost',
        { waitMs: 2500 }
      );
      assert.equal(result.recovered, true);
      assert.deepEqual(result.terminated, [fixture.pid]);
      assert.equal(readGenerationRecord(state, 'orphan.localhost'), null);
      assert.equal(
        (await recoverRollingGenerationsLocked(state, 'orphan.localhost'))
          .recovered,
        false
      );
    } finally {
      fixture?.owner.kill('SIGKILL');
      if (fixture?.pid && alive(fixture.pid)) {
        try {
          process.kill(-fixture.pid, 'SIGKILL');
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
      fs.rmSync(state, { recursive: true, force: true });
    }
  }
);

test('recovery refuses live controllers and refuses unverifiable files', async () => {
  /** Owned private synthetic recovery directory removed in finally. */
  const state = dir();
  try {
    /** Owned private recovery journal whose close must preserve live-child evidence. */
    const tracker = createGenerationRegistry(state, 'live.localhost');
    await assert.rejects(
      recoverRollingGenerationsLocked(state, 'live.localhost'),
      /still running/
    );
    assert.equal(tracker.close(), true);
    /** Fixed hashed fixture journal path used for malformed/unsafe/reused-identity checks. */
    const file = generationRecordPath(state, 'live.localhost');
    fs.symlinkSync('/etc/passwd', file);
    assert.throws(
      () => readGenerationRecord(state, 'live.localhost'),
      /Unsafe/
    );
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test(
  'unidentifiable PID is never signalled; reused PID fingerprint is ignored',
  { timeout: 20000 },
  async () => {
    /** Owned private synthetic recovery directory removed in finally. */
    const state = dir();
    let fixture;
    try {
      fixture = await crashFixture(state, 'reused.localhost');
      await fixture.crash();
      /** Fixed hashed fixture journal path used for malformed/unsafe/reused-identity checks. */
      const file = generationRecordPath(state, 'reused.localhost');
      /** Detached fixture journal intentionally assigned a mismatching fingerprint for a denial test. */
      const doc = readGenerationRecord(state, 'reused.localhost');
      doc.children[0].identity = 'linux:0';
      fs.writeFileSync(file, JSON.stringify(doc), { mode: 0o600 });
      /** Actual trusted recovery/retention receipt checked against the known synthetic state. */
      const result = await recoverRollingGenerationsLocked(
        state,
        'reused.localhost'
      );
      assert.deepEqual(result.alreadyExited, [fixture.pid]);
      assert.ok(alive(fixture.pid));
    } finally {
      if (fixture?.pid && alive(fixture.pid)) {
        try {
          process.kill(-fixture.pid, 'SIGKILL');
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
      fs.rmSync(state, { recursive: true, force: true });
    }
  }
);

test(
  'supervisor aborts startup and reaps child when the persistence hook fails',
  { timeout: 10000 },
  async () => {
    let pid;
    await assert.rejects(
      launchSupervisedCommand(
        [process.execPath, '-e', 'setInterval(()=>{},1000)'],
        {
          stdio: 'ignore',
          shutdownTimeoutMs: 1000,
          onSpawn(child) {
            pid = child.pid;
            throw Error('persistence unavailable');
          },
        }
      ),
      /persistence unavailable/
    );
    assert.ok(pid);
    await delay(50);
    // PID can remain a zombie momentarily; its identity must no longer be running.
    assert.equal(processIdentity(pid), null);
  }
);

test('history compaction prunes old entries, bounds count and retains latest status', () => {
  /** Owned private synthetic recovery directory removed in finally. */
  const state = dir();
  try {
    /** Synthetic rolling observation used only for private diagnostic history. */
    const status = {
      phase: 'running',
      generation: 1,
      port: 4300,
      pid: process.pid,
      previousPort: null,
      updatedAt: new Date().toISOString(),
    };
    /** Single-writer private history fixture with explicit retention settings. */
    const book = createDeploymentHistory(state, 'retention.localhost', status, {
      days: 365,
      maxEvents: 50,
    });
    for (let i = 0; i < 5; i++) {
      book.record('deployed', { fromPort: 4300, toPort: 4301 });
    }
    /** Validated prior diagnostic envelope used to compare compaction counts. */
    const before = readDeploymentHistory(state, 'retention.localhost');
    assert.equal(before.history.length, 5);
    /** Actual trusted recovery/retention receipt checked against the known synthetic state. */
    const result = pruneDeploymentHistory(state, 'retention.localhost', {
      days: 30,
      maxEvents: 2,
    });
    assert.deepEqual(result, {
      hostname: 'retention.localhost',
      removed: 3,
      remaining: 2,
    });
    assert.equal(
      readDeploymentHistory(state, 'retention.localhost').status.port,
      4300
    );
    assert.equal(
      pruneDeploymentHistory(state, 'retention.localhost', {
        days: 0,
        maxEvents: 0,
      }).remaining,
      0
    );
    assert.throws(
      () => pruneDeploymentHistory(state, 'retention.localhost', { days: -1 }),
      /retention/
    );
    assert.throws(
      () =>
        pruneDeploymentHistory(state, 'retention.localhost', { maxEvents: 51 }),
      /retention/
    );
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test(
  'recovery cannot delete a route registered by a newer owner',
  { timeout: 20000 },
  async () => {
    /** Owned private synthetic recovery directory removed in finally. */
    const state = dir();
    let fixture;
    try {
      fixture = await crashFixture(state, 'replace.localhost');
      /** Owned old route lease journaled before crashing this fixture controller. */
      const prior = new RouteStore(state).registerRoute(
        'replace.localhost',
        4300,
        fixture.owner.pid
      );
      /** Validated private fixture journal checked against known owned controller/child handles. */
      const record = readGenerationRecord(state, 'replace.localhost');
      record.leaseId = prior.leaseId;
      fs.writeFileSync(
        generationRecordPath(state, 'replace.localhost'),
        JSON.stringify(record),
        { mode: 0o600 }
      );
      await fixture.crash();
      /** Owned later route lease that recovery must not withdraw. */
      const newer = new RouteStore(state).registerRoute(
        'replace.localhost',
        4500,
        process.pid,
        true
      );
      /** Actual recovery receipt proving the newer lease remains untouched. */
      const report = await recoverRollingGenerationsLocked(
        state,
        'replace.localhost',
        { waitMs: 1500 }
      );
      assert.equal(report.recovered, true);
      assert.equal(report.routeRemoved, false);
      assert.equal(new RouteStore(state).loadRoutes()[0].port, 4500);
      newer.release();
    } finally {
      if (fixture?.pid && alive(fixture.pid)) {
        try {
          process.kill(-fixture.pid, 'SIGKILL');
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
      fs.rmSync(state, { recursive: true, force: true });
    }
  }
);

test('untracked child cannot be hidden by a premature registry close', async () => {
  /** Owned private synthetic recovery directory removed in finally. */
  const state = dir();
  let child;
  try {
    /** Owned private recovery journal whose close must preserve live-child evidence. */
    const tracker = createGenerationRegistry(state, 'close.localhost');
    child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      detached: true,
      stdio: 'ignore',
    });
    await waitFor(() => processIdentity(child.pid) !== null);
    tracker.track(child.pid, 4300);
    assert.throws(() => tracker.close(), /tracked children/);
    assert.ok(readGenerationRecord(state, 'close.localhost'));
    child.kill('SIGTERM');
    await new Promise((r) => child.once('close', r));
    tracker.untrack(child.pid);
    assert.equal(tracker.close(), true);
  } finally {
    if (child?.pid && alive(child.pid)) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* This optional failure is intentionally ignored. */
      }
    }
    fs.rmSync(state, { recursive: true, force: true });
  }
});
