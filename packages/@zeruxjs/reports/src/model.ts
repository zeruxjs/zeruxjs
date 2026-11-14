import { validateReportLayout } from './layout.js';
import type {
  ReportsDocument,
  ReportsStore,
  ChartDefinition,
  ChartData,
  AnalyticsReportSource,
  Metric,
} from './types.js';
/** Conservative inert ID syntax shared across stored definitions and source names. */
const ident = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
/** Prototype-sensitive ID parts rejected independently of chart display text. */
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
/** Finite supported inert chart-kind vocabulary, not arbitrary renderer code. */
const chartTypes = [
  'bar',
  'horizontal-bar',
  'line',
  'area',
  'pie',
  'doughnut',
  'scatter',
  'stacked-bar',
  'table',
  'kpi',
];
/** Finite supported metric vocabulary; exactness depends on the selected query path. */
const metrics = ['count', 'sum', 'average', 'min', 'max', 'distinct'];
/** Validate inert IDs and forbidden segments without granting permissions.
 * @param {unknown} v - Inert value under bounded recursive validation.
 * @returns {boolean} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
export const isReportId = (v: unknown): v is string =>
  typeof v === 'string' &&
  ident.test(v) &&
  !v.split(/[.:-]/).some((k) => forbidden.has(k));
/** Reject executable/accessor/class/cyclic definitions and bound depth/nodes/text/final JSON before domain validation. Optional undefined fields may be omitted by JSON; this is not an arbitrary object codec.
 * @param {unknown} value - Unknown definition container/value; inspect descriptors instead of invoking accessors.
 * @returns {void} Explicit validated result or source failure; exactness and authorization remain separate contracts.
 */
function inertDefinition(value: unknown) {
  let nodes = 0,
    textBytes = 0;
  /** Local UTF-8 accounting utility; no source modules are executed. */
  const encoder = new TextEncoder();
  /** Active container ancestors rejecting cycles while allowing shared noncyclic objects. */
  const ancestors = new Set<object>();
  /** Accumulate bounded UTF-8 definition text before complete JSON-size verification.
   * @param {string} s - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const charge = (s: string) => {
    textBytes += encoder.encode(s).byteLength;
    if (textBytes > 262144) {
      throw new RangeError('Report definition text exceeds 256 KiB');
    }
  };
  /** Inspect only own data descriptors within the finite definition budget; never evaluate a getter to discover data.
   * @param {unknown} v - One inert definition value, including omitted optional undefined fields.
   * @param {number} depth - Current recursive depth; maximum12 and20000 visited nodes.
   * @returns {void} Explicit validated result or source failure; exactness and authorization remain separate contracts.
   */
  function walk(v: unknown, depth: number) {
    if (++nodes > 20000 || depth > 12) {
      throw new RangeError('Report definition complexity exceeds limit');
    }
    if (v === undefined || v === null || typeof v === 'boolean') {
      return;
    }
    if (typeof v === 'string') {
      if (v.length > 262144) {
        throw new RangeError('Report text exceeds limit');
      }
      charge(v);
      return;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return;
    }
    if (typeof v !== 'object' || ancestors.has(v)) {
      throw new TypeError('Reports require inert JSON');
    }
    if (
      !Array.isArray(v) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    ) {
      throw new TypeError('Reports require plain objects');
    }
    ancestors.add(v);
    // Stay within validated definition/sample bounds; source scope and coverage remain explicit.
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') {
        continue;
      }
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        throw new TypeError('Invalid report key');
      }
      charge(key);
      /** Own descriptor checked without invoking accessors. */
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in d)) {
        throw new TypeError('Report accessors are forbidden');
      }
      walk(d.value, depth + 1);
    }
    ancestors.delete(v);
  }
  walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 262144) {
    throw new RangeError('Report definition exceeds 256 KiB');
  }
}
/** Reject unknown own field names at this definition level; allowed names do not grant source authorization.
 * @param {object} value - Unknown definition container/value; inspect descriptors instead of invoking accessors.
 * @param {readonly string[]} allowed - Finite allowed own field names for this definition level.
 * @returns {void} Explicit validated result or source failure; exactness and authorization remain separate contracts.
 */
function keys(value: object, allowed: readonly string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) {
    throw new TypeError('Unknown report definition field');
  }
}
/** Validate inert bounded document/report/page/chart/layout fields and global IDs before returning a fresh clone. Import/save validation never publishes or grants access.
 * @param {unknown} input - Unknown document validated before cloning, saving or importing.
 * @returns {ReportsDocument} Explicit validated result or source failure; exactness and authorization remain separate contracts.
 */
