import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CommandRegistry,
  loadPlugins,
  stripTerminalCodes,
  formatError,
  parseArguments,
} from 'zclivo';

test('typed aliases, repeated values, booleans and separator retain positionals', async () => {
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  let captured;
  registry.register(
    'app',
    'build',
    (args, context) => {
      captured = { args, options: context.options };
    },
    {
      aliases: ['b'],
      flags: {
        verbose: { type: 'boolean', alias: 'v' },
        tag: { type: 'string' },
        count: { type: 'number' },
      },
    }
  );
  assert.equal(
    (
      await registry.dispatch('app', [
        'b',
        '-v',
        'file',
        '--tag=a',
        '--tag=b',
        '--count',
        '-2',
        '--',
        '--help',
        '-d',
      ])
    ).exitCode,
    0
  );
  assert.deepEqual(captured.args.positionalArgs, ['file', '--help', '-d']);
  assert.deepEqual(
    { ...captured.options },
    { verbose: true, tag: ['a', 'b'], count: -2 }
  );
});

test('usage errors and conflict diagnostics do not execute handlers', async () => {
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  let calls = 0;
  registry.register(
    'app',
    'build',
    () => {
      calls++;
    },
    {
      flags: {
        mode: { type: 'string', conflicts: ['watch'] },
        watch: { type: 'boolean' },
        workers: { type: 'number' },
      },
    }
  );
  assert.match((await registry.dispatch('app', ['biuld'])).message, /build/);
  assert.match(
    (await registry.dispatch('app', ['build', '--worker', '3'])).message,
    /Did you mean workers/
  );
  for (const args of [
    ['build', '--mode'],
    ['build', '--mode=x', '--watch'],
    ['build', '--workers=NaN'],
    ['build', '--bad!'],
    ['build', '-workers=2'],
  ]) {
    assert.equal((await registry.dispatch('app', args)).exitCode, 2);
  }
  assert.equal(calls, 0);
  assert.throws(() => parseArguments(['--x\r\nInjected=value']));
  assert.equal((await registry.dispatch('app', [null])).exitCode, 2);
});

test('registration validates before mutation and snapshots nested definitions', () => {
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  assert.throws(
    () => registry.register('fresh', 'run', () => {}, { aliases: ['run'] }),
    /conflict/
  );
  assert.deepEqual(registry.keywords(), []);
  assert.throws(() =>
    registry.register('fresh', 'run', () => {}, {
      flags: { value: { type: 'invalid' } },
    })
  );
  /** Borrowed input schema mutated after registration to verify immutable snapshots. */
  const flags = { mode: { type: 'string', choices: ['safe'] } };
  /** Borrowed input alias array mutated to prove registration isolation. */
  const aliases = ['r'];
  registry.register('app', 'run', () => {}, { flags, aliases });
  flags.mode.choices.push('unsafe');
  aliases.push('hacked');
  assert.deepEqual(registry.lookup('app', 'run').options.flags.mode.choices, [
    'safe',
  ]);
  assert.equal(registry.lookup('app', 'hacked'), undefined);
});

test('async rejection retains cause and all cleanup failures while continuing LIFO cleanup', async () => {
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  /** Private synthetic handler failure compared by object identity. */
  const cause = new Error('backend unavailable');
  /** Private synthetic cleanup failure retained separately from the handler error. */
  const cleanup = new Error('cleanup unavailable');
  /** Synthetic LIFO callback trace without application payloads. */
  const order = [];
  registry.register('app', 'run', async (_args, context) => {
    context.onDispose(() => {
      order.push(1);
    });
    context.onDispose(() => {
      order.push(2);
      throw cleanup;
    });
    throw cause;
  });
  /** Explicit dispatch receipt after handler and cleanup actually settle. */
  const result = await registry.dispatch('app', ['run']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.error, cause);
  assert.deepEqual(result.cleanupErrors, [cleanup]);
  assert.deepEqual(order, [2, 1]);
  registry.register('app', 'bad-status', () => NaN);
  assert.equal((await registry.dispatch('app', ['bad-status'])).exitCode, 1);
});

