import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { npmCommand } from './npm-command.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverWorkspaces,
  planWorkspaces,
  executeWorkspacePlan,
  DEFAULT_BUILD_CONCURRENCY,
  getDefaultBuildConcurrency,
} from './workspace-graph.ts';
import {
  parseBuildOptions,
  runWorkspaceBuild,
  verifyWorkspaceArtifacts,
  runNpmWorkspaceBuild,
} from './workspace-build.ts';

/** Perform the fixture operation.
 * @param {unknown} defs - Input value for defs.
 * @returns {unknown} Result produced by fixture.
 */
function fixture(defs) {
  /** Local value for root. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-workspaces-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ workspaces: ['packages/*'] })
  );
  for (const [name, deps] of Object.entries(defs)) {
    /** Local value for dir. */
    const dir = path.join(root, 'packages', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name,
        scripts: { build: 'echo built' },
        main: './dist/index.js',
        dependencies: Object.fromEntries(deps.map((dep) => [dep, '*'])),
      })
    );
  }
  return {
    root,
    entries: discoverWorkspaces(root),
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('dependency planning respects local workspace relationships', () => {
  /** Local value for f. */
  const f = fixture({ base: [], ui: ['base'], app: ['ui'], other: [] });
  try {
    /** Local value for plan. */
    const plan = planWorkspaces(f.entries, { scopes: ['app'] });
    assert.deepEqual(plan.ordered, ['base', 'ui', 'app']);
    assert.deepEqual(
      planWorkspaces(f.entries, { scopes: ['base'], includeDependents: true })
        .ordered,
      ['base', 'ui', 'app']
    );
  } finally {
    f.close();
  }
});

test('cycles and unknown scopes produce actionable errors', () => {
  /** Local value for f. */
  const f = fixture({ first: ['second'], second: ['first'] });
  try {
    assert.throws(() => planWorkspaces(f.entries), /cycle/);
  } finally {
    f.close();
  }
  /** Local value for other. */
  const other = fixture({ first: [] });
  try {
    assert.throws(
      () => planWorkspaces(other.entries, { scopes: ['nope'] }),
      /Unknown workspace/
    );
  } finally {
    other.close();
  }
});

test('parallel scheduler never builds a dependent before dependencies finish', async () => {
  /** Local value for f. */
  const f = fixture({
    base: [],
    ui: ['base'],
    app: ['ui'],
    other: [],
    free1: [],
    free2: [],
    free3: [],
    free4: [],
  });
  try {
    /** Local value for done. */
    const done = new Set(),
      started = [];
    let active = 0,
      peak = 0;
    await executeWorkspacePlan(planWorkspaces(f.entries), {
      run: async (name) => {
        active++;
        peak = Math.max(peak, active);
        if (name === 'app') {
          assert.ok(done.has('ui'));
        }
        if (name === 'ui') {
          assert.ok(done.has('base'));
        }
        started.push(name);
        await new Promise((resolve) => setTimeout(resolve, 10));
        done.add(name);
        active--;
      },
    });
    assert.equal(started.length, 8);
    assert.equal(peak, Math.min(DEFAULT_BUILD_CONCURRENCY, 6));
    assert.equal(parseBuildOptions([]).concurrency, DEFAULT_BUILD_CONCURRENCY);
    assert.equal(
      parseBuildOptions(['--concurrency', 'auto']).concurrency,
      DEFAULT_BUILD_CONCURRENCY
    );
    assert.equal(
      getDefaultBuildConcurrency({
        parallelism: 16,
        memoryBytes: 32 * 1024 ** 3,
        memoryLimitBytes: 0,
      }),
      16
    );
    assert.equal(
      getDefaultBuildConcurrency({
        parallelism: 64,
        memoryBytes: 64 * 1024 ** 3,
        memoryLimitBytes: 4 * 1024 ** 3,
      }),
      6
    );
  } finally {
    f.close();
  }
});

test('failed dependency cancels builds and never launches dependents', async () => {
  /** Local value for f. */
  const f = fixture({ base: [], ui: ['base'], app: ['ui'], other: [] });
  try {
    /** Local value for started. */
    const started = [];
    await assert.rejects(
      executeWorkspacePlan(planWorkspaces(f.entries), {
        concurrency: 2,
        run: async (name) => {
          started.push(name);
          if (name === 'base') {
            throw Error('compile failed');
          }
        },
      }),
      /base.*compile failed/
    );
    assert.ok(!started.includes('ui'));
    assert.ok(!started.includes('app'));
  } finally {
    f.close();
  }
});

test('dry run does not run build commands and CLI options are strictly validated', async () => {
  /** Local value for f. */
  const f = fixture({ alpha: [] });
  try {
    /** Local value for result. */
    const result = await runWorkspaceBuild(
      f.root,
      {
        ...parseBuildOptions([
          '--dry-run',
          '--scope',
          'alpha',
          '--concurrency',
          '2',
        ]),
      },
      {
        run: () => {
          throw Error('must not run');
        },
      }
    );
    assert.deepEqual(result.planned, ['alpha']);
    assert.deepEqual(result.completed, []);
    assert.throws(() => parseBuildOptions(['--something']), /Unknown/);
    assert.throws(
      () => parseBuildOptions(['--concurrency', '0']),
      /Concurrency/
    );
    // Exercise Windows launch selection with spaces and shell metacharacters as literal arguments.
    /** Local value for cli. */
    const cli = path.join(f.root, 'npm with spaces', 'npm-cli.js');
    fs.mkdirSync(path.dirname(cli));
    fs.writeFileSync(
      cli,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))'
    );
    /** Local value for args. */
    const args = [
      'run',
      'build',
      '--workspace',
      'package with spaces & echo injected',
    ];
    /** Local value for invocation. */
    const invocation = npmCommand(args, {
      platform: 'win32',
      npmExecPath: cli,
    });
    assert.equal(invocation.command, process.execPath);
    assert.deepEqual(
      JSON.parse(
        execFileSync(invocation.command, invocation.args, { encoding: 'utf8' })
      ),
      args
    );
  } finally {
    f.close();
  }
});

