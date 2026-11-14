import type { ReportPage } from './types.js';
export interface ReportLayoutV1 {
  /** Fixed layout schema1; independent of document CAS and transfer schema revisions. */
  version: 1;
  /** One, two or three display columns; every item span must fit. */
  columns: 1 | 2 | 3;
  /** Validated IANA display zone; UTC query grouping is not shifted. */
  timeZone: string;
  /** Exact bounded display order of current page charts, each appearing once. */
  items: {
    /** Reference to an actual current page chart ID, never an executable expression. */
    chartId: string;
    /** One to three columns, no larger than the configured layout columns. */
    span: 1 | 2 | 3;
  }[];
}
/** Validate inert presentation-only ordering, spans and IANA display labels. Every page chart appears exactly once; layout never changes query scope, UTC grouping or authorization.
 * @param {ReportLayoutV1} value - Candidate V1 layout, checked before cloning; unknown/accessor/class fields reject.
 * @param {Pick<ReportPage, 'charts'>} page - Trusted selected page chart IDs, bounded to50; no source query is performed.
 * @returns {ReportLayoutV1} Fresh validated clone; invalid layouts fail without mutating the page.
 */
export function validateReportLayout(
  value: ReportLayoutV1,
  page: Pick<ReportPage, 'charts'>
): ReportLayoutV1 {
  if (!page || !Array.isArray(page.charts) || page.charts.length > 50) {
    throw new TypeError('Invalid layout chart set');
  }
  /** Require plain own-data configuration without invoking getters or executable definitions.
   * @param {object} v - Candidate layout/item container.
   * @returns {boolean} Whether every own field is plain data; validation still checks allowed names/values.
   */
  const plain = (v: object) =>
    v &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
    Reflect.ownKeys(v).every(
      (k) =>
        typeof k === 'string' &&
        'value' in Object.getOwnPropertyDescriptor(v, k)!
    );
  if (
    !value ||
    !plain(value) ||
    Object.keys(value).some(
      (k) => !['version', 'columns', 'timeZone', 'items'].includes(k)
    ) ||
    value.version !== 1 ||
    ![1, 2, 3].includes(value.columns) ||
    typeof value.timeZone !== 'string' ||
    !value.timeZone ||
    value.timeZone.length > 100 ||
    !Array.isArray(value.items) ||
    value.items.length !== page.charts.length ||
    Object.values(Object.getOwnPropertyDescriptors(value.items)).some(
      (d) => !('value' in d)
    )
  ) {
    throw new TypeError('Invalid report layout');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timeZone });
  } catch {
    throw new TypeError('Invalid display time zone');
  }
  /** Per-layout chart identity set rejecting duplicates before returning a clone. */
  const seen = new Set<string>();
  // Visit exactly the bounded page chart set; duplicates and unknown references reject.
  for (const item of value.items) {
    if (
      !item ||
      !plain(item) ||
      Object.keys(item).some((k) => !['chartId', 'span'].includes(k)) ||
      !page.charts.some((c) => c.id === item.chartId) ||
      seen.has(item.chartId) ||
      ![1, 2, 3].includes(item.span) ||
      item.span > value.columns
    ) {
      throw new TypeError('Invalid report layout item');
    }
    seen.add(item.chartId);
  }
  return structuredClone(value);
}
/** Resolve a saved V1 layout or the legacy two-column/UTC/span-one fallback, then validate it against the current page charts.
 * @param {ReportPage} page - Explicit report page; its layout is presentation, not a permission or query override.
 * @returns {ReportLayoutV1} Fresh validated resolved layout; no browser/source resource is created.
 */
export function resolveReportLayout(page: ReportPage): ReportLayoutV1 {
  return validateReportLayout(
    page.layout ?? {
      version: 1,
      columns: 2,
      timeZone: 'UTC',
      items: page.charts.map((c) => ({ chartId: c.id, span: 1 })),
    },
    page
  );
}
