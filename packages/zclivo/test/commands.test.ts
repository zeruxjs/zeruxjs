import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry, ZeruxCLI } from '../dist/index.js';
test('supports multiple keyword registries, alias dispatch, help, docs and completion', async () => {
  /** Invocation-local fixture registry; no process listeners or command execution on registration. */
  const registry = new CommandRegistry();
  /** Captured synthetic help output compared without using process console state. */
  const messages = [];
  registry.registerKey('zerux', 'Framework');
  registry.register(
    'zerux',
    'build',
    async (args, ctx) => {
      assert.equal(args.namedArgs.out, 'dist');
      assert.equal(ctx.command, 'build');
      return 0;
    },
    {
      aliases: ['b'],
      description: 'Compile',
      docs: 'Detailed docs',
      example: 'zerux build',
    }
  );
  registry.register('zyro', 'render', () => 0);
  assert.deepEqual(registry.keywords(), ['zerux', 'zyro']);
  assert.deepEqual(registry.complete('zerux', 'b'), ['b', 'build']);
  assert.equal(
    (await registry.dispatch('zerux', ['b', '--out', 'dist'])).exitCode,
    0
  );
  assert.equal(
    (
      await registry.dispatch('zerux', ['build', '--help'], (s) =>
        messages.push(s)
      )
    ).exitCode,
    0
  );
  assert.match(messages[0], /Compile/);
  assert.equal((await registry.dispatch('zerux', ['missing'])).exitCode, 2);
  assert.equal(registry.docs('zerux', 'build'), 'Detailed docs');
});
test('invalid command and conflicting alias rejected', () => {
  /** Invocation-local fixture registry; no process listeners or command execution on registration. */
  const registry = new CommandRegistry();
  registry.register('app', 'run', () => {}, { aliases: ['r'] });
  assert.throws(() => registry.register('app', 'r', () => {}));
  assert.throws(() => registry.register('app', '../../escape', () => {}));
  assert.throws(() =>
    registry.register('app', 'serve', () => {}, { aliases: ['r'] })
  );
});
test('handler exceptions return errors without forcing process exit', async () => {
  /** Invocation-local fixture registry; no process listeners or command execution on registration. */
  const registry = new CommandRegistry();
  registry.register('demo', 'fail', () => {
    throw new Error('boom');
  });
  /** Explicit dispatch receipt checked for ordinary handler failure. */
  const result = await registry.dispatch('demo', ['fail']);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /boom/);
});
test('legacy addKey and addCommand retains registry compatibility', (t) => {
  /** Owned legacy compatibility instance; no addKey scheduling occurs in this fixture. */
  const cli = new ZeruxCLI(['dev', '--port', '4000']);
  t.after(() => cli.dispose());
  let value;
  cli.addCommand('zerux', 'dev', (args) => {
    value = args.namedArgs.port;
  });
  cli.registry.registerKey('zerux');
  assert.ok(cli.registry.lookup('zerux', 'dev'));
});
