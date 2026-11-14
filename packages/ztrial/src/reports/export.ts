/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createResultReport,
  reportLimits,
  ReportExportError,
  type ReportOptions,
  type ResultReportV1,
} from './schema.js';
import type { RunSummary } from '../types/test.js';
export interface RenderContext {
  /** Optional caller cancellation; encoders must cooperate and final publication rechecks it. */
  readonly signal?: AbortSignal;
  /** Finite maximum encoded representation bytes. */
  readonly maxOutputBytes: number;
}
export interface ReportExporter {
  /** Unique explicit trusted encoder identifier. */
  format: string;
  /** Validated fixed encoder-owned filename suffix, never derived from test content. */
  extension: string;
  /** Explicit summary or summary-chart identity; a chart is not a browser screenshot. */
  kind: 'summary' | 'summary-chart';
  /**
   * Encode one detached frozen portable report through this explicitly trusted registered adapter.
   * @param {ResultReportV1} report Validated immutable schema; never arbitrary executable expressions.
   * @param {RenderContext} context Finite output-byte policy and cooperative cancellation.
   * @returns {Uint8Array | Promise<Uint8Array>} Actual encoded bytes; the registry independently validates size/cancellation.
   */
  render(
    report: ResultReportV1,
    context: RenderContext
  ): Uint8Array | Promise<Uint8Array>;
}
export interface ReportWriteOptions extends ReportOptions {
  /** Explicit existing canonical host-owned output directory. */
  directory: string;
  /** Unique explicit trusted encoder identifier. */
  format: string;
  /** Bounded safe output prefix, default ztrial; never an arbitrary test label. */
  name?: string;
  /** Explicit atomic replace policy, false rejects an existing destination. */
  overwrite?: boolean;
  /** Optional caller cancellation; encoders must cooperate and final publication rechecks it. */
  signal?: AbortSignal;
}
/** Quote XML text/attribute metacharacters and attribute whitespace after report plain-text validation; never interpret HTML or executable callbacks.
 * @param {unknown} value - Already bounded declared report scalar.
 * @returns {string} XML-safe string for the fixed encoder template.
 */
export function xml(value: unknown): string {
  return String(value).replace(
    /[&<>"'\t\r\n]/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
        '\t': '&#9;',
        '\r': '&#13;',
        '\n': '&#10;',
      })[char]!
  );
}
/** Prefix common spreadsheet formula-leading text before CSV/XLSX serialization; this does not execute or evaluate a cell.
 * @param {string} value - Already bounded declared report cell text.
 * @returns {string} Text with a protective apostrophe where required by the documented formula guard.
 */
export function spreadsheetText(value: string): string {
  return /^[\t\r\n]|^[\s\uFEFF]*[=+\-@]/u.test(value) ? "'" + value : value;
}
/** Encode already bounded declared text as UTF-8 bytes.
 * @param {string} value Complete controlled representation text.
 * @returns {Uint8Array} New UTF-8 encoded bytes. */
const encode = (value: string) => new TextEncoder().encode(value);
/** Project the bounded detached report into fixed inert text columns shared by CSV/XLSX encoders.
 * @param {ResultReportV1} report - Validated detached portable V1 report.
 * @returns {string[][]} Fixed header plus ordered text rows; artifacts/coverage remain metadata JSON, never file bytes.
 */
export function reportColumns(report: ResultReportV1): string[][] {
  return [
    [
      'schema',
      'version',
      'name',
      'environment',
      'status',
      'durationMs',
      'reason',
      'error',
      'coverageStatus',
      'coverage',
      'artifacts',
    ],
    ...report.results.map((row) => [
      'ztrial-results',
      '1',
      row.name,
      row.environment,
      row.status,
      String(row.durationMs),
      row.reason ?? '',
      row.error ? `${row.error.name}: ${row.error.message}` : '',
      row.coverageStatus,
      JSON.stringify(row.coverage),
      JSON.stringify(row.artifacts),
    ]),
  ];
}
/** Serialize the documented JUnit subset with actual failed/unavailable/skipped classifications and XML-escaped declared properties.
 * @param {ResultReportV1} report - Validated detached portable V1 report.
 * @returns {string} Complete deterministic XML summary, not universal CI-importer parity.
 */
