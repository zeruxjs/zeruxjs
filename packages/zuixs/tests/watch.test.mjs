import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SourceMapConsumer } from 'source-map-js';
import { buildZuix, watchZuix, scanProject } from 'zuixs/node';
import { createZuix, zuixVite } from 'zuixs';
import { activeWatcherCount } from 'zlook';
/** Create an isolated project with a source directory.
 * @returns {string} Owned project path.
 */
const temp = () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zuix-watch-'));
  fs.mkdirSync(path.join(root, 'src'));
  return root;
};
/** Write one synthetic fixture file inside its owned project.
 * @param {string} root - Owned project.
 * @param {string} file - Relative fixture path.
 * @param {string} text - Synthetic contents.
 * @returns {void} Write completion.
 */
const put = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
/** Read an explicitly selected synthetic fixture output.
 * @param {string} root - Owned project.
 * @param {string} file - Relative output path.
 * @returns {string} UTF-8 fixture contents.
 */
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
/** Remove only an owned synthetic project tree.
 * @param {string} root - Owned directory.
 * @returns {void} Cleanup completion.
 */
const remove = (root) => fs.rmSync(root, { recursive: true, force: true });
/** Polling-only short intervals used by isolated watcher fixtures. */
const options = { pollingOnly: true, pollIntervalMs: 100, debounceMs: 5 };
/** Explicit shared fixture build configuration; each watcher snapshots its own copy. */
const cfg = {
  preflight: false,
  content: ['src/**/*.html'],
  output: 'public/css/zuix.css',
};

test('zlook watch invalidates tokens, excludes its outputs, and matches clean CSS after bursts/deletions', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  /** Initial shared-watcher count restored after every owned subscription closes. */
  const baseline = activeWatcherCount();
  /** Postcommit CSS observations; failed candidates must not add a success receipt. */
  const builds = [];
  /** Private fixture errors collected to distinguish failure from successful output. */
  const errors = [];
  let stop;
  try {
    put(root, 'src/a.html', '<p class="p-2">');
    stop = watchZuix(
      root,
      cfg,
      (r) => builds.push(r.css),
      (e) => errors.push(e),
      options
    );
    await stop.ready;
    assert.equal(activeWatcherCount(), baseline + 1);
    assert.equal(builds.length, 1);
    put(root, 'src/a.html', '<p class="m-4">');
    put(root, 'src/a.html', '<p class="w-1/2">');
    put(root, 'src/b.html', '<p class="accent-blue-600">');
    await stop.flush();
    assert.match(read(root, cfg.output), /accent-color/);
    assert.doesNotMatch(read(root, cfg.output), /padding:/);
    fs.unlinkSync(path.join(root, 'src/b.html'));
    await stop.flush();
    assert.doesNotMatch(read(root, cfg.output), /accent-color/);
    assert.equal(
      read(root, cfg.output),
      createZuix(cfg).generate(scanProject(root, cfg)).css + '\n'
    );
    /** Number of committed builds before no-change flushes, which must not emit new receipts. */
    const count = builds.length;
    await stop.flush();
    await stop.flush();
    assert.equal(builds.length, count);
    assert.deepEqual(errors, []);
  } finally {
    stop?.();
    await stop?.closed;
    remove(root);
  }
  assert.equal(activeWatcherCount(), baseline);
});

