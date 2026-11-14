/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { ReportExporter } from './export.js';
import { reportColumns, spreadsheetText, xml } from './export.js';
import { bounded, ReportExportError, type ResultReportV1 } from './schema.js';
/** Explicit lazy renderer injection; no optional library is loaded by importing the package. */
export interface OptionalReportOptions {
  /** Explicit trusted executable dependency injection, used only when this optional format is rendered. */
  load?: () => Promise<unknown>;
}
/** Host-owned licensed font path for selected optional presentation formats. */
export interface FontReportOptions extends OptionalReportOptions {
  /** Explicit host-selected licensed canonical TTF/OTF file; no provider font is downloaded. */
  fontFile: string;
}
/** Typed optional dependency failure with private native causes; never a fake passing artifact. */
export class ReportDependencyError extends ReportExportError {
  /** Identify a missing/incompatible explicitly selected optional renderer without fabricating a successful artifact.
   * @param {string} dependency - Fixed optional dependency name, excluding private configuration.
   * @param {unknown} cause - Optional private native import/load cause.
   */
  constructor(
    readonly dependency: string,
    cause?: unknown
  ) {
    super('DEPENDENCY_UNAVAILABLE', cause);
    this.name = 'ReportDependencyError';
    this.message = `Optional report dependency unavailable: ${dependency}`;
  }
}
/** Load only the fixed internally selected renderer or an explicitly trusted injected loader; imports are lazy and never discover packages from data.
 * @param {string} name - Fixed internal optional package identifier.
 * @param {() => Promise<unknown>} load - Explicit trusted executable host loader, not an arbitrary module name from report data.
 * @returns {Promise<any>} Loaded optional implementation or typed dependency failure with private cause.
 */
async function dependency(
  name: string,
  load?: () => Promise<unknown>
): Promise<any> {
  try {
    return await (load ? load() : import(name));
  } catch (error) {
    throw new ReportDependencyError(name, error);
  }
}
/** Validate the explicit optional-loader configuration without importing anything.
 * @param {OptionalReportOptions} options - Trusted renderer configuration with optional executable dependency injection.
 * @returns {(() => Promise<unknown>) | undefined} Borrowed trusted loader, or undefined to use the fixed internal package identifier.
 */
function loader(options: OptionalReportOptions) {
  if (
    !options ||
    typeof options !== 'object' ||
    (options.load !== undefined && typeof options.load !== 'function')
  ) {
    throw new TypeError('Invalid optional report loader');
  }
  return options.load;
}
/** Validate a bounded explicit TTF/OTF path label before native file checks; extension alone is not font validity or redistribution permission.
 * @param {unknown} value - Host-selected licensed font path, never a report row or client filename.
 * @returns {string} Supported path syntax; native containment/size and renderer format support are checked separately.
 */
function fontPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value.split(/[\\/]/).includes('..') ||
    !/^\.(ttf|otf)$/i.test(path.extname(value))
  ) {
    throw new ReportExportError('INVALID_FONT');
  }
  return value;
}
/** Read bounded bytes from an explicit canonical no-follow real font file, always closing its owned descriptor.
 * @param {string} file - Host-selected licensed TTF/OTF path with trusted filesystem ancestry.
 * @returns {Promise<Buffer>} At most8MiB source bytes; encoder owns actual font parsing/glyph support and no full font certification is implied.
 */
async function font(file: string): Promise<Buffer> {
  fontPath(file);
  /** Resolved explicit font path required to equal its real native path. */
  const absolute = path.resolve(file);
  if ((await fs.realpath(absolute)) !== absolute) {
    throw new ReportExportError('INVALID_FONT');
  }
  /** Owned no-follow font descriptor, closed after bounded read even on failure. */
  const handle = await fs.open(
    absolute,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    /** Same-descriptor regular-file and8MiB font-size metadata. */
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8388608) {
      throw new ReportExportError('INVALID_FONT');
    }
    /** Bounded font bytes or final encoded representation, each under its owning stage’s limits. */
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      /** Actual native partial-read receipt used to advance the bounded font buffer. */
      const chunk = await handle.read(bytes, size, bytes.length - size, null);
      if (!chunk.bytesRead) {
        break;
      }
      size += chunk.bytesRead;
    }
    if (size > stat.size) {
      throw new ReportExportError('INVALID_FONT');
    }
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}
/** Project declared report facts to fixed text-summary lines, excluding source bodies and attachments.
 * @param {ResultReportV1} report Validated portable report.
 * @returns {string[]} Ordered bounded summary/provenance lines; display clipping is explicit presentation behavior. */