function junit(report: ResultReportV1) {
  /** Ordered fixed JUnit testcase markup; every dynamic declared scalar is XML-escaped. */
  const rows = report.results
    .map((row) => {
      /** Fixed-schema per-case provenance fields, excluding stacks/causes/source bodies. */
      const properties = [
        ['schema', 'ztrial-results'],
        ['version', '1'],
        ['status', row.status],
        ['reason', row.reason ?? ''],
        ['environment', row.environment],
        ['durationMs', row.durationMs],
        ['coverageStatus', row.coverageStatus],
        ['coverage', JSON.stringify(row.coverage)],
        ['artifacts', JSON.stringify(row.artifacts)],
      ];
      /** Optional explicitly disclosed private error name/message; absent by default. */
      const details = row.error
        ? `${row.error.name}: ${row.error.message}`
        : '';
      /** Fixed supported JUnit outcome element derived from actual normalized status. */
      let outcome: string;
      if (row.status === 'failed') {
        outcome = `<failure type="TestFailure" message="${xml(details || 'Test failed')}">${xml(details)}</failure>`;
      } else {
        if (row.status === 'environment-unavailable') {
          outcome = `<error type="EnvironmentUnavailable" message="${xml(details || 'Environment unavailable')}"/>`;
        } else {
          if (row.status === 'skipped') {
            outcome = `<skipped message="${xml(row.reason ?? 'Intentional skip')}"/>`;
          } else {
            outcome = '';
          }
        }
      }
      return `<testcase name="${xml(row.name)}" classname="${xml(row.environment)}" time="${row.durationMs / 1000}"><properties>${properties.map(([name, value]) => `<property name="${xml(name)}" value="${xml(value)}"/>`).join('')}</properties>${outcome}</testcase>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="ztrial" tests="${report.results.length}" failures="${report.failed}" errors="${report.unavailable}" skipped="${report.skipped}" time="${report.durationMs / 1000}"><testsuite name="ztrial" tests="${report.results.length}" failures="${report.failed}" errors="${report.unavailable}" skipped="${report.skipped}" time="${report.durationMs / 1000}">${rows}</testsuite></testsuites>\n`;
}
/** Inert fixed JSON/JUnit/CSV encoders; none loads optional modules or writes files. */
const core: ReportExporter[] = [
  {
    format: 'json',
    extension: 'results.json',
    kind: 'summary',
    render: (report) => encode(JSON.stringify(report, null, 2) + '\n'),
  },
  {
    format: 'junit',
    extension: 'junit.xml',
    kind: 'summary',
    render: (report) => encode(junit(report)),
  },
  {
    format: 'csv',
    extension: 'results.csv',
    kind: 'summary',
    render: (report) =>
      encode(
        reportColumns(report)
          .map((row) =>
            row
              .map(
                (cell) => '"' + spreadsheetText(cell).replace(/"/g, '""') + '"'
              )
              .join(',')
          )
          .join('\r\n') + '\r\n'
      ),
  },
];
/** Require an existing canonical real output directory without traversal/control characters; trusted ancestry still needs host control against races.
 * @param {string} value - Explicit host-owned output directory, never an arbitrary client path.
 * @returns {Promise<string>} Canonical verified directory; this helper never creates it.
 */
async function directory(value: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value.split(/[\\/]/).includes('..')
  ) {
    throw new ReportExportError('UNSAFE_OUTPUT_PATH');
  }
  /** Explicit canonical existing owner-controlled output directory. */
  const root = path.resolve(value);
  /** Native output directory/destination metadata checked before publication. */
  const stat = await fs.lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await fs.realpath(root)) !== root
  ) {
    throw new ReportExportError('UNSAFE_OUTPUT_PATH');
  }
  return root;
}
/** Reject symlink/nonfile destinations and explicit no-overwrite conflicts before atomic publication.
 * @param {string} file - Fixed adapter-derived output filename beneath the verified directory.
 * @param {boolean} overwrite - Explicit host choice allowing atomic replacement.
 * @returns {Promise<void>} Validation receipt only; the final hard-link/rename operation remains authoritative.
 */
