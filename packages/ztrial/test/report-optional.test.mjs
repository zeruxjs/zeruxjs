import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {
  createReportExporters,
  createPdfExporter,
  createXlsxExporter,
  createPngExporter,
} from 'ztrial/reports';
/** Explicit optional test-module directory from host configuration; absent means no artifact environment is claimed. */
const modules = process.env.ZTRIAL_REPORT_TEST_MODULES;
/** Explicit host-supplied licensed test font path; no font is downloaded or bundled by this check. */
const fontFile = process.env.ZTRIAL_REPORT_TEST_FONT;
/** Explicit prerequisite presence only; native parser/renderer acceptance still requires actual execution. */
const available = !!modules && !!fontFile;
/** Fixed synthetic portable report, never real browser instrumentation or recipient data. */
const input = {
  passed: 1,
  failed: 0,
  skipped: 0,
  durationMs: 4,
  results: [
    {
      name: '=SUM(1,2) & <tag> "quotes"',
      status: 'passed',
      durationMs: 4,
      environment: 'browser',
      coverage: [
        {
          version: 1,
          format: 'v8-ranges',
          runtime: 'chromium:fixture',
          source: 'https://test.invalid/app.js',
          status: 'uninstrumented',
          ranges: [],
        },
      ],
    },
  ],
};
/** Resolve only a fixed optional test renderer from the explicitly configured host environment; this helper never installs or scans arbitrary packages.
 * @param {string} name - Fixed internal pdfkit/exceljs/sharp fixture identifier.
 * @returns {() => Promise<unknown>} Explicit trusted lazy loader used only when native artifact prerequisites are configured.
 */
function moduleLoader(name) {
  return async () => {
    /** Module resolver bound only to the explicitly configured optional test environment. */
    const require = createRequire(join(modules, 'package.json'));
    return import(pathToFileURL(require.resolve(name)).href);
  };
}

test(
  'real optional artifacts open in PDF, workbook/XML and PNG parsers',
  {
    skip: !available
      ? 'Set explicit optional test modules/font paths; no optional packages installed automatically'
      : false,
  },
  async () => {
    /** Owned private synthetic output namespace removed after native parser checks. */
    const root = await fs.mkdtemp(join(tmpdir(), 'ztrial-optional-report-'));
    try {
      /** Explicit optional presentation registry with trusted fixed dependency loaders. */
      const exporters = createReportExporters([
        createPdfExporter({
          fontFile,
          load: moduleLoader('pdfkit'),
          maxPages: 2,
        }),
        createXlsxExporter({
          fontFamily: 'DejaVu Sans',
          load: moduleLoader('exceljs'),
        }),
        createPngExporter({
          fontFile,
          fontFamily: 'DejaVu Sans',
          load: moduleLoader('sharp'),
          width: 800,
          height: 320,
        }),
      ]);
      for (const format of ['pdf', 'xlsx', 'png']) {
        /** Actual committed native fixture artifact receipt; byte count alone is followed by independent parsers. */
        const result = await exporters.write(input, {
          directory: root,
          name: 'optional',
          format,
        });
        assert.ok(result.bytes > 100);
        assert.equal(
          result.kind,
          format === 'png' ? 'summary-chart' : 'summary'
        );
      }
      /** Actual PDFInfo output used to verify the generated document page count. */
      const info = execFileSync(
        'pdfinfo',
        [join(root, 'optional.summary.pdf')],
        { encoding: 'utf8' }
      );
      assert.match(info, /Pages:\s+1/);
      /** Actual PDFToText output used to verify retained declared provenance. */
      const text = execFileSync(
        'pdftotext',
        [join(root, 'optional.summary.pdf'), '-'],
        { encoding: 'utf8' }
      );
      assert.match(text, /Ztrial results schema v1/);
      assert.match(text, /browser/);
      assert.match(text, /v8-ranges/);
      /** Explicit optional native workbook renderer loaded only for this qualified test path. */
      const excel = await moduleLoader('exceljs')();
      /** Supported native workbook constructor from the explicitly selected test environment. */
      const Workbook = excel.Workbook ?? excel.default.Workbook;
      /** Per-fixture native workbook reader opening only its newly generated XLSX. */
      const workbook = new Workbook();
      await workbook.xlsx.readFile(join(root, 'optional.results.xlsx'));
      /** Actual parsed string cell proving formula-leading fixture text is not a formula object. */
      const value = workbook.getWorksheet('Results').getCell('C2').value;
      assert.equal(value, "'" + input.results[0].name);
      assert.equal(typeof value, 'string');
      /** Actual ZIP/XML/Pillow parser receipts for generated XLSX/PNG, not fabricated metadata. */
      const parsed = JSON.parse(
        execFileSync(
          'python3',
          [
            '-c',
            `import json,zipfile,xml.etree.ElementTree as ET,sys
from PIL import Image
with zipfile.ZipFile(sys.argv[1]) as z:
 names=z.namelist()
 for name in names:
  if name.endswith('.xml'): ET.fromstring(z.read(name))
with Image.open(sys.argv[2]) as image:
 image.load(); print(json.dumps({'format':image.format,'size':image.size,'zipEntries':len(names)}))`,
            join(root, 'optional.results.xlsx'),
            join(root, 'optional.summary.png'),
          ],
          { encoding: 'utf8' }
        )
      );
      assert.equal(parsed.format, 'PNG');
      assert.deepEqual(parsed.size, [800, 320]);
      assert.ok(parsed.zipEntries > 5);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
);

test(
  'optional page, row, pixel and font policies fail without partial output',
  { skip: !available },
  async () => {
    /** Known over-budget synthetic report rows triggering finite page/row policy checks. */
    const many = {
      ...input,
      results: Array.from({ length: 60 }, (_, index) => ({
        ...input.results[0],
        name: 'case ' + index,
      })),
    };
    /** Explicit optional presentation registry with trusted fixed dependency loaders. */
    const exporters = createReportExporters([
      createPdfExporter({
        fontFile,
        maxPages: 1,
        load: moduleLoader('pdfkit'),
      }),
      createXlsxExporter({
        fontFamily: 'Test',
        maxRows: 1,
        load: moduleLoader('exceljs'),
      }),
    ]);
    await assert.rejects(
      exporters.render(many, 'pdf'),
      (error) => error.code === 'PAGE_LIMIT'
    );
    await assert.rejects(
      exporters.render(many, 'xlsx'),
      (error) => error.code === 'ROW_LIMIT'
    );
    assert.throws(
      () => createPngExporter({ fontFile, fontFamily: 'Test', width: 99999 }),
      /width/
    );
    /** Owned private synthetic output namespace removed after native parser checks. */
    const root = await fs.mkdtemp(join(tmpdir(), 'ztrial-font-policy-'));
    try {
      /** Owned temporary font symlink used only to verify unsafe-font rejection. */
      const link = join(root, 'font.ttf');
      await fs.symlink(fontFile, link);
      /** Explicit optional PDF registry using the fixture’s disallowed symlink font. */
      const invalid = createReportExporters([
        createPdfExporter({ fontFile: link, load: moduleLoader('pdfkit') }),
      ]);
      await assert.rejects(
        invalid.render(input, 'pdf'),
        (error) => error.code === 'INVALID_FONT'
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
);
