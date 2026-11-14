import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetFixture } from './helpers/fleet-fixture.ts';

test('scale up and down switches route atomically, retains a spare and drains old work', async () =>
  fleetFixture(async ({ fleet, store, proxy, ports }) => {
    assert.equal(fleet.status.desiredReplicas, 2);
    /** Actual immutable scale-up receipt checked against desired and routed capacity. */
    const snapshot = await fleet.scaleTo(3);
    assert.equal(snapshot.desiredReplicas, 3);
    assert.equal(fleet.status.members.filter((m) => m.routed).length, 3);
    assert.deepEqual(
      store.loadRoutes()[0].backends.map((b) => b.port),
      ports.slice(0, 3)
    );
    /** Owned accepted-session lease remover proving scale-down waits for old traffic. */
    const finished = proxy.backendConnections.track(
      'scale.localhost',
      ports[2]
    );
    /** Actual scale-down promise retained until the fixture releases its tracked connection. */
    const downsizing = fleet.scaleTo(2);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(
      store.loadRoutes()[0].backends.map((b) => b.port),
      ports.slice(0, 2)
    );
    finished();
    await downsizing;
    assert.equal(fleet.status.members.filter((m) => m.routed).length, 2);
    assert.equal(fleet.status.phase, 'running');
  }));

test('out-of-range scale attempts do not change routes or desired count', async () =>
  fleetFixture(async ({ fleet, store }) => {
    /** Detached current synthetic route inventory used to prove invalid scale leaves it unchanged. */
    const before = store.loadRoutes();
    for (const count of [0, 1, 5, 16, 1.5, NaN]) {
      await assert.rejects(fleet.scaleTo(count), /Scale target/);
    }
    assert.deepEqual(store.loadRoutes(), before);
    assert.equal(fleet.status.desiredReplicas, 2);
  }));

test('resizing is serialized with concurrent reconciles and subsequent scale requests', async () =>
  fleetFixture(async ({ fleet, store }) => {
    /** Serialized actual scale receipts, proving each request observes its own committed desired capacity. */
    const [a, b] = await Promise.all([fleet.scaleTo(3), fleet.scaleTo(2)]);
    assert.equal(a.desiredReplicas, 3);
    assert.equal(b.desiredReplicas, 2);
    assert.equal(store.loadRoutes()[0].backends.length, 2);
    /** Actual post-resize reconciliation receipt. */
    const check = await fleet.reconcile();
    assert.equal(check.status.desiredReplicas, 2);
  }));

test('stopping after scale rejects new mutations without leaving an owner route', async () =>
  fleetFixture(async ({ fleet, store }) => {
    await fleet.scaleTo(3);
    await fleet.stop();
    await assert.rejects(fleet.scaleTo(2), /stopping/);
    assert.deepEqual(store.loadRoutes(), []);
  }));

test('a superseded route prevents a resize from changing the newer owner', async () =>
  fleetFixture(async ({ fleet, store, ports }) => {
    /** Owned later conditional route lease that stale resizing must not replace. */
    const newer = store.registerRoute(
      'scale.localhost',
      ports[4],
      process.pid,
      true
    );
    await assert.rejects(fleet.scaleTo(3), /superseded/);
    assert.equal(store.loadRoutes()[0].leaseId, newer.leaseId);
    assert.equal(store.loadRoutes()[0].port, ports[4]);
  }));

test('partial scale-up retains serving capacity and a later reconcile repairs the deficit', async () =>
  fleetFixture(async ({ fleet, store, ports, dir }) => {
    /** Native filesystem import used only for a private synthetic child-start blocker. */
    const fs = (await import('node:fs')).default;
    /** Fixed fixture-only failure marker removed before retrying explicit reconciliation. */
    const blocker = `${dir}/block-${ports[3]}`;
    fs.writeFileSync(blocker, 'block');
    try {
      await assert.rejects(
        fleet.scaleTo(4),
        /before|exited|startup|process|ready/i
      );
      assert.equal(fleet.status.desiredReplicas, 4);
      assert.equal(fleet.status.phase, 'degraded');
      assert.equal(store.loadRoutes()[0].backends.length, 3);
    } finally {
      fs.unlinkSync(blocker);
    }
    /** Actual repair receipt proving healthy capacity is retained and a missing member can recover. */
    const result = await fleet.reconcile();
    assert.equal(result.failures.length, 0);
    assert.equal(fleet.status.phase, 'running');
    assert.equal(store.loadRoutes()[0].backends.length, 4);
  }));

test('zero replacement budget still permits an explicit safe operator scale', async () =>
  fleetFixture(
    async ({ fleet, store }) => {
      // The operator can provision new capacity even when automated replacement is disabled.
      await fleet.scaleTo(3);
      assert.equal(store.loadRoutes()[0].backends.length, 3);
    },
    { maxReplacements: 0 }
  ));
