/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
import { createHash } from 'node:crypto';
import { normalizeResults, type NormalizedResultRecord } from '../results.js';
import { summarizeCoverage } from '../coverage.js';
import type { RunSummary } from '../types/test.js';
/** Per-export finite allocation/representation/reference budgets. */
export interface ReportLimits {
  /** Maximum result rows, default1000 and at most10000. */
  maxResults?: number;
  /** Maximum UTF-8 copied/serialized report input work, default4MiB and at most16MiB. */
  maxInputBytes?: number;
  /** Maximum final encoded bytes, default8MiB and at most32MiB. */
  maxOutputBytes?: number;
  /** Maximum retained inert artifact references, default64 and at most1000. */
  maxAttachments?: number;
  /** Maximum aggregate artifact-label bytes, default64KiB and at most1MiB. */
  maxAttachmentBytes?: number;
}
/** Explicit per-export disclosure/redaction policy; labels are public only by host choice. */
export interface ReportOptions extends ReportLimits {
  /** Error messages can contain private test inputs; omitted unless explicitly enabled. */
  includeErrors?: boolean;
  /** Explicitly disclose bounded/redacted source labels instead of opaque hashes. */
  includeSourceLabels?: boolean;
  /** Explicitly disclose bounded/redacted relative artifact paths instead of opaque hashes. */
  includeArtifactPaths?: boolean;
  /** Application-owned redaction of public labels and explicitly included error text. */
  redact?: (text: string, field: string) => string;
}
/** Detached portable bounded schema shared by every presentation encoder. */
export interface ResultReportV1 {
  /** Fixed portable result document discriminator. */
  schema: 'ztrial-results';
  /** Supported report schema version, currently one. */
  version: 1;
  /** Actual passed row count derived from report rows. */
  passed: number;
  /** Actual failed row count derived from report rows. */
  failed: number;
  /** Actual intentionally skipped row count derived from report rows. */
  skipped: number;
  /** Actual unavailable-required-environment row count, separate from skipped. */
  unavailable: number;
  /** Nonnegative observed run duration in milliseconds. */
  durationMs: number;
  /** Detached validated ordered portable result rows, excluding raw causes. */
  results: readonly NormalizedResultRecord[];
}
/** Fixed report failure code with private native causes, separate from test success. */
export class ReportExportError extends Error {
  /** Create a fixed report failure code with optional private native cause; exported report content never serializes its stack/cause automatically.
   * @param {string} code - Fixed bounded internal report error classification.
   * @param {unknown} cause - Optional private native/host adapter cause.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Result report export failed (${code})`, { cause });
    this.name = 'ReportExportError';
  }
}
/** Normalize one explicit/default report limit using inclusive safe-integer bounds.
 * @param {number | undefined} value - Optional explicit host setting.
 * @param {number} fallback - Internal default for this report policy.
 * @param {number} min - Inclusive supported lower bound.
 * @param {number} max - Inclusive supported upper bound.
 * @param {string} label - Fixed nonsecret option label for validation errors.
 * @returns {number} Validated safe integer without coercion.
 */
export function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string
): number {
  /** Explicit/default safe-integer setting checked against the supported policy bounds. */
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new RangeError(`Invalid ${label}`);
  }
  return number;
}
/** Validate bounded result/input/output/attachment budgets before allocating report representations.
 * @param {ReportLimits} options - Trusted optional per-export count/byte limits.
 * @returns {Required<ReportLimits>} Detached normalized finite report budgets.
 */
export function reportLimits(options: ReportLimits = {}) {
  return {
    maxResults: bounded(options.maxResults, 1000, 1, 10000, 'maxResults'),
    maxInputBytes: bounded(
      options.maxInputBytes,
      4194304,
      1,
      16777216,
      'maxInputBytes'
    ),
    maxOutputBytes: bounded(
      options.maxOutputBytes,
      8388608,
      1,
      33554432,
      'maxOutputBytes'
    ),
    maxAttachments: bounded(
      options.maxAttachments,
      64,
      0,
      1000,
      'maxAttachments'
    ),
    maxAttachmentBytes: bounded(
      options.maxAttachmentBytes,
      65536,
      0,
      1048576,
      'maxAttachmentBytes'
    ),
  };
}
/** Remove XML1.0-incompatible code points only; context-specific markup quoting remains the presentation encoder’s responsibility.
 * @param {string} value - Already bounded trusted text, after optional host redaction.
 * @returns {string} XML-compatible plain text; never an HTML sanitizer or an execution permission.
 */
