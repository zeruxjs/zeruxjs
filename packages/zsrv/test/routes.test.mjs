import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RouteStore, RouteConflictError } from '../dist/portless/routes.js';

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-route-test-'));
  try { return run(new RouteStore(dir), dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('route registry persists valid registrations and replaces routes atomically', () => fixture((store, dir) => {
  store.addRoute('app.localhost', 4312, process.pid);
  assert.equal(store.loadRoutes()[0].port, 4312);
  store.addRoute('app.localhost', 4313, process.pid);
  assert.deepEqual(store.loadRoutes(), [{ hostname: 'app.localhost', port: 4313, pid: process.pid }]);
  assert.equal(fs.readdirSync(dir).some(file => file.endsWith('.tmp')), false);
  store.removeRoute('app.localhost');
  assert.deepEqual(store.loadRoutes(), []);
}));

test('invalid route data cannot be registered or loaded', () => fixture((store, dir) => {
  for (const hostname of ['evil.localhost:9999', 'user@localhost', '../outside', 'APP.localhost', '']) {
    assert.throws(() => store.addRoute(hostname, 4000, process.pid));
  }
  for (const port of [0, 65536, Infinity, NaN, 3.5]) assert.throws(() => store.addRoute('app.localhost', port, process.pid));
  for (const pid of [-1, NaN, 1.3]) assert.throws(() => store.addRoute('app.localhost', 4000, pid));
  assert.equal(fs.existsSync(path.join(dir, 'routes.json')), false);
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify([
    { hostname: 'good.localhost', port: 4010, pid: 0 },
    { hostname: 'bad.localhost:1234', port: 4010, pid: 0 },
    { hostname: 'other.localhost', port: 0, pid: 0 },
    { hostname: 'third.localhost', port: 4010, pid: -1 }
  ]));
  assert.deepEqual(store.loadRoutes(), [{ hostname: 'good.localhost', port: 4010, pid: 0 }]);
}));

test('route collision checks and stale route removal', () => fixture((store, dir) => {
  store.addRoute('app.localhost', 4000, process.pid);
  assert.throws(() => store.addRoute('app.localhost', 4001, 0), RouteConflictError);
  store.addRoute('app.localhost', 4001, 0, true);
  assert.equal(store.loadRoutes()[0].port, 4001);
  fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify([{hostname:'old.localhost',port:4444,pid:2147483647}]));
  assert.deepEqual(store.loadRoutes(), []);
  store.addRoute('new.localhost', 4321, process.pid);
  assert.deepEqual(store.loadRoutes().map(x => x.hostname), ['new.localhost']);
}));
