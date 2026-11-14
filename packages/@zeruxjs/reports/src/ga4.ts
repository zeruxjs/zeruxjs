import {
  validateSourceQuery,
  sourceSchema,
  type ReportSourceAdapter,
  type ReportSourceSchema,
} from './sources.js';
import {
  googleReporting,
  providerFailure,
  GA4_READONLY_SCOPE,
  type GoogleReportOptions,
} from './google-reporting.js';
export {
  createGoogleReportCredentials,
  GA4_READONLY_SCOPE,
} from './google-reporting.js';
/** Create an explicit read-only fixed-property GA4 runReport adapter. Host reviews its field catalog/timezone and binds the exact tenant/site/principal/grant before credentials; no discovery or stream-level authorization is invented.
 * @param {object} options - Trusted provider identity/schema and borrowed credentials.
 * @param {string} options.property - Fixed authorized GA4 property.
 * @param {ReportSourceSchema} options.schema - Reviewed supported field catalog.
 * @param {string} options.timeZone - Expected property IANA timezone.
 * @returns {ReportSourceAdapter} Registered adapter owns its transport work through dispose; credentials remain borrowed and host-owned.
 */
export function createGa4ReportSource(
  options: GoogleReportOptions & {
    /** Fixed server-reviewed numeric GA4 property ID; it must already belong to the authorized site/grant. */
    property: string;
    /** Trusted finite supported field catalog; no executable query DSL or provider introspection. */
    schema: ReportSourceSchema;
    /** Explicit expected GA4 property IANA timezone; mismatched provider metadata rejects. */
    timeZone: string;
  }
): ReportSourceAdapter {
  if (!/^\d{1,20}$/.test(options?.property)) {
    providerFailure('INVALID_QUERY');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: options.timeZone });
  } catch {
    providerFailure('INVALID_QUERY');
  }
  /** Validated fixed numeric GA4 property; never a user-supplied endpoint. */
  const property = options.property;
  /** Expected declared property timezone checked against provider metadata. */
  const timeZone = options.timeZone;
  /** Frozen validated reviewed field catalog; no account discovery. */
  const schema = sourceSchema(options.schema);
  if (
    schema.fields.some(
      (f) =>
        !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(f.name) ||
        (f.kind === 'metric' &&
          !['count', 'seconds', 'milliseconds', 'ratio'].includes(f.unit!) &&
          !f.unit?.startsWith('currency:'))
    )
  ) {
    providerFailure('INVALID_QUERY');
  }
  /** Owned internal provider-request scope; credentials are borrowed and disposal stays explicit. */
  const google = googleReporting(options, GA4_READONLY_SCOPE);
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
      if (columns.some((f) => !f)) {
        providerFailure('INVALID_QUERY');
      }
      /** Private bounded provider response projected only after metadata/shape validation. */
      const value = await google.request(
        `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dateRanges: [{ startDate: q.from, endDate: q.to }],
            dimensions: q.dimensions.map((name) => ({ name })),
            metrics: q.metrics.map((name) => ({ name })),
            limit: String(q.limit),
            returnPropertyQuota: true,
          }),
        },
        c
      );
      if (
        !value ||
        value.metadata?.timeZone !== timeZone ||
        !Array.isArray(value.dimensionHeaders) ||
        value.dimensionHeaders.map((h: any) => h.name).join('|') !==
          q.dimensions.join('|') ||
        !Array.isArray(value.metricHeaders) ||
        value.metricHeaders.map((h: any) => h.name).join('|') !==
          q.metrics.join('|') ||
        !Number.isSafeInteger(value.rowCount) ||
        value.rowCount < 0 ||
        (value.rows !== undefined && !Array.isArray(value.rows))
      ) {
        providerFailure('INVALID_RESULT');
      }
      // Translate only the finite selected catalog/date parts; no arbitrary URLs or executable queries.
      for (const f of columns) {
        if (
          f.unit?.startsWith('currency:') &&
          f.unit !== `currency:${value.metadata.currencyCode}`
        ) {
          providerFailure('INVALID_RESULT');
        }
      }
      // Translate only the finite selected catalog/date parts; no arbitrary URLs or executable queries.
      for (const [i, name] of q.metrics.entries()) {
        /** Registered metric unit compared to the provider-reported metric type. */
        const unit = schema.fields.find((f) => f.name === name)!.unit;
        /** Provider metric type; unsupported mappings reject rather than silently coercing. */
        const type = value.metricHeaders[i].type;
        /** Finite allowlisted provider type mapping for the explicit registered unit. */
        const expected = (() => {
          if (unit === 'count') {
            return ['TYPE_INTEGER'];
          } else {
            if (unit === 'seconds') {
              return ['TYPE_SECONDS'];
            } else {
              if (unit === 'milliseconds') {
                return ['TYPE_MILLISECONDS'];
              } else {
                if (unit?.startsWith('currency:')) {
                  return ['TYPE_CURRENCY'];
                } else {
                  if (unit === 'ratio') {
                    return ['TYPE_FLOAT', 'TYPE_STANDARD'];
                  } else {
                    return [];
                  }
                }
              }
            }
          }
        })();
        if (!expected.includes(type)) {
          providerFailure('INVALID_RESULT');
        }
      }
      /** Finite provider cell projection retaining original decimal strings; registry rechecks complete result budgets. */
      const rows = (value.rows ?? []).map((r: any) => {
        r.dimensionValues ??= [];
        if (
          !Array.isArray(r.dimensionValues) ||
          !Array.isArray(r.metricValues) ||
          r.dimensionValues.length !== q.dimensions.length ||
          r.metricValues.length !== q.metrics.length
        ) {
          providerFailure('INVALID_RESULT');
        }
        return [...r.dimensionValues, ...r.metricValues].map(
          (v: any) => v.value
        );
      });
      return {
        columns,
        rows,
        timeZone,
        coverage: {
          kind: 'provider-reported',
          truncated: value.rowCount > rows.length,
          totalRows: value.rowCount,
          sampling: 'unknown',
          restricted:
            value.metadata.subjectToThresholding === true ||
            value.metadata.dataLossFromOtherRow === true ||
            !!value.metadata.schemaRestrictionResponse,
        },
      };
    },
  };
}

export type {
  GoogleReportCredentials,
  GoogleReportOptions,
} from './google-reporting.js';