export function validateReports(input: unknown): ReportsDocument {
  inertDefinition(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid reports document');
  }
  /** Unknown input narrowed only after inert/domain checks; returned state is cloned. */
  const doc = input as ReportsDocument;
  keys(doc, ['version', 'reports']);
  if (
    !Number.isSafeInteger(doc.version) ||
    doc.version < 1 ||
    !Array.isArray(doc.reports) ||
    doc.reports.length > 100
  ) {
    throw new TypeError('Invalid reports version or size');
  }
  /** Document-wide unique report/page/chart IDs; conflicts reject before acceptance. */
  const ids = new Set<string>();
  /** Validate and reserve one ID within this candidate, not a persistent global namespace.
   * @param {string} id - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const unique = (id: string) => {
    if (!isReportId(id) || ids.has(id)) {
      throw new TypeError('Invalid or repeated report ID');
    }
    ids.add(id);
  };
  // Stay within validated definition/sample bounds; source scope and coverage remain explicit.
  for (const report of doc.reports) {
    if (!report || typeof report !== 'object') {
      throw new TypeError('Invalid report');
    }
    keys(report, ['id', 'name', 'description', 'pages']);
    unique(report.id);
    if (
      typeof report.name !== 'string' ||
      report.name.length < 1 ||
      report.name.length > 128 ||
      (report.description !== undefined &&
        (typeof report.description !== 'string' ||
          report.description.length > 1024)) ||
      !Array.isArray(report.pages) ||
      report.pages.length > 50
    ) {
      throw new TypeError('Invalid report');
    }
    // Stay within validated definition/sample bounds; source scope and coverage remain explicit.
    for (const page of report.pages) {
      if (!page || typeof page !== 'object') {
        throw new TypeError('Invalid page');
      }
      keys(page, ['id', 'name', 'charts', 'layout']);
      unique(page.id);
      if (
        typeof page.name !== 'string' ||
        page.name.length < 1 ||
        page.name.length > 128 ||
        !Array.isArray(page.charts) ||
        page.charts.length > 50
      ) {
        throw new TypeError('Invalid report page');
      }
      if (page.layout !== undefined) {
        validateReportLayout(page.layout, page);
      }
      // Stay within validated definition/sample bounds; source scope and coverage remain explicit.
      for (const chart of page.charts) {
        if (!chart || typeof chart !== 'object') {
          throw new TypeError('Invalid chart');
        }
        keys(chart, [
          'id',
          'title',
          'type',
          'groupBy',
          'metric',
          'valueField',
          'eventName',
          'source',
          'site',
          'since',
          'until',
          'limit',
        ]);
        unique(chart.id);
        if (
          typeof chart.title !== 'string' ||
          chart.title.length < 1 ||
          chart.title.length > 128 ||
          !chartTypes.includes(chart.type) ||
          !metrics.includes(chart.metric) ||
          (!['event', 'day', 'source', 'site', 'pathname'].includes(
            chart.groupBy
          ) &&
            !/^property:[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(chart.groupBy)) ||
          (chart.groupBy.startsWith('property:') &&
            !isReportId(chart.groupBy.slice(9)))
        ) {
          throw new TypeError('Invalid chart');
        }

        if (
          (chart.valueField !== undefined && !isReportId(chart.valueField)) ||
          (chart.eventName !== undefined && !isReportId(chart.eventName)) ||
          (chart.source !== undefined &&
            !['web', 'server', 'email', 'system'].includes(chart.source)) ||
          (chart.site !== undefined &&
            (typeof chart.site !== 'string' ||
              chart.site.length > 200 ||
              // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
              /[\x00-\x1f]/.test(chart.site))) ||
          (chart.limit !== undefined &&
            (!Number.isSafeInteger(chart.limit) ||
              chart.limit < 1 ||
              chart.limit > 500)) ||
          ['since', 'until'].some((k) => {
            /** Optional saved time bound checked as a safe nonnegative integer. */
            const n = chart[k as 'since' | 'until'];
            return n !== undefined && (!Number.isSafeInteger(n) || n < 0);
          }) ||
          (chart.since !== undefined &&
            chart.until !== undefined &&
            chart.since > chart.until)
        ) {
          throw new TypeError('Invalid chart query');
        }
      }
    }
  }
  return structuredClone(doc);
}
/** Keep a cloned validated CAS document in this process only. Local revision checks do not supply durable/distributed locks or retention.
 * @param {ReportsDocument} initial - Optional initial document, default version1/empty; this store is process-local only.
 * @returns {ReportsStore} Explicit validated result or source failure; exactness and authorization remain separate contracts.
 */