test('artifact verification checks declared entrypoints', () => {
  /** Local value for f. */
  const f = fixture({ alpha: [] });
  try {
    assert.match(
      verifyWorkspaceArtifacts(f.entries, ['alpha'])[0],
      /alpha.*dist\/index\.js/
    );
    fs.mkdirSync(path.join(f.root, 'packages/alpha/dist'));
    fs.writeFileSync(path.join(f.root, 'packages/alpha/dist/index.js'), '');
    assert.deepEqual(verifyWorkspaceArtifacts(f.entries, ['alpha']), []);
  } finally {
    f.close();
  }
});

test('export map verification includes subpath declarations, not only main', () => {
  /** Local value for f. */
  const f = fixture({ alpha: [] });
  try {
    /** Local value for item. */
    const item = f.entries.get('alpha');
    item.pkg.exports = {
      '.': { import: './dist/index.js' },
      './extras': { types: './dist/extra.d.ts', default: './dist/extra.js' },
    };
    fs.mkdirSync(path.join(f.root, 'packages/alpha/dist'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'packages/alpha/dist/index.js'), '');
    /** Local value for result. */
    const result = verifyWorkspaceArtifacts(f.entries, ['alpha']);
    assert.ok(result.some((item) => item.includes('extra.d.ts')));
    assert.ok(result.some((item) => item.includes('extra.js')));
  } finally {
    f.close();
  }
});

test('build CLI validates finite per-package timeout', () => {
  assert.equal(parseBuildOptions(['--timeout-ms', '3500']).timeoutMs, 3500);
  assert.throws(() => parseBuildOptions(['--timeout-ms', 'abc']), /timeout/);
  assert.throws(() => parseBuildOptions(['--timeout-ms', '0']), /timeout/);
  assert.throws(
    () => parseBuildOptions(['--timeout-ms', '3600001']),
    /timeout/
  );
});

