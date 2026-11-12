import { mountReportChart } from './view.js';
/** Render the code-owned studio program using only a validated mount and the self-contained view factory.
 * Dynamic report data stays behind authenticated endpoints and renders as inert DOM text.
 * The runtime hashes exact emitted scripts/styles; this pure renderer does not grant authorization or set headers.
 * @param {string} prefix - Explicit validated same-origin mount, never an arbitrary endpoint or script string.
 * @returns {string} Built-in trusted HTML/CSS/JavaScript; no server, listener or provider is started.
 */
export function reportDashboard(prefix: string): string {
  if (
    !/^\/[A-Za-z0-9/_-]+$/.test(prefix) ||
    prefix.includes('//') ||
    prefix.endsWith('/')
  ) {
    throw new TypeError('Invalid reports prefix');
  }
  /** Validated mount encoded once as script data; no credential or stored definition is embedded. */
  const p = JSON.stringify(prefix);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Zerux Reports</title>
    <style>
      :root {
        --reports-gap: 14px;
        --reports-border: #8885;
        --reports-radius: 10px;
        --reports-focus: #2563eb;
        --reports-surface: transparent;
        font:
          14px/1.5 system-ui,
          sans-serif;
        color-scheme: light dark;
      }
      body {
        max-width: 1280px;
        margin: auto;
        padding: 24px;
      }
      h1 {
        margin-bottom: 3px;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 18px 0;
      }
      button,
      input,
      select,
      textarea {
        font: inherit;
        padding: 8px 12px;
        border: 1px solid #9998;
        border-radius: 6px;
        background: transparent;
        color: inherit;
      }
      button {
        cursor: pointer;
      }
      input,
      select,
      textarea {
        max-width: 100%;
        box-sizing: border-box;
      }
      textarea {
        width: 100%;
        height: 200px;
        font-family: monospace;
      }
      main {
        display: grid;
        grid-template-columns: minmax(230px, 1fr) 3fr;
        gap: 18px;
      }
      aside,
      article,
      .chart {
        padding: 15px;
        border: 1px solid var(--reports-border);
        border-radius: var(--reports-radius);
      }
      aside label {
        display: block;
        margin: 8px 0;
      }
      aside input,
      aside select {
        width: 100%;
      }
      #charts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: var(--reports-gap);
      }
      .chart {
        min-height: 180px;
      }
      canvas {
        width: 100%;
        height: 200px;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      td,
      th {
        text-align: left;
        padding: 5px;
        border-bottom: 1px solid #8885;
      }
      .hint {
        color: #888;
      }
      .warn {
        color: #b76a00;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      @media (max-width: 720px) {
        main {
          display: block;
        }
        aside {
          margin-bottom: 12px;
        }
      }
      .report-view:focus-visible,
      button:focus-visible,
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible {
        outline: 3px solid var(--reports-focus);
        outline-offset: 3px;
      }
      .report-view {
        background: var(--reports-surface);
        overflow: auto;
      }
      .report-view caption {
        text-align: left;
        font-weight: 600;
      }
      .report-view button {
        margin: 4px;
      }
    </style>
  </head>
  <body>
    <h1>Zerux Reports</h1>
    <p class="hint">
      Internal analytics reporting • authenticated workspace • page &amp; chart
      designer
    </p>
    <nav>
      <button id="reload">Reload</button
      ><button id="newReport">New report</button
      ><button id="newPage">Add page</button
      ><button id="newChart">Add chart</button
      ><button id="save">Save report</button><button id="csv">Export CSV</button
      ><button id="json">Export JSON</button
      ><button id="definitionExport">Export definition</button
      ><label
        >Import definition
        <input
          id="definitionImport"
          type="file"
          accept="application/json,.json"
      /></label>
    </nav>
    <p class="hint">
      A saved report is private to your application-authorized tenant.
      Downloaded exports have their own permission check.
    </p>
    <section aria-label="Report date filters">
      <label>From UTC <input id="since" type="date" /></label>
      <label>To UTC <input id="until" type="date" /></label>
      <button id="refreshCharts">Refresh charts</button>
      <span class="hint"
        >An optional 366-day maximum date window; blank dates use each chart's
        saved filters.</span
      >
    </section>
    <main>
      <aside>
        <label>Report<select id="report"></select></label
        ><label>Page<select id="page"></select></label
        ><label>Report title<input id="reportName" /></label
        ><label>Page title<input id="pageName" /></label>
        <label>Chart<select id="chart"></select></label
        ><label>Chart title<input id="chartTitle" /></label>
        <label
          >Chart type<select id="chartType">
            <option>bar</option>
            <option>horizontal-bar</option>
            <option>line</option>
            <option>area</option>
            <option>pie</option>
            <option>doughnut</option>
            <option>scatter</option>
            <option>stacked-bar</option>
            <option>table</option>
            <option>kpi</option>
          </select></label
        >
        <label
          >Metric<select id="chartMetric">
            <option>count</option>
            <option>sum</option>
            <option>average</option>
            <option>min</option>
            <option>max</option>
            <option>distinct</option>
          </select></label
        >
        <label
          >Group by<input
            id="chartGroupBy"
            placeholder="event, day, source, property:plan"
        /></label>
        <label
          >Numeric value field<input
            id="chartValueField"
            placeholder="price" /></label
        ><label
          >Filter event<input id="chartEvent" placeholder="purchase"
        /></label>
        <button id="deleteChart">Delete chart</button>
        <p class="hint">
          Chart editor (JSON). Types: bar, horizontal-bar, line, area, pie,
          doughnut, scatter, stacked-bar, table, kpi.
        </p>
        <textarea
          id="chartsJson"
          aria-label="Chart definitions JSON"
          spellcheck="false"
        ></textarea
        ><button id="applyCharts">Apply charts</button>
        <p><button id="deletePage">Delete page</button></p>
      </aside>
      <article>
        <h2 id="pageTitle">Report preview</h2>
        <p class="hint" id="notice"></p>
        <div id="charts" data-report-board></div>
      </article>
    </main>
    <section aria-label="Marketing campaign reports">
      <h2>Campaign analytics</h2>
      <p class="hint">
        Optional integration. SMTP acceptance is not inbox delivery; tracking
        events are not unique recipients.
      </p>
      <label>Campaign code <input id="campaignCode" maxlength="96" /></label>
      <label
        >Report
        <select id="campaignKind">
          <option value="delivery">Recipient delivery page</option>
          <option value="performance">
            All-time durable states / provider notices
          </option>
          <option value="daily">Daily outcome trends</option>
          <option value="activity">Observed open / click events</option>
        </select></label
      >
      <button id="loadCampaign">Load campaign</button>
      <button id="nextCampaign">Next recipient page</button>
      <div id="campaignCharts" data-report-board aria-live="polite"></div>
      <p id="campaignNotice" class="hint"></p>
    </section>
    <pre role="status" aria-live="polite" id="status"></pre>
    <script>
      (function () {
        'use strict';
        /** Validated same-origin server mount injected as a safe JSON string, never a client-selected destination. */
        const prefix = ${p};
        /** Resolve only fixed authored control IDs; never query or execute stored selectors.
         * @param {string} id - Explicit fixed control ID, inert status or returned numeric fact.
         * @returns {HTMLElement|null} Explicit local view result without source authorization or side effects.
         */
        const $ = (id) => document.getElementById(id);
        /** Injected self-contained safe view factory; every returned owner is retained for disposal. */
        const mountReportChart = ${mountReportChart.toString()};
        let views = [];
        let previewAbort;
        /** Dispose replaced/disconnected view owners before dropping their handles; do not leave chart listeners attached.
         * @param {HTMLElement} board - Owned chart board whose replaced/disconnected views must be disposed.
         * @returns {void} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function releaseViews(board) {
          views = views.filter((view) => {
            if (board.contains(view.element) || !view.element.isConnected) {
              view.destroy();
              return false;
            }
            return true;
          });
        }
        let doc,
          ridx = 0,
          pidx = 0,
          cidx = 0,
          campaignCursor = null;
        /** Write status as inert textContent, never raw exception HTML.
         * @param {string} s - Explicit fixed control ID, inert status or returned numeric fact.
         * @returns {void} Explicit local view result without source authorization or side effects.
         */
        const say = (s) => ($('status').textContent = s);
        /** Populate real native options using inert text labels; stored names never become markup.
         * @param {HTMLSelectElement} select - Existing labeled native selection control.
         * @param {Array<object>} list - Finite authorized inert saved definitions, never executable callbacks.
         * @param {string} field - Code-owned inert display field name rendered through textContent.
         * @returns {void} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function opt(select, list, field) {
          select.replaceChildren();
          list.forEach((v, i) => {
            /** Owned inert native option element. */
            const el = document.createElement('option');
            el.value = String(i);
            el.textContent = v[field];
            select.append(el);
          });
        }
        /** Read the currently selected draft report; this is local UI state, not server authorization.
         * @returns {object|undefined} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function selected() {
          return doc && doc.reports[ridx];
        }
        /** Read the current draft page without manufacturing a missing document.
         * @returns {object|undefined} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function page() {
          return selected() && selected().pages[pidx];
        }
        /** Read the current draft chart through bounded native control selection.
         * @returns {object|undefined} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function chart() {
          return page()?.charts[cidx];
        }
        /** Fetch an authenticated private definition snapshot, reset selection and render; failures remain visible rather than fictional empty reports.
         * @returns {Promise<void>} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        async function load() {
          try {
            /** Authenticated private Fetch receipt checked before accepting draft/result data. */
            const response = await fetch(prefix + '/api', {
              credentials: 'same-origin',
              cache: 'no-store',
            });
            if (!response.ok) {
              throw Error('HTTP ' + response.status);
            }
            doc = await response.json();
            ridx = 0;
            pidx = 0;
            render();
            say('Reports loaded');
          } catch (e) {
            say('Load failed: ' + e.message);
          }
        }
        /** Refresh inert local controls/layout and start a generation-fenced preview. Editing the draft does not save or publish it.
         * @returns {void} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function render() {
          if (page()?.layout) {
            /** Local presentation-only draft; never modifies query authorization. */
            const layout = page().layout;
            layout.items = layout.items.filter((item) =>
              page().charts.some((c) => c.id === item.chartId),
            );
            // Visit only the finite selected controls/charts; keep server authorization and stale-response fences.
            for (const chart of page().charts) {
              if (!layout.items.some((item) => item.chartId === chart.id)) {
                layout.items.push({ chartId: chart.id, span: 1 });
              }
            }
          }
          opt($('report'), doc.reports, 'name');
          $('report').value = String(ridx);
          opt($('page'), selected()?.pages || [], 'name');
          $('page').value = String(pidx);
          $('reportName').value = selected()?.name || '';
          $('pageName').value = page()?.name || '';
          opt($('chart'), page()?.charts || [], 'title');
          $('chart').value = String(cidx);
          // Visit only the finite selected controls/charts; keep server authorization and stale-response fences.
          for (const [input, key] of [
            ['chartTitle', 'title'],
            ['chartType', 'type'],
            ['chartMetric', 'metric'],
            ['chartGroupBy', 'groupBy'],
            ['chartValueField', 'valueField'],
            ['chartEvent', 'eventName'],
          ]) {
            $('' + input).value = chart()?.[key] || '';
          }
          $('chartsJson').value = JSON.stringify(page()?.charts || [], null, 2);
          void preview();
        }
        $('report').onchange = (e) => {
          ridx = Number(e.target.value);
          pidx = 0;
          cidx = 0;
          render();
        };
        $('page').onchange = (e) => {
          pidx = Number(e.target.value);
          cidx = 0;
          render();
        };
        $('chart').onchange = (e) => {
          cidx = Number(e.target.value);
          render();
        };
        // Visit only the finite selected controls/charts; keep server authorization and stale-response fences.
        for (const [input, key] of [
          ['chartTitle', 'title'],
          ['chartType', 'type'],
          ['chartMetric', 'metric'],
          ['chartGroupBy', 'groupBy'],
          ['chartValueField', 'valueField'],
          ['chartEvent', 'eventName'],
        ]) {
          $('' + input).onchange = (e) => {
            if (!chart()) {
              return;
            }
            if (e.target.value) {
              chart()[key] = e.target.value;
            } else {
              delete chart()[key];
            }
            render();
          };
        }
        $('deleteChart').onclick = () => {
          if (!chart()) {
            return;
          }
          page().charts.splice(cidx, 1);
          cidx = 0;
          render();
        };
        $('reportName').onchange = (e) => {
          if (selected()) {
            selected().name = e.target.value;
            render();
          }
        };
        $('pageName').onchange = (e) => {
          if (page()) {
            page().name = e.target.value;
            render();
          }
        };
        /** Create an ephemeral local draft identifier; server validation/CAS remains authoritative and this ID grants no permission.
         * @param {string} prefix - Code-owned local ID category, not a security or authorization token.
         * @returns {string} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function uid(prefix) {
          return (
            prefix +
            '_' +
            Date.now().toString(36) +
            '_' +
            Math.floor(Math.random() * 9999)
          );
        }
        $('newReport').onclick = () => {
          doc.reports.push({
            id: uid('report'),
            name: 'New report',
            pages: [{ id: uid('page'), name: 'Overview', charts: [] }],
          });
          ridx = doc.reports.length - 1;
          pidx = 0;
          render();
        };
        $('newPage').onclick = () => {
          if (!selected()) {
            return;
          }
          selected().pages.push({ id: uid('page'), name: 'New page', charts: [] });
          pidx = selected().pages.length - 1;
          cidx = 0;
          render();
        };
        $('newChart').onclick = () => {
          if (!page()) {
            return;
          }
          page().charts.push({
            id: uid('chart'),
            title: 'Events',
            type: 'bar',
            groupBy: 'event',
            metric: 'count',
            limit: 100,
          });
          cidx = page().charts.length - 1;
          render();
        };
        $('applyCharts').onclick = async () => {
          try {
            if (!page()) {
              return;
            }
            /** Independent draft definition sent for validation before replacing local state. */
            const candidate = JSON.parse(JSON.stringify(doc));
            /** Local draft page receiving validated inert chart definitions. */
            const selectedPage = candidate.reports[ridx].pages[pidx];
            selectedPage.charts = JSON.parse($('chartsJson').value);
            if (selectedPage.layout) {
              selectedPage.layout.items = selectedPage.layout.items.filter((item) =>
                selectedPage.charts.some((c) => c.id === item.chartId),
              );
              // Visit only the finite selected controls/charts; keep server authorization and stale-response fences.
              for (const chart of selectedPage.charts) {
                if (
                  !selectedPage.layout.items.some((item) => item.chartId === chart.id)
                ) {
                  selectedPage.layout.items.push({ chartId: chart.id, span: 1 });
                }
              }
            }
            /** Authenticated private Fetch receipt checked before accepting draft/result data. */
            const response = await fetch(prefix + '/definition', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                format: 'zerux-report',
                schemaVersion: 1,
                document: candidate,
              }),
            });
            if (!response.ok) {
              throw Error(
                'Definition validation denied or failed: HTTP ' + response.status,
              );
            }
            doc = await response.json();
            cidx = 0;
            render();
            say('Validated chart definitions; Save to persist.');
          } catch (e) {
            say('Invalid definition: ' + e.message);
          }
        };
        $('deletePage').onclick = () => {
          if (!selected() || !page()) {
            return;
          }
          selected().pages.splice(pidx, 1);
          pidx = 0;
          render();
        };
        $('reload').onclick = load;
        $('refreshCharts').onclick = () => void preview();
        /** Validate paired bounded UTC date controls before query/export; blank controls retain saved filters.
         * @returns {object|null} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function dateWindow() {
          /** First UTC date control value; paired range validation precedes request work. */
          const a = $('since').value;
          /** Final UTC date control value; paired range validation precedes request work. */
          const b = $('until').value;
          if (!a && !b) {
            return null;
          }
          if (!a || !b) {
            throw Error('Select both UTC dates');
          }
          /** Validated UTC start epoch, never subject identity. */
          const since = Date.parse(a + 'T00:00:00.000Z');
          /** Validated inclusive UTC final epoch. */
          const until = Date.parse(b + 'T23:59:59.999Z');
          if (
            !Number.isFinite(since) ||
            !Number.isFinite(until) ||
            until < since ||
            until - since > 366 * 86400000
          ) {
            throw Error('UTC range must be within 366 days');
          }
          return { since, until };
        }
        /** Apply only validated local UTC bounds to a code-owned same-origin endpoint.
         * @param {URL} url - Same-origin code-owned report endpoint receiving only validated date filters.
         * @returns {void} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function applyWindow(url) {
          /** Explicit local UTC bounds; no saved definition mutation. */
          const filter = dateWindow();
          if (filter) {
            url.searchParams.set('since', String(filter.since));
            url.searchParams.set('until', String(filter.until));
          }
        }
        /** Navigate to the separately authorized server export; local filter visibility never grants export permission.
         * @param {string} format - Code-owned csv/json export choice; server still authorizes every export.
         * @returns {void} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function exportFile(format) {
          try {
            if (!page()) {
              throw Error('Select a report page');
            }
            /** Code-owned same-origin query/export/campaign URL; server reauthorizes every operation. */
            const url = new URL(prefix + '/export', location.origin);
            url.searchParams.set('report', selected().id);
            url.searchParams.set('page', page().id);
            url.searchParams.set('format', format);
            applyWindow(url);
            window.location.assign(url.toString());
            say(
              'Requesting ' +
                format.toUpperCase() +
                ' export (requires export permission)',
            );
          } catch (e) {
            say('Export unavailable: ' + e.message);
          }
        }
        $('csv').onclick = () => exportFile('csv');
        $('json').onclick = () => exportFile('json');
        $('definitionExport').onclick = () => location.assign(prefix + '/definition');
        $('definitionImport').onchange = async (event) => {
          try {
            /** Explicit local definition file with a finite256 KiB budget; never executable code. */
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            if (file.size > 262144) {
              throw Error('Definition exceeds 256 KiB');
            }
            /** Authenticated private Fetch receipt checked before accepting draft/result data. */
            const response = await fetch(prefix + '/definition', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: await file.text(),
            });
            if (!response.ok) {
              throw Error('Import denied or invalid: HTTP ' + response.status);
            }
            doc = await response.json();
            ridx = pidx = cidx = 0;
            render();
            say(
              'Definition validated. Review, then Save to apply with current revision.',
            );
          } catch (error) {
            say(error.message);
          } finally {
            event.target.value = '';
          }
        };

        let campaignGeneration = 0,
          campaignAbort;
        /** Cancel the preceding campaign read and fence stale results. Render only authorized aggregate coverage; an opaque cursor is not recipient identity.
         * @param {boolean} next - Default false; true uses the existing opaque recipient-page continuation.
         * @returns {Promise<void>} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        async function loadCampaign(next = false) {
          /** Current request generation token fencing old responses after replacement. */
          const generation = ++campaignGeneration;
          campaignAbort?.abort();
          campaignAbort = new AbortController();
          /** Owned cooperative Fetch cancellation signal for this exact preview/campaign read. */
          const signal = campaignAbort.signal;
          try {
            /** Validated opaque campaign reference; host still enforces campaign/tenant permission. */
            const code = $('campaignCode').value;
            /** Fixed authored campaign-kind control, revalidated on the server. */
            const kind = $('campaignKind').value;
            if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(code)) {
              throw Error('Invalid campaign code');
            }
            if (!next) {
              campaignCursor = null;
            }
            /** Code-owned same-origin query/export/campaign URL; server reauthorizes every operation. */
            const url = new URL(prefix + '/campaign', location.origin);
            url.searchParams.set('code', code);
            url.searchParams.set('kind', kind);
            if (kind === 'delivery' && campaignCursor) {
              url.searchParams.set('cursor', campaignCursor);
            }
            if (kind === 'daily' || kind === 'activity') {
              /** First UTC date control value; paired range validation precedes request work. */
              const a = $('since').value;
              /** Final UTC date control value; paired range validation precedes request work. */
              const b = $('until').value;
              if (!a || !b) {
                throw Error('Choose both campaign UTC dates');
              }
              url.searchParams.set('from', a);
              url.searchParams.set('to', b);
            }
            /** Authenticated private Fetch receipt checked before accepting draft/result data. */
            const response = await fetch(url, {
              credentials: 'same-origin',
              cache: 'no-store',
              signal,
            });
            /** Authorized normalized result/durable receipt, not a raw provider blob. */
            const result = await response.json();
            if (generation !== campaignGeneration) {
              return;
            }
            if (!response.ok) {
              throw Error(result.error || response.status);
            }
            /** Owned report/campaign output board whose views are disposed on replacement. */
            const board = $('campaignCharts');
            releaseViews(board);
            board.replaceChildren();
            /** Finite authorized campaign chart projections; missing providers stay absent. */
            const values = (() => {
              if (result.charts) {
                return Object.values(result.charts);
              } else {
                if (result.activity) {
                  return [result.activity];
                } else {
                  if (result.statuses) {
                    return [result.statuses];
                  } else {
                    return [];
                  }
                }
              }
            })();
            // Visit only the finite selected controls/charts; keep server authorization and stale-response fences.
            for (const item of values) {
              if (!item) {
                continue;
              }
              /** Owned inert chart container preserving the shared table alternative. */
              const section = document.createElement('section');
              section.className = 'chart';
              /** Owned authored label inserted with textContent. */
              const title = document.createElement('h3');
              title.textContent = item.title;
              section.append(title);
              draw(section, item);
              board.append(section);
            }
            campaignCursor = kind === 'delivery' ? result.coverage.nextCursor : null;
            $('nextCampaign').disabled = !campaignCursor;
            $('campaignNotice').textContent =
              kind === 'delivery'
                ? result.coverage.disclaimer +
                  ' Page size: ' +
                  result.coverage.scanned +
                  '; scope: ' +
                  result.coverage.scope
                : result.disclaimer || JSON.stringify(result.coverage || {});
            say('Campaign report loaded');
          } catch (e) {
            if (generation !== campaignGeneration) {
              return;
            }
            say('Campaign report unavailable: ' + e.message);
          }
        }
        $('loadCampaign').onclick = () => void loadCampaign();
        $('nextCampaign').onclick = () => void loadCampaign(true);
        $('campaignKind').onchange = () => {
          campaignCursor = null;
          $('nextCampaign').disabled = true;
        };
        $('nextCampaign').disabled = true;
        $('save').onclick = async () => {
          try {
            /** Copied next CAS draft; incrementing locally never overrides a server conflict. */
            const next = JSON.parse(JSON.stringify(doc));
            next.version++;
            /** Private save receipt; unsuccessful persistence never replaces the authoritative revision. */
            const res = await fetch(prefix + '/api', {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(next),
            });
            /** Authorized normalized result/durable receipt, not a raw provider blob. */
            const result = await res.json();
            if (!res.ok) {
              throw Error(result.error || res.status);
            }
            doc = next;
            render();
            say('Saved version ' + next.version);
          } catch (e) {
            say('Save failed: ' + e.message);
          }
        };
        let previewGeneration = 0;
        /** Cancel stale previews, dispose old views and render at most12 authorized chart requests. Coverage/unavailable states remain explicit.
         * @returns {Promise<void>} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        async function preview() {
          /** Current request generation token fencing old responses after replacement. */
          const generation = ++previewGeneration;
          previewAbort?.abort();
          previewAbort = new AbortController();
          /** Owned cooperative Fetch cancellation signal for this exact preview/campaign read. */
          const signal = previewAbort.signal;
          /** Owned report/campaign output board whose views are disposed on replacement. */
          const board = $('charts');
          releaseViews(board);
          board.replaceChildren();
          $('pageTitle').textContent = page()?.name || 'No page';
          $('notice').textContent = '';
          if (!page()) {
            $('notice').textContent = 'No report page selected.';
            return;
          }
          if (!page().charts.length) {
            $('notice').textContent =
              'No charts yet. Add a chart or import a definition.';
          }
          if (page().layout) {
            board.style.gridTemplateColumns =
              'repeat(' + page().layout.columns + ',minmax(0,1fr))';
          } else {
            board.style.gridTemplateColumns = '';
          }
          if (page().charts.length > 12) {
            $('notice').textContent =
              'Preview is limited to the first 12 charts to protect database performance.';
          }
          // Visit only the finite selected controls/charts; keep server authorization and stale-response fences.
          for (const chart of (page().layout
            ? page()
                .layout.items.map((item) =>
                  page().charts.find((c) => c.id === item.chartId),
                )
                .filter(Boolean)
            : page().charts
          ).slice(0, 12)) {
            /** Owned inert chart container preserving the shared table alternative. */
            const section = document.createElement('div');
            section.className = 'chart';
            /** Presentation span for the exact current page chart; not an arbitrary style expression. */
            const slot = page().layout?.items.find(
              (item) => item.chartId === chart.id,
            );
            if (slot) {
              section.style.gridColumn = 'span ' + slot.span;
            }
            /** Owned inert chart heading/KPI element. */
            const h = document.createElement('h3');
            h.textContent = chart.title;
            section.append(h);
            board.append(section);
            try {
              /** Code-owned same-origin query/export/campaign URL; server reauthorizes every operation. */
              const url = new URL(prefix + '/query', location.origin);
              url.searchParams.set('report', selected().id);
              url.searchParams.set('page', page().id);
              url.searchParams.set('chart', chart.id);
              applyWindow(url);
              /** Authenticated private Fetch receipt checked before accepting draft/result data. */
              const response = await fetch(url, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal,
              });
              if (!response.ok) {
                throw Error('HTTP ' + response.status);
              }
              /** Authorized normalized result/durable receipt, not a raw provider blob. */
              const result = await response.json();
              if (generation !== previewGeneration) {
                return;
              }
              if (
                ['pie', 'doughnut'].includes(chart.type) &&
                result.values.some((v) => v < 0)
              ) {
                /** Owned explicit partial/indexed/negative-value notice, never invented source totals. */
                const note = document.createElement('p');
                note.className = 'warn';
                note.textContent =
                  'Pie and doughnut charts cannot display negative values. Choose bar, line or table.';
                section.append(note);
                views.push(mountReportChart(section, result));
                continue;
              }
              if (result.truncated || result.queryMode === 'materialized') {
                /** Owned explicit partial/indexed/negative-value notice, never invented source totals. */
                const note = document.createElement('p');
                note.className = 'warn';
                note.textContent = (() => {
                  if (result.queryMode === 'materialized') {
                    return (
                      'Indexed numeric facts only (' +
                      result.matchedFacts +
                      ' matching facts); older or failed writes may be missing.' +
                      (result.truncated ? ' Group display limited.' : '')
                    );
                  } else {
                    if (result.queryMode === 'database') {
                      return 'Group display limited; total is a database event count.';
                    } else {
                      return (
                        'Sampled at most ' +
                        result.sampledRows +
                        ' source events; not a complete aggregate.'
                      );
                    }
                  }
                })();
                section.append(note);
              }
              draw(section, result);
            } catch (e) {
              if (generation !== previewGeneration) {
                return;
              }
              /** Owned inert unavailable message element; no raw HTML interpolation. */
              const error = document.createElement('p');
              error.textContent = 'Query unavailable: ' + e.message;
              section.append(error);
              views.push(mountReportChart(section, null));
            }
          }
        }
        /** Retain the shared labeled table for every chart; canvas is supplementary and hidden from assistive technology. Values/titles are never executed as markup.
         * @param {HTMLElement} section - Owned output slot retaining the common semantic table alternative.
         * @param {object} d - Authorized finite ChartData projection; view validation runs before canvas drawing.
         * @returns {void} Explicit local UI result; server-side permissions and source coverage remain authoritative.
         */
        function draw(section, d) {
          views.push(
            mountReportChart(section, d, {
              timeZone: page()?.layout?.timeZone || 'UTC',
            }),
          );
          /** Finite returned display labels retained alongside numeric data. */
          const labels = d.labels || [];
          /** Finite returned numeric values, not arbitrary expressions or missing backend groups. */
          const v = d.values || [];
          if (d.type === 'kpi') {
            /** Owned inert chart heading/KPI element. */
            const h = document.createElement('h1');
            h.textContent = Number(d.total).toLocaleString();
            section.append(h);
            return;
          }
          if (d.type === 'table') {
            return;
          }
          /** Owned supplementary canvas hidden from assistive technology; table remains available. */
          const canvas = document.createElement('canvas');
          canvas.setAttribute('aria-hidden', 'true');
          canvas.width = 640;
          canvas.height = 320;
          section.append(canvas);
          /** Native drawing context; missing support keeps the semantic table usable. */
          const c = canvas.getContext('2d');
          if (!c) {
            return;
          }
          /** Fixed code-owned chart colors; host override policy stays explicit. */
          const palette = [
            '#2563eb',
            '#0891b2',
            '#d97706',
            '#059669',
            '#9333ea',
            '#dc2626',
            '#4f46e5',
            '#64748b',
          ];
          c.font = '12px sans-serif';
          c.fillStyle = '#777';
          if (d.type === 'pie' || d.type === 'doughnut') {
            let angle = -Math.PI / 2;
            /** Finite drawing denominator for nonnegative pie values; not a population/conformance claim. */
            const total = v.reduce((a, b) => a + Math.max(0, b), 0) || 1;
            v.slice(0, 15).forEach((value, i) => {
              /** Supplementary bounded pie segment angle from returned values. */
              const sweep = (Math.PI * 2 * Math.max(0, value)) / total;
              c.beginPath();
              c.moveTo(210, 155);
              c.arc(210, 155, 125, angle, angle + sweep);
              c.closePath();
              c.fillStyle = palette[i % palette.length];
              c.fill();
              angle += sweep;
            });
            if (d.type === 'doughnut') {
              c.beginPath();
              c.arc(210, 155, 62, 0, Math.PI * 2);
              c.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
              c.fill();
            }
            labels.slice(0, 8).forEach((l, i) => {
              c.fillStyle = palette[i % palette.length];
              c.fillRect(370, 20 + i * 28, 12, 12);
              c.fillStyle = '#888';
              c.fillText(String(l).slice(0, 25), 390, 31 + i * 28);
            });
            return;
          }
          /** Returned-value plot floor including zero; no data/source mutation. */
          const lowest = Math.min(0, ...v);
          /** Returned-value plot ceiling including zero. */
          const highest = Math.max(0, ...v);
          /** Nonzero visual range preventing division by zero. */
          const range = Math.max(1, highest - lowest);
          /** Returned-value visual count, not matched source population. */
          const count = Math.max(v.length, 1);
          /** Fixed plot width per returned group. */
          const w = 520 / count;
          /** Map one finite returned numeric value into supplementary canvas coordinates.
           * @param {number} value - Explicit fixed control ID, inert status or returned numeric fact.
           * @returns {number} Explicit local view result without source authorization or side effects.
           */
          const yValue = (value) => 278 - (230 * (value - lowest)) / range;
          /** Supplementary canvas baseline; table numbers remain exact returned values. */
          const zeroY = yValue(0);
          c.strokeStyle = '#aaa';
          c.beginPath();
          c.moveTo(50, zeroY);
          c.lineTo(610, zeroY);
          c.stroke();
          if (d.type === 'horizontal-bar') {
            /** Bounded supplementary horizontal-bar row height. */
            const height = Math.min(28, 240 / Math.max(1, count));
            /** Supplementary horizontal canvas baseline. */
            const zeroX = 145 + (430 * -lowest) / range;
            v.slice(0, 30).forEach((value, i) => {
              /** Supplementary returned-value plot coordinate. */
              const y = 12 + i * height;
              /** Supplementary returned-value plot coordinate. */
              const x = 145 + (430 * (value - lowest)) / range;
              c.fillStyle = palette[i % palette.length];
              c.fillRect(
                Math.min(zeroX, x),
                y,
                Math.abs(x - zeroX),
                Math.max(2, height - 4),
              );
              c.fillStyle = '#888';
              c.fillText(String(labels[i]).slice(0, 18), 4, y + height - 5);
            });
            return;
          }
          if (d.type === 'line' || d.type === 'area' || d.type === 'scatter') {
            c.strokeStyle = palette[0];
            c.fillStyle = palette[0];
            c.beginPath();
            v.forEach((value, i) => {
              /** Supplementary returned-value plot coordinate. */
              const x = 65 + i * (520 / Math.max(1, count - 1));
              /** Supplementary returned-value plot coordinate. */
              const y = yValue(value);
              if (i === 0) {
                c.moveTo(x, y);
              } else {
                c.lineTo(x, y);
              }
            });
            if (d.type === 'area') {
              c.lineTo(65 + (count - 1) * (520 / Math.max(1, count - 1)), zeroY);
              c.lineTo(65, zeroY);
              c.closePath();
              c.globalAlpha = 0.2;
              c.fillStyle = palette[0];
              c.fill();
              c.globalAlpha = 1;
            }
            if (d.type !== 'scatter') {
              c.stroke();
            }
            v.forEach((value, i) => {
              /** Supplementary returned-value plot coordinate. */
              const x = 65 + i * (520 / Math.max(1, count - 1));
              /** Supplementary returned-value plot coordinate. */
              const y = yValue(value);
              c.beginPath();
              c.arc(x, y, 3, 0, Math.PI * 2);
              c.fill();
            });
          } else {
            v.forEach((value, i) => {
              c.fillStyle = palette[i % palette.length];
              /** Supplementary returned-value plot coordinate. */
              const y = yValue(value);
              c.fillRect(
                60 + i * w,
                Math.min(zeroY, y),
                Math.max(2, w - 5),
                Math.abs(zeroY - y),
              );
            });
          }
          c.fillStyle = '#888';
          labels
            .slice(0, 8)
            .forEach((l, i) =>
              c.fillText(
                String(l).slice(0, 13),
                60 + i * (520 / Math.max(1, Math.min(count, 8))),
                304,
              ),
            );
        }
        window.addEventListener('pagehide', () => {
          previewGeneration++;
          previewAbort?.abort();
          campaignGeneration++;
          campaignAbort?.abort();
          // Visit only the finite selected controls/charts; keep server authorization and stale-response fences.
          for (const view of views) {
            view.destroy();
          }
          views = [];
        });
        window.addEventListener('pageshow', (event) => {
          if (event.persisted) {
            void preview();
          }
        });
        load();
      })();
    </script>
  </body>
</html>
`;
}
