import { createResultReport, type ReportOptions } from '../reports/schema.js';
import type { RunSummary } from '../types/test.js';
/** Render the validated portable report through the existing pretty/JSON/TAP presentation policy; errors are omitted unless explicitly disclosed.
 * @param {RunSummary} summary - Actual trusted runner summary requiring report schema/budget validation.
 * @param {'pretty' | 'json' | 'tap'} reporter - Explicit fixed presentation format, default pretty.
 * @param {ReportOptions} options - Per-render bounded disclosure/redaction policy; raw causes/stacks never appear.
 * @returns {string} Complete declared text representation; output does not change test outcomes or execute report data.
 */
export function formatSummary(
  summary: RunSummary,
  reporter: 'pretty' | 'json' | 'tap' = 'pretty',
  options: ReportOptions = {}
) {
  /** Detached bounded portable schema with host disclosure policy already applied. */
  const report = createResultReport(summary, options);
  if (reporter === 'json') {
    return JSON.stringify(report, null, 2);
  }
  if (reporter === 'tap') {
    return [
      'TAP version 13',
      ...report.results.map(
        (r, i) =>
          `${r.status === 'failed' || r.status === 'environment-unavailable' ? 'not ok' : 'ok'} ${i + 1} - ${r.name.replace(/[\r\n]/g, ' ')}${(() => {
            if (r.status === 'skipped') {
              return ' # SKIP';
            } else {
              if (r.status === 'environment-unavailable') {
                return ' # environment-unavailable';
              } else {
                return '';
              }
            }
          })()}`
      ),
      `1..${report.results.length}`,
    ].join('\n');
  }
  return [
    ...report.results.map(
      (r) =>
        `${(() => {
          if (r.status === 'passed') {
            return '✓';
          } else {
            if (r.status === 'skipped') {
              return '○';
            } else {
              return '✗';
            }
          }
        })()} ${r.name} (${r.durationMs}ms)${r.error ? `\n  ${r.error.message}` : ''}`
    ),
    `\n${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped, ${report.unavailable ?? 0} unavailable (${report.durationMs}ms)`,
  ].join('\n');
}
