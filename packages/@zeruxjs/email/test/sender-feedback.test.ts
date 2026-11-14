import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createMemorySenderFeedbackStore,
  createDatabaseSenderFeedbackStore,
  createSenderFeedbackService,
  createSenderReputationReportEndpoint,
  createMarketingFeedbackEndpoint,
  createMemoryMarketingSuppressionStore,
  createMarketingSuppressionService,
  senderReputationCharts,
} from '../dist/index.js';
/** Fixed UTC accepted-cohort start; feedback receipt time remains separate. */
const from = Date.UTC(2026, 9, 1);
/** Exclusive fixed UTC cohort end; no local-time interpretation. */
const until = from + 86400000;
let clock = until + 3600000;
/**
 * Bind one synthetic feedback scope and stable fixture key to an explicit store.
 *
 * @param {object} store - Explicit synthetic reference store or qualified native port.
 * @returns {object} Private scope policy; key/hash values do not prove permission or anonymity.
 */
const config = (store) => ({
  store,
  tenant: 'tenant-a',
  site: 'shop',
  account: 'sender',
  provider: 'relay',
  lookupKey: new Uint8Array(32).fill(7),
  now: () => clock,
});
/**
 * Create only an explicitly non-durable local reference feedback evaluator.
 *
 * @returns {object} Bounded synthetic service; no native resource ownership.
 */
const memory = () =>
  createSenderFeedbackService({
    ...config(createMemorySenderFeedbackStore()),
    requireDurable: false,
  });
test('cohort rates have explicit denominators/nulls, late feedback correlates without rebucketing, repeats do not inflate', async () => {
  /** Scope-bound feedback evaluator over synthetic data; no provider or SMTP connection. */
  const service = memory();
  assert.equal((await service.report(from, until)).rates.bouncePercent, null);
  await service.recordAccepted(
    'sender',
    'person@example.test',
    'smtp-id',
    from + 1000
  );
  await service.recordFeedback({
    eventId: 'bounce',
    email: 'person@example.test',
    messageId: 'smtp-id',
    kind: 'hard-bounce',
    at: until + 100,
  });
  await service.recordFeedback({
    eventId: 'bounce-copy',
    email: 'person@example.test',
    messageId: 'smtp-id',
    kind: 'hard-bounce',
    at: until + 100,
  });
  await service.recordFeedback({
    eventId: 'unmatched',
    email: 'other@example.test',
    messageId: 'unknown',
    kind: 'complaint',
    at: from + 2000,
  });
  /** Private aggregate cohort projection with denominator, sample and late/unmatched coverage. */
  const report = await service.report(from, until);
  assert.equal(report.denominator, 1);
  assert.equal(report.counts.hardBounces, 1);
  assert.equal(report.rates.bouncePercent, 100);
  assert.equal(report.coverage.lateFeedback, 1);
  assert.equal(report.coverage.unmatchedFeedback, 1);
  assert.equal(report.days[0].hardBounces, 1);
  assert.equal(report.coverage.providerReputation, 'not-measured');
  assert(!JSON.stringify(report).includes('person@example'));
  /** Fixed count-only chart specifications derived from the authorized aggregate. */
  const chart = senderReputationCharts(report);
  assert.equal(chart.accepted.values[0], 1);
  assert.equal(chart.bounces.values[0], 1);
  await assert.rejects(
    service.recordFeedback({
      eventId: 'bounce',
      email: 'person@example.test',
      messageId: 'changed',
      kind: 'hard-bounce',
      at: until + 100,
    }),
    /Conflicting/
  );
});
test('bound tenant/provider keys, shared suppression, duplicate event concurrency and fail-closed history capacity', async () => {
  /** Explicit reference store or borrowed native-store adapter; native handles remain host-owned. */
  const store = createMemorySenderFeedbackStore();
  /** First scope-bound service over the shared synthetic feedback ledger. */
  const a = createSenderFeedbackService({
    ...config(store),
    requireDurable: false,
  });
  /** Second service used to verify dedupe and committed shared-ledger visibility. */
  const b = createSenderFeedbackService({
    ...config(store),
    requireDurable: false,
  });
  /** Different tenant binding; identical private recipient facts must not cross this scope. */
  const other = createSenderFeedbackService({
    ...config(store),
    tenant: 'other',
    requireDurable: false,
  });
  /** Synthetic private feedback with explicit event/message/recipient attribution. */
  const event = {
    eventId: 'shared',
    email: 'person@example.test',
    messageId: 'mail',
    kind: 'complaint',
    at: from + 1,
  };
  /** Concurrent insert outcomes or private HTTP projection; only declared counts/status are asserted. */
  const result = await Promise.all([
    a.recordFeedback(event),
    b.recordFeedback(event),
  ]);
  assert.deepEqual(result.sort(), [false, true]);
  assert(await b.isSuppressed(event.email));
  assert.equal(await other.isSuppressed(event.email), false);
  assert.throws(() => createSenderFeedbackService(config(store)), /durable/);
  /** Feedback evaluator with a deliberate strict history scan cap; overflow must fail closed. */
  const limited = createSenderFeedbackService({
    ...config(store),
    requireDurable: false,
    scanLimit: 1,
  });
  await a.recordFeedback({ ...event, eventId: 'second', messageId: 'mail2' });
  await assert.rejects(limited.report(from, until), /scan limit/);
});
/** Public synthetic HMAC signing key; never use it for a deployment or vendor verifier. */
const secret = Buffer.alloc(32, 9);
/**
 * Authenticate exact synthetic timestamp/body bytes with the fixture HMAC key.
 *
 * @param {string | Uint8Array} body - Exact synthetic JSON body bytes.
 * @param {string} at - Exact signed fixture timestamp representation.
 * @returns {string} Hexadecimal fixture proof, never a vendor signature implementation.
 */
