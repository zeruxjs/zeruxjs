import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailTrackingService,
  createMemoryEmailActivityStore,
} from '../dist/index.js';

/** Synthetic tracking-service options builder.
 * @param {object} extra - Explicit fixture overrides, default empty.
 * @returns {object} Synthetic tracking-service options builder. */
const settings = (extra = {}) => ({
  analytics: {
    async track(input) {
      return input.name;
    },
  },
  baseUrl: 'https://events.example.test',
  secret: 'strong-mail-secret-'.repeat(4),
  ...extra,
});
/** Synthetic fixture context for the declared operation.
 * @param {object} tracking - Explicit synthetic tracking policy.
 * @returns {object} Synthetic fixture context for the declared operation. */
const ctx = (tracking = { enabled: true }) => ({
  id: 'activity-one',
  account: 'support',
  message: { tracking },
});
/** Extract generated attribute URLs as inert strings without fetching or executing them.
 * @param {string} html - Inert generated markup.
 * @returns {string[]} Isolated fixture values for the following assertions.
 */
function urls(html) {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((x) =>
    x[1].replace(/&amp;/g, '&')
  );
}

test('per-email report tracks first/last opens, per-link repeat clicks and opt-in download links', async () => {
  /** Observed synthetic telemetry rows/events. */
  const recorded = [];
  /** Explicitly opted-in fixture tracking service with private synthetic keys. */
  const tracking = createEmailTrackingService(
    settings({ onEvent: (event) => recorded.push(event) })
  );
  /** Authored inert HTML fixture; tests verify wrapping/escaping without a browser. */
  const html =
    '<a href="https://app.example.test/guide">Guide</a> <a href="https://app.example.test/archive.zip" data-track-download>ZIP</a><a href="https://app.example.test/unsubscribe">Opt out</a>';
  /** Instrumented HTML whose local URLs and inert markup are asserted. */
  const rendered = tracking.instrumentHtml(html, ctx());
  /** Generated attribute URLs extracted without fetching destinations. */
  const extracted = urls(rendered);
  /** Generated signed pixel URL; no external request is made. */
  const pixel = extracted.find((x) => x.includes('/open/'));
  /** Generated signed links or bounded fixture link extractor. */
  const links = extracted.filter((x) => x.includes('/click/'));
  assert.equal(links.length, 2);
  /** Generated fixture guide-link tracking URL. */
  const guide = links[0];
  await tracking.onSent({
    id: 'activity-one',
    account: 'support',
    message: { tracking: { enabled: true } },
  });
  /** Generated fixture download-link tracking URL. */
  const download = links.find((x) => x !== guide) || links[1];
  assert.equal((await tracking.handle(new Request(pixel))).status, 200);
  assert.equal((await tracking.handle(new Request(pixel))).status, 200);
  assert.equal((await tracking.handle(new Request(guide))).status, 302);
  assert.equal((await tracking.handle(new Request(guide))).status, 302);
  assert.equal((await tracking.handle(new Request(download))).status, 302);
  /** Observed activity summary or fixture aggregate calculator. */
  const summary = await tracking.getActivity('activity-one');
  assert.equal(summary.opens, 2);
  assert.equal(summary.clicks, 3);
  assert.equal(summary.downloadClicks, 1);
  assert.equal(summary.downloads, 0);
  assert.ok(summary.firstOpenedAt <= summary.lastOpenedAt);
  assert.ok(summary.firstClickedAt <= summary.lastClickedAt);
  assert.equal(summary.links.length, 2);
  assert.equal(
    summary.links.reduce((n, link) => n + link.clicks, 0),
    3
  );
  assert.equal(summary.sentAt !== undefined, true);
  assert.equal(recorded.filter((e) => e.kind === 'open').length, 2);
  assert.equal(recorded.filter((e) => e.kind === 'download_click').length, 1);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /app\.example\.test|archive\.zip|subscriber@/
  );
  // A click is only an attempted download. Successful serving must be reported by the app.
  await tracking.recordDownload({
    id: 'activity-one',
    account: 'support',
    url: 'https://app.example.test/archive.zip',
    bytes: 1024,
  });
  await tracking.recordDownload({
    id: 'activity-one',
    account: 'support',
    url: 'https://app.example.test/archive.zip',
    bytes: 2048,
  });
  /** Post-operation summary checked against earlier isolated state. */
  const after = await tracking.getActivity('activity-one');
  assert.equal(after.downloads, 2);
  assert.equal(after.downloadedBytes, 3072);
  assert.equal(after.links.find((l) => l.downloadClicks === 1)?.downloads, 2);
  assert.ok(after.firstDownloadedAt <= after.lastDownloadedAt);
  assert.equal(await tracking.getActivity('unknown-id'), null);
});

