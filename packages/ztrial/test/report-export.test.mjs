import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  createReportExporters,
  createResultReport,
  createPdfExporter,
  createXlsxExporter,
  createPngExporter,
} from 'ztrial/reports';
import { formatSummary } from '../dist/utils/logger.js';
const row = (name, status = 'passed') => ({
  name,
  status,
  durationMs: 1,
  environment: 'node',
});
const summary = (results) => ({
  passed: 0,
  failed: 0,
  skipped: 0,
  unavailable: 0,
  durationMs: 5,
  results,
});

test('JSON/JUnit/CSV share schema, preserve special text, protect formulas and omit secrets', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'ztrial-reports-'));
  const exporters = createReportExporters();
  const special = '=SUM(1,2) <tag>&"\'\n雪';
  const input = summary([
    {
      ...row(special, 'failed'),
      error: new Error('private-secret-token'),
      coverage: [
        {
          version: 1,
          format: 'v8-ranges',
          runtime: 'node:test',
          source: 'https://user:password@example.test/app?token=private',
          status: 'uninstrumented',
          ranges: [],
        },
      ],
      artifacts: [{ type: 'video', path: 'private/video.webm' }],
    },
    row('skip', 'skipped'),
    row('browser missing', 'environment-unavailable'),
  ]);
  try {
    for (const format of ['json', 'junit', 'csv'])
      await exporters.write(input, { directory: root, name: 'checks', format });
    const json = JSON.parse(
      await fs.readFile(join(root, 'checks.results.json'), 'utf8')
    );
    assert.equal(json.schema, 'ztrial-results');
    assert.equal(json.version, 1);
    assert.equal(json.failed, 1);
    assert.equal(json.unavailable, 1);
    assert.equal(json.results[0].name, special);
    assert.equal(json.results[0].artifacts[0].type, 'video');
    assert.ok(json.results[0].artifacts[0].path.startsWith('artifact-'));
    for (const file of await fs.readdir(root)) {
      const content = await fs.readFile(join(root, file), 'utf8');
      assert.ok(!content.includes('private-secret-token'));
      assert.ok(!content.includes('password'));
      assert.ok(!content.includes('private/video'));
    }
    const parsed = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `import json,csv,xml.etree.ElementTree as ET,sys
root=ET.parse(sys.argv[1]).getroot(); suite=root.find('testsuite'); case=suite.find('testcase')
rows=list(csv.reader(open(sys.argv[2],newline='',encoding='utf-8')))
print(json.dumps({'tests':suite.attrib['tests'],'errors':suite.attrib['errors'],'name':case.attrib['name'],'failure':case.find('failure') is not None,'csvName':rows[1][2],'csvRows':len(rows)}))`,
          join(root, 'checks.junit.xml'),
          join(root, 'checks.results.csv'),
        ],
        { encoding: 'utf8' }
      )
    );
    assert.equal(parsed.tests, '3');
    assert.equal(parsed.errors, '1');
    assert.equal(parsed.name, special);
    assert.equal(parsed.failure, true);
    assert.equal(parsed.csvName, "'" + special);
    assert.equal(parsed.csvRows, 4);
    assert.equal(input.failed, 0);
    assert.equal(input.results[0].error.message, 'private-secret-token');
    const cli = JSON.parse(formatSummary(input, 'json'));
    assert.equal(cli.schema, json.schema);
    assert.equal(cli.results[0].error, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('formula prefixes, disclosure and redaction stay explicit', async () => {
  const exporters = createReportExporters();
  const inputs = ['=1', ' +1', '-1', '@calc', '\t=1', '\rtext', '\ntext'];
  const csv = await exporters.render(
    summary(inputs.map((value) => row(value))),
    'csv'
  );
  const parsed = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        'import csv,json,sys;print(json.dumps([r[2] for r in list(csv.reader(sys.stdin))[1:]]))',
      ],
      { input: Buffer.from(csv.bytes), encoding: 'utf8' }
    )
  );
  assert.deepEqual(
    parsed,
    inputs.map((value) => "'" + value)
  );
  assert.equal(
    createResultReport(summary([row('bad\u0000\uD800name')])).results[0].name,
    'badname'
  );
  const document = createResultReport(
    summary([{ ...row('public', 'failed'), error: new Error('token=secret') }]),
    {
      includeErrors: true,
      redact: (text) => text.replace(/secret/g, '[redacted]'),
    }
  );
  assert.equal(document.results[0].error.message, 'token=[redacted]');
});

