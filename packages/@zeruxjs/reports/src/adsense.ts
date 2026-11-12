import {
  sourceSchema,
  validateSourceQuery,
  type ReportSourceAdapter,
  type ReportSourceSchema,
} from './sources.js';
import {
  googleReporting,
  providerFailure,
  ADSENSE_READONLY_SCOPE,
  type GoogleReportOptions,
} from './google-reporting.js';
export {
  createGoogleReportCredentials,
  ADSENSE_READONLY_SCOPE,
} from './google-reporting.js';
/** Create an explicit read-only fixed-account/domain AdSense adapter. Apply the code-owned exact DOMAIN_CODE predicate and Google billing timezone; do not infer account-local timezone or domain permission from a browser query.
 * @param {object} options - Trusted provider identity/schema and borrowed credentials.
 * @param {string} options.account - Fixed authorized AdSense pub account.
 * @param {string} options.domain - Fixed authorized ASCII/punycode domain filter.
 * @param {ReportSourceSchema} options.schema - Reviewed supported field catalog.
 * @returns {ReportSourceAdapter} Registered adapter owns its transport work through dispose; credentials remain borrowed and host-owned.
 */
export function createAdSenseReportSource(
  options: GoogleReportOptions & {
    /** Fixed server-reviewed pub-... AdSense account ID; never query-selected. */
    account: string;
    /** Fixed validated ASCII/punycode reporting domain, applied outside caller input. */
    domain: string;
    /** Trusted finite supported field catalog; no executable query DSL or provider introspection. */
    schema: ReportSourceSchema;
  }
): ReportSourceAdapter {
  if (
    !/^pub-\d{1,30}$/.test(options?.account) ||
    typeof options.domain !== 'string' ||
    options.domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      options.domain
    )
  ) {
    providerFailure('INVALID_QUERY');
  }
  /** Fixed validated private provider account, never a report expression. */
  const account = options.account;
  /** Fixed validated domain predicate owned by the server binding. */
  const domain = options.domain;
  /** Frozen validated reviewed field catalog; no account discovery. */
  const schema = sourceSchema(options.schema);
  if (
    schema.fields.some(
      (f) =>
        !/^[A-Z][A-Z0-9_]{0,95}$/.test(f.name) ||
        (f.kind === 'metric' &&
          f.unit !== 'count' &&
          f.unit !== 'ratio' &&
          !f.unit?.startsWith('currency:'))
    )
  ) {
    providerFailure('INVALID_QUERY');
  }
  /** Finite distinct registered currency set; mixed currencies reject. */
  const currencies = new Set(
    schema.fields
      .filter((f) => f.unit?.startsWith('currency:'))
      .map((f) => f.unit!.slice(9))
  );
  if (currencies.size > 1) {
    providerFailure('INVALID_QUERY');
  }
  /** Optional single explicitly registered currency requested from the provider. */
  const currency = [...currencies][0];
  /** Owned internal provider-request scope; credentials are borrowed and disposal stays explicit. */
  const google = googleReporting(options, ADSENSE_READONLY_SCOPE);
  return {
    schema,
    capabilities: { readOnly: true, maxRows: 1000, maxDays: 366 },
    dispose: () => google.dispose(),
    /** Execute one validated finite page through the bound read-only transport. Validate returned field order, units and source time facts; retain decimal strings and explicit unknown sampling/truncation instead of claiming complete parity.
     * @param {ReportSourceQuery} q - Copied finite source-version/field/date/row plan; cannot override fixed account/property/domain.
     * @param {object} c - Verified identity and cooperative cancellation.
     * @param {Readonly<ReportSourceScope>} c.scope - Host-verified tenant/site/principal/grant partition.
     * @param {AbortSignal} c.signal - Cooperative caller cancellation.
     * @returns {Promise<object>} Source-owned columns/rows/timezone/coverage; the registry independently normalizes the private result envelope.
     */
    async query(q, c) {
      q = validateSourceQuery(q, schema, 1000, 366);
      /** Exactly the selected registered fields/units in query order. */
      const columns = [...q.dimensions, ...q.metrics].map(
        (n) => schema.fields.find((f) => f.name === n)!
      );
      /** Code-owned fixed HTTPS reporting endpoint with structured validated parameters. */
      const url = new URL(
        `https://adsense.googleapis.com/v2/accounts/${account}/reports:generate`
      );
      url.searchParams.set('dateRange', 'CUSTOM');
      // Translate only the finite selected catalog/date parts; no arbitrary URLs or executable queries.
      for (const [prefix, value] of [
        ['startDate', q.from],
        ['endDate', q.to],
      ]) {
        // Translate only the finite selected catalog/date parts; no arbitrary URLs or executable queries.
        for (const [i, part] of ['year', 'month', 'day'].entries()) {
          url.searchParams.set(
            `${prefix}.${part}`,
            String(Number(value.split('-')[i]))
          );
        }
      }
      url.searchParams.set('limit', String(q.limit));
      url.searchParams.set('reportingTimeZone', 'GOOGLE_TIME_ZONE');
      url.searchParams.set('languageCode', 'en');
      url.searchParams.append('filters', `DOMAIN_CODE==${domain}`);
      if (currency) {
        url.searchParams.set('currencyCode', currency);
      }
      // Translate only the finite selected catalog/date parts; no arbitrary URLs or executable queries.
      for (const d of q.dimensions) {
        url.searchParams.append('dimensions', d);
      }
      // Translate only the finite selected catalog/date parts; no arbitrary URLs or executable queries.
      for (const m of q.metrics) {
        url.searchParams.append('metrics', m);
      }
      /** Private bounded provider response projected only after metadata/shape validation. */
      const value = await google.request(url.href, { method: 'GET' }, c);
      if (
        !value ||
        !Array.isArray(value.headers) ||
        value.headers.length !== columns.length ||
        value.headers.some(
          (h: any, i: number) =>
            h.name !== columns[i].name ||
            h.type !==
              (() => {
                if (columns[i].kind === 'dimension') {
                  return 'DIMENSION';
                } else {
                  if (columns[i].unit === 'count') {
                    return 'METRIC_TALLY';
                  } else {
                    if (columns[i].unit === 'ratio') {
                      return 'METRIC_RATIO';
                    } else {
                      return 'METRIC_CURRENCY';
                    }
                  }
                }
              })() ||
            (columns[i].unit?.startsWith('currency:') &&
              columns[i].unit !== `currency:${h.currencyCode}`)
        ) ||
        !/^\d{1,16}$/.test(value.totalMatchedRows) ||
        !Number.isSafeInteger(Number(value.totalMatchedRows)) ||
        (value.rows !== undefined && !Array.isArray(value.rows)) ||
        (value.warnings !== undefined && !Array.isArray(value.warnings))
      ) {
        providerFailure('INVALID_RESULT');
      }
      /** Compare provider-reported date bounds to the canonical requested window.
       * @param {any} v - Inert value under bounded recursive validation.
       * @param {string} date - Explicit value for this documented owner/projection; host authorization remains separate.
       * @returns {any} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
       */
      const matchesDate = (v: any, date: string) =>
        v &&
        [v.year, v.month, v.day].join('-') ===
          date.split('-').map(Number).join('-');
      if (
        !matchesDate(value.startDate, q.from) ||
        !matchesDate(value.endDate, q.to)
      ) {
        providerFailure('INVALID_RESULT');
      }
      /** Finite provider cell projection retaining original decimal strings; registry rechecks complete result budgets. */
      const rows = (value.rows ?? []).map((r: any) => {
        if (!Array.isArray(r.cells) || r.cells.length !== columns.length) {
          providerFailure('INVALID_RESULT');
        }
        return r.cells.map((cell: any) => cell.value);
      });
      /** Safe validated provider matching-group count; distinct from event totals. */
      const totalRows = Number(value.totalMatchedRows);
      return {
        columns,
        rows,
        timeZone: 'America/Los_Angeles',
        coverage: {
          kind: 'provider-reported',
          totalRows,
          truncated: totalRows > rows.length,
          sampling: 'unknown',
          restricted: !!value.warnings?.length,
        },
      };
    },
  };
}

export type {
  GoogleReportCredentials,
  GoogleReportOptions,
} from './google-reporting.js';
