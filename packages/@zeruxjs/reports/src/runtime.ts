import {
  importReportDefinition,
  exportReportDefinition,
} from './definitions.js';
import { createHash } from 'node:crypto';
import type {
  ReportsOptions,
  ReportsStore,
  AnalyticsReportSource,
  ReportAction,
  ChartDefinition,
  ChartData,
} from './types.js';
import {
  createMemoryReportsStore,
  validateReports,
  queryChart,
  isReportId,
} from './model.js';
import {
  campaignPerformanceCharts,
  campaignDailyTrendsCharts,
} from './campaign-delivery.js';
import type {
  CampaignPerformanceSnapshot,
  CampaignDailyTrendsSnapshot,
} from './campaign-delivery.js';
import {
  marketingDeliveryPageCharts,
  campaignActivityCharts,
} from './campaign-reports.js';
import type { CampaignActivitySnapshot } from './campaign-reports.js';
import { reportDashboard } from './dashboard.js';

/** Fixed private/no-store and credential-vary headers shared by protected route results. */
const headers = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  vary: 'Cookie, Authorization',
};
/** Serialize only explicitly projected route data under private/no-store response policy.
 * @param {unknown} body - Explicit value for this documented owner/projection; host authorization remains separate.
 * @param {number} status - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {Response} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  });
/** Return fixed public messages without raw exceptions, payloads or credentials.
 * @param {string} message - Explicit value for this documented owner/projection; host authorization remains separate.
 * @param {number} status - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {Response} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const error = (message: string, status: number) =>
  json({ error: message }, status);

/** Conservative fixed-site validation; syntax does not authenticate a tenant.
 * @param {unknown} site - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {boolean} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const validSite = (site: unknown): site is string =>
  typeof site === 'string' &&
  site.length > 0 &&
  site.length <= 200 &&
  // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
  !/[\x00-\x1f]/.test(site);
/** Validate a real canonical UTC calendar day before bounded date arithmetic.
 * @param {string | null} s - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {number} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const date = (s: string | null) => {
  if (
    !s ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s
  ) {
    throw new TypeError('Invalid UTC date');
  }
  return Date.parse(s + 'T00:00:00Z');
};
/** Validate paired safe epoch bounds under a366-day maximum. Missing optional bounds preserve saved filters; no synthetic current dates or storage mutation.
 * @param {URLSearchParams} params - Untrusted query parameters validated before bounded source work; never tenant identity.
 * @param {boolean} required - Default false; true requires both finite UTC epoch bounds.
 * @returns {object} Explicit bounded route/data result or failure; host authorization and source ownership remain authoritative.
 */
function utcWindow(params: URLSearchParams, required = false) {
  /** Optional caller epoch bound, never a verified identity. */
  const since = params.get('since');
  /** Optional final epoch bound paired with since. */
  const until = params.get('until');
  if (!since && !until && !required) {
    return {};
  }
  if (!since || !until || !/^\d+$/.test(since) || !/^\d+$/.test(until)) {
    throw new TypeError('Both numeric since and until must be supplied');
  }
  /** Validated safe start epoch; paired bounds cannot exceed the declared horizon. */
  const a = Number(since);
  /** Validated safe final epoch; no implicit current-time fallback. */
  const b = Number(until);
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    a < 0 ||
    b < a ||
    b - a > 366 * 86400000
  ) {
    throw new RangeError('Date range must be bounded to 366 days');
  }
  return { since: a, until: b };
}
/** Validate real paired canonical UTC dates and a366-day inclusive campaign window before calling any campaign source.
 * @param {URLSearchParams} params - Untrusted query parameters validated before bounded source work; never tenant identity.
 * @returns {{from:string;to:string}} Explicit bounded route/data result or failure; host authorization and source ownership remain authoritative.
 */
