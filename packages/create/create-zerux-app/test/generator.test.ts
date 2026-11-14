import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  planZeruxApp,
  zeruxAppGenerator,
  runCreateZerux,
} from 'create-zerux-js';
import { writeProjectPlanAsync } from 'zclivo';
/** Allocate an owned fixture root; callers remove it in finally.
 * @returns {string} Fresh temporary directory for synthetic projects.
 */
const temporary = () => mkdtempSync(join(tmpdir(), 'zx086-'));
test('each renderer/language plan emits only selected public imports/dependencies and deterministic files', async () => {
  /** Owned temporary generation root; never an existing user application. */
  const root = temporary();
  try {
    assert.equal(zeruxAppGenerator.capabilities()[0].capabilities.length, 3);
    for (const renderer of ['zyro', 'react', 'vue']) {
      for (const language of ['typescript', 'javascript']) {
        /** New isolated target for this renderer/language combination. */
        const destination = join(root, renderer + '-' + language);
        /** Explicit public-import file plan with only the selected renderer dependencies. */
        const plan = planZeruxApp({
          destination,
          renderer,
          language,
          port: 4321,
        });
        /** Repeated plan used to compare deterministic content digest. */
        const again = planZeruxApp({
          destination,
          renderer,
          language,
          port: 4321,
        });
        assert.equal(plan.digest, again.digest);
        /** Parsed private generated manifest inspected before any consumer execution. */
        const pkg = JSON.parse(plan.files['package.json']);
        assert.equal(pkg.private, true);
        assert.equal(pkg.dependencies.zeruxjs, '0.0.4');
        assert.equal(!!pkg.dependencies.zyrojs, renderer === 'zyro');
        assert.equal(!!pkg.dependencies.react, renderer === 'react');
        assert.equal(!!pkg.dependencies.vue, renderer === 'vue');
        assert.ok(pkg.scripts.dev && pkg.scripts.build && pkg.scripts.start);
        /** Generated authored server entry checked for supported public imports and forbidden client behavior. */
        const source =
          plan.files['src/index.' + (language === 'typescript' ? 'ts' : 'mjs')];
        assert.match(source, /zeruxjs\/renderers/);
        assert.doesNotMatch(source, /hydrateRoot|createBrowserRouter|eval\(/);
        assert.match(
          plan.files[
            language === 'typescript' ? 'zerux.config.ts' : 'zerux.config.mjs'
          ],
          /src\/index/
        );
        assert.match(plan.files['.env.example'], /No secrets/);
        await writeProjectPlanAsync(plan);
        assert.equal(
          readFileSync(join(destination, 'public/style.css'), 'utf8'),
          plan.files['public/style.css']
        );
        assert.equal(readdirSync(destination).includes('node_modules'), false);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('legacy help/version/bin names, dry-run and unavailable templates fail safely', async () => {
  /** Owned temporary generation root; never an existing user application. */
  const root = temporary();
  /** Synthetic captured public CLI messages. */
  const out = [];
  try {
    assert.equal(
      await runCreateZerux(['--version'], { out: (m) => out.push(m) }),
      0
    );
    assert.equal(out[0], '0.0.4');
    assert.equal(
      await runCreateZerux(['--help'], { out: (m) => out.push(m) }),
      0
    );
    assert.match(out.at(-1), /zyro, react, vue/);
    assert.equal(
      await runCreateZerux(['new-app', '--yes', '--dry-run'], {
        cwd: root,
        out: (m) => out.push(m),
        err: () => {},
      }),
      0
    );
    assert.deepEqual(readdirSync(root), []);
    for (const args of [
      ['bad', '--renderer', 'unknown'],
      ['bad', '--mode', 'hydrate'],
      ['CON'],
      ['bad', '--port', '0'],
      ['bad', '--install'],
    ]) {
      assert.equal(
        await runCreateZerux(args, { cwd: root, out: () => {}, err: () => {} }),
        2
      );
    }
    symlinkSync(join(root, 'absent'), join(root, 'taken'));
    assert.equal(
      await runCreateZerux(['taken', '--yes'], {
        cwd: root,
        out: () => {},
        err: () => {},
      }),
      1
    );
    assert.equal(readdirSync(root).length, 1);
    /** Actual package manifest used to verify legacy and matching binary aliases. */
    const manifest = JSON.parse(
      readFileSync('packages/create/create-zerux-app/package.json', 'utf8')
    );
    assert.equal(manifest.bin['create-zerux'], manifest.bin['create-zerux-js']);
    /** Owned finite CLI subprocess used only for a version query. */
    const cli = spawnSync(
      process.execPath,
      ['packages/create/create-zerux-app/dist/index.js', '-v'],
      { encoding: 'utf8' }
    );
    assert.equal(cli.status, 0);
    assert.equal(cli.stdout.trim(), '0.0.4');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('cancelled prompting cleans up and writes nothing', async () => {
  /** Owned temporary generation root; never an existing user application. */
  const root = temporary();
  /** Owned cancellation controller proving prompt cleanup on interruption. */
  const controller = new AbortController();
  let disposed = 0;
  try {
    /** Explicit CLI exit code after cooperative prompt cancellation. */
    const status = await runCreateZerux([], {
      cwd: root,
      signal: controller.signal,
      out: () => {},
      err: () => {},
      prompt: () => ({
        async ask() {
          controller.abort();
          throw Error('interrupted');
        },
        close() {
          disposed++;
        },
      }),
    });
    assert.equal(status, 130);
    assert.equal(disposed, 1);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