test('download classification can be controlled per send without controlling opens or clicks', async () => {
  /** Explicitly opted-in fixture tracking service with private synthetic keys. */
  const tracking = createEmailTrackingService(settings());
  /** Inert single-link HTML fixture. */
  const h = '<a href="https://app.example.test/app.zip">Download</a>';
  /** Instrumented HTML; fixtures verify opt-out preservation and idempotence. */
  const marked = tracking.instrumentHtml(
    h,
    ctx({
      enabled: true,
      opens: false,
      downloadLinks: ['https://app.example.test/app.zip'],
    })
  );
  assert.doesNotMatch(marked, /\/open\//);
  /** Locally handled signed redirect response or generated redirect URL. */
  const redirect = urls(marked)[0];
  await tracking.handle(new Request(redirect));
  assert.equal((await tracking.getActivity('activity-one')).downloadClicks, 1);
  /** Explicitly disabled download classification output. */
  const unmarked = tracking.instrumentHtml(
    h,
    ctx({
      enabled: true,
      opens: false,
      downloads: false,
      downloadLinks: ['https://app.example.test/app.zip'],
    })
  );
  await tracking.handle(new Request(urls(unmarked)[0]));
  assert.equal((await tracking.getActivity('activity-one')).downloadClicks, 1);
  assert.equal((await tracking.getActivity('activity-one')).clicks, 2);
});

test('activity storage failures and timeouts do not block redirect', async () => {
  /** Captured one-time warning observations. */
  const warn = [];
  /** Explicitly opted-in fixture tracking service with private synthetic keys. */
  const tracking = createEmailTrackingService(
    settings({
      activityStore: {
        record: async () => new Promise(() => {}),
        get: async () => {
          throw Error('outage');
        },
      },
      telemetryTimeoutMs: 15,
      onWarning: (m) => warn.push(m),
    })
  );
  /** Authored inert HTML fixture; tests verify wrapping/escaping without a browser. */
  const html = tracking.instrumentHtml(
    '<a href="https://app.example.test/report">Report</a>',
    ctx({ enabled: true, opens: false })
  );
  assert.equal((await tracking.handle(new Request(urls(html)[0]))).status, 302);
  assert.equal(await tracking.getActivity('activity-one'), null);
  assert.equal(warn.length, 1);
});

test('bounded local store supports snapshots, repeated reads and deterministic eviction', async () => {
  /** Isolated reference store; production durability is not inferred from this fixture. */
  const store = createMemoryEmailActivityStore({ maxMessages: 1 });
  /** Synthetic event/input used for repeatable validation and dedup checks.
   * @param {string|number} id - Synthetic opaque fixture identifier.
   * @returns {object} Synthetic event/input used for repeatable validation and dedup checks. */
  const event = (id) => ({
    kind: 'open',
    id,
    account: 'default',
    campaign: '',
    at: 1000,
  });
  await store.record(event('first'));
  /** First independent fixture receipt/summary in the asserted comparison. */
  const one = await store.get('first');
  one.opens = 999;
  assert.equal((await store.get('first')).opens, 1);
  await store.record(event('second'));
  assert.equal(await store.get('first'), null);
  assert.equal((await store.get('second')).opens, 1);
});

test('explicit shared aggregation store combines requests received on separate instances', async () => {
  /** Isolated reference store; production durability is not inferred from this fixture. */
  const store = createMemoryEmailActivityStore();
  /** First fixture receipt, service, key or lease in this comparison. */
  const first = createEmailTrackingService(settings({ activityStore: store }));
  /** Second fixture receipt, service, key or lease for replay/rotation/isolation checks. */
  const second = createEmailTrackingService(settings({ activityStore: store }));
  /** Inert instrumented HTML; no JavaScript or browser execution occurs. */
  const markup = first.instrumentHtml(
    '<a href="https://app.example.test/resource">Resource</a>',
    ctx({ enabled: true, opens: false })
  );
  /** Generated signed click URL; handled locally by the fixture. */
  const click = urls(markup)[0];
  await first.onSent({
    id: 'activity-one',
    account: 'support',
    message: { tracking: { enabled: true } },
  });
  await second.handle(new Request(click));
  await first.handle(new Request(click));
  assert.equal((await first.getActivity('activity-one')).clicks, 2);
  assert.equal((await second.getActivity('activity-one')).clicks, 2);
});