test('shared roots keep configuration and subscriptions independent; failed reload retains the previous stylesheet', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  /** Initial shared-watcher count restored after every owned subscription closes. */
  const baseline = activeWatcherCount();
  /** Private fixture errors collected to distinguish failure from successful output. */
  const errors = [];
  let a, b;
  try {
    put(root, 'src/a.html', '<p class="bg-brand">');
    /** Caller-owned config deliberately changed after subscription to prove snapshot isolation. */
    const mutable = { ...cfg, extend: { colors: { brand: '#123' } } };
    a = watchZuix(root, mutable, undefined, (e) => errors.push(e), options);
    b = watchZuix(
      root,
      {
        ...cfg,
        output: 'public/css/other.css',
        extend: { colors: { brand: '#abc' } },
      },
      undefined,
      (e) => errors.push(e),
      options
    );
    await Promise.all([a.ready, b.ready]);
    assert.equal(activeWatcherCount(), baseline + 1);
    mutable.extend.colors.brand = '#f00';
    await a.flush();
    assert.match(read(root, cfg.output), /#123/);
    assert.match(read(root, 'public/css/other.css'), /#abc/);
    /** Last known committed CSS preserved across invalid compilation/reload candidates. */
    const before = read(root, cfg.output);
    await assert.rejects(
      a.reload({ ...cfg, recipes: [{ selector: '.x', apply: ['unknown'] }] }),
      /unsupported recipe/
    );
    assert.equal(read(root, cfg.output), before);
    await a.reload({ ...cfg, extend: { colors: { brand: '#456' } } });
    assert.match(read(root, cfg.output), /#456/);
    a();
    await a.closed;
    assert.equal(activeWatcherCount(), baseline + 1);
    put(root, 'src/a.html', '<p class="bg-brand p-4">');
    await b.flush();
    assert.match(read(root, 'public/css/other.css'), /padding:1rem/);
  } finally {
    a?.();
    b?.();
    await Promise.all([a?.closed, b?.closed]);
    remove(root);
  }
  assert.equal(activeWatcherCount(), baseline);
});

test('declared config changes stage before activation and invalid config/dependency failures retain good output', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  /** Private fixture errors collected to distinguish failure from successful output. */
  const errors = [];
  let stop;
  try {
    put(root, 'src/a.html', '<p class="bg-brand">');
    put(root, 'zuix.json', '{"brand":"#123"}');
    stop = watchZuix(
      root,
      { ...cfg, extend: { colors: { brand: '#123' } } },
      undefined,
      (e) => errors.push(e),
      {
        ...options,
        configFile: 'zuix.json',
        loadConfig: async () => ({
          ...cfg,
          extend: {
            colors: { brand: JSON.parse(read(root, 'zuix.json')).brand },
          },
        }),
      }
    );
    await stop.ready;
    /** Last known committed CSS preserved across invalid compilation/reload candidates. */
    const before = read(root, cfg.output);
    put(root, 'zuix.json', '{broken');
    await stop.flush();
    assert.ok(errors.length);
    assert.equal(read(root, cfg.output), before);
    put(root, 'zuix.json', '{"brand":"#789"}');
    await stop.flush();
    assert.match(read(root, cfg.output), /#789/);
    await assert.rejects(
      stop.reload({
        ...cfg,
        plugins: [
          () => {
            throw new Error('plugin dependency failed');
          },
        ],
      }),
      /dependency failed/
    );
    assert.match(read(root, cfg.output), /#789/);
  } finally {
    stop?.();
    await stop?.closed;
    remove(root);
  }
});

test('CSS-entry watching includes source changes, authored CSS and awaited cancellation', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  /** Initial shared-watcher count restored after every owned subscription closes. */
  const baseline = activeWatcherCount();
  /** Host cancellation controller for this isolated watcher owner. */
  const controller = new AbortController();
  /** Private fixture errors collected to distinguish failure from successful output. */
  const errors = [];
  let stop;
  try {
    put(root, 'src/a.html', '<p class="p-2">');
    put(root, 'src/styles.css', '@import "zuixs"; .host{color:red}');
    stop = watchZuix(root, cfg, undefined, (e) => errors.push(e), {
      ...options,
      roots: ['src'],
      input: 'src/styles.css',
      signal: controller.signal,
    });
    await stop.ready;
    put(root, 'src/styles.css', '@import "zuixs"; .host{color:blue}');
    await stop.flush();
    assert.match(read(root, cfg.output), /color:blue/);
    /** Last valid CSS used to verify syntax errors cannot replace committed output. */
    const good = read(root, cfg.output);
    put(root, 'src/styles.css', '.bad{color:red}');
    await stop.flush();
    assert.equal(read(root, cfg.output), good);
    assert.ok(errors.length);
    controller.abort();
    await stop.closed;
    assert.equal(activeWatcherCount(), baseline);
  } finally {
    stop?.();
    await stop?.closed;
    remove(root);
  }
});

test('startup cancellation and a cooperative in-flight config load release handles without committing stale work', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  /** Initial shared-watcher count restored after every owned subscription closes. */
  const baseline = activeWatcherCount();
  let stop, release, started;
  try {
    put(root, 'src/a.html', '<p class="p-2">');
    put(root, 'zuix.json', '{}');
    /** Fixture synchronization promise proving config loading started before cancellation. */
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    stop = watchZuix(root, cfg, undefined, () => {}, {
      ...options,
      configFile: 'zuix.json',
      loadConfig: ({ signal }) =>
        new Promise((resolve) => {
          release = () => resolve({ ...cfg, safelist: ['hidden'] });
          signal.addEventListener('abort', release, { once: true });
          started();
        }),
    });
    await stop.ready;
    /** Last known committed CSS preserved across invalid compilation/reload candidates. */
    const before = read(root, cfg.output);
    put(root, 'zuix.json', '{"changed":true}');
    /** Owned reconciliation promise awaited alongside teardown after cancellation. */
    const flush = stop.flush();
    await entered;
    stop();
    await stop.closed;
    await flush;
    assert.equal(read(root, cfg.output), before);
    /** Host cancellation controller for this isolated watcher owner. */
    const controller = new AbortController();
    controller.abort();
    /** Already-aborted watcher proving startup allocates no output/subscription. */
    const cancelled = watchZuix(
      root,
      { ...cfg, output: 'no.css' },
      undefined,
      () => {},
      { ...options, signal: controller.signal }
    );
    await cancelled.closed;
    assert.equal(fs.existsSync(path.join(root, 'no.css')), false);
  } finally {
    release?.();
    stop?.();
    await stop?.closed;
    remove(root);
  }
  assert.equal(activeWatcherCount(), baseline);
});

test('valid manifests use non-root public URLs and hashes; source maps are explicit file-level records', () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  try {
    put(root, 'src/a.html', '<p class="p-2 w-1/2">');
    /** Explicit per-test compiler/build policy independent of other fixtures. */
    const config = {
      ...cfg,
      perFile: { dir: 'public/css/parts' },
      buildManifest: {
        file: 'public/css/assets.json',
        publicPath: '/catalog/css/',
      },
    };
    buildZuix(root, config);
    /** Parsed package or output manifest checked against explicit public contracts. */
    const manifest = JSON.parse(read(root, 'public/css/assets.json'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.stylesheets.length, 2);
    assert.doesNotMatch(JSON.stringify(manifest), /src\/a\.html/);
    for (const asset of manifest.stylesheets) {
      assert.ok(asset.url.startsWith('/catalog/css/'));
      assert.equal(asset.sourceMap, undefined);
    }
    assert.equal(fs.existsSync(path.join(root, cfg.output + '.map')), false);
    /** Public shared stylesheet record whose hash must match its actual committed bytes. */
    const shared = manifest.stylesheets.find((item) => item.id === 'shared');
    assert.equal(
      shared.integrity,
      'sha256-' +
        createHash('sha256').update(read(root, cfg.output)).digest('base64')
    );
    buildZuix(root, {
      ...config,
      buildManifest: { ...config.buildManifest, sourceMap: true },
    });
    /** Explicitly enabled external source map; source contents remain absent by default. */
    const map = JSON.parse(read(root, cfg.output + '.map'));
    assert.equal(map.sourcesContent, undefined);
    /** Synchronous borrowed map reader used only for file-level mapping assertions. */
    const consumer = new SourceMapConsumer(map);
    /** Observed generated/source map positions, distinct from token-exact source mapping. */
    const positions = [];
    consumer.eachMapping((item) => positions.push(item));
    assert.ok(positions.length);
    assert.ok(positions.every((item) => item.originalLine === 1));
    assert.match(read(root, cfg.output), /sourceMappingURL=zuix\.css\.map/);
    buildZuix(root, config);
    assert.equal(fs.existsSync(path.join(root, cfg.output + '.map')), false);
    /** Last known committed CSS preserved across invalid compilation/reload candidates. */
    const before = read(root, cfg.output);
    assert.throws(
      () =>
        buildZuix(root, {
          ...config,
          buildManifest: { ...config.buildManifest, publicPath: '/bad/../' },
        }),
      /publicPath/
    );
    assert.equal(read(root, cfg.output), before);
  } finally {
    remove(root);
  }
});

test('all per-file compilation completes before writes; failed atomic rename removes staged candidates', () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  try {
    put(root, 'src/a.html', '<p class="p-2">');
    /** Explicit per-test compiler/build policy independent of other fixtures. */
    const config = { ...cfg, perFile: { dir: 'public/css/parts' } };
    buildZuix(root, config);
    /** Last known committed CSS preserved across invalid compilation/reload candidates. */
    const before = read(root, cfg.output);
    put(root, 'src/a.html', '<p class="m-4">');
    let calls = 0;
    assert.throws(
      () =>
        buildZuix(root, {
          ...config,
          plugins: [
            () => {
              if (++calls === 2) {
                throw new Error('per-file failed');
              }
            },
          ],
        }),
      /per-file failed/
    );
    assert.equal(read(root, cfg.output), before);
    /** Original filesystem function restored after injecting a replacement failure. */
    const rename = fs.renameSync;
    try {
      fs.renameSync = () => {
        throw new Error('interrupted rename');
      };
      assert.throws(() => buildZuix(root, config), /interrupted rename/);
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(read(root, cfg.output), before);
    assert.ok(
      fs
        .readdirSync(path.join(root, 'public/css'))
        .every((file) => !file.startsWith('.zuix-'))
    );
  } finally {
    remove(root);
  }
});

test('Vite targets stylesheet modules without full reload or unrelated invalidation', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  try {
    put(root, 'src/a.html', '<p class="p-2">');
    /** Synthetic targeted HMR messages; no real browser socket is opened. */
    const sent = [];
    /** Synthetic graph records invalidated by the adapter. */
    const invalidated = [];
    /** Generated CSS or synthetic stylesheet module used by this fixture. */
    const css = { url: '/@id/virtual:zuix.css' };
    /** Unrelated module record that stylesheet invalidation must never include. */
    const unrelated = { url: '/unrelated.js' };
    /** Owned adapter hook object; closeBundle releases its retained graph/token state. */
    const plugin = zuixVite(cfg);
    plugin.configResolved({ root });
    plugin.configureServer({
      moduleGraph: {
        getModuleById: () => css,
        invalidateModule: (item) => invalidated.push(item),
      },
      ws: { send: (item) => sent.push(item) },
    });
    await plugin.buildStart();
    /** Changed source module included alongside affected stylesheet modules. */
    const own = { url: '/src/a.html' };
    /** Explicit hot-update module result, compared to source plus stylesheet only. */
    const affected = await plugin.handleHotUpdate({
      file: path.join(root, 'src/a.html'),
      modules: [own],
      read: async () => '<p class="m-4">',
    });
    assert.deepEqual(affected, [own, css]);
    assert.ok(!invalidated.includes(unrelated));
    assert.ok(sent.every((item) => item.type === 'update'));
    assert.doesNotMatch(
      plugin.load(plugin.resolveId('virtual:zuix.css')),
      /padding:/
    );
    plugin.closeBundle();
  } finally {
    remove(root);
  }
});

