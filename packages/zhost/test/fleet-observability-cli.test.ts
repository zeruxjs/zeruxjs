import test from 'node:test';
import assert from 'node:assert/strict';
import { cliFixture, cli, request } from './helpers/fleet-cli-fixture.ts';

test(
  'local CLI exposes verified HTTP service metrics, Prometheus format and live doctor',
  { timeout: 45000 },
  async () =>
    cliFixture(async ({ env, proxyPort, start }) => {
      await start();
      for (let i = 0; i < 8; i++) {
        assert.equal((await request(proxyPort, 'scale.localhost')).status, 200);
      }
      /** Actual bounded synthetic metric CLI output, parsed only after owned command success. */
      const output = await cli(['fleet', 'metrics', 'scale', '--json'], env);
      /** Same-host aggregate observations measured from real fixture requests. */
      const metrics = JSON.parse(output);
      assert.equal(metrics.metrics.hostname, 'scale.localhost');
      assert.ok(metrics.metrics.completedRequests >= 8);
      assert.equal(metrics.metrics.errorRate, 0);
      assert.ok(metrics.metrics.p95LatencyMs >= 0);
      /** Actual fixed-label metric exposition checked for expected sample/coverage fields. */
      const exposition = await cli(
        ['fleet', 'metrics', 'scale', '--prometheus'],
        env
      );
      assert.match(
        exposition,
        /zerux_fleet_healthy_replicas\{fleet="scale.localhost"\} 2/
      );
      assert.match(exposition, /zerux_fleet_http_error_ratio/);
      /** Authenticated live doctor receipt for only the synthetic fleet. */
      const live = JSON.parse(
        await cli(['fleet', 'doctor', 'scale', '--live', '--json'], env)
      );
      assert.equal(live.healthy, true);
      /** Private bounded aggregate sample history, empty without configured autosampling. */
      const history = JSON.parse(
        await cli(['fleet', 'samples', 'scale', '--json'], env)
      );
      assert.deepEqual(history, []); // no configured autoscaling = no samples
    })
);