export function createMemoryReportsStore(
  initial: ReportsDocument = { version: 1, reports: [] }
): ReportsStore {
  let current = validateReports(initial);
  return {
    /** Return a fresh clone of the current private process-local document.
     * @returns {Promise<ReportsDocument>} Explicit validated result or source failure; exactness and authorization remain separate contracts.
     */
    async load() {
      return structuredClone(current);
    },
    /** Accept only the exact next local revision, validate it before replacing state and return false on conflict. No partial write occurs on validation failure.
     * @param {ReportsDocument} next - Validated next document whose version must equal expected+1.
     * @param {number} expected - Required optimistic current local revision; stale writes return false.
     * @returns {Promise<boolean>} Explicit validated result or source failure; exactness and authorization remain separate contracts.
     */
    async save(next, expected) {
      if (expected !== current.version || next.version !== expected + 1) {
        return false;
      }
      current = validateReports(next);
      return true;
    },
  };
}
interface Item {
  /** Bounded display group label from the authorized source; never executable markup. */
  category: string;
  /** Metric value whose provenance is native, materialized or sampled as declared. */
  value: number;
}
/** Validate a chart and use supported native count/indexed numeric paths or a bounded raw sample. Preserve trusted site scope, provenance and hidden-group limits; no source failure becomes fabricated zero data.
 * @param {AnalyticsReportSource} source - Borrowed analytics query facade; host authorizes its scope and owns connector lifetime.
 * @param {ChartDefinition} chart - Inert validated chart definition; no executable SQL/JavaScript expression.
 * @param {number} maxSourceRows - Default500, validated1–500 raw sample rows; native query modes have separate coverage.
 * @param {string} site - Optional trusted host-enforced site overriding a chart-authored site filter.
 * @returns {Promise<ChartData>} Explicit validated result or source failure; exactness and authorization remain separate contracts.
 */
