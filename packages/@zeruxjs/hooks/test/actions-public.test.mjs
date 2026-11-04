import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test('packed root/actions exports and package-owned declarations compile and run', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'hooks-public-'));
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const result = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--cache', join(temporary, 'cache'), '--pack-destination', temporary], { cwd, encoding: 'utf8' }));
    const packed = Array.isArray(result) ? result[0] : result['@zeruxjs/hooks'];
    writeFileSync(join(temporary, 'package.json'), JSON.stringify({ type: 'module', private: true }));
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', join(temporary, 'cache'), join(temporary, packed.filename)], { cwd: temporary, stdio: 'pipe' });
    writeFileSync(join(temporary, 'consumer.ts'), `import { createServerActions } from '@zeruxjs/hooks';
import { createServerFilters, createAsyncServerActions, createAsyncServerFilters } from '@zeruxjs/hooks/actions';
import { createServerLifecycleHooks } from '@zeruxjs/hooks/lifecycle';
const lifecycle = createServerLifecycleHooks();
lifecycle.register('response:before', context => context.response.setHeader('x-example', 'yes'));
lifecycle.register('request:after', context => { const status: number = context.status;
// @ts-expect-error observation phases do not expose mutable response handles
context.response;
});
lifecycle.dispose();
const actions = createServerActions<{ ready: [id: string] }>();
const filters = createServerFilters<{ title: [value: string, suffix: string] }>();
const events: string[] = [];
const registration = actions.register('ready', (_context, id) => { events.push(id); }, { once: true, priority: 5 });
filters.register('title', (_context, value, suffix) => value + suffix);
try {
 actions.dispatch('ready', ['application']);
 if (registration.active || events[0] !== 'application' || filters.apply('title', 'Hello', ['!']) !== 'Hello!') throw Error('Public API mismatch');
} finally { registration.remove(); actions.dispose(); filters.dispose(); }
const asyncActions = createAsyncServerActions<{ work: [number] }>();
asyncActions.register('work', async (_context, count) => { if (count !== 1) throw Error('Wrong tuple'); });
await asyncActions.dispatch('work', [1]); asyncActions.dispose(); await asyncActions.whenIdle();
const asyncFilters = createAsyncServerFilters<{ increment: [number] }>();
asyncFilters.register('increment', async (_context, value) => value + 1);
const incremented: number = await asyncFilters.apply('increment', 1, []);
if (incremented !== 2) throw Error('Wrong filter'); asyncFilters.dispose(); await asyncFilters.whenIdle();
if (false) {
 // @ts-expect-error undeclared lifecycle action
 actions.dispatch('unknown', []);
 // @ts-expect-error invalid action payload
 actions.dispatch('ready', [1]);
 // @ts-expect-error filters preserve their declared value type
 filters.register('title', (_context, _value) => 1);
 // @ts-expect-error synchronous filters cannot return promises
 filters.register('title', async (_context, value) => value);
 // @ts-expect-error invalid filter argument tuple
 filters.apply('title', 'Hello', [1]);
}
`);
    const compiler = resolve(cwd, '../../../node_modules/typescript/bin/tsc');
    execFileSync(process.execPath, [compiler, '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', 'consumer.ts'], { cwd: temporary, stdio: 'pipe' });
    execFileSync(process.execPath, ['consumer.js'], { cwd: temporary, stdio: 'pipe' });
    assert.ok(packed.files.some(file => file.path === 'dist/server-hooks.d.ts'));
    assert.ok(!packed.files.some(file => file.path.startsWith('src/')));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
