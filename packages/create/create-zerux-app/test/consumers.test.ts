import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { planZeruxApp } from 'create-zerux-js';
import { writeProjectPlanAsync } from 'zclivo';
/** Resolver for explicitly named installed packages; no arbitrary package discovery is executed. */
const require = createRequire(import.meta.url);
/** Repository root from the documented root-level fixture invocation. */
const repository = path.resolve('.');
/** Copied child environment with parent Node test context removed. */
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
/** Execute fixed fixture commands and retain bounded diagnostics on failure.
 * @param {string} command - Trusted explicit executable.
 * @param {string[]} args - Trusted argument array, never shell-interpolated.
 * @param {object} options - Owned fixture cwd, encoding and finite deadline.
 * @returns {Buffer | string} Captured process output; throws when the child fails.
 */
function execute(command, args, options) {
  try {
    return execFileSync(command, args, {
      ...options,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(
      command +
        ' failed: ' +
        String(error.stdout ?? '').slice(0, 3500) +
        '\n' +
        String(error.stderr ?? error.message).slice(0, 1500)
    );
  }
}
/** Resolve explicitly selected local packages, including hoisted tooling.
 * @param {string} name - Dependency declared by the validated generated manifest.
 * @returns {string} Local installed package root; no network discovery or execution.
 */
function dependency(name) {
  if (name === 'typescript') {
    return path.dirname(require.resolve('typescript/package.json'));
  }
  /** Explicit mapping of selected local framework/renderer packages for offline fixtures. */
  const workspace = {
    zeruxjs: 'packages/zeruxjs',
    zyrojs: 'packages/zyrojs',
    '@zeruxjs/react': 'packages/@zeruxjs/react',
    '@zeruxjs/vue': 'packages/@zeruxjs/vue',
  }[name];
  return workspace
    ? path.join(repository, workspace)
    : path.dirname(require.resolve(name + '/package.json'));
}
/** Fixed authored production-handler fixture; never sourced from generated/user content. */
const runtime = `import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createServer} from 'node:http';import {once} from 'node:events';import {createApplicationLifecycle,resolveProductionStructure} from 'zeruxjs';const root=process.cwd();const config=(await import(pathToFileURL(path.join(root,process.argv[1])).href)).default;const production=await resolveProductionStructure(root,'zerux',config);const app=await createApplicationLifecycle({rootDir:root,mode:'start',config:production,providers:{database:async()=>null,cache:async()=>null}});const server=createServer((q,s)=>void app.handle(q,s).catch(()=>s.destroy()));try{server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;const response=await fetch(origin+'/');assert.equal(response.status,200);const html=await response.text();assert.match(html,/<h1/);assert.match(html,/No JavaScript is required/);assert.doesNotMatch(html,/<script/);assert.equal((await fetch(origin+'/about')).status,200);const css=await fetch(origin+'/style.css');assert.equal(css.status,200);assert.match(await css.text(),/system-ui/);assert.deepEqual(await (await fetch(origin+'/health')).json(),{status:'ok'});assert.equal((await fetch(origin+'/absent')).status,404);console.log('SSR/links/assets/health/404 verified');}finally{await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}`;
test(
  'all six generated consumers install selected local links offline, build/typecheck and render production HTTP',
  { timeout: 180000 },
  async (t) => {
    /** Owned temporary consumer/cache root removed in finally. */
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zx086-consumers-'));
    try {
      for (const renderer of ['zyro', 'react', 'vue']) {
        for (const language of ['javascript', 'typescript']) {
          await t.test(renderer + ' ' + language, async () => {
            /** New isolated app directory for one renderer/language pair. */
            const destination = path.join(root, renderer + '-' + language);
            /** Reviewable supported file plan written only into the owned fixture root. */
            const plan = planZeruxApp({ destination, renderer, language });
            await writeProjectPlanAsync(plan);
            /** Generated private manifest defining this consumer's selected dependencies. */
            const pkg = JSON.parse(plan.files['package.json']);
            /** Explicit local dependency roots installed as offline links for this qualification. */
            const paths = Object.keys({
              ...pkg.dependencies,
              ...pkg.devDependencies,
            }).map(dependency);
            /** Invoke fixed npm argument arrays in the isolated consumer with a finite deadline.
             * @param {string[]} args - Trusted explicit npm arguments without shell interpolation.
             * @returns {string} Captured UTF-8 child-process output.
             */
            const run = (args) =>
              execute('npm', [...args, '--cache', path.join(root, 'cache')], {
                cwd: destination,
                encoding: 'utf8',
                timeout: 30000,
              });
            run([
              'install',
              '--offline',
              '--ignore-scripts',
              '--no-save',
              '--package-lock=false',
              '--no-audit',
              '--no-fund',
              ...paths,
            ]);
            for (const name of Object.keys({
              ...pkg.dependencies,
              ...pkg.devDependencies,
            })) {
              assert.equal(
                fs
                  .lstatSync(path.join(destination, 'node_modules', name))
                  .isSymbolicLink(),
                true
              );
            }
            /** Actual isolated consumer build output checked before runtime qualification. */
            const build = run(['run', 'build']);
            assert.match(build, /Compiled/);
            run(['run', 'typecheck']);
            run(['test']);
            /** Output from the owned ephemeral production-handler HTTP fixture. */
            const result = execute(
              process.execPath,
              [
                '--input-type=module',
                '-e',
                runtime,
                language === 'typescript'
                  ? 'zerux.config.ts'
                  : 'zerux.config.mjs',
              ],
              { cwd: destination, encoding: 'utf8', timeout: 15000 }
            );
            assert.match(result, /SSR\/links\/assets/);
            // Removing only the chosen runtime must fail; there is no renderer fallback.
            /** Only the chosen runtime dependency is removed to prove no silent renderer fallback. */
            let missing;
            if (renderer === 'zyro') {
              missing = 'zyrojs';
            } else {
              if (renderer === 'react') {
                missing = 'react';
              } else {
                missing = '@vue/runtime-dom';
              }
            }
            fs.unlinkSync(path.join(destination, 'node_modules', missing));
            /** Fixed authored missing-runtime fixture that drains any partial application startup. */
            const failure = `import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createApplicationLifecycle,resolveProductionStructure} from 'zeruxjs';const root=process.cwd();const config=(await import(pathToFileURL(path.join(root,process.argv[1])).href)).default;const production=await resolveProductionStructure(root,'zerux',config);let app,error;try{app=await createApplicationLifecycle({rootDir:root,mode:'start',config:production,providers:{database:async()=>null,cache:async()=>null}});}catch(e){error=e;}finally{await app?.close();}assert.ok(error,'missing runtime must not fall back');assert.match(String(error.message),/Cannot find package|MODULE_NOT_FOUND/);console.log('MISSING_RUNTIME_REJECTED');`;
            assert.match(
              execute(
                process.execPath,
                [
                  '--input-type=module',
                  '-e',
                  failure,
                  language === 'typescript'
                    ? 'zerux.config.ts'
                    : 'zerux.config.mjs',
                ],
                { cwd: destination, encoding: 'utf8', timeout: 15000 }
              ),
              /MISSING_RUNTIME_REJECTED/
            );
          });
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