test('budgets and unsupported adapters reject before producing output', async () => {
  const exporters = createReportExporters();
  await assert.rejects(
    exporters.render(summary([row('x')]), 'html'),
    (error) => error.code === 'UNSUPPORTED_FORMAT'
  );
  assert.throws(
    () =>
      createResultReport(summary(Array.from({ length: 1001 }, () => row('x')))),
    (error) => error.code === 'INPUT_LIMIT_OR_SCHEMA'
  );
  assert.throws(
    () =>
      createResultReport(summary([row('x'.repeat(100))]), {
        maxInputBytes: 20,
      }),
    (error) => error.code === 'INPUT_BYTE_LIMIT'
  );
  assert.throws(
    () =>
      createResultReport(
        summary([
          { ...row('x'), artifacts: [{ type: 'screenshot', path: 'img.png' }] },
        ]),
        { maxAttachments: 0 }
      ),
    (error) => error.code === 'ATTACHMENT_LIMIT'
  );
  await assert.rejects(
    exporters.render(summary([row('x')]), 'json', { maxOutputBytes: 10 }),
    (error) => error.code === 'OUTPUT_BYTE_LIMIT'
  );
  assert.throws(
    () =>
      createReportExporters([
        {
          format: 'json',
          extension: 'evil',
          kind: 'summary',
          render: () => new Uint8Array(),
        },
      ]),
    /conflicting/
  );
});

