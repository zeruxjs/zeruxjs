import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import {
  minimalProjectGenerator,
  createProjectGenerator,
  writeProjectPlan,
  writeProjectPlanAsync,
  runGeneratorCli,
  createZeruxProject,
} from 'zclivo';
const temp = () => fs.mkdtempSync(join(tmpdir(), 'zx085-'));
const remove = (root) => fs.rmSync(root, { recursive: true, force: true });
test('pure bounded plans/dry-run are deterministic, pin public versions and do not create or install', async () => {
  const root = temp();
  try {
    const options = {
      name: 'Demo',
      language: 'javascript',
      port: 4321,
      mode: 'minimal',
      renderer: 'none',
    };
    const a = minimalProjectGenerator.plan({
        ...options,
        destination: join(root, 'first'),
      }),
      b = minimalProjectGenerator.plan({
        ...options,
        destination: join(root, 'second'),
      });
    assert.equal(a.digest, b.digest);
    assert.deepEqual(a.files, b.files);
    assert.deepEqual(fs.readdirSync(root), []);
    assert.equal(
      JSON.parse(a.files['package.json']).dependencies.zeruxjs,
      '0.0.4',
    );
    assert.equal(JSON.parse(a.files['package.json']).engines.node, '>=24.15.0');
    assert.match(a.files['zerux.config.mjs'], /4321/);
    assert.throws(() => writeProjectPlan({ ...a }), /Validated/);
    await writeProjectPlanAsync(a);
    assert.deepEqual(fs.readdirSync(root), ['first']);
    for (const [path, body] of Object.entries(a.files))
      assert.equal(fs.readFileSync(join(root, 'first', path), 'utf8'), body);
    assert.equal(fs.existsSync(join(root, 'first/node_modules')), false);
    assert.equal(fs.existsSync(join(root, 'first/package-lock.json')), false);
  } finally {
    remove(root);
  }
});
test('reserved names, incompatible capabilities, invalid ports and unsafe template paths reject before writes', () => {
  const root = temp();
  try {
    for (const name of [
      '.hidden',
      'CON',
      'aux.txt',
      'LPT1',
      'node_modules',
      'favicon.ico',
      'a..b',
      'bad;cmd',
    ])
      assert.throws(() =>
        minimalProjectGenerator.plan({ destination: join(root, name) }),
      );
    for (const extra of [
      { port: 0 },
      { port: null },
      { language: null },
      { port: 1.5 },
      { port: 65536 },
      { renderer: 'react' },
      { mode: 'static' },
      { language: 'ruby' },
    ])
      assert.throws(() =>
        minimalProjectGenerator.plan({
          destination: join(root, 'valid'),
          ...extra,
        }),
      );
    for (const output of [
      { '../escape': 'x' },
      { '/absolute': 'x' },
      { 'nested\\escape': 'x' },
      { Foo: 'x', foo: 'y' },
      { file: 'x', 'file/child': 'y' },
      { 'node_modules/x': 'x' },
    ]) {
      const engine = createProjectGenerator([
        {
          id: 'custom',
          capabilities: [
            { mode: 'minimal', renderer: 'none', languages: ['javascript'] },
          ],
          render: () => output,
        },
      ]);
      assert.throws(() =>
        engine.plan({
          destination: join(root, 'valid'),
          language: 'javascript',
        }),
      );
    }
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    remove(root);
  }
});
test('occupied/dangling target and symlink parent are never followed', () => {
  const root = temp();
  try {
    const real = join(root, 'real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, join(root, 'parent'));
    assert.throws(
      () => createZeruxProject(join(root, 'parent/new')),
      /symlink/,
    );
    fs.symlinkSync(join(root, 'missing'), join(root, 'taken'));
    assert.throws(
      () => createZeruxProject(join(root, 'taken')),
      /already exists/,
    );
    fs.writeFileSync(join(root, 'file'), 'keep');
    assert.throws(
      () => createZeruxProject(join(root, 'file')),
      /already exists/,
    );
    assert.equal(fs.readFileSync(join(root, 'file'), 'utf8'), 'keep');
    assert.deepEqual(fs.readdirSync(real), []);
  } finally {
    remove(root);
  }
});
test('native staged-write and promotion failures roll back owned paths only', () => {
  const root = temp(),
    write = fs.writeFileSync,
    copy = fs.copyFileSync;
  try {
    const plan = minimalProjectGenerator.plan({
      destination: join(root, 'project'),
    });
    let writes = 0;
    fs.writeFileSync = (...args) => {
      if (++writes === 3) throw Error('disk write fixture failure');
      return write(...args);
    };
    syncBuiltinESMExports();
    assert.throws(() => writeProjectPlan(plan), /disk write fixture/);
    fs.writeFileSync = write;
    syncBuiltinESMExports();
    assert.deepEqual(fs.readdirSync(root), []);
    let moves = 0;
    fs.copyFileSync = (...args) => {
      if (++moves === 2) throw Error('promotion fixture failure');
      return copy(...args);
    };
    syncBuiltinESMExports();
    assert.throws(() => writeProjectPlan(plan), /promotion fixture/);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.writeFileSync = write;
    fs.copyFileSync = copy;
    syncBuiltinESMExports();
    remove(root);
  }
});
test('template dependency failure and abort during async staging leave no partial project', async () => {
  const root = temp(),
    write = fs.writeFileSync;
  try {
    const broken = createProjectGenerator([
      {
        id: 'broken',
        capabilities: [
          { mode: 'minimal', renderer: 'none', languages: ['typescript'] },
        ],
        render() {
          throw Error('template dependency unavailable');
        },
      },
    ]);
    assert.throws(
      () => broken.plan({ destination: join(root, 'new') }),
      /dependency unavailable/,
    );
    const plan = minimalProjectGenerator.plan({
      destination: join(root, 'new'),
    });
    const controller = new AbortController();
    fs.writeFileSync = (...args) => {
      const result = write(...args);
      controller.abort();
      return result;
    };
    syncBuiltinESMExports();
    await assert.rejects(
      writeProjectPlanAsync(plan, { signal: controller.signal }),
      (e) => e.name === 'AbortError',
    );
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.writeFileSync = write;
    syncBuiltinESMExports();
    remove(root);
  }
});
test('interactive answers equal noninteractive flags and help describes actual supported capabilities', async () => {
  const root = temp(),
    messages = [],
    questions = [];
  try {
    const answers = {
      template: 'zerux-minimal',
      name: 'named',
      destination: 'interactive',
      mode: 'minimal',
      renderer: 'none',
      language: 'javascript',
      port: '4321',
    };
    let disposed = 0;
    const code = await runGeneratorCli(
      ['create', '--interactive', '--dry-run'],
      {
        cwd: root,
        out: (m) => messages.push(m),
        err: () => {},
        prompt: () => ({
          async ask(q) {
            questions.push(q);
            return answers[q.name];
          },
          close() {
            disposed++;
          },
        }),
      },
    );
    assert.equal(code, 0);
    assert.equal(disposed, 1);
    assert.ok(
      questions.find((q) => q.name === 'mode').choices.includes('minimal'),
    );
    assert.equal(
      await runGeneratorCli(
        [
          'create',
          'interactive',
          '--name',
          'named',
          '--language',
          'javascript',
          '--mode',
          'minimal',
          '--renderer',
          'none',
          '--port',
          '4321',
          '--yes',
          '--dry-run',
        ],
        { cwd: root, out: (m) => messages.push(m), err: () => {} },
      ),
      0,
    );
    assert.equal(messages[0], messages[1]);
    assert.deepEqual(fs.readdirSync(root), []);
    assert.equal(
      await runGeneratorCli(['create', '--help'], {
        out: (m) => messages.push(m),
      }),
      0,
    );
    assert.match(messages.at(-1), /Supported modes: minimal/);
    assert.match(messages.at(-1), /Supported renderers: none/);
    assert.equal(
      await runGeneratorCli(['create', 'valid', '--interactive', '--yes'], {
        cwd: root,
        out: () => {},
        err: () => {},
      }),
      2,
    );
    assert.equal(
      await runGeneratorCli(['create', 'valid', '--install'], {
        cwd: root,
        out: () => {},
        err: () => {},
      }),
      2,
    );
  } finally {
    remove(root);
  }
});
test(
  'real SIGINT while prompting returns 130, disposes the prompt and writes no project',
  { timeout: 10000 },
  async () => {
    const root = temp();
    try {
      const toolkit = pathToFileURL(
        resolve('packages/zclivo/dist/index.js'),
      ).href;
      const code = `import {runGeneratorCli} from ${JSON.stringify(toolkit)};import fs from 'node:fs';const c=new AbortController(),stop=()=>c.abort(),keepAlive=setInterval(()=>{},1000);process.once('SIGINT',stop);try{process.exitCode=await runGeneratorCli(['create','--interactive'],{cwd:process.argv[1],signal:c.signal,out:()=>{},err:()=>{},prompt:()=>({ask(_q,signal){console.log('READY');return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('interrupted')),{once:true}));},close(){fs.writeFileSync(process.argv[1]+'/disposed','yes');}})});}finally{clearInterval(keepAlive);process.off('SIGINT',stop);}`;
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', code, root],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      try {
        await once(child.stdout, 'data');
        const ended = once(child, 'close');
        child.kill('SIGINT');
        const [status] = await ended;
        assert.equal(status, 130);
        assert.deepEqual(fs.readdirSync(root), ['disposed']);
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      const noninteractive = spawnSync(
        process.execPath,
        ['packages/zclivo/dist/bin.js', 'create', '--interactive'],
        { encoding: 'utf8', timeout: 3000 },
      );
      assert.equal(noninteractive.status, 2);
    } finally {
      remove(root);
    }
  },
);
test('a target claimed by another writer during staging is preserved', () => {
  const root = temp(),
    write = fs.writeFileSync;
  const destination = join(root, 'race');
  try {
    const plan = minimalProjectGenerator.plan({ destination });
    let raced = false;
    fs.writeFileSync = (...args) => {
      if (!raced) {
        raced = true;
        fs.mkdirSync(destination);
        write(join(destination, 'unrelated'), 'keep');
      }
      return write(...args);
    };
    syncBuiltinESMExports();
    assert.throws(() => writeProjectPlan(plan), /appeared/);
    assert.deepEqual(fs.readdirSync(root), ['race']);
    assert.equal(
      fs.readFileSync(join(destination, 'unrelated'), 'utf8'),
      'keep',
    );
  } finally {
    fs.writeFileSync = write;
    syncBuiltinESMExports();
    remove(root);
  }
});
test('disposed terminal prompts cannot reopen and malformed CLI/plan input does not write', async () => {
  const { PassThrough } = await import('node:stream');
  const { createTerminalGeneratorPrompt } = await import('zclivo');
  const input = new PassThrough(),
    output = new PassThrough();
  const prompt = createTerminalGeneratorPrompt({
    input,
    output,
    onInterrupt: () => {},
  });
  try {
    prompt.close();
    await assert.rejects(
      prompt.ask(
        { name: 'name', message: 'Name', defaultValue: 'app' },
        new AbortController().signal,
      ),
      /closed/,
    );
    assert.equal(
      await runGeneratorCli(null, { out: () => {}, err: () => {} }),
      2,
    );
    await assert.rejects(writeProjectPlanAsync({}), /Validated/);
  } finally {
    input.destroy();
    output.destroy();
  }
});
