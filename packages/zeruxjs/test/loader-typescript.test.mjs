import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
/** Promise-based child runner used only for the isolated authored loader fixture. */
const exec = promisify(execFile);
/** Fixed child entry registering the public loader before importing a fixture module. */
const runner = `import {registerLoader} from 'zeruxjs/loader';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
registerLoader('fixture', process.argv[2]==='source'?{sourceRoot:process.cwd()}:{});
const result=await import(pathToFileURL(path.join(process.cwd(),process.argv[3])).href+'?t=fixture');
console.log(JSON.stringify(result.result));`;
/** Create a temporary source project with an explicit public-loader child entry.
 * @returns {Promise<{root: string, run: (mode: string, entry: string) => Promise<unknown>, close: () => Promise<void>}>} Fixture owner; callers must await close after child execution.
 */
async function fixture() {
  /** Temporary source project owning its dependency link and generated fixture modules. */
  const root = await mkdtemp(path.join(tmpdir(), 'zerux-ts-loader-'));
  await symlink(
    path.resolve('../../node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  );
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'runner.mjs'), runner);
  return {
    root,
    run: async (mode, entry) => {
      /** Bounded child-process result parsed only after successful execution. */
      const result = await exec(process.execPath, ['runner.mjs', mode, entry], {
        cwd: root,
        timeout: 20000,
        env: { ...process.env, WORKSPACE_ENABLED: 'false' },
      });
      return JSON.parse(result.stdout.trim());
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test('source mode resolves nested .js/.mjs imports to TypeScript and propagates generation URLs', async () => {
  /** Isolated loader fixture closed in finally so child project files are removed. */
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.root, 'entry.ts'),
      "import {value} from './helper.js';import {extra} from './extra.mjs';export const result=value+extra;"
    );
    await writeFile(
      path.join(f.root, 'helper.ts'),
      "import {value as nested} from './nested.js';export const value:number=nested+1;"
    );
    await writeFile(
      path.join(f.root, 'nested.ts'),
      'export const value:number=40;'
    );
    await writeFile(
      path.join(f.root, 'extra.mts'),
      "export const extra:number=new URL(import.meta.url).searchParams.get('t')==='fixture'?1:0;"
    );
    assert.equal(await f.run('source', 'entry.ts'), 42);
    await assert.rejects(
      f.run('production', 'entry.ts'),
      /ERR_MODULE_NOT_FOUND|Cannot find module/
    );
    await writeFile(path.join(f.root, 'helper.js'), 'export const value=99;');
    assert.equal(await f.run('source', 'entry.ts'), 100);
  } finally {
    await f.close();
  }
});
test('source fallback refuses missing packages, linked escapes and absent siblings', async () => {
  /** Isolated loader fixture closed in finally so child project files are removed. */
  const f = await fixture();
  /** Separate temporary directory proving linked source cannot escape the project root. */
  const outside = await mkdtemp(path.join(tmpdir(), 'zerux-ts-outside-'));
  try {
    await writeFile(path.join(outside, 'private.ts'), 'export const value=1;');
    await symlink(
      path.join(outside, 'private.ts'),
      path.join(f.root, 'private.ts')
    );
    for (const statement of [
      "import './private.js';",
      "import 'uninstalled-package.js';",
      "import './absent.js';",
    ]) {
      await writeFile(
        path.join(f.root, 'entry.ts'),
        statement + 'export const result=true;'
      );
      await assert.rejects(
        f.run('source', 'entry.ts'),
        /Cannot find|ERR_MODULE_NOT_FOUND/
      );
    }
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});
test('actual workspace plugin boots unbundled through the development loader', async () => {
  /** Isolated loader fixture closed in finally so child project files are removed. */
  const f = await fixture();
  try {
    /** Repository sample read as source and copied into an isolated boot fixture. */
    const app = path.resolve('../../apps/zeruxjs-app');
    await mkdir(path.join(f.root, 'plugins'));
    await cp(
      path.join(app, 'plugins/workspace.ts'),
      path.join(f.root, 'plugins/workspace.ts')
    );
    await cp(path.join(app, 'lib'), path.join(f.root, 'lib'), {
      recursive: true,
    });
    await writeFile(
      path.join(f.root, 'entry.ts'),
      `import {createApplicationLifecycle} from 'zeruxjs';
  const app=await createApplicationLifecycle({rootDir:process.cwd(),mode:'dev',config:{},providers:{database:async()=>null,cache:async()=>null}});
  try {if(!app.runtime().routes.some(route=>route.pattern==='/workspace'))throw Error('workspace plugin was not loaded');}finally{await app.close();}
  export const result='booted';`
    );
    assert.equal(await f.run('source', 'entry.ts'), 'booted');
  } finally {
    await f.close();
  }
});
