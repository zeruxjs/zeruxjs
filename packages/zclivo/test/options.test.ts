import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry, type OptionSchema } from '../dist/index.js';
test('typed flags validate defaults, aliases, choices and rejected values', async () => {
  /** Trusted fixture schema covering scalar defaults, choices and aliases. */
  const flags: OptionSchema = {
    port: { type: 'number', required: true, alias: 'p' },
    env: { type: 'string', choices: ['dev', 'prod'], default: 'dev' },
    verbose: { type: 'boolean', default: false },
  };
  /** Isolated registry using the explicit scalar schema under test. */
  const registry = new CommandRegistry();
  let captured: Record<string, unknown> | undefined;
  registry.register(
    'app',
    'serve',
    (_args, ctx) => {
      captured = ctx.options;
    },
    { flags }
  );
  assert.equal(
    (await registry.dispatch('app', ['serve', '-p', '4300', '--env', 'prod']))
      .exitCode,
    0
  );
  /** Captured parsed options retained for exact default/alias assertions. */
  const capturedOptions = captured;
  if (!capturedOptions) {
    throw new Error('Command options were not captured');
  }
  assert.deepEqual(
    { ...capturedOptions },
    { port: 4300, env: 'prod', verbose: false }
  );
  assert.equal(
    (await registry.dispatch('app', ['serve', '--port', 'abc'])).exitCode,
    2
  );
  assert.equal(
    (await registry.dispatch('app', ['serve', '--port', '2', '--env', 'stage']))
      .exitCode,
    2
  );
  assert.equal(
    (await registry.dispatch('app', ['serve', '--port', '2', '--unexpected']))
      .exitCode,
    2
  );
  assert.equal((await registry.dispatch('app', ['serve'])).exitCode, 2);
});