const lines = (report: ResultReportV1) => [
  'Ztrial results schema v1',
  `${report.passed} passed / ${report.failed} failed / ${report.skipped} skipped / ${report.unavailable} unavailable`,
  `${report.durationMs} ms; ${report.results.length} test results`,
  ...report.results.flatMap((row, index) => [
    `#${index + 1} ${row.name.replace(/[\r\n\t]/g, ' ').slice(0, 78)}`,
    `${row.environment} | ${row.status} | ${row.durationMs} ms | ${row.coverageStatus} | ${row.reason ?? ''}`,
    ...row.coverage.flatMap((source) => [
      `${source.source} | ${source.status}`,
      `${source.format} | ${source.runtime.slice(0, 90)}`,
      `hash: ${source.sourceHash ?? 'not instrumented'}`,
    ]),
  ]),
];
/** Register an inert explicit-font PDF text-summary encoder with finite page/output budgets; no renderer loads until render runs.
 * @param {FontReportOptions & { maxPages?: number }} options - Trusted licensed font, finite page cap and optional explicit renderer loader.
 * @returns {ReportExporter} Lazy trusted encoder; returned PDF is a summary, never a screenshot or recording.
 */
export function createPdfExporter(
  options: FontReportOptions & {
    /** Whole PDF page cap, default20 and at most100. */
    maxPages?: number;
  }
): ReportExporter {
  /** Borrowed explicitly trusted optional renderer loader; no execution at factory construction. */
  const load = loader(options);
  /** Validated explicit licensed font path retained for render-time native checks. */
  const file = fontPath(options.fontFile);
  /** Validated finite PDF page budget. */
  const maxPages = bounded(options.maxPages, 20, 1, 100, 'maxPages');
  return {
    format: 'pdf',
    extension: 'summary.pdf',
    kind: 'summary',
    /** Render one previously validated portable report through the explicitly selected optional library, checking cooperative cancellation and declared presentation limits.
     * @param {ResultReportV1} report - Recursively frozen validated portable report; error/source/path disclosure policy is already applied.
     * @param {import('./export.js').RenderContext} context - Finite output budget and optional cooperative caller cancellation.
     * @returns {Promise<Uint8Array>} Actual encoded summary bytes; native failures remain failures and never alter runner test outcomes.
     */
    async render(report, context) {
      /** Declared text-summary lines derived only from the validated report. */
      const rows = lines(report);
      /** Fixed PDF summary lines per page, keeping the page cap deterministic. */
      const perPage = 45;
      if (Math.ceil(rows.length / perPage) > maxPages) {
        throw new ReportExportError('PAGE_LIMIT');
      }
      context.signal?.throwIfAborted();
      /** Actual optional fixed/injected renderer implementation loaded only for this explicit format. */
      const module = await dependency('pdfkit', load);
      /** Supported native PDF constructor resolved from the explicitly loaded dependency. */
      const Pdf = module.PDFDocument ?? module.default ?? module;
      if (typeof Pdf !== 'function') {
        throw new ReportDependencyError('pdfkit');
      }
      /** Bounded font bytes or final encoded representation, each under its owning stage’s limits. */
      const bytes = await font(file);
      context.signal?.throwIfAborted();
      return new Promise<Uint8Array>((resolve, reject) => {
        /** Owned native PDF document stream, destroyed on abort/output-limit/render failure. */
        const document = new Pdf({
          autoFirstPage: false,
          info: { Title: 'Ztrial result summary', Creator: 'ztrial' },
        });
        /** Owned bounded PDF output chunks copied before resolving the final bytes. */
        const chunks: Buffer[] = [];
        let size = 0,
          settled = false;
        /** Settle this PDF stream once and remove its abort listener.
         * @param {unknown} error Optional private native renderer/abort failure.
         * @returns {void} Resolves actual bytes or rejects; never fabricates an artifact. */
        const finish = (error?: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          context.signal?.removeEventListener('abort', abort);
          if (error) {
            reject(error);
          } else {
            resolve(Buffer.concat(chunks, size));
          }
        };
        /** Destroy only this owned native PDF/image pipeline on cooperative cancellation.
         * @returns {void} Requests native pipeline cancellation without claiming forced JavaScript termination. */
        const abort = () => {
          /** Explicit caller abort reason or fixed cancellation failure, retained privately. */
          const error =
            context.signal?.reason ?? new ReportExportError('CANCELLED');
          document.destroy();
          finish(error);
        };
        document.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > context.maxOutputBytes) {
            document.destroy();
            finish(new ReportExportError('OUTPUT_BYTE_LIMIT'));
          } else {
            chunks.push(Buffer.from(chunk));
          }
        });
        document.on('error', (error: unknown) => finish(error));
        document.on('end', () => finish());
        context.signal?.addEventListener('abort', abort, { once: true });
        if (context.signal?.aborted) {
          abort();
          return;
        }
        try {
          document.font(bytes).fontSize(9);
          for (let index = 0; index < rows.length; index++) {
            if (index % perPage === 0) {
              document.addPage({ size: 'A4', margin: 40 });
            }
            document.text(rows[index], 40, 45 + (index % perPage) * 16, {
              width: 510,
              height: 14,
              lineBreak: false,
            });
          }
          document.end();
        } catch (error) {
          document.destroy();
          finish(error);
        }
      });
    },
  };
}
/** Register an inert XLSX text-cell encoder with finite row/cell limits and an explicit viewer font family.
 * @param {OptionalReportOptions & { maxRows?: number; fontFamily: string }} options - Trusted finite row cap, declared font-family label and optional renderer loader.
 * @returns {ReportExporter} Lazy encoder writing formula-guarded strings; no font or recording bytes are embedded.
 */