test('hung npm workspace build times out with a diagnostic and terminates', async (t) => {
  /** Local value for f. */
  const f = fixture({ alpha: [] });
  try {
    /** Local value for manifest path. */
    const manifestPath = path.join(f.root, 'packages/alpha/package.json');
    /** Local value for manifest. */
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.scripts.build = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      runNpmWorkspaceBuild(f.root, 'alpha', undefined, 400),
      /Build timed out/
    );
  } finally {
    f.close();
  }
});

test('export verification rejects symlinked generated entrypoints', (t) => {
  /** Local value for f. */
  const f = fixture({ alpha: [] });
  /** Local value for outside. */
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'zerux-external-build-')
  );
  try {
    fs.mkdirSync(path.join(f.root, 'packages/alpha/dist'), { recursive: true });
    /** Local value for destination. */
    const destination = path.join(outside, 'external.js');
    fs.writeFileSync(destination, 'export {}');
    try {
      fs.symlinkSync(
        destination,
        path.join(f.root, 'packages/alpha/dist/index.js')
      );
    } catch (error) {
      if (error.code === 'EPERM') {
        return t.skip('Platform disallows test symlinks');
      }
      throw error;
    }
    assert.ok(
      verifyWorkspaceArtifacts(f.entries, ['alpha']).some((x) =>
        x.includes('dist/index.js')
      )
    );
  } finally {
    f.close();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('site tooling plans build-time watcher declarations before Zuixs without requiring its runtime peer', async () => {
  /** Local value for root. */
  const root = fileURLToPath(new URL('..', import.meta.url));
  /** Local value for entries. */
  const entries = discoverWorkspaces(root);
  /** Local value for manifest. */
  const manifest = entries.get('zuixs').pkg;
  assert.equal(manifest.peerDependenciesMeta.zlook.optional, true);
  assert.equal(manifest.dependencies?.zlook, undefined);
  assert.equal(
    manifest.devDependencies.zlook,
    entries.get('zlook').pkg.version
  );
  /** Local value for plan. */
  const plan = planWorkspaces(entries, {
    scopes: [
      'zuixs',
      '@zeruxjs/typescript',
      '@zeruxjs/performance',
      '@zeruxjs/search',
    ],
  });
  assert.ok(plan.dependencies.get('zuixs').includes('zlook'));
  /** Local value for completed. */
  const completed = new Set();
  await executeWorkspacePlan(plan, {
    concurrency: 4,
    run: async (name) => {
      if (name === 'zuixs') {
        assert.ok(completed.has('zlook'));
      }
      completed.add(name);
    },
  });
  assert.ok(completed.has('zuixs'));
});

/** Perform the staged fixture operation.
 * @returns {unknown} Result produced by staged fixture.
 */
function stagedFixture() {
  /** Local value for f. */
  const f = fixture({
    devtools: [],
    host: ['devtools'],
    runtime: ['host', 'devtools'],
    unrelated: [],
  });
  /** Local value for file. */
  const file = path.join(f.root, 'packages/devtools/package.json');
  /** Local value for manifest. */
  const manifest = JSON.parse(fs.readFileSync(file));
  manifest.scripts['build:core'] = 'echo strict core';
  manifest.workspaceBuild = {
    bootstrapScript: 'build:core',
    finalizeDependencies: ['host', 'runtime'],
  };
  fs.writeFileSync(file, JSON.stringify(manifest));
  return f;
}

test('explicit strict-core bootstrap includes peer owners and always finalizes optional integrations', async () => {
  /** Local value for f. */
  const f = stagedFixture();
  try {
    /** Local value for calls. */
    const calls = [];
    /** Local value for options. */
    const options = parseBuildOptions([
      '--scope',
      'devtools',
      '--concurrency',
      '3',
    ]);
    /** Local value for result. */
    const result = await runWorkspaceBuild(f.root, options, {
      run: async (name, signal, script) => {
        assert.ok(signal instanceof AbortSignal);
        calls.push([name, script]);
        if (name === 'host') {
          assert.deepEqual(calls[0], ['devtools', 'build:core']);
        }
        if (name === 'devtools' && script === 'build') {
          assert.ok(calls.some(([owner]) => owner === 'runtime'));
        }
      },
    });
    assert.deepEqual(result.planned, ['devtools', 'host', 'runtime']);
    assert.deepEqual(result.finalized, ['devtools']);
    assert.deepEqual(calls.at(-1), ['devtools', 'build']);
    assert.equal(
      calls.some(([name]) => name === 'unrelated'),
      false
    );
  } finally {
    f.close();
  }
});

test('bootstrap/finalization failures fail the build; a successful core is never final success', async () => {
  /** Local value for f. */
  const f = stagedFixture();
  try {
    for (const failingScript of ['build:core', 'build']) {
      /** Local value for calls. */
      const calls = [];
      await assert.rejects(
        runWorkspaceBuild(f.root, parseBuildOptions(['--scope', 'devtools']), {
          run: async (name, signal, script) => {
            calls.push([name, script]);
            if (name === 'devtools' && script === failingScript) {
              throw Error('strict compiler failure');
            }
          },
        }),
        /devtools.*strict compiler failure/
      );
      if (failingScript === 'build:core') {
        assert.deepEqual(calls, [['devtools', 'build:core']]);
      }
    }
  } finally {
    f.close();
  }
});

test('bootstrap metadata rejects undeclared commands, unknown peers and nested finalizers', () => {
  /** Local value for f. */
  const f = stagedFixture();
  try {
    /** Local value for entries. */
    const entries = discoverWorkspaces(f.root);
    /** Local value for metadata. */
    const metadata = entries.get('devtools').pkg.workspaceBuild;
    metadata.bootstrapScript = 'start';
    assert.throws(
      () => planWorkspaces(entries),
      /Invalid workspace build bootstrap/
    );
    metadata.bootstrapScript = 'build:core';
    metadata.finalizeDependencies = ['missing'];
    assert.throws(
      () => planWorkspaces(entries),
      /Invalid workspace build bootstrap/
    );
    metadata.finalizeDependencies = ['host'];
    entries.get('host').pkg.scripts['build:core'] = 'echo core';
    entries.get('host').pkg.workspaceBuild = {
      bootstrapScript: 'build:core',
      finalizeDependencies: ['runtime'],
    };
    assert.throws(
      () => planWorkspaces(entries),
      /Nested workspace build finalization/
    );
  } finally {
    f.close();
  }
});

test('literal workspace peer imports have development declarations or an explicit finalization owner', () => {
  /** Local value for root. */
  const root = fileURLToPath(new URL('..', import.meta.url));
  /** Local value for entries. */
  const entries = discoverWorkspaces(root);
  for (const { name, dir, pkg } of entries.values()) {
    /** Local value for peers. */
    const peers = new Set(
      Object.keys(pkg.peerDependencies ?? {}).filter((peer) =>
        entries.has(peer)
      )
    );
    if (!peers.size) {
      continue;
    }
    /**
     * Run the scan callback.
     * @param {unknown} directory - Input value for directory.
     * @returns {unknown} Result produced by scan.
     */
    const scan = (directory) => {
      if (!fs.existsSync(directory)) {
        return;
      }
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        /** Local value for file. */
        const file = path.join(directory, item.name);
        if (item.isDirectory()) {
          scan(file);
        } else if (/\.[mc]?tsx?$/.test(item.name)) {
          /** Local value for source. */
          const source = fs.readFileSync(file, 'utf8');
          for (const match of source.matchAll(
            /\b(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g
          )) {
            /** Local value for specifier. */
            const specifier = match[1],
              peer = specifier.startsWith('@')
                ? specifier.split('/').slice(0, 2).join('/')
                : specifier.split('/')[0];
            if (!peers.has(peer)) {
              continue;
            }
            /** Local value for dependency. */
            const dependency =
              pkg.dependencies?.[peer] ??
              pkg.devDependencies?.[peer] ??
              pkg.optionalDependencies?.[peer];
            assert.ok(
              dependency ||
                pkg.workspaceBuild?.finalizeDependencies.includes(peer),
              `${name}: ${path.relative(dir, file)} needs ${peer} declarations in a clean source build`
            );
          }
        }
      }
    };
    scan(path.join(dir, 'src'));
  }
});
