import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerActions, createAsyncServerActions, createServerFilters, createAsyncServerFilters, runWithRequestHooks, createContext, setContext, useContext } from '../dist/index.js';

test('priority ties, exact duplicate tokens, once before invocation and idempotent disposal', async () => {
  const hooks = createServerActions(), events = [];
  const callback = () => events.push('duplicate');
  const first = hooks.register('ready', callback, { priority: 0 });
  hooks.register('ready', callback, { priority: 0 });
  hooks.register('ready', () => events.push('last'), { priority: 20 });
  let once;
  once = hooks.register('ready', () => { assert.equal(once.active, false); events.push('once'); }, { priority: -1, once: true });
  assert.equal(first.remove(), true); assert.equal(first.remove(), false);
  hooks.dispatch('ready', []); hooks.dispatch('ready', []);
  assert.deepEqual(events, ['once', 'duplicate', 'last', 'duplicate', 'last']);
  hooks.dispose(); hooks.dispose(); await hooks.whenIdle();
  assert.deepEqual(hooks.getDiagnostics(), { disposed: true, handlers: 0, pending: 0 });
  assert.throws(() => hooks.dispatch('ready', []), { code: 'HOOK_CLOSED' });
});
test('mutation snapshot excludes new entries and skips removed handlers before their turn', () => {
  const hooks = createServerActions(), events = []; let second;
  hooks.register('event', () => { events.push('first'); second.remove(); hooks.register('event', () => events.push('new')); }, { once: true });
  second = hooks.register('event', () => events.push('removed'));
  hooks.dispatch('event', []); assert.deepEqual(events, ['first']);
  hooks.dispatch('event', []); assert.deepEqual(events, ['first', 'new']); hooks.dispose();
});
test('filters transform serially, preserve extra arguments, and identity when empty', async () => {
  const sync = createServerFilters(), async = createAsyncServerFilters();
  assert.equal(sync.apply('title', 'hello', []), 'hello');
  sync.register('title', (_ctx, value, suffix) => value + suffix, { priority: 1 });
  sync.register('title', (_ctx, value) => value.toUpperCase());
  assert.equal(sync.apply('title', 'hello', ['!']), 'HELLO!');
  async.register('number', async (_ctx, value) => value + 1);
  async.register('number', (_ctx, value) => value * 2);
  assert.equal(await async.apply('number', 2, []), 6);
  assert.equal('dispatch' in sync, false); sync.dispose(); async.dispose(); await async.whenIdle();
});
test('sync handlers reject async misuse and propagate thrown dependencies without later calls', async () => {
  const hooks = createServerActions();
  assert.throws(() => hooks.register('event', async () => {}), { code: 'HOOK_ASYNC_IN_SYNC' });
  hooks.register('event', () => Promise.reject(Error('dependency failed')));
  assert.throws(() => hooks.dispatch('event', []), { code: 'HOOK_ASYNC_IN_SYNC' });
  await new Promise(resolve => setImmediate(resolve)); hooks.dispose();
  const second = createServerActions(), failure = Error('dependency failure'); let later = false;
  second.register('event', () => { throw failure; }, { once: true });
  second.register('event', () => later = true);
  assert.throws(() => second.dispatch('event', []), error => error === failure);
  assert.equal(later, false); second.dispatch('event', []); assert.equal(later, true); second.dispose();
});
test('async failure consumes once, preserves original failure and releases pending slots', async () => {
  const hooks = createAsyncServerActions({ maxPending: 1 }), error = Error('backend unavailable'); let count = 0;
  const token = hooks.register('event', async () => { throw error; }, { once: true });
  hooks.register('event', () => { count++; });
  await assert.rejects(hooks.dispatch('event', []), actual => actual === error);
  assert.equal(token.active, false); assert.equal(count, 0); assert.equal(hooks.getDiagnostics().pending, 0);
  await hooks.dispatch('event', []); assert.equal(count, 1); hooks.dispose(); await hooks.whenIdle();
});
test('recursive dispatch is bounded and once handlers cannot recursively invoke themselves', async () => {
  const sync = createServerActions({ maxDepth: 3 }); let calls = 0;
  sync.register('recursive', () => { calls++; sync.dispatch('recursive', []); });
  assert.throws(() => sync.dispatch('recursive', []), { code: 'HOOK_DEPTH' }); assert.equal(calls, 3);
  assert.equal(sync.getDiagnostics().pending, 0); sync.dispose();
  const once = createServerActions(); let count = 0;
  once.register('recursive', () => { count++; once.dispatch('recursive', []); }, { once: true });
  once.dispatch('recursive', []); assert.equal(count, 1); once.dispose();
  const async = createAsyncServerActions({ maxDepth: 2 });
  async.register('recursive', () => async.dispatch('recursive', []));
  await assert.rejects(async.dispatch('recursive', []), { code: 'HOOK_DEPTH' });
  assert.equal(async.getDiagnostics().pending, 0); async.dispose();
});
test('request registries and AsyncLocalStorage context remain isolated during overlapping dispatch', async () => {
  const context = createContext('none');
  const request = value => runWithRequestHooks(async () => {
    const hooks = createAsyncServerFilters(); setContext(context, value);
    hooks.register('label', async (_ctx, text) => { await new Promise(resolve => setImmediate(resolve)); return `${text}:${useContext(context)}`; });
    try { return await hooks.apply('label', value, []); } finally { hooks.dispose(); await hooks.whenIdle(); }
  });
  assert.deepEqual(await Promise.all([request('one'), request('two')]), ['one:one', 'two:two']);
});
test('cooperative cancellation, disposal drain and registration-signal listener ownership', async () => {
  const hooks = createAsyncServerActions({ maxPending: 1 }), lifetime = new AbortController();
  const token = hooks.register('unused', () => {}, { signal: lifetime.signal });
  lifetime.abort(); assert.equal(token.active, false);
  let started, release, observed; const ready = new Promise(resolve => started = resolve);
  hooks.register('event', async ({ signal }) => { observed = signal; started(); await new Promise(resolve => release = resolve); });
  const work = hooks.dispatch('event', []); await ready;
  await assert.rejects(hooks.dispatch('event', []), { code: 'HOOK_CAPACITY' });
  hooks.dispose(); assert.equal(observed.aborted, true); assert.equal(hooks.getDiagnostics().handlers, 0);
  let drained = false; const drain = hooks.whenIdle().then(() => drained = true);
  await Promise.resolve(); assert.equal(drained, false); release();
  await assert.rejects(work, { code: 'HOOK_ABORTED' }); await drain;
  assert.equal(hooks.getDiagnostics().pending, 0);
});
test('abort before dispatch skips work, abort between handlers skips remaining work, invalid inputs fail', async () => {
  const hooks = createServerActions({ maxHandlers: 2 }), abort = new AbortController(); let later = false;
  hooks.register('event', () => abort.abort()); hooks.register('event', () => later = true);
  assert.throws(() => hooks.dispatch('event', [], { signal: abort.signal }), { code: 'HOOK_ABORTED' });
  assert.equal(later, false); assert.throws(() => hooks.dispatch('event', [], { signal: abort.signal }), { code: 'HOOK_ABORTED' });
  assert.throws(() => hooks.register('event', () => {}), { code: 'HOOK_CAPACITY' });
  hooks.dispose();
  for (const options of [{ maxDepth: 0 }, { maxDepth: null }, { maxHandlers: Infinity }, { maxPending: 257 }, { unknown: 1 }]) assert.throws(() => createServerActions(options), { code: 'HOOK_INVALID' });
  const invalid = createServerFilters();
  assert.throws(() => invalid.register('bad\r\n', () => 0), { code: 'HOOK_INVALID' });
  assert.throws(() => invalid.register('value', () => 0, { priority: NaN }), { code: 'HOOK_INVALID' });
  assert.throws(() => invalid.register('value', () => 0, { priority: null }), { code: 'HOOK_INVALID' });
  assert.throws(() => invalid.apply('value', 0, null), { code: 'HOOK_INVALID' });
  invalid.dispose();
});
test('equal priorities preserve registration order, including concurrent once dispatch', async () => {
  const sync = createServerActions(), order = [];
  for (let i = 0; i < 3; i++) sync.register('event', () => { order.push(i); }, { priority: 5 });
  sync.dispatch('event', []); assert.deepEqual(order, [0, 1, 2]); sync.dispose();
  const async = createAsyncServerActions(); let calls = 0;
  async.register('event', async () => { calls++; await Promise.resolve(); }, { once: true });
  await Promise.all([async.dispatch('event', []), async.dispatch('event', [])]);
  assert.equal(calls, 1); async.dispose(); await async.whenIdle();
});
test('async cancellation keeps pending slot and skip remaining handlers until real settlement', async () => {
  const hooks = createAsyncServerFilters({ maxPending: 1 }), abort = new AbortController();
  let release, started; const ready = new Promise(resolve => started = resolve); let later = false;
  hooks.register('value', async (_ctx, value) => { started(); await new Promise(resolve => release = resolve); return value + 1; });
  hooks.register('value', (_ctx, value) => { later = true; return value; });
  const pending = hooks.apply('value', 1, [], { signal: abort.signal }); await ready; abort.abort('private-reason');
  assert.equal(hooks.getDiagnostics().pending, 1);
  await assert.rejects(hooks.apply('value', 1, []), { code: 'HOOK_CAPACITY' });
  release(); await assert.rejects(pending, error => error.code === 'HOOK_ABORTED' && !error.message.includes('private-reason'));
  assert.equal(later, false); assert.equal(hooks.getDiagnostics().pending, 0); hooks.dispose(); await hooks.whenIdle();
});
test('argument copying is bounded and failed getters do not acquire pending handles', async () => {
  const hooks = createServerActions(); const args = [];
  Object.defineProperty(args, '0', { get() { throw Error('payload unavailable'); } });
  assert.throws(() => hooks.dispatch('event', args), /payload unavailable/);
  assert.equal(hooks.getDiagnostics().pending, 0);
  // eslint-disable-next-line require-yield -- This negative fixture throws before yielding to exercise iterator failure cleanup.
  let count = 0; const values = [1]; values[Symbol.iterator] = function* () { throw Error('must not run iterator'); };
  hooks.register('event', (_ctx, value) => { count += value; });
  hooks.dispatch('event', values); assert.equal(count, 1); hooks.dispose(); await hooks.whenIdle();
});
