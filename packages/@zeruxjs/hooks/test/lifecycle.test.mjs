import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestHookScope, createContext, useContext, setContext, withContext, runHooks, useEffect, disposeHooks, createServerLifecycleHooks } from '../dist/index.js';
test('owned request scopes invalidate escaped contexts/state and clean every effect once despite failure', async () => {
  const scope = createRequestHookScope(), key = createContext('default'), events = []; let release;
  const work = scope.run(async () => {
    setContext(key, 'PRIVATE');
    const component = () => { useEffect(() => () => { events.push('one'); throw Error('cleanup failed'); }, []); useEffect(() => () => events.push('two'), []); };
    runHooks(component);
    assert.throws(() => disposeHooks(component), /cleanup failed/); assert.equal(disposeHooks(component), false);
    runHooks(() => useEffect(() => () => events.push('owned'), []));
    await new Promise(resolve => release = resolve);
    assert.throws(() => useContext(key), /disposed/);
    assert.throws(() => runHooks(() => 1), /disposed/);
  });
  scope.dispose(); scope.dispose(); release(); await work;
  assert.deepEqual(events, ['one', 'two', 'owned']); assert.throws(() => scope.run(() => 1), /disposed/);
});
test('nested contexts cannot outlive their owned parent; synchronous lifecycle registrations are explicit', async () => {
  const scope = createRequestHookScope(), context = createContext('none'); let release;
  const work = scope.run(() => withContext(context, 'child', async () => { await new Promise(resolve => release = resolve); assert.throws(() => useContext(context), /disposed/); }));
  scope.dispose(); release(); await work;
  const hooks = createServerLifecycleHooks();
  assert.throws(() => hooks.register('request:before', async () => {}), { code: 'HOOK_ASYNC_IN_SYNC' });
  assert.throws(() => hooks.register('request:before', null), { code: 'HOOK_INVALID' });
  const values = []; const token = hooks.register('generation:ready', value => values.push(value.generationId), { once: true });
  hooks.dispatch('generation:ready', { generationId: 'one' }); hooks.dispatch('generation:ready', { generationId: 'two' });
  assert.deepEqual(values, ['one']); assert.equal(token.active, false); hooks.dispose();
});
