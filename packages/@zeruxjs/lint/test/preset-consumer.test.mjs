import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
/** Owned synthetic fixture directory or resolved package root used by the following checks. */
const root = fileURLToPath(new URL('..', import.meta.url));
/** Fixture-local resolver used only for installed engine/manifest discovery. */
const require = createRequire(import.meta.url);
/** Bounded subprocess helper; arguments are passed directly without a shell.
 * @param {string} bin - Trusted executable selected by this fixture, never by source content.
 * @param {string[]} args - Explicit subprocess arguments passed without shell interpolation.
 * @param {string} cwd - Trusted project directory resolved against the current process working directory.
 * @returns {string} Captured UTF-8 stdout; nonzero exits, oversized output and timeouts throw.
 */
const run = (bin, args, cwd) =>
  execFileSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });

test('real prepack archive exposes opt-in configs, verified bundle and optional extractor failure', () => {
  /** Owned consumer fixture prefix/cache, removed in finally even after packaging failure. */
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'zerux-lint-consumer-')
  );
  try {
    /** Actual npm archive report used to verify published inputs and integrity. */
    const report = JSON.parse(
      run(
        'npm',
        [
          'pack',
          '--json',
          '--pack-destination',
          temporary,
          '--cache',
          '/tmp/zerux-lint-npm-cache',
        ],
        root
      )
    );
    /** Selected npm archive metadata, normalized across supported report shapes. */
    const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
    assert.equal(
      packed.integrity,
      'sha512-' +
        createHash('sha512')
          .update(fs.readFileSync(path.join(temporary, packed.filename)))
          .digest('base64')
    );
    /** Extracted real archive directory used to test installed public exports. */
    const installed = path.join(temporary, 'node_modules/@zeruxjs/lint');
    fs.mkdirSync(installed, { recursive: true });
    run(
      'tar',
      [
        '-xzf',
        path.join(temporary, packed.filename),
        '-C',
        installed,
        '--strip-components=1',
      ],
      temporary
    );
    /** Package metadata inspected as JSON; candidate modules are not executed by this read. */
    const manifest = JSON.parse(
      fs.readFileSync(path.join(installed, 'package.json'), 'utf8')
    );
    assert.equal(
      manifest.scripts.prepack,
      'node scripts/prepare-stylelint-bundle.mjs && npm run build'
    );
    assert.equal(manifest.version, '0.0.4');
    /** Bundled dependency identity/version inspected from the real archive. */
    const locked = JSON.parse(
      fs.readFileSync(
        path.join(installed, 'node_modules/braces/package.json'),
        'utf8'
      )
    );
    assert.equal(locked.name, '@zklogic/braces');
    assert.equal(locked.version, '3.0.7');
    /** Bundled licensed parser identity checked before consumer execution. */
    const adapter = JSON.parse(
      fs.readFileSync(
        path.join(
          installed,
          'node_modules/postcss-media-query-parser/package.json'
        ),
        'utf8'
      )
    );
    assert.equal(adapter.name, '@zeruxjs/scss-media-parser');
    // name selects an installed archive dependency or license required by the isolated consumer.
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) {
      assert.ok(
        fs.readFileSync(
          path.join(installed, 'node_modules/postcss-media-query-parser', name),
          'utf8'
        ).length > 100
      );
    }
    // name selects an installed archive dependency or license required by the isolated consumer.
    for (const name of Object.keys(manifest.dependencies)) {
      /** Consumer dependency path; installed engines are borrowed through explicit symlinks. */
      const target = path.join(installed, 'node_modules', name);
      if (fs.existsSync(target)) {
        continue;
      }
      // Borrow actual installed engine packages; the lint package itself is extracted from its real archive.
      /** Existing installed module directory used to borrow a known dependency without downloading code. */
      const search = require.resolve
        .paths(name)
        .find((directory) =>
          fs.existsSync(path.join(directory, name, 'package.json'))
        );
      assert.ok(search, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(path.join(search, name), target, 'dir');
    }
    fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(
      path.join(temporary, 'light.mjs'),
      `import assert from 'node:assert/strict';import config from '@zeruxjs/lint/presets/package';import {createPackageConfig,createApplicationConfig} from '@zeruxjs/lint/presets';if(!Array.isArray(config)||!Array.isArray(createPackageConfig()))throw Error();await assert.rejects(createApplicationConfig(),{code:'ERR_MODULE_NOT_FOUND'});`
    );
    run(process.execPath, [path.join(temporary, 'light.mjs')], temporary);
    /** Actual workspace localization package exposed through its public installed exports. */
    const localeRoot = fileURLToPath(
      new URL('../../../zlocale', import.meta.url)
    );
    // Actual installed public zlocale exports, with no source-only module specifiers.
    fs.symlinkSync(
      localeRoot,
      path.join(temporary, 'node_modules/zlocale'),
      'dir'
    );
    fs.writeFileSync(
      path.join(temporary, 'strict.mjs'),
      `import assert from 'node:assert/strict';import config from '@zeruxjs/lint/presets/application';import {createApplicationConfig} from '@zeruxjs/lint/presets';const {Linter}=await import(${JSON.stringify(require.resolve('eslint'))});const source="'use client';import 'node:fs';";const messages=new Linter().verify(source,await createApplicationConfig({environment:'browser'}),{filename:'test.js'});assert.ok(messages.some(item=>item.ruleId==='zerux/client-server-import'));assert.ok(Array.isArray(config));`
    );
    run(process.execPath, [path.join(temporary, 'strict.mjs')], temporary);
    /** Documented public-import example copied into an isolated consumer for syntax/declaration checks. */
    const code = fs
      .readFileSync(path.join(root, 'README.md'), 'utf8')
      .split('## Opt-in flat-config presets')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    fs.writeFileSync(
      path.join(temporary, 'example.ts'),
      code +
        `\nimport {createPackageConfig} from '@zeruxjs/lint/presets';\n// @ts-expect-error invalid declared environment\ncreatePackageConfig({environment:'unknown'});\nimport {createDeprecationRegistry,type DeprecatedApi} from '@zeruxjs/lint';\nconst facts:readonly DeprecatedApi[]=createDeprecationRegistry([{module:'fixture-plugin',export:'old',reason:'Use the new public API',replacement:'newApi'}]);\ncreatePackageConfig({packageUsage:true,deprecations:facts});\n// @ts-expect-error invalid deprecation phase\ncreatePackageConfig({deprecations:[{module:'fixture-plugin',export:'old',reason:'Known fact',kind:'unknown'}]});\n`
    );
    fs.writeFileSync(path.join(temporary, 'example.mjs'), code);
    run(process.execPath, [path.join(temporary, 'example.mjs')], temporary);
    /** Installed Node declaration root linked only into the synthetic consumer. */
    const nodeTypes = path.dirname(require.resolve('@types/node/package.json'));
    fs.mkdirSync(path.join(temporary, 'node_modules/@types'), {
      recursive: true,
    });
    fs.symlinkSync(
      nodeTypes,
      path.join(temporary, 'node_modules/@types/node'),
      'dir'
    );
    /** Installed ESLint package root borrowed for public consumer resolution. */
    const eslintRoot = path.dirname(require.resolve('eslint/package.json'));
    fs.symlinkSync(
      eslintRoot,
      path.join(temporary, 'node_modules/eslint'),
      'dir'
    );
    fs.writeFileSync(
      path.join(temporary, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: ['example.ts'],
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