const sign = (body, at) =>
  createHmac('sha256', secret)
    .update(at + '.')
    .update(body)
    .digest('hex');
/**
 * Build a local feedback handler with exact fixture signature/freshness and correlation.
 *
 * @param {object} service - Explicit scope-bound feedback service registered by the fixture.
 * @returns {object} Explicit Fetch handler; no listener or remote trust discovery.
 */
function endpoint(service) {
  return createMarketingFeedbackEndpoint({
    now: () => clock,
    signatureTime: (h) => Number(h.get('x-at')),
    verifySignature: (raw, h) => {
      /** Untrusted fixture signature header checked for syntax before constant-time comparison. */
      const value = h.get('x-signature');
      return (
        /^[a-f0-9]{64}$/.test(value ?? '') &&
        timingSafeEqual(
          Buffer.from(value, 'hex'),
          Buffer.from(sign(raw, h.get('x-at')), 'hex')
        )
      );
    },
    parse: (raw) => JSON.parse(Buffer.from(raw).toString()),
    suppression: createMarketingSuppressionService({
      store: createMemoryMarketingSuppressionStore(),
      now: () => clock,
    }),
    correlatedFeedback: {
      service,
      normalize: (e) => ({
        eventId: e.eventId,
        email: e.email,
        messageId: e.messageId,
        kind: e.kind,
        at: e.at,
      }),
    },
  });
}
/**
 * Invoke the fixture handler with signed inert JSON and optional invalid freshness/proof.
 *
 * @param {object} app - Local fixture Fetch endpoint.
 * @param {unknown[]} events - Inert synthetic notifications; invalid entries exercise whole-batch rejection.
 * @param {object} options - Explicit fixture verification overrides.
 * @param {number} options.at - Controlled signed timestamp in epoch milliseconds, default fixture clock.
 * @param {boolean} options.forged - Default false; true deliberately replaces the HMAC proof.
 * @returns {Promise<Response>} Local explicit acceptance/denial; body values never execute.
 */
