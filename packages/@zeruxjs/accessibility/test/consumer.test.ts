import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
/** Owned temporary fixture prefix or resolved package source root. */
const root = fileURLToPath(new URL('..', import.meta.url));
/** Fixture-local resolver for already installed tooling/declaration dependencies. */
const require = createRequire(import.meta.url);
/** Bounded subprocess helper with an argument array and no shell interpolation.
 * @param {string} bin - Trusted executable chosen by this fixture, never by source contents.
 * @param {string[]} args - Explicit argument array, without shell interpolation.
 * @param {string} cwd - Owned fixture process working directory.
 * @returns {string} Captured bounded stdout; nonzero exits/timeouts propagate without shell interpolation.
 */
const run = (bin, args, cwd) =>
  execFileSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
test('packed public imports are DOM-inert on server import and preserve declaration contracts', () => {
  /** Owned packed-consumer prefix/cache removed in finally. */
  const temporary = fs.mkdtempSync(path.join(tmpdir(), 'zerux-a11y-consumer-'));
  try {
    /** Actual npm archive report from the built public package. */
    const packed = JSON.parse(
      run(
        'npm',
        [
          'pack',
          '--json',
          '--pack-destination',
          temporary,
          '--cache',
          '/tmp/zerux-a11y-npm-cache',
        ],
        root
      )
    );
    /** Selected normalized archive metadata, never an executable configuration object. */
    const item = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Extracted real archive directory used for import/declaration checks. */
    const installed = path.join(
      temporary,
      'node_modules/@zeruxjs/accessibility'
    );
    fs.mkdirSync(installed, { recursive: true });
    run(
      'tar',
      [
        '-xzf',
        path.join(temporary, item.filename),
        '-C',
        installed,
        '--strip-components=1',
      ],
      temporary
    );
    /** Archive manifest data inspected for unchanged version and dependency-free runtime. */
    const manifest = JSON.parse(
      fs.readFileSync(path.join(installed, 'package.json'), 'utf8')
    );
    assert.equal(manifest.version, '0.0.4');
    assert.equal(manifest.dependencies, undefined);
    fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(
      path.join(temporary, 'check.ts'),
      `import assert from 'node:assert/strict';import {createAccessibleDialog,validateComponentProps,applyLabelledComponentProps,createPreferenceState}from'@zeruxjs/accessibility';assert.equal(typeof document,'undefined');assert.equal(typeof createAccessibleDialog,'function');assert.equal(typeof validateComponentProps,'function');assert.equal(typeof applyLabelledComponentProps,'function');const state=createPreferenceState();state.set({textScale:1.25});assert.equal(state.getSnapshot().values.textScale,1.25);state.destroy();`
    );
    run(process.execPath, [path.join(temporary, 'check.ts')], temporary);
    /** README public-import example copied into a temporary declaration consumer. */
    const example = fs
      .readFileSync(path.join(root, 'README.md'), 'utf8')
      .split('## Component contracts and owned modal behavior')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    fs.writeFileSync(
      path.join(temporary, 'example.ts'),
      example +
        `\nimport type{LabelledComponentProps}from'@zeruxjs/accessibility';\n// @ts-expect-error explicit name is required\nconst unnamed:LabelledComponentProps={disabled:true};\n`
    );
    /** Documented preference example checked through the public installed declarations. */
    const prefs = fs
      .readFileSync(path.join(root, 'README.md'), 'utf8')
      .split('## Optional scoped preferences')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    fs.writeFileSync(path.join(temporary, 'preferences.ts'), prefs);
    fs.writeFileSync(
      path.join(temporary, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          types: [],
          lib: ['ES2022', 'DOM'],
        },
        include: ['example.ts', 'preferences.ts'],
      })
    );
    run(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '-p',
        path.join(temporary, 'tsconfig.json'),
      ],
      temporary
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
