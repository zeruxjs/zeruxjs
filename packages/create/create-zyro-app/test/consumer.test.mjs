import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { planZyroApp, runCreateZyro } from 'create-zyro-app';
import { writeProjectPlanAsync } from 'zclivo';
const require = createRequire(import.meta.url),
  repo = path.resolve('.'),
  env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const dependency = (name) =>
  ({
    zyrojs: path.join(repo, 'packages/zyrojs'),
    zeruxjs: path.join(repo, 'packages/zeruxjs'),
    '@zeruxjs/security': path.join(repo, 'packages/@zeruxjs/security'),
    typescript: path.join(
      repo,
      'packages/create/create-zyro-app/node_modules/typescript',
    ),
    parse5: path.join(repo, 'node_modules/parse5'),
  })[name] ?? path.dirname(require.resolve(name + '/package.json'));
function execute(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch (error) {
    throw Error(
      command +
        ' failed: ' +
        String(error.stdout ?? '').slice(0, 2500) +
        '\n' +
        String(error.stderr ?? error.message).slice(0, 2000),
    );
  }
}
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((r) => server.close(r));
  return value;
}
async function start(dir, mode) {
  const child = spawn(
    process.execPath,
    [
      ['ssr', 'hydrated'].includes(mode)
        ? 'dist/server.mjs'
        : 'scripts/serve.mjs',
    ],
    { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (b) => {
      log += b;
      if (log.includes('Zyro ready')) resolve();
    });
    child.stderr.on('data', (b) => (log += b));
    child.once('exit', () => reject(Error('Preview exited: ' + log)));
  });
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        const t = setTimeout(
          () => reject(Error('Preview timeout: ' + log)),
          5000,
        );
        t.unref();
      }),
    ]);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return async () => {
    if (child.exitCode === null) {
      const done = once(child, 'close');
      child.kill('SIGTERM');
      await done;
    }
  };
}
test(
  'eight standalone mode/language consumers build, serve /demo and own DOM/hydration teardown',
  { timeout: 180000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zx087-'));
    try {
      for (const mode of ['client', 'static', 'ssr', 'hydrated'])
        for (const language of ['javascript', 'typescript'])
          await t.test(mode + ' ' + language, async () => {
            const destination = path.join(root, mode + '-' + language),
              chosen = await port();
            const plan = planZyroApp({
              destination,
              mode,
              language,
              port: chosen,
              basePath: '/demo',
            });
            await writeProjectPlanAsync(plan);
            const pkg = JSON.parse(plan.files['package.json']);
            assert.equal(pkg.private, true);
            assert.equal(pkg.dependencies.react, undefined);
            assert.equal(pkg.dependencies.vue, undefined);
            execute(
              'npm',
              [
                'install',
                '--offline',
                '--ignore-scripts',
                '--no-save',
                '--package-lock=false',
                '--no-audit',
                '--no-fund',
                '--cache',
                path.join(root, 'cache'),
                ...Object.keys({
                  ...pkg.dependencies,
                  ...pkg.devDependencies,
                }).map(dependency),
              ],
              destination,
            );
            assert.match(
              execute('npm', ['run', 'build'], destination),
              /Built/,
            );
            execute('npm', ['run', 'typecheck'], destination);
            execute('npm', ['test'], destination);
            const manifest = JSON.parse(
              fs.readFileSync(
                path.join(
                  destination,
                  'dist',
                  mode === 'static'
                    ? 'static-export.json'
                    : 'build-manifest.json',
                ),
                'utf8',
              ),
            );
            if (mode === 'client' && language === 'javascript') {
              const dependencyPath = path.join(destination, 'node_modules/esbuild');
              fs.renameSync(dependencyPath, dependencyPath + '.disabled');
              try {
                assert.throws(() => execute('npm', ['run', 'build'], destination), /esbuild/);
                assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'dist/build-manifest.json'), 'utf8')), manifest);
                assert.equal(fs.existsSync(path.join(destination, '.zyro-build.lock')), false);
              } finally {
                fs.renameSync(dependencyPath + '.disabled', dependencyPath);
              }
            }
            execute('npm', ['run', 'build'], destination);
            assert.deepEqual(
              JSON.parse(
                fs.readFileSync(
                  path.join(
                    destination,
                    'dist',
                    mode === 'static'
                      ? 'static-export.json'
                      : 'build-manifest.json',
                  ),
                  'utf8',
                ),
              ),
              manifest,
            );
            const close = await start(destination, mode);
            try {
              const origin = 'http://127.0.0.1:' + chosen;
              const response = await fetch(origin + '/demo/');
              assert.equal(response.status, 200);
              assert.match(
                response.headers.get('content-security-policy'),
                /style-src[^;]*'self'/,
              );
              if (['client', 'hydrated'].includes(mode))
                assert.match(
                  response.headers.get('content-security-policy'),
                  /script-src[^;]*'self'/,
                );
              const html = await response.text();
              assert.match(
                html,
                mode === 'client' ? /Enable JavaScript/ : /<main/,
              );
              assert.equal((await fetch(origin + '/missing')).status, 404);
              assert.equal((await fetch(origin + '/demo/absent')).status, 404);
              assert.equal(
                (
                  await fetch(origin + '/demo/', { method: 'HEAD' })
                ).headers.get('content-type'),
                'text/html; charset=utf-8',
              );
              const dom = new JSDOM(html, {
                url: origin + '/demo/',
                runScripts: 'outside-only',
              });
              try {
                const css = dom.window.document.querySelector(
                  'link[rel=stylesheet]',
                );
                assert.ok(css.getAttribute('href').startsWith('/demo/'));
                assert.equal(
                  (await fetch(origin + css.getAttribute('href'))).status,
                  200,
                );
                const script = dom.window.document.querySelector('script[src]');
                if (mode === 'client' || mode === 'hydrated') {
                  assert.ok(script);
                  const src = script.getAttribute('src');
                  assert.ok(src.startsWith('/demo/'));
                  const bundle = await (await fetch(origin + src)).text();
                  assert.doesNotMatch(bundle, /createServer|node:fs/);
                  if (mode === 'hydrated')
                    dom.window.document.querySelector('input').value =
                      'Retained edit';
                  new vm.Script(bundle).runInContext(
                    dom.getInternalVMContext(),
                  );
                  if (mode === 'hydrated')
                    assert.equal(
                      dom.window.document.querySelector('input').value,
                      'Retained edit',
                    );
                  dom.window.dispatchEvent(
                    new dom.window.PageTransitionEvent('pagehide', {
                      persisted: true,
                    }),
                  );
                  dom.window.document.querySelector('button').click();
                  assert.equal(
                    dom.window.document.querySelector('[data-count]')
                      .textContent,
                    'Count: 1',
                  );
                  dom.window.dispatchEvent(
                    new dom.window.PageTransitionEvent('pagehide', {
                      persisted: false,
                    }),
                  );
                  assert.equal(
                    dom.window.document.querySelector('#app').childNodes.length,
                    0,
                  );
                } else {
                  assert.equal(script, null);
                  assert.ok(
                    dom.window.document.querySelector('button').disabled,
                  );
                }
              } finally {
                dom.window.close();
              }
            } finally {
              await close();
            }
            // Public source graph denial preserves the prior browser output.
            if (mode === 'client') {
              fs.writeFileSync(
                path.join(destination, 'src/private.server.mjs'),
                'export const secret="PRIVATE_SENTINEL";',
              );
              const source = path.join(
                destination,
                'src/client.' + (language === 'typescript' ? 'ts' : 'mjs'),
              );
              fs.appendFileSync(
                source,
                '\nimport {secret} from "./private.server.mjs";console.log(secret);\n',
              );
              assert.throws(
                () => execute('npm', ['run', 'build'], destination),
                /non-public source/,
              );
              const after = JSON.parse(
                fs.readFileSync(
                  path.join(destination, 'dist/build-manifest.json'),
                  'utf8',
                ),
              );
              assert.deepEqual(after, manifest);
              assert.equal(
                fs
                  .readdirSync(destination)
                  .some(
                    (n) =>
                      n.startsWith('.zyro-candidate-') ||
                      n === '.zyro-build.lock',
                  ),
                false,
              );
            }
          });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
