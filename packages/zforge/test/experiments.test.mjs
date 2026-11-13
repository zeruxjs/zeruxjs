import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as transports from 'zhost/protocols';
import { createDevtoolsModuleHost } from 'zforge/modules';
import { createExperimentInspectionModule } from 'zforge/experiments';
import {
  createExperimentCatalog,
  createExperimentEvaluator,
} from 'ztrial/experiments';
/** Explicit synthetic two-variant development catalog; weights are allocation, not statistical evidence. */
const catalog = createExperimentCatalog([
  {
    id: 'checkout',
    version: 1,
    salt: 'allocation_salt_v1',
    migration: 'initial',
    environments: ['development'],
    variants: [
      { name: 'control', weight: 5000 },
      { name: 'compact', weight: 5000 },
    ],
  },
]);
/** Exact synthetic operator UI origin used for native CSRF/origin checks. */
const origin = 'http://localhost:3000';
/** Build private synthetic evaluation/CSRF/audit settings without starting a listener.
 * @param {object} extra - Explicit trusted policy or failure-injection overrides.
 * @returns {object} Inert module options with bounded native endpoint settings.
 */
function config(extra = {}) {
  return {
    mode: 'development',
    createEvaluator: createExperimentEvaluator,
    evaluation: {
      catalog,
      tenant: 'tenant_0123456789',
      tenantSalt: new Uint8Array(32).fill(7),
      resolveContext: () => ({
        tenant: 'tenant_0123456789',
        subject: 'subject_0123456789',
        environment: 'development',
        consent: 'granted',
      }),
    },
    endpoint: {
      allowedOrigins: [origin],
      limits: { maxMessageBytes: 4096, maxConcurrent: 4, timeoutMs: 1000 },
    },
    authorize: () => true,
    verifyCsrf: (req) => req.headers['x-csrf-token'] === 'fixture',
    audit: () => {},
    ...extra,
  };
}
/** Invoke a registered inspection tool on the exact local fixture port.
 * @param {number} port - Bound ephemeral loopback endpoint port.
 * @param {string} action - Explicit inspect/preview/test operation.
 * @param {object} args - Synthetic identifier-only tool arguments.
 * @param {object} headers - Optional deliberate CSRF/origin denial overrides.
 * @returns {Promise<object>} Native status and response text after the fixture request settles.
 */
function call(port, action, args, headers = {}) {
  return new Promise((resolve, reject) => {
    /** Owned loopback MCP request carrying only identifier-based inspection arguments. */
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          origin,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'x-csrf-token': 'fixture',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, text: data }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'experiment.' + action, arguments: args },
      })
    );
  });
}
/** Create a scoped test host with fixed expiring operator authentication.
 * @returns {object} Host owner closed after its module/control requests settle.
 */
const host = () =>
  createDevtoolsModuleHost({
    appId: 'app',
    generationId: 'generation-one',
    transports,
    authorize: async () => ({
      subject: 'operator',
      expiresAt: Date.now() + 5000,
    }),
  });
