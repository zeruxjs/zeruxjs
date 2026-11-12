import { validateReports } from './model.js';
import type { ReportsDocument } from './types.js';
export { validateReports } from './model.js';
export { validateReportLayout, resolveReportLayout } from './layout.js';
export type { ReportLayoutV1 } from './layout.js';
export type {
  ReportsDocument,
  ReportDefinition,
  ReportPage,
  ChartDefinition,
  ChartData,
} from './types.js';
/** Export only an inert validated definition envelope with transfer schema1, separately from the optimistic document revision. Never include result rows, credentials or callbacks.
 * @param {ReportsDocument} document - Candidate document validated under existing field/node/depth/byte budgets.
 * @returns {string} Bounded UTF-8 JSON envelope, at most256 KiB; no persistence or publication occurs.
 */
export function exportReportDefinition(document: ReportsDocument): string {
  /** Validated bounded definition-only transfer JSON; no source result or credential data. */
  const value = JSON.stringify({
    format: 'zerux-report',
    schemaVersion: 1,
    document: validateReports(document),
  });
  if (new TextEncoder().encode(value).byteLength > 262144) {
    throw new RangeError('Definition export exceeds 256 KiB');
  }
  return value;
}
/** Parse a bounded V1 definition-only envelope and validate its inert document. Import alone never saves, publishes, authorizes a source or overrides a store revision.
 * @param {string} text - Untrusted definition JSON text, at most256 KiB UTF-8; never executable expressions.
 * @returns {ReportsDocument} Fresh validated definition candidate; the authorized runtime applies its own current CAS revision.
 */
export function importReportDefinition(text: string): ReportsDocument {
  if (
    typeof text !== 'string' ||
    new TextEncoder().encode(text).byteLength > 262144
  ) {
    throw new RangeError('Definition import exceeds 256 KiB');
  }
  /** Parsed untrusted transfer envelope validated before accepting its document. */
  const input = JSON.parse(text);
  if (
    !input ||
    input.format !== 'zerux-report' ||
    input.schemaVersion !== 1 ||
    Object.keys(input).some(
      (k) => !['format', 'schemaVersion', 'document'].includes(k)
    )
  ) {
    throw new TypeError('Unsupported report definition format');
  }
  return validateReports(input.document);
}