test('traversal/symlink outputs and attachment escapes reject; existing output remains intact', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'ztrial-paths-'));
  const exporters = createReportExporters();
  const input = summary([row('valid')]);
  try {
    await exporters.write(input, { directory: root, format: 'json' });
    const before = await fs.readFile(join(root, 'ztrial.results.json'), 'utf8');
    await assert.rejects(
      exporters.write(input, { directory: root, format: 'json' }),
      (error) => error.code === 'OUTPUT_EXISTS'
    );
    await assert.rejects(
      exporters.write(input, {
        directory: root,
        name: '../escape',
        format: 'json',
      }),
      (error) => error.code === 'UNSAFE_OUTPUT_NAME'
    );
    const outside = join(root, 'outside');
    await fs.writeFile(outside, 'safe');
    await fs.symlink(outside, join(root, 'link.results.json'));
    await assert.rejects(
      exporters.write(input, {
        directory: root,
        name: 'link',
        format: 'json',
        overwrite: true,
      }),
      (error) => error.code === 'UNSAFE_OUTPUT_PATH'
    );
    assert.equal(await fs.readFile(outside, 'utf8'), 'safe');
    await fs.symlink(root, root + '-link', 'dir');
    try {
      await assert.rejects(
        exporters.write(input, { directory: root + '-link', format: 'json' }),
        (error) => error.code === 'UNSAFE_OUTPUT_PATH'
      );
    } finally {
      await fs.rm(root + '-link', { force: true });
    }
    assert.throws(
      () =>
        createResultReport(
          summary([
            {
              ...row('x'),
              artifacts: [{ type: 'trace', path: '../private.zip' }],
            },
          ])
        ),
      (error) => error.code === 'UNSAFE_ATTACHMENT_REFERENCE'
    );
    assert.equal(
      await fs.readFile(join(root, 'ztrial.results.json'), 'utf8'),
      before
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('interrupted staged write and failed atomic publication release handles without partial replacement', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'ztrial-atomic-'));
  const exporters = createReportExporters();
  const input = summary([row('old')]);
  try {
    await exporters.write(input, { directory: root, format: 'json' });
    const file = join(root, 'ztrial.results.json'),
      before = await fs.readFile(file, 'utf8');
    const controller = new AbortController();
    const open = fs.open.bind(fs);
    let closed = 0;
    const replacement = mock.method(fs, 'open', async (...args) => {
      const handle = await open(...args);
      const write = handle.write.bind(handle),
        close = handle.close.bind(handle);
      handle.write = async (...values) => {
        const result = await write(...values);
        controller.abort();
        return result;
      };
      handle.close = async () => {
        closed++;
        return close();
      };
      return handle;
    });
    try {
      await assert.rejects(
        exporters.write(summary([row('new')]), {
          directory: root,
          format: 'json',
          overwrite: true,
          signal: controller.signal,
        })
      );
    } finally {
      replacement.mock.restore();
    }
    assert.equal(closed, 1);
    assert.equal(await fs.readFile(file, 'utf8'), before);
    assert.ok(
      !(await fs.readdir(root)).some((name) =>
        name.startsWith('.ztrial-report-')
      )
    );
    const rename = mock.method(fs, 'rename', async () => {
      throw Object.assign(new Error('backend unavailable'), { code: 'EIO' });
    });
    try {
      await assert.rejects(
        exporters.write(input, {
          directory: root,
          format: 'json',
          overwrite: true,
        }),
        (error) => error.code === 'EIO'
      );
    } finally {
      rename.mock.restore();
    }
    assert.equal(await fs.readFile(file, 'utf8'), before);
    assert.ok(
      !(await fs.readdir(root)).some((name) =>
        name.startsWith('.ztrial-report-')
      )
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('custom adapters are scoped and optional dependencies fail without mutating test status', async () => {
  const input = summary([row('passed')]);
  const adapters = [
    createPdfExporter({
      fontFile: '/synthetic/font.ttf',
      load: async () => {
        throw Error('missing');
      },
    }),
    createXlsxExporter({
      fontFamily: 'Test',
      load: async () => {
        throw Error('missing');
      },
    }),
    createPngExporter({
      fontFile: '/synthetic/font.ttf',
      fontFamily: 'Test',
      load: async () => {
        throw Error('missing');
      },
    }),
  ];
  const exporters = createReportExporters(adapters);
  for (const format of ['pdf', 'xlsx', 'png'])
    await assert.rejects(
      exporters.render(input, format),
      (error) => error.code === 'DEPENDENCY_UNAVAILABLE'
    );
  assert.equal(input.results[0].status, 'passed');
  const custom = createReportExporters([
    {
      format: 'custom',
      extension: 'custom.txt',
      kind: 'summary',
      render: (report) => {
        assert.ok(Object.isFrozen(report.results[0]));
        return new TextEncoder().encode(report.schema);
      },
    },
  ]);
  assert.equal(
    new TextDecoder().decode((await custom.render(input, 'custom')).bytes),
    'ztrial-results'
  );
  assert.ok(!createReportExporters().formats().includes('custom'));
});

test('default optional loaders report actual absent modules without auto-installing', async (t) => {
  for (const [name, adapter] of [
    ['pdfkit', createPdfExporter({ fontFile: '/synthetic/font.ttf' })],
    ['exceljs', createXlsxExporter({ fontFamily: 'Test' })],
    [
      'sharp',
      createPngExporter({
        fontFile: '/synthetic/font.ttf',
        fontFamily: 'Test',
      }),
    ],
  ]) {
    try {
      const resolved = import.meta.resolve(name);
      assert.equal(typeof resolved, 'string');
      t.diagnostic(
        name + ' installed; absence covered through explicit failing loader'
      );
    } catch {
      await assert.rejects(
        createReportExporters([adapter]).render(
          summary([row('safe')]),
          adapter.format
        ),
        (error) =>
          error.code === 'DEPENDENCY_UNAVAILABLE' && error.dependency === name
      );
    }
  }
});