function campaignDays(params: URLSearchParams) {
  /** Caller UTC first-day label checked before campaign work. */
  const from = params.get('from');
  /** Caller UTC final-day label checked before campaign work. */
  const to = params.get('to');
  /** Validated canonical first UTC epoch. */
  const first = date(from);
  /** Validated canonical final UTC epoch. */
  const last = date(to);
  if (last < first || last - first > 365 * 86400000) {
    throw new RangeError('Campaign date range exceeds 366 days');
  }
  return { from: from!, to: to! };
}
/** Hash the exact emitted inline representation for restrictive CSP; hashes are not authorization.
 * @param {string} source - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {string} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const sha = (source: string) =>
  "'sha256-" + createHash('sha256').update(source).digest('base64') + "'";
/** Encode one inert CSV cell and neutralize leading spreadsheet-formula characters.
 * @param {unknown} item - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {string} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const escapeCsv = (item: unknown) => {
  /** Inert string form of one already authorized export cell. */
  const value = String(item ?? '');
  // Spreadsheet formulas must remain literal data, even when preceded by whitespace.
  /** Formula-neutralized CSV text before doubling quotes. */
  const safe = /^[\s\uFEFF]*[=+@\-\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
};
/** Create explicit tabular chart projections, including provenance, without arbitrary expressions.
 * @param {ChartData[]} items - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {string} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const csv = (items: ChartData[]) =>
  [
    [
      'chartId',
      'title',
      'dimension',
      'value',
      'total',
      'mode',
      'coverage',
      'truncated',
    ]
      .map(escapeCsv)
      .join(','),
    ...items.flatMap((item) =>
      item.labels.map((label, index) =>
        [
          item.id,
          item.title,
          label,
          item.values[index],
          item.total,
          item.queryMode ?? 'unknown',
          item.coverage ?? item.numericCoverage ?? '',
          item.truncated,
        ]
          .map(escapeCsv)
          .join(',')
      )
    ),
  ].join('\r\n') + '\r\n';
/** Serialize only the authorized selection under a256 KiB output cap and explicit attachment representation. CSV cells remain formula-neutralized; per-chart coverage remains separate from consistency.
 * @param {unknown} data - Already authorized chart projections, never raw provider credentials or recipient records.
 * @param {string} format - Previously allowlisted csv/json representation; not an executable format plugin.
 * @param {string} filename - Code-owned bounded attachment filename from validated report/page IDs.
 * @returns {Response} Explicit bounded route/data result or failure; host authorization and source ownership remain authoritative.
 */
function exported(data: unknown, format: string, filename: string) {
  /** Complete private serialized export checked against the final byte cap. */
  const payload =
    format === 'csv'
      ? csv(Array.isArray(data) ? (data as ChartData[]) : [data as ChartData])
      : JSON.stringify(data);
  if (Buffer.byteLength(payload) > 256 * 1024) {
    return error('Export exceeds 256 KiB limit; narrow your selection', 413);
  }
  return new Response(payload, {
    headers: {
      ...headers,
      'content-type':
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}.${format}"`,
    },
  });
}
/** Own a strict UTF-8 ten-second/256 KiB body read, cancelling/releasing the reader on all exits before validation/storage. Signals do not force-cancel arbitrary host callbacks.
 * @param {Request} request - Host Fetch request; reader ownership ends before storage mutation.
 * @returns {Promise<string>} Explicit bounded route/data result or failure; host authorization and source ownership remain authoritative.
 */
