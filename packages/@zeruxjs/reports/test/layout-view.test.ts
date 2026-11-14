import { createFixtureCleanup } from './fixture-cleanup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  validateReports,
  createReports,
  createMemoryReportsStore,
} from '../dist/index.js';
import {
  exportReportDefinition,
  importReportDefinition,
  resolveReportLayout,
} from '../dist/definitions.js';
import { mountReportChart } from '../dist/view.js';
import { reportDashboard } from '../dist/dashboard.js';
import { validateComponentProps } from '../../accessibility/dist/index.js';
/** Finite inert authored chart definition, never executable SQL or HTML. */
const chart = {
  id: 'chart',
  title: '<img src=x onerror=alert(1)>',
  type: 'bar',
  groupBy: 'event',
  metric: 'count',
};
/** Finite inert definition builder, not the ambient DOM global.
 * @returns {unknown} Result of this documented fixture projection or explicit failure.
 */
const document = () => ({
  version: 1,
  reports: [
    {
      id: 'report',
      name: 'Report',
      pages: [
        {
          id: 'page',
          name: 'Page',
          charts: [{ ...chart }],
          layout: {
            version: 1,
            columns: 2,
            timeZone: 'UTC',
            items: [{ chartId: 'chart', span: 2 }],
          },
        },
      ],
    },
  ],
});
/** Finite authorized synthetic chart projection with explicit coverage. */
const data = {
  id: 'chart',
  title: chart.title,
  type: 'bar',
  labels: ['=SUM(A1)', '<script>secret()</script>', 'beta'],
  values: [1, 3, 2],
  total: 6,
  sampledRows: 3,
  truncated: true,
  queryMode: 'sampled',
  coverage: 'bounded-source-event-page',
};
test('V1 layout roundtrip is inert, rejects executable/unknown fields and huge imports', () => {
  /** Fresh synthetic document validated/cloned before any store change. */
  const doc = document();
  assert.deepEqual(importReportDefinition(exportReportDefinition(doc)), doc);
  assert.equal(
    resolveReportLayout({ ...doc.reports[0].pages[0], layout: undefined })
      .version,
    1
  );
  // Inspect only the finite synthetic cases/handles; no live-provider acceptance is inferred.
  for (const change of [
    (d) => (d.reports[0].pages[0].charts[0].sql = 'SELECT secret'),
    (d) => (d.reports[0].pages[0].charts[0].html = '<b>x</b>'),
    (d) => (d.reports[0].pages[0].charts[0].title = () => 42),
    (d) => (d.reports[0].pages[0].layout.version = 2),
    (d) => (d.reports[0].pages[0].layout.items[0].chartId = 'unknown'),
    (d) => (d.reports[0].pages[0].layout.items[0].span = 3),
    (d) => (d.reports[0].pages[0].layout.timeZone = 'evil/zone'),
  ]) {
    /** Independent invalid candidate; rejection must preserve prior state. */
    const modified = document();
    change(modified);
    assert.throws(() => validateReports(modified));
  }
  let called = false;
  /** Synthetic invalid definition/view value scoped only to this test. */
  const d = document();
  Object.defineProperty(d.reports[0], 'name', {
    enumerable: true,
    /** Expose a deliberately unsafe getter only to prove inert definition validation never invokes it.
     * @returns {string} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    get() {
      called = true;
      return 'bad';
    },
  });
  assert.throws(() => validateReports(d));
  assert(!called);
  assert.throws(() => importReportDefinition(' '.repeat(262145)), RangeError);
});
test('definition import is edit/origin guarded, does not save or trust imported revision; exports stay private', async () => {
  /** Synthetic local CAS definition store; no distributed durability claim. */
  const store = createMemoryReportsStore(document());
  /** Inert authorized studio facade over synthetic local stores. */
  const runtime = createReports({
    analytics: { events: async () => [] },
    store,
    authorize: (r, a) =>
      r.headers.get('role') === 'editor' ? true : a === 'read',
  });
  /** Borrowed authenticated handler, not a running server or permission bypass. */
  const route = new Map(runtime.routes().map((r) => [r.pattern, r.handler]));
  /** Bounded synthetic request stream/definition; cancellation owns reader cleanup. */
  const body = exportReportDefinition({ ...document(), version: 900 });
  /** Synthetic request builder; no real session or remote service.
   * @param {unknown} role - Explicit synthetic value/callback; this fixture never contacts live providers.
   * @param {unknown} origin - Explicit synthetic value/callback; this fixture never contacts live providers.
   * @returns {unknown} Result of this documented fixture projection or explicit failure.
   */
  const request = (role = 'editor', origin = 'https://host') =>
    new Request('https://host/_reports/definition', {
      method: 'POST',
      headers: { role, origin, 'content-type': 'application/json' },
      body,
    });
  assert.equal(
    (await route.get('/_reports/definition')(request('viewer'))).status,
    403
  );
  assert.equal(
    (await route.get('/_reports/definition')(request('editor', 'https://evil')))
      .status,
    403
  );
  /** Validated candidate rebound to current tenant revision without saving. */
  const imported = await route.get('/_reports/definition')(request());
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).version, 1);
  assert.equal((await store.load()).version, 1);
  /** Explicit definition/export result under private/no-store policy. */
  const output = await route.get('/_reports/definition')(
    new Request('https://host/_reports/definition', {
      headers: { role: 'editor' },
    })
  );
  assert.equal(output.headers.get('cache-control'), 'private, no-store');
  assert.equal(importReportDefinition(await output.text()).version, 1);
  /** Finite oversized request used to prove byte-budget rejection. */
  const huge = new Request('https://host/_reports/definition', {
    method: 'POST',
    headers: {
      role: 'editor',
      origin: 'https://host',
      'content-type': 'application/json',
    },
    body: ' '.repeat(262145),
  });
  assert.equal((await route.get('/_reports/definition')(huge)).status, 413);
});
test('table view labels, XSS safety, native sort/filter/paging, keyboard chart focus and teardown (DOM emulation)', (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned jsdom environment; ordered teardown releases views before closing its window. */
  const dom = new JSDOM('<div id="board" data-report-board></div>');
  /** Borrowed emulated window, not a live browser. */
  const w = dom.window;
  /** Owned synthetic chart board; existing host attributes remain authored. */
  const board = w.document.getElementById('board');
  // Register fixture ownership before later assertions can fail.
  cleanup('environment', () => {
    if (dom.window.document) {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    }
    dom.window.close();
  });
  /** Borrowed emulated mounting element; view owns only inserted subtrees. */
  const host = w.document.createElement('div');
  /** Independent fixture/definition preserving tenant and source boundaries. */
  const other = w.document.createElement('div');
  board.append(host, other);
  let disposed = 0;
  /** First synthetic scoped result/store/view; ownership remains explicit. */
  const a = mountReportChart(host, data, {
    pageSize: 2,
    components: {
      /** Trusted synthetic component callback or intentional renderer failure; never a stored definition callback.
       * @param {unknown} node - Explicit synthetic query/callback/options value, never a live credential or arbitrary source.
       * @returns {unknown} Explicit fixture result or intentional failure; no live-provider qualification.
       */
      chart(node) {
        node.textContent = 'Host component';
        return () => disposed++;
      },
    },
  });
  /** Second synthetic scoped result/store/view proving isolation or deterministic ordering. */
  const b = mountReportChart(other, { ...data, id: 'other' });
  // Register fixture ownership before later assertions can fail.
  cleanup('view', () => a.destroy());
  cleanup('view', () => b.destroy());
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('script'), null);
  assert(host.textContent.includes('Partial data'));
  assert.deepEqual(
    validateComponentProps(
      a.element,
      { label: data.title },
      { requireLabel: true }
    ),
    []
  );
  assert.equal(host.querySelectorAll('tbody tr').length, 2);
  /** Find one labeled native control in the finite fixture view.
   * @param {unknown} name - Explicit synthetic value/callback; this fixture never contacts live providers.
   * @returns {unknown} Result of this documented fixture projection or explicit failure.
   */
  const button = (name) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === name);
  button('Sort by value').click();
  assert.equal(host.querySelector('tbody tr td').textContent, '1');
  button('Sort by value').click();
  assert.equal(host.querySelector('tbody tr td').textContent, '3');
  button('Next rows').click();
  assert.equal(host.querySelectorAll('tbody tr').length, 1);
  /** Synthetic invalid value or emulated native input; no operator data. */
  const input = host.querySelector('input');
  input.value = 'beta';
  input.dispatchEvent(new w.Event('input'));
  assert.equal(host.querySelector('tbody th').textContent, 'beta');
  a.element.focus();
  a.element.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
  );
  assert.equal(w.document.activeElement, b.element);
  b.element.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true })
  );
  assert.equal(w.document.activeElement, a.element);
  a.destroy();
  a.destroy();
  b.destroy();
  assert.equal(disposed, 1);
  assert.equal(board.querySelectorAll('.report-view').length, 0);
  dom.window.close();
});
test('empty/unavailable and throwing custom component retain honest states and clean ownership', (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned jsdom environment; ordered teardown releases views before closing its window. */
  const dom = new JSDOM('<main></main>');
  /** Borrowed emulated mounting element; view owns only inserted subtrees. */
  const host = dom.window.document.querySelector('main');
  // Register fixture ownership before later assertions can fail.
  cleanup('environment', () => {
    if (dom.window.document) {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    }
    dom.window.close();
  });
  /** Explicit empty fixture/snapshot, distinct from missing/unavailable data. */
  const empty = mountReportChart(host, {
    ...data,
    labels: [],
    values: [],
    total: 0,
    truncated: false,
    queryMode: 'database',
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('view', () => empty.destroy());
  assert(host.textContent.includes('No data'));
  empty.destroy();
  /** Owned explicit unavailable chart view, never a fictional successful zero. */
  const unavailable = mountReportChart(host, null);
  // Register fixture ownership before later assertions can fail.
  cleanup('view', () => unavailable.destroy());
  assert(host.textContent.includes('unavailable'));
  unavailable.destroy();
  assert.throws(
    () =>
      mountReportChart(host, data, {
        components: {
          /** Trusted synthetic component callback or intentional renderer failure; never a stored definition callback.
           * @returns {unknown} Explicit fixture result or intentional failure; no live-provider qualification.
           */
          chart() {
            throw Error('renderer failed');
          },
        },
      }),
    /renderer failed/
  );
  assert.equal(host.children.length, 0);
  dom.window.close();
});
test('built-in studio uses shared safe view and retains keyboard tables for stored XSS titles', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned jsdom environment; ordered teardown releases views before closing its window. */
  const dom = new JSDOM(reportDashboard('/_reports'), {
    url: 'https://host',
    runScripts: 'outside-only',
  });
  /** Borrowed emulated window, not a live browser. */
  const w = dom.window;
  // Register fixture ownership before later assertions can fail.
  cleanup('environment', () => {
    if (dom.window.document) {
      dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    }
    dom.window.close();
  });
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.fetch = async (url) =>
    new Response(
      JSON.stringify(String(url).includes('/api') ? document() : data),
      { headers: { 'content-type': 'application/json' } }
    );
  w.eval(w.document.querySelector('script').textContent);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.document.querySelector('#charts img'), null);
  assert(
    w.document
      .querySelector('#charts table caption')
      .textContent.includes(chart.title)
  );
  assert(w.document.querySelector('#charts [role=region]'));
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(w.document.querySelectorAll('.report-view').length, 0);
  w.close();
});
test('custom studio remains behind read authorization and failures return private unavailable responses', async () => {
  let calls = 0;
  /** Inert authorized studio facade over synthetic local stores. */
  const runtime = createReports({
    analytics: { events: async () => [] },
    authorize: (r) => r.headers.get('allow') === 'yes',
    /** Throw an intentional private renderer failure after read authorization; it must not enter response text.
     * @returns {never} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    renderDashboard() {
      calls++;
      throw Error('private renderer detail');
    },
  });
  /** Borrowed authenticated handler, not a running server or permission bypass. */
  const route = runtime.routes()[0].handler;
  assert.equal((await route(new Request('https://host/_reports'))).status, 404);
  assert.equal(calls, 0);
  /** Explicit tested projection/receipt; unknown or missing data must not become fake zeroes. */
  const result = await route(
    new Request('https://host/_reports', { headers: { allow: 'yes' } })
  );
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert(!(await result.text()).includes('private renderer detail'));
});