export function createXlsxExporter(
  options: OptionalReportOptions & {
    /** Whole result row cap, default1000 and at most10000. */
    maxRows?: number;
    /** Explicit renderer/viewer font-family label; no promise against viewer substitution. */
    fontFamily: string;
  }
): ReportExporter {
  /** Borrowed explicitly trusted optional renderer loader; no execution at factory construction. */
  const load = loader(options);
  /** Validated maximum XLSX result rows. */
  const maxRows = bounded(options.maxRows, 1000, 1, 10000, 'maxRows');
  /** Validated explicit font family; viewer substitution remains outside this encoder. */
  const family = options.fontFamily;
  if (
    typeof family !== 'string' ||
    !family ||
    family.length > 128 ||
    /[\x00-\x1f\x7f]/.test(family)
  ) {
    throw new TypeError('Invalid spreadsheet font family');
  }
  return {
    format: 'xlsx',
    extension: 'results.xlsx',
    kind: 'summary',
    /** Render one previously validated portable report through the explicitly selected optional library, checking cooperative cancellation and declared presentation limits.
     * @param {ResultReportV1} report - Recursively frozen validated portable report; error/source/path disclosure policy is already applied.
     * @param {import('./export.js').RenderContext} context - Finite output budget and optional cooperative caller cancellation.
     * @returns {Promise<Uint8Array>} Actual encoded summary bytes; native failures remain failures and never alter runner test outcomes.
     */
    async render(report, context) {
      if (report.results.length > maxRows) {
        throw new ReportExportError('ROW_LIMIT');
      }
      /** Actual optional fixed/injected renderer implementation loaded only for this explicit format. */
      const module = await dependency('exceljs', load);
      /** Supported native workbook constructor from the explicitly loaded renderer. */
      const Workbook = module.Workbook ?? module.default?.Workbook;
      if (typeof Workbook !== 'function') {
        throw new ReportDependencyError('exceljs');
      }
      context.signal?.throwIfAborted();
      /** Per-render native workbook; never shared between applications or exports. */
      const workbook = new Workbook();
      workbook.creator = 'ztrial';
      /** Declared Results worksheet containing text cells only. */
      const sheet = workbook.addWorksheet('Results');
      for (const row of reportColumns(report)) {
        context.signal?.throwIfAborted();
        if (row.some((cell) => cell.length > 32767)) {
          throw new ReportExportError('SPREADSHEET_CELL_LIMIT');
        }
        /** Actual row of formula-guarded strings assigned a viewer font reference. */
        const cells = sheet.addRow(row.map(spreadsheetText));
        cells.font = { name: family, size: 11 };
      }
      /** Fixed Summary worksheet with declared version/outcome/duration metadata. */
      const meta = workbook.addWorksheet('Summary');
      for (const row of [
        ['schema', 'ztrial-results'],
        ['version', 1],
        ['passed', report.passed],
        ['failed', report.failed],
        ['skipped', report.skipped],
        ['unavailable', report.unavailable],
        ['durationMs', report.durationMs],
      ]) {
        meta.addRow(row);
      }
      /** Actual native encoded bytes checked again by the common exporter owner. */
      const output = await workbook.xlsx.writeBuffer();
      context.signal?.throwIfAborted();
      return new Uint8Array(output);
    },
  };
}
/** Register an inert licensed-font summary-chart encoder with finite dimensions/provenance labels; this is not browser capture.
 * @param {FontReportOptions & {
    fontFamily: string;
    width?: number;
    height?: number;
    maxSources?: number;
  }} options - Trusted font/family, bounded chart dimensions/source count and optional renderer loader.
 * @returns {ReportExporter} Lazy owned native-image pipeline disposed on completion/abort; encoding is optional and explicit.
 */
