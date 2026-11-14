import test from 'node:test';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
/**
 * Inspect executable syntax rather than treating prose/string literals as Node dependencies.
 * @param {string} source - Compiled browser-entry JavaScript or an inert regression fixture.
 * @returns {string[]} Detected module-loading and Node-global syntax categories.
 */
function browserDependencies(source) {
  /** Parsing never evaluates the browser entry or any synthetic module specifier. */
  const tree = ts.createSourceFile(
    'browser.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  /** Fixed categories avoid retaining full source or private values in diagnostics. */
  const dependencies = [];
  /**
   * Visit syntax nodes while ignoring comments and literal string contents.
   * @param {import('typescript').Node} node - Current parsed syntax node.
   * @returns {void} Appends only fixed violation categories.
   */
  function inspect(node) {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require')))
    ) {
      dependencies.push('module-loading');
    }
    if (ts.isIdentifier(node) && ['Buffer', 'process'].includes(node.text)) {
      dependencies.push('node-global');
    }
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  return dependencies;
}

test('browser dependency qualification ignores prose but rejects actual loading and Node globals', () => {
  assert.deepEqual(
    browserDependencies(
      '/* import Buffer process */ const label = "import Buffer process";'
    ),
    []
  );
  // Each fixture is parsed only: no module, process or native buffer is actually invoked.
  for (const source of [
    'import value from "node:crypto";',
    'export * from "node:fs";',
    'await import("node:fs");',
    'require("node:fs");',
    'Buffer.alloc(1);',
    'process.cwd();',
  ]) {
    assert.ok(browserDependencies(source).length > 0);
  }
});

test('packed schema declarations infer dimensions/metrics; browser import has no Node graph', () => {
  /** Package root whose compiled public archive is inspected without installing a published release. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository tooling root supplies compiler dependencies only, not application runtime state. */
  const root = path.resolve(pkg, '../../..');
  /** Owned disposable consumer root; finally removes its archive, cache and generated declarations. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'analytics-schema-consumer-'));
  try {
    /** npm pack metadata for the local archive; lifecycle scripts are explicitly disabled for this fixture. */
    const packed = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          '--ignore-scripts',
          '--cache',
          path.join(dir, 'cache'),
          '--pack-destination',
          dir,
          '--json',
        ],
        { cwd: pkg, encoding: 'utf8' }
      )
    );
    /** Normalized npm archive record used only to locate the generated tarball. */
    const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Private temporary package scope for the isolated public consumer. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    /** Extracted local package under the temporary scope; no user-managed install is modified. */
    const installed = path.join(scope, 'analytics');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Copy only required installed packages into the owned temporary consumer fixture.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Existing public schema/analysis examples are compiled with preserved negative inference fixtures. */
    const example =
      readFileSync(path.join(pkg, 'examples/versioned-events.ts'), 'utf8') +
      '\n' +
      readFileSync(path.join(pkg, 'examples/analysis.ts'), 'utf8');
    writeFileSync(
      path.join(dir, 'example.ts'),
      example +
        `
// @ts-expect-error unknown finite dimension value
schemas.event('page.view', {properties:{section:'private'}});
// @ts-expect-error missing required dimension
schemas.event('page.view', {properties:{duration_ms:2}});
// @ts-expect-error wrong metric type
schemas.event('page.view', {properties:{section:'docs',duration_ms:'2'}});
// @ts-expect-error unregistered event name
schemas.event('private.event', {properties:{section:'docs'}});
`
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--types',
        'node',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'example.ts',
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    symlinkSync(
      path.join(root, 'packages/@zeruxjs/db'),
      path.join(scope, 'db')
    );
    writeFileSync(
      path.join(dir, 'durable.ts'),
      readFileSync(path.join(pkg, 'examples/durable.ts'), 'utf8')
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--types',
        'node',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'durable.ts',
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    writeFileSync(
      path.join(dir, 'browser.ts'),
      "import {createEventClient} from '@zeruxjs/analytics/browser';\ncreateEventClient({endpoint:'https://events.test',enabled:false});\n"
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--types',
        'node',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'browser.ts',
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    /** Compiled browser entry is parsed for executable dependencies, never scanned as prose. */
    const browser = readFileSync(
      path.join(installed, 'dist/browser.js'),
      'utf8'
    );
    assert.deepEqual(browserDependencies(browser), []);
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {createEventClient} from '@zeruxjs/analytics/browser'; createEventClient({endpoint:'https://events.test',enabled:false});",
      ],
      { cwd: dir, encoding: 'utf8', timeout: 5000 }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