test('public MCP inspection previews are ephemeral, authorized, redacted and generation owned', async () => {
  /** Scoped host owning evaluator modules and native endpoint cleanup. */
  const h = host();
  /** Identifier-only synthetic audit receipts checked for private-trait exclusion. */
  const audit = [];
  let runs = 0;
  try {
    /** Loaded experiment inspection generation; its stale handle must not dispose a replacement. */
    const module = await h.load(
      createExperimentInspectionModule(
        config({
          audit: (e) => audit.push(e),
          tests: {
            smoke: () => {
              runs++;
              return true;
            },
          },
        })
      )
    );
    /** Actual bound ephemeral MCP port returned by the module host. */
    const port = module.endpoints()[0].address.port;
    /** Authorized inspection response checked for explanation fields without private subjects/salts. */
    const normal = await call(port, 'inspect', { experiment: 'checkout' });
    assert.match(normal.text, /assigned/);
    assert.doesNotMatch(
      normal.text,
      /subject_0123456789|tenant_0123456789|allocation_salt/
    );
    /** Display-only expiring variant preview; no production assignment is written. */
    const preview = await call(port, 'preview', {
      experiment: 'checkout',
      variant: 'compact',
      ttlMs: 500,
    });
    assert.match(preview.text, /previewOnly/);
    assert.match(preview.text, /expiresAt/);
    assert.match(
      (
        await call(
          port,
          'preview',
          { experiment: 'checkout', variant: 'compact', ttlMs: 500 },
          { 'x-csrf-token': '' }
        )
      ).text,
      /Tool execution failed/
    );
    assert.equal(
      (
        await call(
          port,
          'preview',
          { experiment: 'checkout', variant: 'compact', ttlMs: 500 },
          { origin: 'http://evil.test' }
        )
      ).status,
      403
    );
    assert.match(
      (await call(port, 'test', { experiment: 'checkout', test: 'smoke' }))
        .text,
      /passed/
    );
    assert.equal(runs, 1);
    assert.match(
      (
        await call(port, 'preview', {
          experiment: 'checkout',
          variant: 'compact',
          ttlMs: 60001,
        })
      ).text,
      /Tool execution failed/
    );
    assert.ok(
      audit.some(
        (e) => e.action === 'preview' && e.phase === 'completed' && e.expiresAt
      )
    );
    assert.ok(!JSON.stringify(audit).includes('subject_0123456789'));
    /** Fresh module generation with a deliberately denying authorization callback. */
    const replacement = await h.load(
      createExperimentInspectionModule(config({ authorize: () => false }))
    );
    await module.dispose();
    assert.equal(h.status().modules, 1);
    assert.match(
      (
        await call(replacement.endpoints()[0].address.port, 'inspect', {
          experiment: 'checkout',
        })
      ).text,
      /Tool execution failed/
    );
    await assert.rejects(call(port, 'inspect', { experiment: 'checkout' }));
    await replacement.dispose();
    assert.equal(h.status().modules, 0);
  } finally {
    await h.close();
  }
});
test('production, persistence options and dependency failures fail closed', async () => {
  assert.throws(
    () => createExperimentInspectionModule(config({ mode: 'production' })),
    /development/
  );
  /** Fresh configuration mutated to include a forbidden recording option for fail-closed validation. */
  const invalid = config();
  invalid.evaluation.recording = {};
  assert.throws(() => createExperimentInspectionModule(invalid), /persistence/);
  /** Scoped host owning evaluator modules and native endpoint cleanup. */
  const h = host();
  try {
    await assert.rejects(
      h.load(
        createExperimentInspectionModule(
          config({
            createEvaluator: () => {
              throw Error('private-secret');
            },
          })
        )
      ),
      /startup/
    );
    assert.equal(h.status().modules, 0);
    /** Loaded module with an intentionally unavailable audit dependency. */
    const m = await h.load(
      createExperimentInspectionModule(
        config({
          audit: () => {
            throw Error('private-secret');
          },
        })
      )
    );
    /** Sanitized failed-tool response excluding the injected private dependency cause. */
    const result = await call(m.endpoints()[0].address.port, 'preview', {
      experiment: 'checkout',
      variant: 'compact',
      ttlMs: 100,
    });
    assert.match(result.text, /Tool execution failed/);
    assert.doesNotMatch(result.text, /private-secret/);
  } finally {
    await h.close();
  }
});
test(
  'consent denial prevents tests and unloading cancels/drains an in-flight callback',
  { timeout: 5000 },
  async () => {
    /** Scoped host owning evaluator modules and native endpoint cleanup. */
    const h = host();
    let runs = 0;
    try {
      /** Explicit evaluation configuration whose subject consent denies inspection test execution. */
      const denied = config({
        tests: {
          smoke: () => {
            runs++;
            return true;
          },
        },
      });
      denied.evaluation.resolveContext = () => ({
        tenant: 'tenant_0123456789',
        subject: 'subject_0123456789',
        environment: 'development',
        consent: 'denied',
      });
      /** Consented-policy module fixture returning denial without running its registered test. */
      const first = await h.load(createExperimentInspectionModule(denied));
      assert.match(
        (
          await call(first.endpoints()[0].address.port, 'test', {
            experiment: 'checkout',
            test: 'smoke',
          })
        ).text,
        /consent/
      );
      assert.equal(runs, 0);
      let started;
      /** Barrier proving the trusted callback started before unloading its module. */
      const begun = new Promise((r) => (started = r));
      let settled = false;
      /** Replacement module owning a cooperative callback cancelled by explicit disposal. */
      const next = await h.load(
        createExperimentInspectionModule(
          config({
            tests: {
              smoke: (ctx) =>
                new Promise((resolve) => {
                  started();
                  ctx.signal.addEventListener(
                    'abort',
                    () => {
                      settled = true;
                      resolve(true);
                    },
                    { once: true }
                  );
                }),
            },
          })
        )
      );
      /** In-flight inspection request retained through cancellation and actual handler settlement. */
      const pending = call(next.endpoints()[0].address.port, 'test', {
        experiment: 'checkout',
        test: 'smoke',
      }).catch(() => null);
      await begun;
      await next.dispose();
      await pending;
      assert.equal(settled, true);
      assert.equal(h.status().modules, 0);
    } finally {
      await h.close();
    }
  }
);