export function createPngExporter(
  options: FontReportOptions & {
    /** Explicit renderer/viewer font-family label; no promise against viewer substitution. */
    fontFamily: string;
    /** Whole chart width from128through4096pixels, default1000. */
    width?: number;
    /** Whole chart height from128through4096pixels, default400. */
    height?: number;
    /** Whole distinct provenance-source cap from1through32, default8. */
    maxSources?: number;
  }
): ReportExporter {
  /** Borrowed explicitly trusted optional renderer loader; no execution at factory construction. */
  const load = loader(options);
  /** Validated explicit licensed font path retained for render-time native checks. */
  const file = fontPath(options.fontFile);
  /** Validated explicit font family; viewer substitution remains outside this encoder. */
  const family = options.fontFamily;
  /** Validated finite chart output width. */
  const width = bounded(options.width, 1000, 128, 4096, 'width');
  /** Validated finite chart output height. */
  const height = bounded(options.height, 400, 128, 4096, 'height');
  /** Validated finite chart provenance-source cap. */
  const maxSources = bounded(options.maxSources, 8, 1, 32, 'maxSources');
  if (
    typeof family !== 'string' ||
    !family ||
    family.length > 128 ||
    !/^[-\w .]+$/u.test(family)
  ) {
    throw new TypeError('Invalid image font family');
  }
  return {
    format: 'png',
    extension: 'summary.png',
    kind: 'summary-chart',
    /** Render one previously validated portable report through the explicitly selected optional library, checking cooperative cancellation and declared presentation limits.
     * @param {ResultReportV1} report - Recursively frozen validated portable report; error/source/path disclosure policy is already applied.
     * @param {import('./export.js').RenderContext} context - Finite output budget and optional cooperative caller cancellation.
     * @returns {Promise<Uint8Array>} Actual encoded summary bytes; native failures remain failures and never alter runner test outcomes.
     */
    async render(report, context) {
      /** Actual optional fixed/injected renderer implementation loaded only for this explicit format. */
      const module = await dependency('sharp', load);
      /** Explicitly loaded supported native image factory, never an arbitrary report callback. */
      const sharp = module.default ?? module;
      if (typeof sharp !== 'function') {
        throw new ReportDependencyError('sharp');
      }
      await font(file);
      context.signal?.throwIfAborted();
      /** Distinct actual source/runtime/hash/status provenance, bounded before chart rendering. */
      const sources = [
        ...new Map(
          report.results
            .flatMap((row) => row.coverage)
            .map((source) => [
              JSON.stringify([
                source.source,
                source.runtime,
                source.sourceHash,
                source.status,
              ]),
              source,
            ])
        ).values(),
      ];
      if (sources.length > maxSources) {
        throw new ReportExportError('IMAGE_PROVENANCE_LIMIT');
      }
      if (
        sources.some(
          (source) => source.source.length > 256 || source.runtime.length > 256
        )
      ) {
        throw new ReportExportError('IMAGE_LABEL_LIMIT');
      }
      /** Actual portable row counts by declared Node/browser environment. */
      const environments = report.results.reduce(
        (counts, row) => {
          counts[row.environment]++;
          return counts;
        },
        { node: 0, browser: 0 }
      );
      /** Nonzero scale derived only from actual outcome counts for the summary bars. */
      const maximum = Math.max(
        1,
        report.passed,
        report.failed,
        report.skipped,
        report.unavailable
      );
      /** Fixed plain-text status/provenance chart; markup is escaped before the native text renderer. */
      const chart = [
        'Ztrial summary chart / schema v1',
        `Duration: ${report.durationMs} ms | node: ${environments.node} / browser: ${environments.browser}`,
        ...(['passed', 'failed', 'skipped', 'unavailable'] as const).map(
          (status) =>
            `${status.padEnd(12)} ${String(report[status]).padStart(5)} ${'#'.repeat(Math.round((report[status] / maximum) * 30))}`
        ),
        'Coverage provenance (not line/branch percentages):',
        ...sources.flatMap((source) => [
          `${source.source} | ${source.runtime} | ${source.status}`,
          `hash: ${source.sourceHash ?? 'not instrumented'}`,
        ]),
      ].join('\n');
      /** Owned native image pipeline, destroyed in finally after actual buffer settlement. */
      const image = sharp({
        text: {
          text: xml(chart),
          font: `${family} 14`,
          fontfile: path.resolve(file),
          width: width - 32,
          height: height - 32,
          rgba: true,
        },
      })
        .resize(width, height, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .png();
      /** Destroy only this owned native PDF/image pipeline on cooperative cancellation.
       * @returns {void} Requests native pipeline cancellation without claiming forced JavaScript termination. */
      const abort = () => image.destroy();
      context.signal?.addEventListener('abort', abort, { once: true });
      try {
        if (context.signal?.aborted) {
          abort();
        }
        /** Actual native encoded bytes checked again by the common exporter owner. */
        const output = await image.toBuffer();
        context.signal?.throwIfAborted();
        return new Uint8Array(output);
      } finally {
        context.signal?.removeEventListener('abort', abort);
        image.destroy();
      }
    },
  };
}
