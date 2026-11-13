import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { findPidOnPort } from '../dist/portless/cli-utils.js';

/**
 * Replace native lookup boundaries without executing any process or shell.
 *
 * @param {import('node:test').TestContext} t - Test-owned mock lifetime.
 * @param {(command: string) => string} reply - Fixed native output or failure fixture.
 * @returns {object} Captured fixed native calls and shell-attempt count.
 */
function lookupFixture(t, reply) {
  /** Only fixed diagnostic arguments/timeout enter this fixture observation. */
  const calls = [];
  let shellCalls = 0;
  t.mock.method(childProcess, 'execSync', () => {
    shellCalls++;
    throw new Error('Unexpected shell lookup');
  });
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    calls.push({ command, args: [...args], timeout: options.timeout });
    return reply(command);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    calls,
    get shellCalls() {
      return shellCalls;
    },
  };
}

test('PID lookup validates runtime ports and executes fixed native argument arrays', (t) => {
  /** Native output is synthetic; no broker, app, OS listing or shell is invoked. */
  const fixture = lookupFixture(t, (command) =>
    command === 'netstat'
      ? 'TCP 0.0.0.0:4000 0.0.0.0:0 LISTENING 4242\n'
      : '4242\n'
  );
  assert.equal(findPidOnPort(4000), 4242);
  assert.deepEqual(fixture.calls, [
    process.platform === 'win32'
      ? { command: 'netstat', args: ['-ano', '-p', 'tcp'], timeout: 5000 }
      : {
          command: 'lsof',
          args: ['-ti', 'tcp:4000', '-sTCP:LISTEN'],
          timeout: 5000,
        },
  ]);
  for (const invalid of [
    0,
    -1,
    65536,
    1.5,
    NaN,
    Infinity,
    '4000; injected',
    null,
    undefined,
    Object(4000),
  ]) {
    assert.equal(findPidOnPort(invalid), null);
  }
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.shellCalls, 0);
});

test('unavailable native PID lookup retains the nonthrowing null contract', (t) => {
  /** Simulated native failure contains no actual path, credentials or process data. */
  const fixture = lookupFixture(t, () => {
    throw new Error('Synthetic native lookup failure');
  });
  assert.equal(findPidOnPort(4000), null);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.shellCalls, 0);
});