test('actual zuix binary reloads declared config, retains good CSS on syntax error and exits after SIGTERM', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = temp();
  let child,
    output = '',
    errors = '';
  /** Wait for bounded integration polling without creating a production retry policy.
   * @param {number} ms - Delay in milliseconds.
   * @returns {Promise<void>} Timer completion.
   */
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Poll a fixture condition with a finite deadline.
   * @param {() => boolean} condition - Assertion readiness predicate.
   * @returns {Promise<void>} Readiness or a declared fixture timeout.
   */
  const until = async (condition) => {
    /** Absolute fixture deadline preventing a hanging child-process check. */
    const end = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > end) {
        throw new Error('CLI fixture deadline exceeded');
      }
      await delay(20);
    }
  };
  try {
    put(root, 'src/a.html', '<p class="bg-brand">');
    /** Explicit trusted configuration file watched by the isolated CLI child. */
    const configFile = 'zuix.config.mjs';
    /** Render a trusted literal config fixture without injecting shell text.
     * @param {string} brand - Synthetic color token.
     * @returns {string} Inert configuration source written only to the isolated project.
     */
    const source = (brand) =>
      'export default ' +
      JSON.stringify({ ...cfg, extend: { colors: { brand } } }) +
      ';';
    put(root, configFile, source('#123'));
    child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
        'watch',
        '-c',
        configFile,
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      errors += data;
    });
    await until(() => output.includes('watching for changes'));
    /** Last valid CSS used to verify syntax errors cannot replace committed output. */
    const good = read(root, cfg.output);
    put(root, configFile, 'export default { broken');
    await until(() => errors.includes('[zuix] watch:'));
    assert.equal(read(root, cfg.output), good);
    put(root, configFile, source('#789'));
    await until(() => read(root, cfg.output).includes('#789'));
    /** Child outcome promise installed before signalling termination. */
    const exited = new Promise((resolve, reject) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', reject);
    });
    child.kill('SIGTERM');
    let timer;
    try {
      /** Observed child termination outcome, not a claim about user-managed applications. */
      const status = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('CLI did not drain')),
            3000
          );
        }),
      ]);
      assert.equal(status.code, 0);
      assert.equal(status.signal, null);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('close', resolve));
    }
    remove(root);
  }
});