export async function queryChart(
  source: AnalyticsReportSource,
  chart: ChartDefinition,
  maxSourceRows = 500,
  site?: string
): Promise<ChartData> {
  if (
    !Number.isSafeInteger(maxSourceRows) ||
    maxSourceRows < 1 ||
    maxSourceRows > 500
  ) {
    throw new RangeError('Invalid source row limit');
  }
  // Direct programmatic callers receive the same chart validation as editor-saved definitions.
  /** Synthetic validation-only report ID chosen to avoid colliding with the chart. */
  const reportId =
    chart.id === 'ReportValidation'
      ? 'ReportValidationTwo'
      : 'ReportValidation';
  /** Synthetic validation-only page ID chosen to avoid colliding with chart/report. */
  const pageId = [chart.id, reportId].includes('PageValidation')
    ? 'PageValidationTwo'
    : 'PageValidation';
  validateReports({
    version: 1,
    reports: [
      {
        id: reportId,
        name: 'Validation',
        pages: [{ id: pageId, name: 'Preview', charts: [chart] }],
      },
    ],
  });
  /** Validated finite raw sample limit; never request an unbounded event table. */
  const take = Math.min(chart.limit ?? maxSourceRows, maxSourceRows);
  /** Trusted host site takes precedence over a chart-authored filter. */
  const scopedSite = site ?? chart.site;
  if (
    chart.metric === 'count' &&
    typeof source.aggregate === 'function' &&
    (['event', 'source', 'site', 'pathname'].includes(chart.groupBy) ||
      (chart.groupBy === 'day' &&
        chart.since !== undefined &&
        chart.until !== undefined))
  ) {
    /** Native count/numeric aggregate receipt checked before output; not a raw provider blob. */
    const result = await source.aggregate({
      groupBy: chart.groupBy as
        | 'event'
        | 'source'
        | 'site'
        | 'pathname'
        | 'day',
      name: chart.eventName,
      source: chart.source,
      site: scopedSite,
      since: chart.since,
      until: chart.until,
      limit: chart.limit ?? 100,
    });
    if (
      result.mode !== 'database' ||
      result.groupBy !== chart.groupBy ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      typeof result.truncated !== 'boolean' ||
      !Array.isArray(result.groups) ||
      result.groups.length > (chart.limit ?? 100) ||
      result.groups.some(
        (g) =>
          typeof g.category !== 'string' ||
          g.category.length > 150 ||
          !Number.isSafeInteger(g.value) ||
          g.value < 0
      ) ||
      result.groups.reduce((n, g) => n + g.value, 0) > result.total
    ) {
      throw new Error('Invalid native report count result');
    }
    /** Ordered bounded projection; UTC day labels retain chronological order. */
    const output =
      chart.groupBy === 'day'
        ? [...result.groups].sort((a, b) =>
            a.category.localeCompare(b.category)
          )
        : result.groups;
    /** At most60 display groups; hidden groups remain explicit truncation metadata. */
    const visible = output.slice(0, 60);
    return {
      id: chart.id,
      title: chart.title,
      type: chart.type,
      labels: visible.map((g) => g.category),
      values: visible.map((g) => g.value),
      total: result.total,
      sampledRows: 0,
      truncated: result.truncated || output.length > 60,
      queryMode: 'database',
      coverage: 'exact-persisted-event-count',
    };
  }
  if (
    chart.metric !== 'count' &&
    chart.metric !== 'distinct' &&
    chart.valueField &&
    typeof source.aggregateNumeric === 'function' &&
    (typeof source.supportsNumericField !== 'function' ||
      source.supportsNumericField(chart.valueField)) &&
    (['event', 'source', 'site', 'pathname'].includes(chart.groupBy) ||
      (chart.groupBy === 'day' &&
        chart.since !== undefined &&
        chart.until !== undefined))
  ) {
    /** Native count/numeric aggregate receipt checked before output; not a raw provider blob. */
    const result = await source.aggregateNumeric({
      groupBy: chart.groupBy as
        | 'event'
        | 'source'
        | 'site'
        | 'pathname'
        | 'day',
      metric: chart.metric,
      valueField: chart.valueField,
      name: chart.eventName,
      source: chart.source,
      site: scopedSite,
      since: chart.since,
      until: chart.until,
      limit: chart.limit ?? 100,
    });
    if (
      result.mode !== 'materialized' ||
      result.groupBy !== chart.groupBy ||
      result.metric !== chart.metric ||
      result.valueField !== chart.valueField ||
      result.coverage !== 'indexed-only' ||
      typeof result.truncated !== 'boolean' ||
      !Number.isSafeInteger(result.matchedFacts) ||
      result.matchedFacts < 0 ||
      !Number.isFinite(result.total) ||
      !Array.isArray(result.groups) ||
      result.groups.length > (chart.limit ?? 100) ||
      result.groups.some(
        (g) =>
          typeof g.category !== 'string' ||
          g.category.length > 150 ||
          !Number.isFinite(g.value)
      )
    ) {
      throw new Error('Invalid indexed numeric report result');
    }
    /** Ordered bounded projection; UTC day labels retain chronological order. */
    const output =
      chart.groupBy === 'day'
        ? [...result.groups].sort((a, b) =>
            a.category.localeCompare(b.category)
          )
        : result.groups;
    /** At most60 display groups; hidden groups remain explicit truncation metadata. */
    const visible = output.slice(0, 60);
    return {
      id: chart.id,
      title: chart.title,
      type: chart.type,
      labels: visible.map((g) => g.category),
      values: visible.map((g) => g.value),
      total: result.total,
      sampledRows: 0,
      truncated: result.truncated || output.length > 60,
      queryMode: 'materialized',
      numericCoverage: result.coverage,
      matchedFacts: result.matchedFacts,
      coverage: 'indexed-numeric-facts-only',
    };
  }
  /** At most the requested raw source sample; source must honor enforced site scope. */
  const rows = await source.events({
    name: chart.eventName,
    source: chart.source,
    site: scopedSite,
    since: chart.since,
    until: chart.until,
    limit: take,
  });
  if (!Array.isArray(rows) || rows.length > take) {
    throw new Error('Source returned more than the bounded event page');
  }
  /** Bounded sample group accumulators; no later arbitrary dropping hides source cardinality. */
  const groups = new Map<
    string,
    {
      /** Number of valid sampled events in this group. */
      count: number;
      /** Number of finite numeric facts included in sampled arithmetic; missing values do not inflate averages. */
      numericCount: number;
      /** Sum of actual finite numeric facts from the bounded sample. */
      sum: number;
      /** Smallest finite sampled value, initialized internally until a real numeric fact exists. */
      min: number;
      /** Largest finite sampled value, initialized internally until a real numeric fact exists. */
      max: number;
      /** Bounded distinct sampled string values; never claim unique people or a full population. */
      unique: Set<string>;
    }
  >();
  /** Whole-sample metric accumulator; overall averages are not sums of per-group averages. */
  const all = {
    count: 0,
    numericCount: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    unique: new Set<string>(),
  };
  // Stay within validated definition/sample bounds; source scope and coverage remain explicit.
  for (const row of rows) {
    let props: Record<string, unknown> = {};
    try {
      /** Optional inert properties JSON; malformed properties yield no invented numeric facts. */
      const parsed: unknown = JSON.parse(row.properties_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        props = parsed as Record<string, unknown>;
      }
    } catch {
      /* This optional failure is intentionally ignored. */
    }
    if (scopedSite !== undefined && row.site !== scopedSite) {
      throw new Error('Analytics source violated enforced site scope');
    }
    /** Allowlisted built-in dimension or explicit property lookup, never a raw expression. */
    const raw = (() => {
      switch (chart.groupBy) {
        case 'event':
          return row.event_name;
        case 'day':
          return new Date(Number(row.occurred_at)).toISOString().slice(0, 10);
        case 'source':
          return row.source;
        case 'site':
          return row.site;
        case 'pathname':
          return row.pathname;
        default:
          return props[chart.groupBy.slice(9)];
      }
    })();
    /** Bounded inert source group label; unknown values retain the documented not-set label. */
    const category = String(raw ?? '(not set)').slice(0, 150);
    /** Selected property fact or implicit count unit; only finite numbers enter numeric arithmetic. */
    const value = chart.valueField ? props[chart.valueField] : 1;
    let group = groups.get(category);
    if (!group) {
      group = {
        count: 0,
        numericCount: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        unique: new Set(),
      };
      groups.set(category, group);
    }
    group.count++;
    all.count++;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Stay within validated definition/sample bounds; source scope and coverage remain explicit.
      for (const item of [group, all]) {
        item.numericCount++;
        item.sum += value;
        item.min = Math.min(item.min, value);
        item.max = Math.max(item.max, value);
      }
    }
    /** Sample-only string identity bounded by the existing distinct set ceiling. */
    const distinct = String(value ?? '');
    if (group.unique.size < 10000) {
      group.unique.add(distinct);
    }
    if (all.unique.size < 10000) {
      all.unique.add(distinct);
    }
  }
  /** Project the declared operation from sampled accumulators; missing numeric facts do not become average denominators.
   * @param {{ count: number; numericCount: number; sum: number; min: number; max: number; unique: Set<string>; }} group - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {number} group.count - Actual sampled event count.
   * @param {number} group.numericCount - Finite numeric denominator for averages.
   * @param {number} group.sum - Sum of sampled finite numeric facts.
   * @param {number} group.min - Sample minimum, possibly the internal initial sentinel.
   * @param {number} group.max - Sample maximum, possibly the internal initial sentinel.
   * @param {Set<string>} group.unique - Bounded sampled distinct identities, not people.
   * @param {Metric} method - Explicit supported sampled metric.
   * @returns {number} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const metric = (
    group: {
      /** Number of valid sampled events in this group. */
      count: number;
      /** Number of finite numeric facts included in sampled arithmetic; missing values do not inflate averages. */
      numericCount: number;
      /** Sum of actual finite numeric facts from the bounded sample. */
      sum: number;
      /** Smallest finite sampled value, initialized internally until a real numeric fact exists. */
      min: number;
      /** Largest finite sampled value, initialized internally until a real numeric fact exists. */
      max: number;
      /** Bounded distinct sampled string values; never claim unique people or a full population. */
      unique: Set<string>;
    },
    method: Metric
  ) =>
    ({
      count: group.count,
      sum: group.sum,
      average: group.numericCount ? group.sum / group.numericCount : 0,
      min: Number.isFinite(group.min) ? group.min : 0,
      max: Number.isFinite(group.max) ? group.max : 0,
      distinct: group.unique.size,
    })[method];
  /** Finite sample group/value projections before deterministic display sorting. */
  const items: Array<Item> = [...groups].map(([category, group]) => ({
    category,
    value: metric(group, chart.metric),
  }));
  if (chart.groupBy === 'day') {
    items.sort((a, b) => a.category.localeCompare(b.category));
  } else {
    items.sort((a, b) => b.value - a.value);
  }
  /** Ordered bounded projection; UTC day labels retain chronological order. */
  const output = items.slice(0, 60);
  return {
    id: chart.id,
    title: chart.title,
    type: chart.type,
    labels: output.map((i) => i.category),
    values: output.map((i) => i.value),
    total: metric(all, chart.metric),
    sampledRows: rows.length,
    truncated: rows.length >= take,
    queryMode: 'sampled',
    coverage: 'bounded-source-event-page',
  };
}
