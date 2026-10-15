import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRunArguments } from '../dist/bin/parse-run.js';

test('preserves all command args, even flags and their values', () => {
  const parsed = parseRunArguments(['--name', 'web', '--app-port', '4545', '--force', '--', 'npm', 'run', 'dev', '--', '--host', '0.0.0.0']);
  assert.equal(parsed.name, 'web');
  assert.equal(parsed.appPort, 4545);
  assert.equal(parsed.force, true);
  assert.deepEqual(parsed.command, ['npm', 'run', 'dev', '--', '--host', '0.0.0.0']);
});

test('does not interpret app arguments as supervision options', () => {
  assert.deepEqual(parseRunArguments(['vite', '--port', '2222', '--name', 'app']).command,
    ['vite', '--port', '2222', '--name', 'app']);
  assert.equal(parseRunArguments(['--no-ready', 'node', 'server.js']).waitForReady, false);
});

test('rejects missing commands, unknown flags, duplicates, malformed ports and timeouts', () => {
  for (const args of [[], ['--force'], ['--unknown', 'vite'], ['--force', '--force', 'vite'],
    ['--app-port', '4x', 'vite'], ['--app-port', '65536', 'vite'], ['--ready-timeout', '0', 'vite'],
    ['--name', '../bad', 'vite'], ['--name', 'vite']]) {
    assert.throws(() => parseRunArguments(args));
  }
});

test('accepts restart and HTTP health options without swallowing application args', () => {
  const args = parseRunArguments(['--name','web','--health-path','/health','--health-interval','500',
    '--health-failures','2','--restart','on-failure','--max-restarts','4','--restart-delay','150',
    '--restart-window','60000','--', 'node','index.js','--restart','always']);
  assert.equal(args.healthPath,'/health');
  assert.equal(args.healthIntervalMs,500);
  assert.equal(args.unhealthyThreshold,2);
  assert.equal(args.restartPolicy,'on-failure');
  assert.equal(args.maxRestarts,4);
  assert.deepEqual(args.command,['node','index.js','--restart','always']);
});
test('rejects unsafe health paths and incompatible no-ready health configuration', () => {
  assert.throws(()=>parseRunArguments(['--health-path','//example.org','--','node','a.js']),/health path/);
  assert.throws(()=>parseRunArguments(['--health-path','/health','--no-ready','--','node','a.js']),/no-ready/);
  assert.throws(()=>parseRunArguments(['--restart','forever','--','node','a.js']),/policy/);
});

test('accepts opt-in reload signal and preserves child arguments', () => {
  const args=parseRunArguments(['--reload-signal','--name','api','--','node','server.mjs','--foo']);
  assert.equal(args.reloadSignal,true);
  assert.deepEqual(args.command,['node','server.mjs','--foo']);
  assert.throws(()=>parseRunArguments(['--reload-signal','--reload-signal','node']),/Repeated/);
});
