import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import 'node:url';
import {
  createZuix,
  generateCSS,
  extractClasses,
  renderZuixStyle,
  zuixVite,
} from '../dist/index.js';
import { buildZuix, watchZuix, scanProjectFiles } from '../dist/node.js';
import '../dist/theme.js';
/** Create an owned isolated project directory.
 * @returns {string} Temporary project path.
 */
const tmp = () => mkdtempSync(path.join(tmpdir(), 'zuix-test-'));
/** Remove only an owned fixture tree after its asynchronous resources settle.
 * @param {string} root - Owned temporary directory.
 * @returns {void} Removal completion.
 */
const cleanup = (root) => rmSync(root, { recursive: true, force: true });
/** Wait for bounded integration polling without creating a production retry policy.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Timer completion.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('generation stable regardless of input order and duplicates', () => {
  /** Representative compiler configuration with an explicit theme extension. */
  const c = {
    preflight: false,
    minify: true,
    extend: { colors: { brand: '#135' } },
  };
  /** Representative literal tokens; reversing their order must not change the generated cascade. */
  const tokens = [
    'p-4',
    'md:flex',
    'dark:bg-brand',
    'hover:text-red-500',
    'motion-reduce:duration-0',
    'focus-visible:ring-blue-500',
  ];
  assert.equal(
    generateCSS(tokens, c),
    generateCSS([...tokens].reverse().concat(tokens), c)
  );
  assert.match(generateCSS(tokens, c), /prefers-reduced-motion/);
  assert.match(generateCSS(tokens, c), /min-width: 768px/);
  assert.match(generateCSS(tokens, c), /#135/);
});
test('boundaries prevent CSS escape in malicious arbitrary tokens and themes', () => {
  /** Malicious literal token fixtures that must produce no escaped declaration/rule. */
  const bad = [
    'w-[url(https://bad.example)]',
    '[color:red!important]',
    '[background:expression(alert(1))]',
    'w-[10px;body{display:none}]',
    'has-[.hi};body{color:red}]:p-4',
    'media-[width:5px;body{}]:block',
    'p-4}body{display:none}',
    'w-[var(--x)/**/]',
  ];
  for (const token of bad) {
    /** Compilation result whose CSS and unmatched diagnostics are asserted separately. */
    const result = createZuix({ preflight: false }).generate([token]);
    assert.equal(result.css, '', token);
    assert.deepEqual(result.unmatched, [token]);
  }
  assert.match(
    generateCSS(['w-[var(--space)]', 'media-[width>=40rem]:p-2'], {
      preflight: false,
    }),
    /width:var\(--space\)/
  );
  assert.match(
    generateCSS(['has-[.active]:p-4'], { preflight: false }),
    /:has\(\.active\)/
  );
  assert.equal(
    generateCSS(['bg-brand'], {
      preflight: false,
      theme: { colors: { brand: 'red;}body{color:blue' } },
    }),
    ''
  );
  assert.doesNotMatch(renderZuixStyle(bad), /<\/style><style/i);
});
test('selector escape, prefixes, custom plugin and theme extension', () => {
  /** Generated prefixed/plugin CSS checked for intended theme and selector output. */
  const out = generateCSS(['2xl:p-3', 'zu-p-4', 'hover:zu-text-brand'], {
    prefix: 'zu-',
    preflight: false,
    extend: { colors: { brand: '#abc' } },
    plugins: [
      (api) =>
        api.addUtilities({
          '.text-brand': { color: api.theme('colors.brand') },
        }),
    ],
  });
  assert.match(out, /#abc/);
  assert.match(out, /hover/);
  /** Generated unprefixed responsive CSS testing leading-digit escaping. */
  const bare = generateCSS(['2xl:p-2'], { preflight: false });
  assert.match(bare, /\\32 xl/);
});
test('safelist, hard limits and malformed config fail explicitly', () => {
  assert.match(
    generateCSS([], { preflight: false, safelist: ['p-2'] }),
    /padding:0\.5rem/
  );
  assert.throws(
    () => generateCSS(['p-1', 'p-2'], { limits: { maxClasses: 1 } }),
    /maxClasses/
  );
  assert.throws(
    () => createZuix({ limits: { maxFiles: -2 } }),
    /invalid maxFiles/
  );
  assert.deepEqual(
    extractClasses(`<p class="p-2 lg:flex" class:active></p>`).slice(0, 2),
    ['p-2', 'lg:flex']
  );
});
test('static scanning is bounded, ignores symlinks and excludes output', () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = tmp();
  /** Separate owned tree proving source scanning never follows its symlink. */
  const remote = tmp();
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(
      path.join(root, 'src/a.tsx'),
      '<div className="p-4 lg:flex"/>'
    );
    writeFileSync(
      path.join(remote, 'secret.html'),
      '<div class="bg-red-500"/>'
    );
    symlinkSync(remote, path.join(root, 'src/elsewhere'));
    /** Complete bounded scan result compared against the intended source list. */
    const files = scanProjectFiles(root, { content: ['src/**/*.tsx'] });
    assert.deepEqual([...files.keys()], ['src/a.tsx']);
    assert.throws(
      () =>
        scanProjectFiles(root, {
          content: ['src/**/*.tsx'],
          limits: { maxFileBytes: 5 },
        }),
      /maxFileBytes/
    );
  } finally {
    cleanup(root);
    cleanup(remote);
  }
});
test('build outputs are stable and per-file stale deletion is controlled', () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = tmp();
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/a.html'), '<p class="p-2"></p>');
    writeFileSync(path.join(root, 'src/b.html'), '<p class="m-2"></p>');
    /** Explicit shared fixture build configuration; each watcher snapshots its own copy. */
    const cfg = { content: ['src/**/*.html'], perFile: true, preflight: false };
    buildZuix(root, cfg);
    /** First committed stylesheet retained for deterministic-content assertions. */
    const first = readFileSync(path.join(root, 'zuix.css'), 'utf8');
    /** Original output timestamp; unchanged candidates must not rewrite the file. */
    const mtime = statSync(path.join(root, 'zuix.css')).mtimeMs;
    buildZuix(root, cfg);
    assert.equal(readFileSync(path.join(root, 'zuix.css'), 'utf8'), first);
    assert.equal(statSync(path.join(root, 'zuix.css')).mtimeMs, mtime);
    unlinkSync(path.join(root, 'src/b.html'));
    buildZuix(root, cfg);
    assert.equal(
      existsSync(path.join(root, 'zuix-files/src/b.html.css')),
      false
    );
    /** Per-file configuration explicitly disabling global stylesheet generation. */
    const noShared = { ...cfg, perFile: { shared: false } };
    buildZuix(root, noShared);
    assert(existsSync(path.join(root, 'zuix-files/src/a.html.css')));
    assert.throws(
      () => buildZuix(root, { output: '../evil.css' }),
      /output must remain/
    );
    assert.throws(
      () => buildZuix(root, { perFile: { dir: '../escape' } }),
      /output must remain/
    );
    /** Owned external symlink target that must never receive generated output. */
    const outside = tmp();
    try {
      symlinkSync(outside, path.join(root, 'linked'));
      assert.throws(
        () => buildZuix(root, { output: 'linked/evil.css' }),
        /symlink output/
      );
    } finally {
      cleanup(outside);
    }
  } finally {
    cleanup(root);
  }
});
test('watch rebuilds deterministically for edits/deletions and recovers after input errors', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = tmp();
  try {
    mkdirSync(path.join(root, 'src'));
    /** Fixture source/output path or compiled module text, selected explicitly by the test. */
    const file = path.join(root, 'src/a.html');
    writeFileSync(file, '<i class="p-2"></i>');
    /** Postcommit CSS observations; failed candidates must not add a success receipt. */
    const builds = [];
    /** Private fixture errors collected to distinguish failure from successful output. */
    const errors = [];
    /** Owned callable watch disposer; closed tracks startup/loader/subscription settlement. */
    const stop = watchZuix(
      root,
      {
        content: ['src/**/*.html'],
        preflight: false,
        limits: { maxFileBytes: 200 },
      },
      (r) => builds.push(r.css),
      (e) => errors.push(e)
    );
    try {
      assert.equal(builds.length, 1);
      writeFileSync(file, '<i class="m-4"></i>');
      await delay(630);
      assert.equal(builds.length, 2);
      assert.match(builds.at(-1), /margin:/);
      writeFileSync(file, 'x'.repeat(250));
      await delay(630);
      assert.equal(errors.length, 1);
      writeFileSync(file, '<i class="flex"></i>');
      await delay(630);
      assert.equal(builds.length, 3);
      assert.match(builds.at(-1), /display:flex/);
      unlinkSync(file);
      await delay(630);
      assert.equal(builds.length, 4);
    } finally {
      stop();
      await stop.closed;
    }
  } finally {
    cleanup(root);
  }
});
test('Vite adapter tracks transformed classes and removes stale values on deletion', async () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = tmp();
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/a.tsx'), '<div class="p-4"/>');
    /** Explicit Vite-hook fixture borrowing a synthetic graph/socket surface. */
    const v = zuixVite({ preflight: false, content: ['src/**/*.{tsx}'] });
    let invalidations = 0;
    v.configResolved({ root });
    v.configureServer({
      moduleGraph: {
        getModuleById: () => ({}),
        invalidateModule: () => invalidations++,
      },
      ws: { send: () => {} },
    });
    await v.buildStart();
    /** Resolved virtual stylesheet identifier, not an arbitrary engine/network address. */
    const id = v.resolveId('virtual:zuix.css');
    assert.match(v.load(id), /padding:1rem/);
    v.transform('<div class="m-4"/>', path.join(root, 'src/a.tsx'));
    /** Generated CSS or synthetic stylesheet module used by this fixture. */
    const css = v.load(id);
    assert.match(css, /margin:1rem/);
    assert.doesNotMatch(css, /padding:1rem/);
    v.watchChange(path.join(root, 'src/a.tsx'), { event: 'delete' });
    assert.doesNotMatch(v.load(id), /margin:1rem/);
    assert(invalidations >= 2);
    v.closeBundle();
  } finally {
    cleanup(root);
  }
});
test('CLI parsing rejects invalid arguments without generating output', () => {
  /** Owned isolated project/consumer tree, removed in finally after resource cleanup. */
  const root = tmp();
  try {
    /** Built package CLI path; child invocation runs only inside the owned temporary project. */
    const cli = new URL('../dist/cli.js', import.meta.url).pathname;
    /** Invoke the built CLI only inside the owned temporary directory.
     * @param {string[]} args - CLI argument vector.
     * @returns {import("node:child_process").SpawnSyncReturns<string>} Exit status and captured output.
     */
    const run = (args) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: 'utf8',
      });
    assert.notEqual(run(['watc']).status, 0);
    assert.notEqual(run(['build', '--bogus']).status, 0);
    assert.notEqual(run(['build', '-o']).status, 0);
    assert.equal(run(['build', '--output', 'styles.css']).status, 0);
    assert(existsSync(path.join(root, 'styles.css')));
  } finally {
    cleanup(root);
  }
});
test('root entry is browser-safe: no eager Node builtins', () => {
  // adapters.ts remains bundled from root; Node IO is only dynamically loaded in the Vite hook.
  /** Fixture source/output path or compiled module text, selected explicitly by the test. */
  const file = readFileSync(
    new URL('../dist/adapters.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(file, /from ['"]node:(?:fs|path)/);
});
