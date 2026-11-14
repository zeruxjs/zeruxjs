import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverLintFiles, loadLintConfig } from '../dist/index.js';
import { createRequire } from 'node:module';
/** Fixture-local resolver used only for installed engine/manifest discovery. */
const require = createRequire(import.meta.url);

test('discovers nested source files while skipping build output and symlinks', () => {
  /** Owned synthetic fixture directory or resolved package root used by the following checks. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-lint-'));
  try {
    // dir selects an owned fixture directory, including intentionally ignored outputs.
    for (const dir of ['src', 'dist', 'node_modules', 'src/nested']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'const a = 1;');
    fs.writeFileSync(path.join(root, 'src/nested/b.css'), 'body {}');
    fs.writeFileSync(path.join(root, 'dist/c.js'), '');
    fs.writeFileSync(path.join(root, 'node_modules/d.js'), '');
    fs.symlinkSync(path.join(root, 'dist'), path.join(root, 'src/linked'));
    assert.deepEqual(
      discoverLintFiles(root).map((s) => path.relative(root, s)),
      ['src/a.ts', 'src/nested/b.css']
    );
    assert.throws(() => discoverLintFiles(root, { maxFiles: 1 }), /exceeds/);
    assert.throws(
      () => discoverLintFiles(root, { files: ['../outside'] }),
      /escapes/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('loads JSON project configuration and refuses symlink configs', async () => {
  /** Owned synthetic fixture directory or resolved package root used by the following checks. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-lintcfg-'));
  try {
    assert.deepEqual(await loadLintConfig(root), {});
    /** Owned synthetic input path used for bounded source and no-write checks. */
    const file = path.join(root, 'lint.zerux.json');
    fs.writeFileSync(file, JSON.stringify({ fix: true }));
    assert.deepEqual(await loadLintConfig(root), { fix: true });
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(root, 'missing'), file);
    await assert.rejects(() => loadLintConfig(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('licensed media adapter preserves SCSS operator diagnostics and source positions', async () => {
  /** Actual installed stylesheet engine used for compatibility fixtures. */
  const stylelint = (await import('stylelint')).default;
  /** Actual installed SCSS plugin; source-offset behavior is checked without replacing its rules. */
  const scss = (await import('stylelint-scss')).default;
  /** Native SCSS operator rule exercised against the licensed parser adapter. */
  const ruleName = 'scss/operator-no-unspaced';
  /** Synthetic stylesheets and expected diagnostic counts, not production styles. */
  const cases = [
    ['@media (min-width: $size + 1px) { a {} }', 0],
    ['@media (min-width: $size+1px) { a {} }', 2],
    ['@media (min-width: calc($size+1px)) { a {} }', 2],
    ['@media #{$kind+1} and (width: $size+1) { a {} }', 4],
    ['@import url(10px +2);', 1],
    ['@import url("font(1).css") screen and (width: $size+1);', 2],
    ['@media screen /* (ignored: value) */ and (width: $size+1) { a {} }', 2],
  ];
  // code and count define a native SCSS diagnostic fixture and its expected number of findings.
  for (const [code, count] of cases) {
    /** Actual engine diagnostics inspected for count and source-position compatibility. */
    const output = await stylelint.lint({
      code,
      customSyntax: 'postcss-scss',
      config: { plugins: [scss], rules: { [ruleName]: true } },
    });
    /** Native diagnostic records checked against the synthetic stylesheet source. */
    const warnings = output.results[0].warnings;
    assert.equal(warnings.length, count, code);
    // warning must point to the actual unspaced operator in the synthetic source.
    for (const warning of warnings) {
      // PostCSS strips comments from params before the upstream rule computes offsets.
      if (!code.includes('/*')) {
        assert.equal(
          code[warning.column - 1],
          '+',
          `Incorrect source offset: ${code}`
        );
      }
    }
  }
  // Resolve from the plugin to verify that the licensed adapter is installed.
  /** Resolver anchored to the actual plugin so the installed adapter dependency is inspected. */
  const pluginRequire = createRequire(require.resolve('stylelint-scss'));
  /** Package metadata inspected as JSON; candidate modules are not executed by this read. */
  const manifest = pluginRequire('postcss-media-query-parser/package.json');
  assert.equal(manifest.name, '@zeruxjs/scss-media-parser');
});
