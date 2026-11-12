import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as ts from 'typescript';
import {
  buildTypescript,
  checkTypes,
  createTsConfig,
  registerTypescript,
  transformTypescript,
} from '@zeruxjs/typescript';
import { createTypeScriptPreset } from '@zeruxjs/typescript/presets';
/** Allocate a private fixture root; each test removes it in finally.
 * @returns {string} Absolute path to the owned temporary directory.
 */
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-ts-foundation-'));
/** Write trusted synthetic fixture text, creating its parent directories.
 * @param {string} root - Owned fixture directory.
 * @param {string} file - Trusted relative fixture path beneath root.
 * @param {string} text - Synthetic UTF-8 contents; never evaluated by this helper.
 * @returns {void} Completes after the write; filesystem errors propagate.
 */
const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
/** Preserve compiler diagnostics in assertion failures without executing fixtures.
 * @param {import('typescript').Diagnostic[]} diagnostics - Raw fixture compiler diagnostics.
 * @returns {string} Human-readable compiler output for assertion messages.
 */
const format = (diagnostics) =>
  ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (f) => f,
    getNewLine: () => '\n',
  });

test(
  'installed exports, generated presets and package-owned declarations',
  { timeout: 120000 },
  () => {
    /** Owned synthetic fixture root, removed in the enclosing finally block. */
    const root = temporary();
    try {
      // Every npm operation uses this disposable prefix/cache, never the operator cache.
      /** Bounded npm runner using only this test prefix and cache; failures propagate.
       * @param {string[]} args - npm arguments passed directly without shell interpolation.
       * @param {string} [cwd=root] - Owned fixture working directory.
       * @returns {string} Captured UTF-8 stdout; nonzero exit or timeout throws.
       */
      const npm = (args, cwd = root) =>
        execFileSync('npm', [...args, '--cache', path.join(root, 'cache')], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000,
        });
      /** Archive metadata for the already-built tooling package; no prepack hook runs. */
      const packed = Object.values(
        JSON.parse(
          npm([
            'pack',
            path.resolve(import.meta.dirname, '..'),
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            root,
          ])
        )
      );
      write(
        root,
        'package.json',
        JSON.stringify({
          name: 'typescript-consumer',
          private: true,
          type: 'module',
        })
      );
      // Pack already installed dependencies too, keeping this check offline and
      // independent of the user's npm cache (which may be read-only).
      /** Fixture-side resolver used to locate already installed dependency manifests. */
      const localRequire = createRequire(import.meta.url);
      /** Explicit local archive dependencies for the offline installed consumer. */
      const dependencies = {
        '@zeruxjs/typescript': `file:${path.join(root, packed[0].filename)}`,
      };
      // name selects an installed dependency to archive, never an external download.
      for (const name of [
        'typescript',
        'esbuild',
        '@types/node',
        '@types/ws',
        'undici-types',
        `@esbuild/${process.platform}-${process.arch}`,
      ]) {
        /** Resolved installed dependency manifest used to locate its packaging root. */
        const manifest = localRequire.resolve(name + '/package.json');
        /** Archive metadata for an installed dependency packed into the owned fixture. */
        const archive = Object.values(
          JSON.parse(
            npm([
              'pack',
              path.dirname(manifest),
              '--ignore-scripts',
              '--json',
              '--pack-destination',
              root,
            ])
          )
        );
        dependencies[name] = `file:${path.join(root, archive[0].filename)}`;
      }
      write(
        root,
        'package.json',
        JSON.stringify({
          name: 'typescript-consumer',
          private: true,
          type: 'module',
          dependencies,
        })
      );
      npm([
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ]);
      /** Installed package path inspected to reject accidental reliance on workspace source. */
      const installed = path.join(root, 'node_modules/@zeruxjs/typescript');
      assert.ok(!fs.existsSync(path.join(installed, 'src')));
      /** CommonJS resolver/registry handle used to inspect the fixture environment. */
      const req = createRequire(path.join(root, 'package.json'));
      // require.resolve uses require conditions; use ESM import.meta.resolve instead
      // since this tooling package intentionally exposes ESM-only entries.
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import assert from 'node:assert/strict';
      for (const subpath of ['', '/presets', '/tsconfig', '/build', '/loader']) {
        assert.ok(import.meta.resolve('@zeruxjs/typescript' + subpath).includes('/node_modules/@zeruxjs/typescript/dist/'));
        await import('@zeruxjs/typescript' + subpath);
      }
      assert.throws(() => import.meta.resolve('@zeruxjs/typescript/src/index.js'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    `,
        ],
        { cwd: root }
      );
      // preset selects a separate environment fixture and its expected declarations.
      for (const preset of [
        'node-server',
        'browser-library',
        'mixed-exports',
      ]) {
        /** Owned preset-specific consumer directory with its own manifest and source. */
        const directory = path.join(root, preset);
        // Each preset must compile a genuinely different environment contract.
        /** Synthetic source texts proving distinct Node, browser and portable contracts. */
        const sources = {
          'node-server': 'export const runtime: string = process.version;\n',
          'browser-library':
            "import { createTypeScriptPreset } from '@zeruxjs/typescript/presets'; export const preset = createTypeScriptPreset('browser-library'); export const element: HTMLElement = document.createElement('div');\n",
          'mixed-exports': "export const portable: string = 'hello';\n",
        };
        /** Source selected for the current preset fixture, written without executing it here. */
        const code = sources[preset];
        /** Expected public declaration/import map, preserved by config generation. */
        const exports = {
          '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        };
        write(
          directory,
          'package.json',
          JSON.stringify({ name: preset, type: 'module', exports })
        );
        write(directory, 'src/index.ts', code);
        createTsConfig(directory, { preset });
        /** Actual tooling result inspected by the following behavior assertions. */
        const result = checkTypes({ cwd: directory, files: [] });
        assert.equal(result.status, 'passed', format(result.diagnostics));
        execFileSync(
          process.execPath,
          [req.resolve('typescript/bin/tsc'), '-p', directory],
          { cwd: directory }
        );
        assert.ok(fs.existsSync(path.join(directory, 'dist/index.d.ts')));
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(directory, 'package.json')))
            .exports,
          exports
        );
      }
      write(
        root,
        'src/index.ts',
        `import { checkTypes, type TypecheckResult } from '@zeruxjs/typescript';
import { createTypeScriptPreset, type TypeScriptPreset } from '@zeruxjs/typescript/presets';
import { createTsConfig } from '@zeruxjs/typescript/tsconfig';
import { buildTypescript } from '@zeruxjs/typescript/build';
import { load } from '@zeruxjs/typescript/loader';
export const preset: TypeScriptPreset = createTypeScriptPreset('node-server');
createTsConfig(process.cwd(), { compilerOptions: preset.compilerOptions, include: preset.include });
export const result: TypecheckResult = checkTypes({files: []});
export { buildTypescript, createTsConfig, load };\n`
      );
      createTsConfig(root, {
        preset: 'node-server',
        compilerOptions: { skipLibCheck: false },
      });
      /** Installed public-import typecheck result, independent of source aliases. */
      const consumer = checkTypes({
        cwd: root,
        files: [],
        checkDependencies: true,
      });
      assert.equal(consumer.ok, true, format(consumer.diagnostics));
      /** Browser-only fixture directory used to check that Node globals stay unavailable. */
      const browser = path.join(root, 'browser-library');
      write(
        browser,
        'src/denied.ts',
        'export const leak = process.version; export const bytes = Buffer.alloc(1);'
      );
      /** Typecheck result for deliberately forbidden browser-global usage. */
      const denied = checkTypes({ cwd: browser, files: [] });
      assert.equal(denied.status, 'failed');
      // Each name must appear in browser-denial diagnostics, not just any error.
      for (const name of ['process', 'Buffer']) {
        assert.ok(
          denied.diagnostics.some((d) =>
            ts.flattenDiagnosticMessageText(d.messageText, '\n').includes(name)
          )
        );
      }
      assert.doesNotMatch(
        fs.readFileSync(path.join(browser, 'dist/index.d.ts'), 'utf8'),
        /NodeJS|Buffer|node:/
      );
      delete dependencies.typescript;
      write(
        root,
        'package.json',
        JSON.stringify({
          name: 'typescript-consumer',
          private: true,
          type: 'module',
          dependencies,
        })
      );
      write(
        root,
        'src/invalid.ts',
        "import ts from 'typescript'; import '@zeruxjs/typescript/private'; export { ts };\n"
      );
      /** Typecheck result for deliberately undeclared or unexported package imports. */
      const invalid = checkTypes({
        cwd: root,
        files: [],
        checkDependencies: true,
      });
      assert.equal(invalid.status, 'failed');
      assert.ok(invalid.diagnostics.some((d) => d.code === 95001));
      assert.ok(invalid.diagnostics.some((d) => d.code === 2307));
      dependencies['untyped-fixture'] = '1.0.0';
      write(
        root,
        'package.json',
        JSON.stringify({
          name: 'typescript-consumer',
          private: true,
          type: 'module',
          dependencies,
        })
      );
      write(
        root,
        'node_modules/untyped-fixture/package.json',
        JSON.stringify({
          name: 'untyped-fixture',
          type: 'module',
          exports: './index.js',
        })
      );
      write(
        root,
        'node_modules/untyped-fixture/index.js',
        'export const value = 1;'
      );
      write(
        root,
        'src/untyped.ts',
        "import { value } from 'untyped-fixture'; export { value };"
      );
      assert.ok(
        checkTypes({
          cwd: root,
          files: [],
          checkDependencies: true,
        }).diagnostics.some((d) => d.code === 7016)
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test('preset validation and hook registration have no partial mutation', () => {
  assert.throws(() => createTypeScriptPreset('unknown'), /Unknown/);
  assert.throws(() => transformTypescript(42), /source/);
  assert.throws(() => transformTypescript('', { format: 'unknown' }), /format/);
  /** Caller-owned preset copy mutated to prove that subsequent results are independent. */
  const preset = createTypeScriptPreset('browser-library');
  preset.compilerOptions.types.push('node');
  assert.deepEqual(
    createTypeScriptPreset('browser-library').compilerOptions.types,
    []
  );
  /** CommonJS resolver/registry handle used to inspect the fixture environment. */
  const req = createRequire(import.meta.url);
  /** Captured global TS handler used to verify registration rollback and disposal. */
  const before = req.extensions['.ts'];
  assert.throws(
    () => registerTypescript({ extensions: ['.ts', '.js'] }),
    /extensions/
  );
  assert.equal(req.extensions['.ts'], before);
  /** Owned hook disposer exercised for idempotent restoration. */
  const dispose = registerTypescript({ extensions: ['.ts'] });
  dispose();
  dispose();
  assert.equal(req.extensions['.ts'], before);
  /** Owned synthetic fixture root, removed in the enclosing finally block. */
  const root = temporary();
  try {
    assert.throws(() => createTsConfig(root, { preset: 'invalid' }), /Unknown/);
    assert.throws(
      () => createTsConfig(root, { compilerOptions: { module: 'invalid' } }),
      /module/
    );
    assert.ok(!fs.existsSync(path.join(root, 'tsconfig.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('typecheck cancellation, configuration and dependency failures', () => {
  /** Owned synthetic fixture root, removed in the enclosing finally block. */
  const root = temporary();
  try {
    write(root, 'src/index.ts', "export const value: number = 'bad';");
    assert.ok(transformTypescript("export const value: number = 'bad';").code);
    /** Fixture-owned cancellation controller; no production resources are controlled. */
    const controller = new AbortController();
    controller.abort('cancel requested');
    /** Cancellation result checked for failure status and preserved abort reason. */
    const cancelled = checkTypes({
      cwd: root,
      files: ['src/index.ts'],
      signal: controller.signal,
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.reason, 'cancel requested');
    assert.equal(cancelled.ok, false);
    /** Diagnostic result for deliberately invalid synthetic source. */
    const failed = checkTypes({ cwd: root, files: ['src/index.ts'] });
    assert.equal(failed.status, 'failed');
    assert.ok(failed.diagnostics.some((d) => d.code === 2322));
    assert.ok(
      checkTypes({
        cwd: root,
        files: ['src/index.ts'],
        checkDependencies: true,
      }).diagnostics.some((d) => d.code === 95002)
    );
    assert.equal(
      checkTypes({ cwd: root, files: [], configFile: 'missing.json' }).status,
      'failed'
    );
    write(root, 'package.json', '{');
    assert.ok(
      checkTypes({
        cwd: root,
        files: ['src/index.ts'],
        checkDependencies: true,
      }).diagnostics.some((d) => d.code === 95002)
    );
    assert.throws(() => checkTypes({ files: 'src/index.ts' }), /array/);
    assert.equal(
      checkTypes({
        files: [],
        cancellationToken: {
          isCancellationRequested: () => true,
          throwIfCancellationRequested() {},
        },
      }).status,
      'cancelled'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('browser bundle, raw dependency failures and cancellation cleanup', async () => {
  /** Owned synthetic fixture root, removed in the enclosing finally block. */
  const root = temporary();
  try {
    write(root, 'src/index.ts', 'export const title: string = document.title;');
    /** Fixture-owned cancellation controller; no production resources are controlled. */
    const controller = new AbortController();
    await buildTypescript({
      cwd: root,
      entryPoints: ['src/index.ts'],
      outdir: 'dist',
      platform: 'browser',
      bundle: true,
      signal: controller.signal,
    });
    assert.match(
      fs.readFileSync(path.join(root, 'dist/index.js'), 'utf8'),
      /document.title/
    );
    controller.abort();
    await assert.rejects(
      buildTypescript({
        cwd: root,
        entryPoints: ['src/index.ts'],
        outdir: 'cancelled',
        signal: controller.signal,
      }),
      { name: 'AbortError' }
    );
    assert.ok(!fs.existsSync(path.join(root, 'cancelled')));
    /** Controller used to interrupt only the fixture build context. */
    const active = new AbortController();
    /** Owned in-flight build promise; awaited through its cancellation result. */
    const pending = buildTypescript({
      cwd: root,
      entryPoints: ['src/index.ts'],
      outdir: 'interrupted',
      signal: active.signal,
    });
    /** Owned timer requesting cancellation; cleared in finally regardless of outcome. */
    const abortTimer = setTimeout(() => active.abort('stop'), 0);
    try {
      await assert.rejects(pending, { name: 'AbortError' });
    } finally {
      clearTimeout(abortTimer);
    }
    // Rebuild after cancellation demonstrates no retained context blocks reuse.
    await buildTypescript({
      cwd: root,
      entryPoints: ['src/index.ts'],
      outdir: 'resumed',
      signal: new AbortController().signal,
    });
    write(root, 'src/index.ts', "import 'missing-zerux-test-dependency';");
    await assert.rejects(
      buildTypescript({
        cwd: root,
        entryPoints: ['src/index.ts'],
        outdir: 'bad',
        bundle: true,
      }),
      (error) =>
        error.errors?.some((d) => /missing-zerux-test-dependency/.test(d.text))
    );
    write(root, 'src/index.ts', "import fs from 'node:fs'; export { fs };");
    await assert.rejects(
      buildTypescript({
        cwd: root,
        entryPoints: ['src/index.ts'],
        outdir: 'bad',
        bundle: true,
        platform: 'browser',
      }),
      (error) => error.errors?.length > 0
    );
    await assert.rejects(
      buildTypescript({ cwd: root, entryPoints: [], outdir: 'bad' }),
      /entry point/
    );
    await assert.rejects(
      buildTypescript({
        cwd: root,
        entryPoints: ['src/index.ts'],
        outdir: '.',
      }),
      /project root/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
