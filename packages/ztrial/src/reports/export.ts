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
  readonly signal?: AbortSignal;
  readonly maxOutputBytes: number;
}
export interface ReportExporter {
  format: string;
  extension: string;
  kind: 'summary' | 'summary-chart';
  render(
    report: ResultReportV1,
    context: RenderContext
  ): Uint8Array | Promise<Uint8Array>;
}
export interface ReportWriteOptions extends ReportOptions {
  directory: string;
  format: string;
  name?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
}
/** XML text/attribute encoding, including attribute whitespace. No HTML execution. */
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
/** Formula guard precedes RFC 4180 quoting; text remains text in spreadsheet readers. */
export function spreadsheetText(value: string): string {
  return /^[\t\r\n]|^[\s\uFEFF]*[=+\-@]/u.test(value) ? "'" + value : value;
}
const encode = (value: string) => new TextEncoder().encode(value);
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
function junit(report: ResultReportV1) {
  const rows = report.results
    .map((row) => {
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
      const details = row.error
        ? `${row.error.name}: ${row.error.message}`
        : '';
      const outcome =
        row.status === 'failed'
          ? `<failure type="TestFailure" message="${xml(details || 'Test failed')}">${xml(details)}</failure>`
          : row.status === 'environment-unavailable'
            ? `<error type="EnvironmentUnavailable" message="${xml(details || 'Environment unavailable')}"/>`
            : row.status === 'skipped'
              ? `<skipped message="${xml(row.reason ?? 'Intentional skip')}"/>`
              : '';
      return `<testcase name="${xml(row.name)}" classname="${xml(row.environment)}" time="${row.durationMs / 1000}"><properties>${properties.map(([name, value]) => `<property name="${xml(name)}" value="${xml(value)}"/>`).join('')}</properties>${outcome}</testcase>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="ztrial" tests="${report.results.length}" failures="${report.failed}" errors="${report.unavailable}" skipped="${report.skipped}" time="${report.durationMs / 1000}"><testsuite name="ztrial" tests="${report.results.length}" failures="${report.failed}" errors="${report.unavailable}" skipped="${report.skipped}" time="${report.durationMs / 1000}">${rows}</testsuite></testsuites>\n`;
}
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
async function directory(value: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value.split(/[\\/]/).includes('..')
  )
    throw new ReportExportError('UNSAFE_OUTPUT_PATH');
  const root = path.resolve(value);
  const stat = await fs.lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await fs.realpath(root)) !== root
  )
    throw new ReportExportError('UNSAFE_OUTPUT_PATH');
  return root;
}
async function destination(file: string, overwrite: boolean) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new ReportExportError('UNSAFE_OUTPUT_PATH');
    if (!overwrite) throw new ReportExportError('OUTPUT_EXISTS');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
/** Per-owner registry: optional/custom adapters never alter global runner state. */
export function createReportExporters(
  adapters: readonly ReportExporter[] = []
) {
  if (!Array.isArray(adapters) || adapters.length > 32)
    throw new TypeError('Invalid report adapters');
  const registry = new Map<string, ReportExporter>();
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
    )
      throw new TypeError('Invalid or conflicting report adapter');
    registry.set(adapter.format, Object.freeze({ ...adapter }));
    extensions.add(adapter.extension);
  }
  const exporters = {
    formats: () => [...registry.keys()],
    async render(
      summary: RunSummary,
      format: string,
      options: ReportOptions & { signal?: AbortSignal } = {}
    ) {
      if (!options || typeof options !== 'object' || Array.isArray(options))
        throw new TypeError('Invalid report options');
      options = { ...options };
      const adapter = registry.get(format);
      if (!adapter) throw new ReportExportError('UNSUPPORTED_FORMAT');
      if (
        options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)
      )
        throw new TypeError('Invalid report signal');
      options.signal?.throwIfAborted();
      const report = createResultReport(summary, options);
      const limits = reportLimits(options);
      // Adapters receive one detached, recursively frozen schema snapshot.
      const freeze = (value: unknown): void => {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
          for (const child of Object.values(value)) freeze(child);
          Object.freeze(value);
        }
      };
      freeze(report);
      const output = await adapter.render(report, {
        signal: options.signal,
        maxOutputBytes: limits.maxOutputBytes,
      });
      options.signal?.throwIfAborted();
      if (
        !(output instanceof Uint8Array) ||
        output.length > limits.maxOutputBytes
      )
        throw new ReportExportError('OUTPUT_BYTE_LIMIT');
      return {
        bytes: new Uint8Array(output),
        extension: adapter.extension,
        kind: adapter.kind,
      };
    },
    async write(summary: RunSummary, options: ReportWriteOptions) {
      if (
        !options ||
        typeof options !== 'object' ||
        (options.overwrite !== undefined &&
          typeof options.overwrite !== 'boolean')
      )
        throw new TypeError('Invalid report write options');
      options = { ...options };
      if (
        options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)
      )
        throw new TypeError('Invalid report signal');
      const name = options.name ?? 'ztrial';
      if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
        throw new ReportExportError('UNSAFE_OUTPUT_NAME');
      const adapter = registry.get(options.format);
      if (!adapter) throw new ReportExportError('UNSUPPORTED_FORMAT');
      const root = await directory(options.directory);
      const file = path.join(root, `${name}.${adapter.extension}`);
      await destination(file, options.overwrite ?? false);
      options.signal?.throwIfAborted();
      const output = await exporters.render(summary, options.format, options);
      let staged: string | undefined;
      try {
        staged = await fs.mkdtemp(path.join(root, '.ztrial-report-'));
        const temporary = path.join(staged, 'output');
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
          for (let offset = 0; offset < output.bytes.length; ) {
            options.signal?.throwIfAborted();
            const { bytesWritten } = await handle.write(
              output.bytes,
              offset,
              Math.min(65536, output.bytes.length - offset),
              offset
            );
            if (!bytesWritten) throw new ReportExportError('WRITE_STALLED');
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
        if (options.overwrite) await fs.rename(temporary, file);
        else await fs.link(temporary, file); // Same-filesystem atomic no-clobber publication.
        return {
          format: options.format,
          fileName: path.basename(file),
          bytes: output.bytes.length,
          kind: output.kind,
          schema: 'ztrial-results' as const,
          version: 1 as const,
        };
      } finally {
        if (staged) await fs.rm(staged, { recursive: true, force: true });
      }
    },
  };
  return Object.freeze(exporters);
}