async function destination(file: string, overwrite: boolean) {
  try {
    /** Native output directory/destination metadata checked before publication. */
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new ReportExportError('UNSAFE_OUTPUT_PATH');
    }
    if (!overwrite) {
      throw new ReportExportError('OUTPUT_EXISTS');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
/** Create an inert per-owner registry of fixed core and explicitly trusted optional encoders; custom adapters never modify global runner state.
 * @param {readonly ReportExporter[]} adapters - At most32 explicit trusted custom encoders, with unique format/extension identities.
 * @returns {object} Frozen explicit formats/render/write API; no rendering, file write or optional import occurs at construction.
 */
export function createReportExporters(
  adapters: readonly ReportExporter[] = []
) {
  if (!Array.isArray(adapters) || adapters.length > 32) {
    throw new TypeError('Invalid report adapters');
  }
  /** Bounded per-owner explicit trusted encoder map; no package discovery. */
  const registry = new Map<string, ReportExporter>();
  /** Declared suffix uniqueness set preventing ambiguous output identities. */
  const extensions = new Set<string>();
  for (const adapter of [...core, ...adapters]) {
    if (
      !adapter ||
      typeof adapter.format !== 'string' ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(adapter.format) ||
      typeof adapter.extension !== 'string' ||
      !/^[a-z0-9]+(?:\.[a-z0-9]+)?$/.test(adapter.extension) ||
      adapter.extension.length > 24 ||
      !['summary', 'summary-chart'].includes(adapter.kind) ||
      typeof adapter.render !== 'function' ||
      registry.has(adapter.format) ||
      extensions.has(adapter.extension)
    ) {
      throw new TypeError('Invalid or conflicting report adapter');
    }
    registry.set(adapter.format, Object.freeze({ ...adapter }));
    extensions.add(adapter.extension);
  }
  /** Per-owner explicit render/write methods; construction performs no optional import. */
  const exporters = {
    formats: () => [...registry.keys()],
    /** Validate/detach/freeze a report, invoke one explicitly selected trusted encoder and independently enforce cancellation/output-byte policy.
     * @param {RunSummary} summary - Actual trusted runner summary awaiting schema validation.
     * @param {string} format - Explicit registered fixed format identifier.
     * @param {ReportOptions & { signal?: AbortSignal }} options - Per-render bounded disclosure/cancellation policy.
     * @returns {Promise<{ bytes: Uint8Array; extension: string; kind: "summary" | "summary-chart" }>} Owned returned byte copy and fixed adapter metadata; render never writes files or changes test success.
     */
    async render(
      summary: RunSummary,
      format: string,
      options: ReportOptions & {
        /** Optional caller cancellation; encoders must cooperate and final publication rechecks it. */
        signal?: AbortSignal;
      } = {}
    ) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('Invalid report options');
      }
      options = { ...options };
      /** Explicitly registered trusted encoder selected by validated format. */
      const adapter = registry.get(format);
      if (!adapter) {
        throw new ReportExportError('UNSUPPORTED_FORMAT');
      }
      if (
        options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)
      ) {
        throw new TypeError('Invalid report signal');
      }
      options.signal?.throwIfAborted();
      /** Detached validated portable report, recursively frozen before passing it to the encoder. */
      const report = createResultReport(summary, options);
      /** Validated finite render input/output/reference budgets. */
      const limits = reportLimits(options);
      // Adapters receive one detached, recursively frozen schema snapshot.
      /** Recursively freeze the detached declared report before passing it to trusted encoder code.
       * @param {unknown} value Detached bounded schema value, never an arbitrary executable host object.
       * @returns {void} Freezes only this detached representation, not caller runner state. */
      const freeze = (value: unknown): void => {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
          for (const child of Object.values(value)) {
            freeze(child);
          }
          Object.freeze(value);
        }
      };
      freeze(report);
      /** Actual returned encoder bytes/metadata subject to byte/cancellation checks before publication. */
      const output = await adapter.render(report, {
        signal: options.signal,
        maxOutputBytes: limits.maxOutputBytes,
      });
      options.signal?.throwIfAborted();
      if (
        !(output instanceof Uint8Array) ||
        output.length > limits.maxOutputBytes
      ) {
        throw new ReportExportError('OUTPUT_BYTE_LIMIT');
      }
      return {
        bytes: new Uint8Array(output),
        extension: adapter.extension,
        kind: adapter.kind,
      };
    },
    /** Render under finite budgets, stage private bytes and atomically publish by no-clobber hard link or explicit overwrite rename.
     * @param {RunSummary} summary - Actual trusted runner summary.
     * @param {ReportWriteOptions} options - Explicit host-owned directory/name/format/disclosure/cancellation policy.
     * @returns {Promise<object>} Committed relative filename/byte/schema receipt; cancellation after commit cannot undo publication.
     */
    async write(summary: RunSummary, options: ReportWriteOptions) {
      if (
        !options ||
        typeof options !== 'object' ||
        (options.overwrite !== undefined &&
          typeof options.overwrite !== 'boolean')
      ) {
        throw new TypeError('Invalid report write options');
      }
      options = { ...options };
      if (
        options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)
      ) {
        throw new TypeError('Invalid report signal');
      }
      /** Validated safe host output prefix, never taken from a test name. */
      const name = options.name ?? 'ztrial';
      if (
        typeof name !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)
      ) {
        throw new ReportExportError('UNSAFE_OUTPUT_NAME');
      }
      /** Explicitly registered trusted encoder selected by validated format. */
      const adapter = registry.get(options.format);
      if (!adapter) {
        throw new ReportExportError('UNSUPPORTED_FORMAT');
      }
      /** Explicit canonical existing owner-controlled output directory. */
      const root = await directory(options.directory);
      /** Fixed directory/name/adapter-extension destination. */
      const file = path.join(root, `${name}.${adapter.extension}`);
      await destination(file, options.overwrite ?? false);
      options.signal?.throwIfAborted();
      /** Actual returned encoder bytes/metadata subject to byte/cancellation checks before publication. */
      const output = await exporters.render(summary, options.format, options);
      let staged: string | undefined;
      try {
        staged = await fs.mkdtemp(path.join(root, '.ztrial-report-'));
        /** Fixed private staging output filename inside an owned temporary directory. */
        const temporary = path.join(staged, 'output');
        /** Owned exclusive staging descriptor, closed after write/fsync even on abort/failure. */
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
          for (let offset = 0; offset < output.bytes.length; ) {
            options.signal?.throwIfAborted();
            /** Actual native partial-write progress used to avoid silent truncation or infinite stalled writes. */
            const { bytesWritten } = await handle.write(
              output.bytes,
              offset,
              Math.min(65536, output.bytes.length - offset),
              offset
            );
            if (!bytesWritten) {
              throw new ReportExportError('WRITE_STALLED');
            }
            offset += bytesWritten;
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        options.signal?.throwIfAborted();
        await directory(root);
        await destination(file, options.overwrite ?? false);
        options.signal?.throwIfAborted();
        if (options.overwrite) {
          await fs.rename(temporary, file);
        } else {
          await fs.link(temporary, file);
        } // Same-filesystem atomic no-clobber publication.
        return {
          format: options.format,
          fileName: path.basename(file),
          bytes: output.bytes.length,
          kind: output.kind,
          schema: 'ztrial-results' as const,
          version: 1 as const,
        };
      } finally {
        if (staged) {
          await fs.rm(staged, { recursive: true, force: true });
        }
      }
    },
  };
  return Object.freeze(exporters);
}