test('interruption waits for cooperative handler and clears its timer exactly once', async () => {
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  /** Owned invocation cancellation controller; no process signal listeners are installed. */
  const controller = new AbortController();
  let started;
  /** Synthetic barrier proving the cooperative handler acquired its timer first. */
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let cleaned = 0;
  registry.register('app', 'wait', async (_args, context) => {
    /** Owned handler interval transferred immediately to invocation cleanup. */
    const timer = setInterval(() => {}, 1000);
    context.onDispose(() => {
      clearInterval(timer);
      cleaned++;
    });
    started();
    await new Promise((resolve) =>
      context.signal.addEventListener('abort', resolve, { once: true })
    );
  });
  /** Owned dispatch or registration promise kept pending until the explicit fixture releases it. */
  const pending = registry.dispatch('app', ['wait'], undefined, {
    signal: controller.signal,
  });
  await ready;
  controller.abort(new Error('private reason'));
  /** Explicit dispatch receipt after handler and cleanup actually settle. */
  const result = await pending;
  assert.equal(result.exitCode, 130);
  assert.equal(result.cancelled, true);
  assert.equal(cleaned, 1);
  assert.doesNotMatch(result.message, /private/);
  assert.equal(
    (
      await registry.dispatch('app', ['wait'], undefined, {
        signal: controller.signal,
      })
    ).exitCode,
    130
  );
  assert.equal(cleaned, 1);
});

test('help, errors and formatting strip CSI, OSC, CR and controls', async () => {
  /** Inert terminal-control fixture used to verify sanitization, not secret redaction. */
  const attack = 'safe\x1b[2J\x1b]52;c;clipboard\x07\r\x00';
  assert.equal(stripTerminalCodes(attack), 'safe');
  assert.equal(formatError(new Error(attack)), 'Error: safe');
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  registry.register(
    'app',
    'run',
    () => {
      throw new Error(attack);
    },
    { description: attack, docs: attack }
  );
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  assert.doesNotMatch(registry.help('app'), /[\x00\x1b\r]/);
  assert.equal(registry.docs('app', 'run'), 'safe');
  assert.equal((await registry.dispatch('app', ['run'])).message, 'safe');
});

/** Create an owned temporary host and explicit synthetic plugin writer.
 * @returns {object} Fixture root, inert writer and filesystem cleanup callback.
 */
