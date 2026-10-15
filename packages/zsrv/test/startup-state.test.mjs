import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { publishStartupState, assertStartupOwnership } from '../dist/portless/startup-state.js';
import { createProcessMarker } from '../dist/portless/lifecycle.js';

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-startup-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const config = stateDir => ({ stateDir, port: 1355, https: true, tld: 'localhost' });
test('publishes the PID last and supports safe rollback', () => withDir(dir => {
  const publication = publishStartupState(config(dir));
  assert.equal(fs.readFileSync(path.join(dir, 'proxy.port'), 'utf8').trim(), '1355');
  assert.equal(fs.readFileSync(path.join(dir, 'proxy.tls'), 'utf8').trim(), '1');
  assert.equal(fs.existsSync(path.join(dir, 'proxy.tld')), false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'proxy.pid'), 'utf8')).identity);
  publication.rollback();
  assert.deepEqual(fs.readdirSync(dir), []);
}));
test('refuses to overwrite a live owner or unverifiable marker', () => withDir(dir => {
  fs.writeFileSync(path.join(dir, 'proxy.pid'), JSON.stringify(createProcessMarker()));
  assert.throws(() => assertStartupOwnership(dir), /live process/);
  assert.throws(() => publishStartupState(config(dir)), /live process/);
  fs.writeFileSync(path.join(dir, 'proxy.pid'), '1234');
  assert.throws(() => publishStartupState(config(dir)), /Unverifiable/);
}));
test('failure mid-publication restores earlier values', () => withDir(dir => {
  fs.writeFileSync(path.join(dir, 'proxy.port'), '8000\n');
  fs.mkdirSync(path.join(dir, 'proxy.tls'));
  assert.throws(() => publishStartupState(config(dir)), /Unsafe proxy state file/);
  assert.equal(fs.readFileSync(path.join(dir, 'proxy.port'), 'utf8'), '8000\n');
  assert.equal(fs.existsSync(path.join(dir, 'proxy.pid')), false);
}));
test('recovers stale PID markers', () => withDir(dir => {
  fs.writeFileSync(path.join(dir, 'proxy.pid'), JSON.stringify({ ...createProcessMarker(), pid: 2147483646 }));
  const publication = publishStartupState(config(dir));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'proxy.pid'), 'utf8')).pid, process.pid);
  publication.rollback();
}));