function post(app, events, { at = clock, forged = false } = {}) {
  /** Exact synthetic JSON bytes authenticated by the explicit fixture HMAC. */
  const body = JSON.stringify(events);
  /** Signed fixture timestamp string; replay protection must authenticate this value. */
  const timestamp = String(at);
  return app.handle(
    new Request('https://host/_email/feedback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-at': timestamp,
        'x-signature': forged ? '0'.repeat(64) : sign(body, timestamp),
      },
      body,
    })
  );
}
test('raw-body authentication/freshness and full-batch validation precede durable suppression', async () => {
  /** Scope-bound feedback evaluator over synthetic data; no provider or SMTP connection. */
  const service = memory();
  /** Local feedback handler with fixture verification and explicit source correlation. */
  const app = endpoint(service);
  /** Synthetic private feedback with explicit event/message/recipient attribution. */
  const event = {
    eventId: 'auth',
    email: 'person@example.test',
    messageId: 'smtp-id',
    kind: 'hard-bounce',
    at: from + 2000,
  };
  assert.equal((await post(app, [event], { forged: true })).status, 401);
  assert.equal((await post(app, [event], { at: clock - 300001 })).status, 401);
  assert.equal(
    (
      await post(app, [
        event,
        { ...event, eventId: 'invalid', messageId: 'bad\nvalue' },
      ])
    ).status,
    400
  );
  assert.equal(await service.isSuppressed(event.email), false);
  assert.equal((await post(app, [event])).status, 204);
  assert.equal((await post(app, [event])).status, 204);
  assert(await service.isSuppressed(event.email));
});
test('persistence outage returns 503; sender report auth runs before source resolution and remains no-store', async () => {
  /** Explicit reference store or borrowed native-store adapter; native handles remain host-owned. */
  const store = createMemorySenderFeedbackStore();
  /** Feedback evaluator with a deliberately failing durable-append protocol port. */
  const failed = createSenderFeedbackService({
    ...config({
      ...store,
      append: async () => {
        throw Error('private storage failure');
      },
    }),
    requireDurable: false,
  });
  /** Synthetic private feedback with explicit event/message/recipient attribution. */
  const event = {
    eventId: 'error',
    email: 'person@example.test',
    messageId: 'smtp-id',
    kind: 'complaint',
    at: from + 1,
  };
  assert.equal((await post(endpoint(failed), [event])).status, 503);
  let resolved = 0;
  /** Registered local report service; authorization must run before resolving it. */
  const source = memory();
  /** Local private report handler with explicit fixture authorization. */
  const api = createSenderReputationReportEndpoint({
    authorize: (r) => r.headers.get('role') === 'reader',
    resolveService: () => {
      resolved++;
      return source;
    },
  });
  /** Synthetic report query bound to the fixed UTC cohort; no outbound network. */
  const url = `https://host/_email/sender-report?from=${from}&until=${until}`;
  assert.equal((await api.handle(new Request(url))).status, 403);
  assert.equal(resolved, 0);
  /** Concurrent insert outcomes or private HTTP projection; only declared counts/status are asserted. */
  const result = await api.handle(
    new Request(url, { headers: { role: 'reader' } })
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal((await result.json()).report.denominator, 0);
});
test('durable SQLite dedupe and suppression survive two connections and reopen; handles/temp files close', async () => {
  /** Fixed ESM/CommonJS bridge for the built SQLite adapter. */
  const require = createRequire(import.meta.url);
  /** Public built native SQLite factory; only owned disposable test state is opened. */
  const { createConnector } = require('../../db-sqllite/dist/index.js');
  /** Owned temporary database directory; remove after all native handles settle. */
  const dir = mkdtempSync(path.join(tmpdir(), 'sender-feedback-'));
  /** Synthetic SQLite path inside the owned temporary directory. */
  const filename = path.join(dir, 'feedback.sqlite');
  /** Fixed private database context, unrelated to operator application files. */
  const ctx = {
    connection: {
      slug: 'feedback',
      name: 'feedback',
      connector: 'sqlite',
      options: {},
    },
  };
  /**
   * Open the fixed synthetic SQLite journal for a native durability assertion.
   *
   * @returns {Promise<object>} Owned native connector requiring disconnect before folder cleanup.
   */
  const open = () => createConnector({ filename, driver: 'node' });
  let first, second, reopened;
  /**
   * Borrow structured operations for an explicitly durable native feedback store.
   *
   * @param {object} c - Owned native SQLite connector; close it outside this borrowed adapter.
   * @returns {object} Borrowed feedback-store port; native connector remains externally owned.
   */
  const store = (c) =>
    createDatabaseSenderFeedbackStore(
      Object.fromEntries(
        ['createTable', 'insert', 'select', 'createIndex'].map((op) => [
          op,
          (input) => c.execute({ op, ...input }, ctx),
        ])
      )
    );
  try {
    first = await open();
    second = await open();
    /** First scope-bound service over the shared synthetic feedback ledger. */
    const a = createSenderFeedbackService(config(store(first)));
    /** Second service used to verify dedupe and committed shared-ledger visibility. */
    const b = createSenderFeedbackService(config(store(second)));
    await a.recordAccepted('sender', 'person@example.test', 'mail', from + 1);
    /** Synthetic private feedback with explicit event/message/recipient attribution. */
    const event = {
      eventId: 'db',
      email: 'person@example.test',
      messageId: 'mail',
      kind: 'complaint',
      at: from + 2,
    };
    assert.equal(await a.recordFeedback(event), true);
    assert.equal(await b.recordFeedback(event), false);
    assert(await b.isSuppressed(event.email));
    assert.equal((await b.report(from, until)).counts.complaints, 1);
    await first.disconnect();
    first = null;
    await second.disconnect();
    second = null;
    reopened = await open();
    assert(
      await createSenderFeedbackService(config(store(reopened))).isSuppressed(
        event.email
      )
    );
  } finally {
    // Attempt every native close and owned-folder cleanup even after an earlier rejection.
    try {
      await first?.disconnect();
    } finally {
      try {
        await second?.disconnect();
      } finally {
        try {
          await reopened?.disconnect();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  }
});
test('correlated conflicting message references in a signed batch reject before any write', async () => {
  /** Scope-bound feedback evaluator over synthetic data; no provider or SMTP connection. */
  const service = memory();
  /** Local feedback handler with fixture verification and explicit source correlation. */
  const app = endpoint(service);
  /** Synthetic conflicting feedback whose immutable event identity must not change meaning. */
  const e = {
    eventId: 'conflict',
    email: 'person@example.test',
    messageId: 'one',
    kind: 'complaint',
    at: from + 1,
  };
  assert.equal((await post(app, [e, { ...e, messageId: 'two' }])).status, 400);
  assert.equal(await service.isSuppressed(e.email), false);
});
test('Reports view consumes sender trend charts with table alternatives and owned cleanup (DOM emulation)', async (t) => {
  /** Explicit DOM-emulation fixture dependency; never claimed as native browser/AT acceptance. */
  const { JSDOM } = await import('jsdom');
  /** Public built Reports view adapter; every mounted view must be destroyed. */
  const { mountReportChart } = await import('../../reports/dist/view.js');
  /** Scope-bound feedback evaluator over synthetic data; no provider or SMTP connection. */
  const service = memory();
  await service.recordAccepted(
    'sender',
    'person@example.test',
    'chart-mail',
    from + 1
  );
  /** Fixed count-only sender trend specifications with table alternatives. */
  const charts = senderReputationCharts(await service.report(from, until));
  /** Owned DOM-emulation window; close even after a failed assertion. */
  const dom = new JSDOM('<main data-report-board></main>');
  /** Owned synthetic chart container; private markup never enters via arbitrary HTML. */
  const host = dom.window.document.querySelector('main');
  /** Owned report-view handles; destroy each before releasing the emulated window. */
  const views = [];
  // Retain each successful mount immediately so a later mount/assertion failure cannot strand it.
  t.after(() => {
    try {
      // Release every still-owned view before disposing the emulated window.
      for (const view of views) {
        view.destroy();
      }
    } finally {
      dom.window.close();
    }
  });
  // Register only fixed count-chart specifications, retaining each cleanup owner as it mounts.
  for (const chart of Object.values(charts)) {
    views.push(mountReportChart(host, chart));
  }
  assert.equal(host.querySelectorAll('table caption').length, 5);
  assert(host.textContent.includes('SMTP-accepted cohort denominator'));
  // Dispose every report-view owner before releasing the synthetic DOM window.
  for (const view of views) {
    view.destroy();
  }
  views.length = 0;
  assert.equal(host.children.length, 0);
});
test('late coverage uses first receipt independent of hash order; repeated acceptance keeps first cohort', async () => {
  /** Previous controlled clock value restored in finally, preserving test isolation. */
  const saved = clock;
  /** Scope-bound feedback evaluator over synthetic data; no provider or SMTP connection. */
  const service = memory();
  try {
    clock = from + 10000;
    await service.recordAccepted(
      'sender',
      'person@example.test',
      'stable',
      from + 1
    );
    await service.recordFeedback({
      eventId: 'first-receipt',
      email: 'person@example.test',
      messageId: 'stable',
      kind: 'complaint',
      at: from + 2,
    });
    clock = until + 10000;
    await service.recordFeedback({
      eventId: 'copy-receipt',
      email: 'person@example.test',
      messageId: 'stable',
      kind: 'complaint',
      at: from + 2,
    });
    assert.equal((await service.report(from, until)).coverage.lateFeedback, 0);
    await service.recordAccepted(
      'sender',
      'person@example.test',
      'stable',
      until + 1
    );
    /** Local cancellation scope used to verify bounded report abort without source disclosure. */
    const c = new AbortController();
    c.abort();
    await assert.rejects(service.report(from, until, c.signal), {
      code: 'EMAIL_REPORT_CANCELLED',
    });
    assert.equal((await service.report(from, until)).denominator, 1);
  } finally {
    clock = saved;
  }
});