export function plain(value: string): string {
  return [...value]
    .filter((char) => {
      /** Actual Unicode code point checked against XML1.0 text ranges. */
      const code = char.codePointAt(0)!;
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      );
    })
    .join('');
}
/** Validate a bounded inert artifact reference without opening the referenced file.
 * @param {string} value - Unknown-at-runtime relative artifact label.
 * @returns {boolean} Whether supported nontraversing relative syntax matches; no filesystem sandbox is claimed.
 */
function relative(value: string) {
  return (
    value.length <= 2048 &&
    !/[\x00-\x1f\x7f\\]/.test(value) &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
/** Create a deterministic opaque reference label; hashing is not anonymization or access control.
 * @param {string} prefix Fixed internal source/artifact namespace.
 * @param {string} value Already bounded/redacted private label.
 * @returns {string} Domain-prefixed truncated SHA-256 reference, never an authorization token. */
const id = (prefix: string, value: string) =>
  prefix + '-' + createHash('sha256').update(value).digest('hex').slice(0, 24);
/** Validate, budget and detach one portable V1 report with explicit disclosure/redaction policy; counts derive from actual rows rather than caller totals.
 * @param {RunSummary} summary - Actual trusted runner summary, still schema-validated at export.
 * @param {ReportOptions} options - Explicit bounded disclosure/redaction policy; error text and raw source/artifact labels are omitted by default.
 * @returns {ResultReportV1} Detached bounded report without source bodies, raw stacks, causes or embedded artifact bytes.
 */
export function createResultReport(
  summary: RunSummary,
  options: ReportOptions = {}
): ResultReportV1 {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Invalid report options');
  }
  /** Detached finite per-export work/output/reference budgets. */
  const limits = reportLimits(options);
  for (const key of [
    'includeErrors',
    'includeSourceLabels',
    'includeArtifactPaths',
  ] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError('Invalid report disclosure option');
    }
  }
  if (options.redact !== undefined && typeof options.redact !== 'function') {
    throw new TypeError('Invalid report redactor');
  }
  if (
    !summary ||
    !Array.isArray(summary.results) ||
    summary.results.length > limits.maxResults ||
    !Number.isFinite(summary.durationMs) ||
    summary.durationMs < 0
  ) {
    throw new ReportExportError('INPUT_LIMIT_OR_SCHEMA');
  }
  let workBytes = 0;
  /** Charge bounded copy/serialization work before constructing a larger report representation.
   * @param {number} bytes Actual bytes copied/encoded for the next supported field.
   * @returns {void} Accumulates input work or rejects before exceeding its declared budget. */
  const charge = (bytes: number) => {
    workBytes += bytes;
    if (workBytes > limits.maxInputBytes) {
      throw new ReportExportError('INPUT_BYTE_LIMIT');
    }
  };
  let inputBytes = 0,
    attachments = 0,
    attachmentBytes = 0;
  /** Validate, optionally redact and XML-normalize one supported bounded label.
   * @param {unknown} value Unknown-at-runtime field text.
   * @param {string} field Fixed host redaction field label.
   * @param {number} max Maximum allowed input/output text code units.
   * @returns {string} Bounded plain text charged against report input work. */
  const text = (value: unknown, field: string, max = 8192): string => {
    if (typeof value !== 'string' || value.length > max) {
      throw new ReportExportError('INVALID_TEXT');
    }
    /** Trusted host redactor result, revalidated before including it in any representation. */
    const sanitized = options.redact ? options.redact(value, field) : value;
    if (typeof sanitized !== 'string' || sanitized.length > max) {
      throw new ReportExportError('INVALID_REDACTION');
    }
    /** XML-compatible bounded plain text charged by actual UTF-8 bytes. */
    const output = plain(sanitized);
    charge(Buffer.byteLength(output));
    return output;
  };
  /** Detached validated output rows; original runner receipts are never mutated. */
  const rows: NormalizedResultRecord[] = [];
  for (const item of summary.results) {
    if (
      !item ||
      !['passed', 'failed', 'skipped', 'environment-unavailable'].includes(
        item.status
      ) ||
      !Number.isFinite(item.durationMs) ||
      item.durationMs < 0 ||
      (item.environment !== undefined &&
        !['node', 'browser'].includes(item.environment))
    ) {
      throw new ReportExportError('INVALID_RESULT');
    }
    if (
      item.coverage !== undefined &&
      (!Array.isArray(item.coverage) || item.coverage.length > 1000)
    ) {
      throw new ReportExportError('COVERAGE_LIMIT');
    }
    if (
      item.artifacts !== undefined &&
      (!Array.isArray(item.artifacts) ||
        item.artifacts.length > limits.maxAttachments)
    ) {
      throw new ReportExportError('ATTACHMENT_LIMIT');
    }
    // Reuse the public normalizer, then construct only declared fields from its output.
    /** One trusted portable projection, followed by full report boundary validation. */
    const normalized = normalizeResults({ ...summary, results: [item] })[0];
    if (!normalized) {
      throw new ReportExportError('INVALID_RESULT');
    }
    /** Detached supported range provenance; no source code bodies are retained. */
    const coverage = normalized.coverage.map((record) => {
      summarizeCoverage([record]);
      if (
        record.sourceHash !== undefined &&
        (typeof record.sourceHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(record.sourceHash))
      ) {
        throw new ReportExportError('INVALID_COVERAGE_HASH');
      }
      /** Bounded/redacted source label, optionally converted to an opaque report reference. */
      const source = text(record.source, 'coverage.source', 2048);
      return {
        version: 1 as const,
        format: 'v8-ranges' as const,
        runtime: text(record.runtime, 'coverage.runtime', 2048),
        source: options.includeSourceLabels ? source : id('source', source),
        status: record.status,
        ...(record.sourceHash && { sourceHash: record.sourceHash }),
        ...(record.reason && {
          reason: text(record.reason, 'coverage.reason', 2048),
        }),
        ranges: record.ranges.map((range) => {
          /** Declared detached native range fields only; unknown payload fields are not copied. */
          const value = {
            functionIndex: range.functionIndex,
            rangeIndex: range.rangeIndex,
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            count: range.count,
            block: range.block,
          };
          charge(Buffer.byteLength(JSON.stringify(value)));
          return value;
        }),
      };
    });
    /** Detached validated inert artifact references; files are never opened here. */
    const artifacts = normalized.artifacts.map((artifact) => {
      if (
        !artifact ||
        !['screenshot', 'video', 'trace'].includes(artifact.type) ||
        typeof artifact.path !== 'string' ||
        !relative(artifact.path)
      ) {
        throw new ReportExportError('UNSAFE_ATTACHMENT_REFERENCE');
      }
      /** Bounded/redacted relative artifact label revalidated before optional disclosure. */
      const label = text(artifact.path, 'artifact.path', 2048);
      if (!relative(label)) {
        throw new ReportExportError('UNSAFE_ATTACHMENT_REFERENCE');
      }
      attachments++;
      attachmentBytes += Buffer.byteLength(label);
      if (
        attachments > limits.maxAttachments ||
        attachmentBytes > limits.maxAttachmentBytes
      ) {
        throw new ReportExportError('ATTACHMENT_LIMIT');
      }
      return {
        type: artifact.type,
        path: options.includeArtifactPaths ? label : id('artifact', label),
      };
    });
    /** Complete detached declared result envelope with optional explicitly allowed error text. */
    const row: NormalizedResultRecord = {
      version: 1,
      name: text(item.name, 'name', 2048),
      environment: normalized.environment,
      status: item.status,
      durationMs: item.durationMs,
      ...(normalized.reason && {
        reason: text(normalized.reason, 'reason', 2048),
      }),
      coverageStatus: normalized.coverageStatus,
      coverage,
      artifacts,
    };
    if (options.includeErrors && normalized.error) {
      row.error = {
        name: text(normalized.error.name, 'error.name', 256),
        message: text(normalized.error.message, 'error.message'),
      };
    }
    inputBytes += Buffer.byteLength(JSON.stringify(row));
    if (inputBytes > limits.maxInputBytes) {
      throw new ReportExportError('INPUT_BYTE_LIMIT');
    }
    rows.push(row);
  }
  /** Count actual output rows for one fixed outcome classification.
   * @param {string} status Fixed internal supported outcome label.
   * @returns {number} Actual row count, independent of caller-provided summary totals. */
  const count = (status: string) =>
    rows.filter((row) => row.status === status).length;
  /** Complete detached versioned report with counts derived only from its validated rows. */
  const report: ResultReportV1 = {
    schema: 'ztrial-results',
    version: 1,
    passed: count('passed'),
    failed: count('failed'),
    skipped: count('skipped'),
    unavailable: count('environment-unavailable'),
    durationMs: summary.durationMs,
    results: rows,
  };
  if (Buffer.byteLength(JSON.stringify(report)) > limits.maxInputBytes) {
    throw new ReportExportError('INPUT_BYTE_LIMIT');
  }
  return report;
}