async function definitionBody(request: Request) {
  if (!request.body) {
    throw new TypeError('Definition body required');
  }
  /** Owned bounded definition reader; release before returning/attempting persistence. */
  const reader = request.body.getReader();
  /** Strict streaming UTF-8 decoder, never a source evaluator. */
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0,
    text = '',
    expired = false;
  /** Owned reader-cancellation listener, removed on every terminal path.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  /** Owned ten-second read timer cleared on actual read completion/cancellation. */
  const timer = setTimeout(() => {
    expired = true;
    abort();
  }, 10000);
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    // Stay within explicit chart/query/body budgets; never bypass action or tenant scope.
    while (true) {
      if (expired || request.signal.aborted) {
        throw new TypeError('Definition read cancelled');
      }
      /** One body-read chunk or terminal receipt under the finite byte cap. */
      const next = await reader.read();
      if (expired || request.signal.aborted) {
        throw new TypeError('Definition read cancelled');
      }
      if (next.done) {
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > 262144) {
        throw new RangeError('Definition too large');
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Create an inert authenticated studio/headless route facade over borrowed sources/stores. Tenant resolution requires dedicated storage; direct query is trusted-only and disabled in dynamic-tenant mode. No database/source disposal owner is acquired.
 * @param {ReportsOptions} options - Explicit analytics/store/session/tenant/campaign callbacks; all resource lifetimes remain host-owned.
 * @returns {object} Explicit bounded route/data result or failure; host authorization and source ownership remain authoritative.
 */
export function createReports(options: ReportsOptions) {
  if (!options?.analytics || typeof options.authorize !== 'function') {
    throw new TypeError(
      'Reports requires analytics and an application authorizer'
    );
  }
  if (options.resolveScope && typeof options.resolveScope !== 'function') {
    throw new TypeError('Invalid tenant resolver');
  }
  if (options.site !== undefined && !validSite(options.site)) {
    throw new TypeError('Invalid enforced site');
  }
  if (
    options.renderDashboard !== undefined &&
    typeof options.renderDashboard !== 'function'
  ) {
    throw new TypeError('Invalid dashboard renderer');
  }
  /** Validated explicit mount, default /_reports; not a tenant permission boundary. */
  const prefix = options.prefix ?? '/_reports';
  if (
    !/^\/[A-Za-z0-9/_-]+$/.test(prefix) ||
    prefix.includes('//') ||
    prefix.endsWith('/')
  ) {
    throw new TypeError('Invalid reports path');
  }
  if (
    options.dashboardHost &&
    !/^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(options.dashboardHost)
  ) {
    throw new TypeError('Invalid reports dashboard host');
  }
  if (
    options.maxSourceRows !== undefined &&
    (!Number.isSafeInteger(options.maxSourceRows) ||
      options.maxSourceRows < 1 ||
      options.maxSourceRows > 500)
  ) {
    throw new RangeError('Invalid report row cap');
  }
  /** Borrowed supplied CAS store or explicit volatile local fallback; no durable lock is invented. */
  const store: ReportsStore = options.store ?? createMemoryReportsStore();
  /** Borrowed supplied analytics facade or manager, never auto-discovered external providers. */
  const source = options.source ?? options.analytics;
  /** Fresh host action authorization plus optional exact host restriction; errors deny.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {ReportAction} action - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {string | undefined} id - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<boolean>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const authorized = async (
    req: Request,
    action: ReportAction,
    id?: string
  ) => {
    if (
      options.dashboardHost &&
      new URL(req.url).host !== options.dashboardHost
    ) {
      return false;
    }
    try {
      return (await options.authorize(req, action, id)) === true;
    } catch {
      return false;
    }
  };
  /** Resolve only authenticated host site/storage/source; dynamic mode requires dedicated tenant stores.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<{ site: string | undefined; store: ReportsStore; source: AnalyticsReportSource; }>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const scoped = async (
    req: Request
  ): Promise<{
    /** Trusted fixed site from authenticated host scope, never query JSON or inferred email. */
    site: string | undefined;
    /** Borrowed dedicated tenant CAS store; scope resolution does not transfer its lifecycle. */
    store: ReportsStore;
    /** Borrowed authorized analytics source; every underlying connector/consent policy remains host-owned. */
    source: AnalyticsReportSource;
  }> => {
    if (!options.resolveScope) {
      return { site: options.site, store, source };
    }
    /** Verified host-resolved tenant partition; browser filters cannot select it. */
    const scope = await options.resolveScope(req);
    if (
      !scope ||
      !validSite(scope.site) ||
      !scope.store ||
      typeof scope.store.load !== 'function' ||
      typeof scope.store.save !== 'function' ||
      (!scope.source && typeof source.events !== 'function') ||
      (scope.source && typeof scope.source.events !== 'function') ||
      (options.site !== undefined && scope.site !== options.site)
    ) {
      throw new Error('Untrusted reports tenant scope');
    }
    return {
      site: scope.site,
      store: scope.store,
      source: scope.source ?? source,
    };
  };
  /** Authorize before invoking the trusted optional studio renderer and computing exact CSP hashes.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const main = async (req: Request) => {
    if (!(await authorized(req, 'read'))) {
      return new Response('Not found', { status: 404 });
    }
    let html: string;
    try {
      html = options.renderDashboard
        ? options.renderDashboard({ prefix })
        : reportDashboard(prefix);
      if (typeof html !== 'string' || Buffer.byteLength(html) > 524288) {
        throw new TypeError('Invalid dashboard output');
      }
    } catch {
      return error('Report UI unavailable', 503);
    }
    /** Exact first inline script body used for CSP hashing, never arbitrary permission grants. */
    const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1] ?? '';
    /** Exact first inline style body used for CSP hashing. */
    const style = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '';
    return new Response(html, {
      headers: {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src ${sha(script)}; style-src ${sha(style)}; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`,
      },
    });
  };
  /** Authorize read/edit, enforce same-origin writes and validate complete documents before CAS.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const api = async (req: Request) => {
    /** Code-owned read/edit action selected by method, never a browser role string. */
    const action: ReportAction = req.method === 'PUT' ? 'edit' : 'read';
    if (!(await authorized(req, action))) {
      return error('Forbidden', 403);
    }
    if (!['GET', 'PUT'].includes(req.method)) {
      return error('Method not allowed', 405);
    }
    let tenantStore: ReportsStore;
    try {
      tenantStore = (await scoped(req)).store;
    } catch {
      return error('Report storage unavailable', 503);
    }
    if (req.method === 'GET') {
      try {
        return json(validateReports(await tenantStore.load()));
      } catch {
        return error('Report storage unavailable', 503);
      }
    }
    if (req.headers.get('origin') !== new URL(req.url).origin) {
      return error('Origin required', 403);
    }
    let next;
    try {
      /** Bounded untrusted definition text; JSON validation precedes any save. */
      const raw = await definitionBody(req);
      next = validateReports(JSON.parse(raw));
    } catch (e) {
      return error(
        'Invalid report document',
        e instanceof RangeError ? 413 : 422
      );
    }
    try {
      if (!(await tenantStore.save(next, next.version - 1))) {
        return error('Version conflict', 409);
      }
      return json({ ok: true, version: next.version });
    } catch {
      return error('Report storage unavailable', 503);
    }
  };
  /** Authorize definition transfer; import validates a candidate without persisting or trusting its revision.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const definition = async (req: Request) => {
    if (!['GET', 'POST'].includes(req.method)) {
      return error('Method not allowed', 405);
    }
    if (!(await authorized(req, req.method === 'GET' ? 'export' : 'edit'))) {
      return error('Forbidden', 403);
    }
    if (
      req.method === 'POST' &&
      (req.headers.get('origin') !== new URL(req.url).origin ||
        req.headers.get('content-type')?.split(';')[0].trim() !==
          'application/json')
    ) {
      return error('Same-origin JSON required', 403);
    }
    let current;
    try {
      current = validateReports(await (await scoped(req)).store.load());
    } catch {
      return error('Report storage unavailable', 503);
    }
    if (req.method === 'GET') {
      try {
        return new Response(exportReportDefinition(current), {
          headers: {
            ...headers,
            'content-type': 'application/json',
            'content-disposition':
              'attachment; filename="report-definition.json"',
          },
        });
      } catch {
        return error('Definition export exceeds limits', 413);
      }
    }
    try {
      /** Validated definition candidate rebound to current storage revision without saving. */
      const imported = importReportDefinition(await definitionBody(req));
      return json({ ...imported, version: current.version });
    } catch (e) {
      return error(
        'Invalid definition import',
        e instanceof RangeError ? 413 : 422
      );
    }
  };
  /** Return bounded metadata pages with revision-aware continuation; stale cursors conflict.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const catalog = async (req: Request) => {
    if (!(await authorized(req, 'read'))) {
      return error('Forbidden', 403);
    }
    if (req.method !== 'GET') {
      return error('Method not allowed', 405);
    }
    try {
      /** Untrusted URL parameters checked independently of trusted identity/tenant resolution. */
      const params = new URL(req.url).searchParams;
      /** Untrusted finite page-size text; reject instead of silently expanding scans. */
      const rawLimit = params.get('limit') ?? '20';
      /** Untrusted revision/offset cursor; stale revisions require restart. */
      const rawCursor = params.get('cursor');
      if (
        !/^\d{1,2}$/.test(rawLimit) ||
        Number(rawLimit) < 1 ||
        Number(rawLimit) > 50
      ) {
        return error('Invalid page size', 422);
      }
      /** Validated private current tenant document, not a public cross-tenant catalog. */
      const doc = validateReports(await (await scoped(req)).store.load());
      let offset = 0;
      if (rawCursor) {
        /** Validated revision/offset cursor components, never an executable expression. */
        const match = /^(\d+):(\d{1,3})$/.exec(rawCursor);
        if (!match) {
          return error('Invalid page cursor', 422);
        }
        if (Number(match[1]) !== doc.version) {
          return error('Report catalog changed; reload from first page', 409);
        }
        offset = Number(match[2]);
        if (offset > doc.reports.length) {
          return error('Invalid page cursor', 422);
        }
      }
      /** Validated finite catalog page size, default20 and maximum50. */
      const take = Number(rawLimit);
      /** Bounded authorized catalog metadata, never source credentials or result bodies. */
      const items = doc.reports.slice(offset, offset + take).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? '',
        pages: r.pages.length,
      }));
      return json({
        version: doc.version,
        items,
        nextCursor:
          offset + take < doc.reports.length
            ? `${doc.version}:${offset + take}`
            : null,
        total: doc.reports.length,
      });
    } catch {
      return error('Report catalog unavailable', 503);
    }
  };
  /** Resolve only existing report/page/chart IDs from this authorized tenant document.
   * @param {ReportsDocument} doc - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {URLSearchParams} params - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {{ report: ReportDefinition | undefined; page: ReportPage; charts: ChartDefinition[]; } | null} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const locate = (
    doc: ReturnType<typeof validateReports>,
    params: URLSearchParams
  ) => {
    /** Untrusted requested ID matched only within the already scoped document. */
    const reportId = params.get('report');
    /** Untrusted requested page reference matched within its selected report. */
    const pageId = params.get('page');
    /** Optional chart reference matched within the selected authorized page. */
    const chartId = params.get('chart');
    /** Matched report within scoped storage; absence cannot select another tenant. */
    const report = doc.reports.find((r) => r.id === reportId);
    /** Matched bounded page, separate from source execution or stored callbacks. */
    const page = report?.pages.find((p) => p.id === pageId);
    if (!page) {
      return null;
    }
    if (chartId && !page.charts.some((c) => c.id === chartId)) {
      return null;
    }
    return {
      report,
      page,
      charts: chartId
        ? page.charts.filter((c) => c.id === chartId)
        : page.charts,
    };
  };
  /** Bound query/export work, preserve action/sensitive permissions and source provenance.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {"export" | "query"} kind - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const charts = async (req: Request, kind: 'query' | 'export') => {
    if (req.method !== 'GET') {
      return error('Method not allowed', 405);
    }
    /** Untrusted URL parameters checked independently of trusted identity/tenant resolution. */
    const params = new URL(req.url).searchParams;
    if (
      kind === 'export' &&
      !['json', 'csv'].includes(params.get('format') ?? 'json')
    ) {
      return error('Invalid export format', 422);
    }
    let window: ReturnType<typeof utcWindow>;
    try {
      window = utcWindow(params);
    } catch {
      return error('Invalid or excessive UTC date window', 422);
    }
    try {
      /** Verified host-resolved tenant partition; browser filters cannot select it. */
      const scope = await scoped(req);
      /** Validated private current tenant document, not a public cross-tenant catalog. */
      const doc = validateReports(await scope.store.load());
      /** Existing scoped report/page selection; no arbitrary plan or endpoint. */
      const target = locate(doc, params);
      if (!target) {
        return error('Unknown report page or chart', 404);
      }
      if (kind === 'query' && target.charts.length !== 1) {
        return error('Choose exactly one chart', 422);
      }
      if (target.charts.length > 12) {
        return error('Page export is limited to 12 charts', 422);
      }
      // 366-day native grouping issues one COUNT per UTC day; bound multi-chart amplification.
      let estimatedQueries = 0;
      // Stay within explicit chart/query/body budgets; never bypass action or tenant scope.
      for (const chart of target.charts) {
        /** Request-only validated date override; saved chart definitions remain unchanged. */
        const merged = { ...chart, ...window };
        if (
          merged.groupBy === 'day' &&
          merged.since !== undefined &&
          merged.until !== undefined
        ) {
          /** Caller UTC first-day label checked before campaign work. */
          const from = Date.UTC(
            new Date(merged.since).getUTCFullYear(),
            new Date(merged.since).getUTCMonth(),
            new Date(merged.since).getUTCDate()
          );
          /** Caller UTC final-day label checked before campaign work. */
          const to = Date.UTC(
            new Date(merged.until).getUTCFullYear(),
            new Date(merged.until).getUTCMonth(),
            new Date(merged.until).getUTCDate()
          );
          estimatedQueries += 2 + Math.floor((to - from) / 86400000);
        } else {
          estimatedQueries++;
        }
      }
      if (estimatedQueries > 500) {
        return error(
          'Export exceeds query budget; narrow the UTC date range or select one chart',
          422
        );
      }
      // Stay within explicit chart/query/body budgets; never bypass action or tenant scope.
      for (const chart of target.charts) {
        if (
          chart.groupBy.startsWith('property:') &&
          !(await authorized(req, 'sensitive', chart.id))
        ) {
          return error('Sensitive chart permission required', 403);
        }
      }
      /** Bounded sequential authorized chart projections, not a pinned multi-query snapshot. */
      const results: ChartData[] = [];
      // Stay within explicit chart/query/body budgets; never bypass action or tenant scope.
      for (const chart of target.charts) {
        /** Request-only validated date override; saved chart definitions remain unchanged. */
        const merged: ChartDefinition = { ...chart, ...window };
        results.push(
          await queryChart(
            scope.source,
            merged,
            options.maxSourceRows ?? 500,
            scope.site
          )
        );
      }
      if (kind === 'query') {
        return json(results[0]);
      }
      /** Allowlisted private export representation, default json. */
      const format = params.get('format') ?? 'json';
      return exported(
        format === 'csv'
          ? results
          : {
              report: target.report!.id,
              page: target.page.id,
              generatedAt: new Date().toISOString(),
              site: scope.site ?? null,
              charts: results,
              disclaimer:
                'Coverage is chart-specific. SMTP acceptance and provider notifications do not confirm inbox delivery.',
            },
        format,
        `reports-${target.report!.id}-${target.page.id}`
      );
    } catch {
      return error('Report query unavailable', 503);
    }
  };
  /** Require read action before scoped one-chart execution.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const query = async (req: Request) => {
    if (!(await authorized(req, 'read'))) {
      return error('Forbidden', 403);
    }
    return charts(req, 'query');
  };
  /** Require independent export action before bounded selected chart execution.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const exportRoute = async (req: Request) => {
    if (!(await authorized(req, 'export'))) {
      return error('Forbidden', 403);
    }
    return charts(req, 'export');
  };
  /** Authorize campaign scope before invoking explicitly configured borrowed providers.
   * @param {Request} req - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {Promise<Response>} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const campaign = async (req: Request) => {
    if (req.method !== 'GET') {
      return error('Method not allowed', 405);
    }
    if (!options.campaigns) {
      return error('Campaign reporting unavailable', 404);
    }
    /** Untrusted URL parameters checked independently of trusted identity/tenant resolution. */
    const params = new URL(req.url).searchParams;
    /** Validated opaque campaign reference; the underlying provider independently authorizes it. */
    const code = params.get('code');
    if (!isReportId(code)) {
      return error('Invalid campaign code', 422);
    }
    if (!(await authorized(req, 'campaign', code))) {
      return error('Forbidden', 403);
    }
    /** Fixed allowlisted campaign report projection; absent sources return unavailable, never fake zeroes. */
    const kind = params.get('kind') ?? 'delivery';
    if (!['delivery', 'performance', 'daily', 'activity'].includes(kind)) {
      return error('Invalid campaign report kind', 422);
    }
    let days:
      | {
          /** Inclusive canonical UTC campaign start day. */
          from: string;
          /** Inclusive canonical UTC campaign final day. */
          to: string;
        }
      | undefined;
    if (kind === 'daily' || kind === 'activity') {
      try {
        days = campaignDays(params);
      } catch {
        return error('Invalid or excessive campaign UTC date window', 422);
      }
    }
    /** Opaque bounded recipient-page continuation, not subject identity. */
    const cursor = params.get('cursor');
    /** Untrusted finite page-size text; reject instead of silently expanding scans. */
    const rawLimit = params.get('limit') ?? '200';
    if (
      kind === 'delivery' &&
      (!/^\d{1,3}$/.test(rawLimit) ||
        Number(rawLimit) < 1 ||
        Number(rawLimit) > 200 ||
        (cursor !== null && (cursor.length > 1024 || !cursor)))
    ) {
      return error('Invalid campaign recipient page', 422);
    }
    try {
      // Scope resolution and the campaign service independently enforce the same application-selected tenant.
      /** Authenticated fixed tenant site passed explicitly to the independent campaign adapter. */
      const site = (await scoped(req)).site;
      if (kind === 'delivery') {
        /** Matched bounded page, separate from source execution or stored callbacks. */
        const page = await options.campaigns.report(code, {
          cursor,
          limit: Number(rawLimit),
          site,
        });
        if (page.campaignCode !== code) {
          throw new Error('Campaign mismatch');
        }
        return json({ kind, code, ...marketingDeliveryPageCharts(page) });
      }
      if (kind === 'performance') {
        if (!options.campaigns.performance) {
          return error('Native campaign performance not configured', 404);
        }
        /** Private authorized campaign aggregate validated before public projection. */
        const snapshot = (await options.campaigns.performance(
          code,
          site
        )) as CampaignPerformanceSnapshot;
        if (snapshot.campaignId !== code) {
          throw new Error('Campaign mismatch');
        }
        return json({
          kind,
          code,
          charts: campaignPerformanceCharts(snapshot),
          coverage: {
            smtp: 'durable-delivery-states',
            provider: 'reported-events-only',
          },
        });
      }
      if (kind === 'daily') {
        if (!options.campaigns.dailyTrends) {
          return error('Daily campaign trends not configured', 404);
        }
        /** Private authorized campaign aggregate validated before public projection. */
        const snapshot = (await options.campaigns.dailyTrends(
          code,
          days!.from,
          days!.to,
          site
        )) as CampaignDailyTrendsSnapshot;
        if (
          snapshot.campaignId !== code ||
          snapshot.from !== days!.from ||
          snapshot.to !== days!.to
        ) {
          throw new Error('Campaign mismatch');
        }
        return json({
          kind,
          code,
          charts: campaignDailyTrendsCharts(snapshot),
          coverage: {
            delivery: 'last-state-update-day',
            snapshotConsistent: false,
          },
        });
      }
      if (!options.campaigns.activity) {
        return error('Campaign tracking reports not configured', 404);
      }
      /** Observed consent-aware tracking snapshot, never verified unique people or inbox delivery. */
      const activity = (await options.campaigns.activity(
        code,
        days!.from,
        days!.to,
        site
      )) as CampaignActivitySnapshot;
      if (
        activity.campaignCode !== code ||
        activity.from !== days!.from ||
        activity.to !== days!.to
      ) {
        throw new Error('Campaign mismatch');
      }
      return json({ kind, code, ...campaignActivityCharts(activity) });
    } catch {
      return error('Campaign report unavailable', 503);
    }
  };
  return {
    store,
    query: async (reportId: string, pageId: string, chartId: string) => {
      if (options.resolveScope) {
        throw new Error(
          'Tenant-scoped reports require an authorized HTTP request'
        );
      }
      /** Validated private current tenant document, not a public cross-tenant catalog. */
      const doc = validateReports(await store.load());
      /** Matched inert chart from scoped storage; direct unscoped querying remains trusted-only. */
      const chart = doc.reports
        .find((r) => r.id === reportId)
        ?.pages.find((p) => p.id === pageId)
        ?.charts.find((c) => c.id === chartId);
      if (!chart) {
        throw new Error('Unknown report chart');
      }
      return queryChart(
        source,
        chart,
        options.maxSourceRows ?? 500,
        options.site
      );
    },
    /** Return explicit mounted route descriptors without starting HTTP servers, registering globals or granting permissions. Each handler keeps its own authorization/validation.
     * @returns {object[]} Explicit bounded route/data result or failure; host authorization and source ownership remain authoritative.
     */
    routes() {
      return [
        { pattern: prefix, handler: main },
        { pattern: prefix + '/api', handler: api },
        { pattern: prefix + '/definition', handler: definition },
        { pattern: prefix + '/catalog', handler: catalog },
        { pattern: prefix + '/query', handler: query },
        { pattern: prefix + '/export', handler: exportRoute },
        { pattern: prefix + '/campaign', handler: campaign },
      ];
    },
  };
}