function fixture() {
  /** Owned temporary plugin project removed by the fixture close callback. */
  const root = mkdtempSync(join(tmpdir(), 'zclivo-lifecycle-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module' })
  );
  /** Create only a trusted synthetic allowlisted package in the fixture root.
   * @param {string} name - Fixed fixture package name.
   * @param {string} source - Fixed authored registration source.
   * @returns {void} Writes inert fixture package files without importing them.
   */
  const plugin = (name, source) => {
    /** Owned synthetic node_modules package directory inside this fixture only. */
    const dir = join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name,
        type: 'module',
        exports: './plugin.js',
        zerux: './plugin.js',
      })
    );
    writeFileSync(join(dir, 'plugin.js'), source);
  };
  return {
    root,
    plugin,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('plugin conflict rolls back partial registration and releases acquired resources', async () => {
  /** Owned temporary plugin fixture; finally removes its filesystem state. */
  const f = fixture();
  try {
    /** Owned synthetic cleanup marker used to prove failed-registration rollback. */
    const marker = join(f.root, 'cleaned');
    f.plugin(
      'conflicting',
      `import {writeFileSync} from 'node:fs';export function register({commands,onDispose}){onDispose(()=>writeFileSync(new URL('../../cleaned',import.meta.url),'done'));commands.register('app','partial',()=>{});commands.register('app','run',()=>{});}`
    );
    /** Isolated command registry with only trusted synthetic handlers. */
    const registry = new CommandRegistry();
    registry.register('app', 'run', () => 0);
    await assert.rejects(
      loadPlugins(['conflicting'], registry, f.root),
      /already registered/
    );
    assert.equal(registry.lookup('app', 'partial'), undefined);
    assert.equal((await registry.dispatch('app', ['run'])).exitCode, 0);
    assert.equal(readFileSync(marker, 'utf8'), 'done');
  } finally {
    f.close();
  }
});

test('dependency import failure removes earlier plugins from the same load batch', async () => {
  /** Owned temporary plugin fixture; finally removes its filesystem state. */
  const f = fixture();
  try {
    f.plugin(
      'working',
      `export function register({commands}){commands.register('app','added',()=>0);}`
    );
    f.plugin(
      'broken',
      `import 'zclivo-deliberately-missing-dependency';export function register(){}`
    );
    /** Isolated command registry with only trusted synthetic handlers. */
    const registry = new CommandRegistry();
    registry.register('app', 'original', () => 0);
    await assert.rejects(
      loadPlugins(['working', 'broken'], registry, f.root),
      /zclivo-deliberately-missing-dependency/
    );
    assert.equal(registry.lookup('app', 'added'), undefined);
    assert.ok(registry.lookup('app', 'original'));
  } finally {
    f.close();
  }
});

test('plugin disposal interrupts active commands, removes owned entries and reports cleanup failure', async () => {
  /** Owned temporary plugin fixture; finally removes its filesystem state. */
  const f = fixture();
  try {
    f.plugin(
      'waiting',
      `export function register({commands,onDispose}){onDispose(()=>{throw new Error('plugin cleanup failure')});commands.register('app','wait',async (_args,context)=>{await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));});}`
    );
    /** Isolated command registry with only trusted synthetic handlers. */
    const registry = new CommandRegistry();
    registry.register('app', 'keep', () => 0);
    /** Owned explicit plugin activation record; dispose aborts/drains its commands. */
    const [plugin] = await loadPlugins(['waiting'], registry, f.root);
    /** Owned dispatch or registration promise kept pending until the explicit fixture releases it. */
    const pending = registry.dispatch('app', ['wait']);
    await assert.rejects(plugin.dispose(), /cleanup failed/);
    assert.equal((await pending).exitCode, 130);
    assert.equal(registry.lookup('app', 'wait'), undefined);
    assert.ok(registry.lookup('app', 'keep'));
    await assert.rejects(plugin.dispose(), /cleanup failed/);
  } finally {
    f.close();
  }
});

test('concurrent registration does not overwrite a live registry change', async () => {
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  let resume;
  /** Synthetic registration barrier controlling concurrent live mutation. */
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  /** Owned dispatch or registration promise kept pending until the explicit fixture releases it. */
  const pending = registry.transaction(async (commands) => {
    commands.register('app', 'staged', () => {});
    await gate;
  });
  registry.register('app', 'live', () => {});
  resume();
  await assert.rejects(pending, /Registry changed/);
  assert.equal(registry.lookup('app', 'staged'), undefined);
  assert.ok(registry.lookup('app', 'live'));
});

test('scope completion unlinks upstream listeners on success and plugin disposal', async () => {
  /** Native diagnostic helper inspecting only the fixture's owned signal. */
  const { getEventListeners } = await import('node:events');
  /** Owned invocation cancellation controller; no process signal listeners are installed. */
  const controller = new AbortController();
  /** Isolated command registry with only trusted synthetic handlers. */
  const registry = new CommandRegistry();
  registry.register('app', 'run', () => 0);
  /** Original borrowed-signal listener count used to detect lifecycle leaks. */
  const count = getEventListeners(controller.signal, 'abort').length;
  assert.equal(
    (
      await registry.dispatch('app', ['run'], undefined, {
        signal: controller.signal,
      })
    ).exitCode,
    0
  );
  assert.equal(getEventListeners(controller.signal, 'abort').length, count);
  /** Owned temporary plugin fixture; finally removes its filesystem state. */
  const f = fixture();
  try {
    f.plugin(
      'normal',
      `export function register({commands,onDispose}){commands.register('app','extra',()=>0);onDispose(()=>{});}`
    );
    /** Owned explicit plugin activation record; dispose aborts/drains its commands. */
    const [plugin] = await loadPlugins(['normal'], registry, f.root, {
      signal: controller.signal,
    });
    assert.equal((await registry.dispatch('app', ['extra'])).exitCode, 0);
    await plugin.dispose();
    await plugin.dispose();
    assert.equal(registry.lookup('app', 'extra'), undefined);
    assert.equal(getEventListeners(controller.signal, 'abort').length, count);
  } finally {
    f.close();
  }
});

test('standalone entry point sanitizes unknown-command diagnostics and suggests commands', async () => {
  /** Explicit legacy synchronous entry used to inspect fixed diagnostic policy. */
  const { runZcli } = await import('../dist/bin.js');
  /** Captured synthetic terminal-safe output. */
  const messages = [];
  assert.equal(
    runZcli(
      ['creat'],
      () => {},
      (message) => messages.push(message)
    ),
    2
  );
  assert.match(messages[0], /Did you mean create/);
  assert.equal(
    runZcli(
      ['bad\x1b[2J\r'],
      () => {},
      (message) => messages.push(message)
    ),
    2
  );
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  assert.doesNotMatch(messages[1], /[\x1b\r]/);
  assert.equal(
    runZcli(
      [null],
      () => {},
      () => {}
    ),
    2
  );
});

test('shared plugin keywords disappear after disposal in either order', async () => {
  /** Owned temporary plugin fixture; finally removes its filesystem state. */
  const f = fixture();
  try {
    f.plugin(
      'first',
      `export function register({commands}){commands.registerKey('shared','Plugin commands');commands.register('shared','first',()=>0);}`
    );
    f.plugin(
      'second',
      `export function register({commands}){commands.register('shared','second',()=>0);}`
    );
    /** Isolated command registry with only trusted synthetic handlers. */
    const registry = new CommandRegistry();
    /** Owned explicit plugin records sharing one fixture keyword. */
    const [first, second] = await loadPlugins(
      ['first', 'second'],
      registry,
      f.root
    );
    await first.dispose();
    assert.equal((await registry.dispatch('shared', ['second'])).exitCode, 0);
    await second.dispose();
    assert.deepEqual(registry.keywords(), []);
  } finally {
    f.close();
  }
});