test('dry-run, mode diagnostics, base path, aliases, occupied targets and abort fail safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zx087-cli-')),
    output = [];
  try {
    assert.equal(
      await runCreateZyro(['--version'], { out: (m) => output.push(m) }),
      0,
    );
    assert.equal(output[0], '0.0.4');
    assert.equal(
      await runCreateZyro(
        [
          'app',
          '--yes',
          '--mode',
          'static',
          '--base-path',
          '/docs',
          '--dry-run',
        ],
        { cwd: root, out: (m) => output.push(m), err: () => {} },
      ),
      0,
    );
    assert.deepEqual(fs.readdirSync(root), []);
    for (const args of [
      ['app', '--base-path', '/../private'],
      ['app', '--mode', 'selective-hydration'],
      ['app', '--renderer', 'react'],
      ['CON'],
      ['app', '--port', '0'],
    ])
      assert.equal(
        await runCreateZyro(args, { cwd: root, out: () => {}, err: () => {} }),
        2,
      );
    fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'taken'));
    assert.equal(
      await runCreateZyro(['taken', '--yes'], {
        cwd: root,
        out: () => {},
        err: () => {},
      }),
      1,
    );
    const controller = new AbortController();
    let cleaned = 0;
    assert.equal(
      await runCreateZyro([], {
        cwd: root,
        signal: controller.signal,
        out: () => {},
        err: () => {},
        prompt: () => ({
          async ask() {
            controller.abort();
            throw Error('abort');
          },
          close() {
            cleaned++;
          },
        }),
      }),
      130,
    );
    assert.equal(cleaned, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
