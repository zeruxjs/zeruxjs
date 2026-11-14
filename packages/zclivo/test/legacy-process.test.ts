import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
/** Fixture module directory used to select only this package's compiled entry. */
const here = dirname(fileURLToPath(import.meta.url));
test('legacy Zerux command executes once and does not terminate handlers', () => {
  /** Explicit built toolkit module path, never sourced from a command argument. */
  const modulePath = join(here, '../dist/index.js');
  /** Fixed authored synthetic child program; only the test explicitly executes it. */
  const source = `import {ZeruxCLI} from ${JSON.stringify('file://' + modulePath)};
 const cli=new ZeruxCLI(['dev','--port','6000']);
 cli.addKey('zerux',{func(){cli.addCommand('zerux','dev',args=>{console.log('RUN:'+args.namedArgs.port);});}});`;
  /** Finite owned child-process receipt used for exit/diagnostic assertions. */
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 3000 }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RUN:6000/);
});

test('legacy owner can interrupt and dispose an explicitly awaited command', () => {
  /** Explicit built toolkit module path, never sourced from a command argument. */
  const modulePath = join(here, '../dist/index.js');
  /** Fixed authored synthetic child program; only the test explicitly executes it. */
  const source = `import {ZeruxCLI} from ${JSON.stringify('file://' + modulePath)};
 const cli=new ZeruxCLI(['wait']);let cleaned=false;let started;const ready=new Promise(resolve=>{started=resolve;});
 cli.registry.register('app','wait',async (_args,context)=>{const timer=setInterval(()=>{},1000);context.onDispose(()=>{clearInterval(timer);cleaned=true;});started();await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));});
 const pending=cli.run('app');await ready;await cli.dispose();const result=await pending;
 if(result.exitCode!==130||!cleaned)throw new Error('cleanup failed');`;
  /** Finite owned child-process receipt used for exit/diagnostic assertions. */
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 3000 }
  );
  assert.equal(result.status, 130, result.stderr);
  assert.equal(result.signal, null);
});

test('configured missing plugins are not swallowed as a missing application manifest', async () => {
  /** Explicit native fixture filesystem helpers; only owned temporary paths are written. */
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  /** Native temporary-root helper for isolated synthetic plugin configuration. */
  const { tmpdir } = await import('node:os');
  /** Owned fixture project root removed in finally. */
  const root = mkdtempSync(join(tmpdir(), 'zclivo-legacy-missing-'));
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        zeruxCli: { plugins: ['zclivo-missing-plugin'] },
      })
    );
    /** Fixed authored synthetic child program; only the test explicitly executes it. */
    const source = `import {ZeruxCLI} from ${JSON.stringify('file://' + join(here, '../dist/index.js'))};const cli=new ZeruxCLI(['run']);cli.addCommand('app','run',()=>{console.log('SHOULD_NOT_RUN');});await cli.run('app');await cli.dispose();`;
    /** Finite owned child-process receipt used for exit/diagnostic assertions. */
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', source],
      { cwd: root, encoding: 'utf8', timeout: 3000 }
    );
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/);
    assert.match(result.stderr, /zclivo-missing-plugin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
