import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunner,
  expect,
  fn,
  spyOn,
  restoreAllMocks,
} from '../dist/index.js';
test('isolated runner executes suite hooks in order and .only selections', async () => {
  /** Independent inert fixture registry; all executed callbacks use only synthetic in-memory state. */
  const runner = createRunner();
  /** Observed hook/case invocation order, never a fabricated lifecycle trace. */
  const events = [];
  runner.describe('outer', () => {
    runner.beforeAll(() => events.push('beforeAll'));
    runner.afterAll(() => events.push('afterAll'));
    runner.beforeEach(() => events.push('beforeEach'));
    runner.afterEach(() => events.push('afterEach'));
    runner.test('first', () => events.push('first'));
    runner.test('second', () => events.push('second'));
  });
  /** Actual isolated run receipt with explicit passed/failed/skipped/attempt outcomes. */
  const result = await runner.runTests();
  assert.deepEqual([result.passed, result.failed, result.skipped], [2, 0, 0]);
  assert.deepEqual(events, [
    'beforeAll',
    'beforeEach',
    'first',
    'afterEach',
    'beforeEach',
    'second',
    'afterEach',
    'afterAll',
  ]);
  runner.clearTests();
  runner.test.only('selected', () => {});
  runner.test('hidden', () => assert.fail('not executed'));
  /** Actual second run receipt after clearing/replacing only this fixture registry. */
  const second = await runner.runTests();
  assert.equal(second.passed, 1);
  assert.equal(second.skipped, 1);
});
test('retries and hooks clean up after failures, timeout is reported', async () => {
  /** Independent inert fixture registry; all executed callbacks use only synthetic in-memory state. */
  const runner = createRunner();
  let tries = 0,
    cleanup = 0;
  runner.afterEach(() => cleanup++);
  runner.test.withOptions('retry', { retries: 2 }, () => {
    if (++tries < 3) {
      throw new Error('retry');
    }
  });
  runner.test('timeout', () => new Promise(() => {}));
  /** Actual isolated run receipt with explicit passed/failed/skipped/attempt outcomes. */
  const result = await runner.runTests({ timeoutMs: 20 });
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(tries, 3);
  assert.equal(cleanup, 4);
  assert.match(result.results[1].error.message, /timeout/i);
});
test('deep equality handles cycles, dates, maps, sets, negatives', () => {
  /** First trusted cyclic equality fixture; not hostile parsed runtime input. */
  const a = { id: 1 };
  a.self = a;
  /** Second independent trusted cyclic equality fixture. */
  const b = { id: 1 };
  b.self = b;
  expect(a).toEqual(b);
  expect(new Map([['a', 2]])).toEqual(new Map([['a', 2]]));
  expect(new Date('2025-01-01')).toEqual(new Date('2025-01-01'));
  expect([1, 2]).not.toContain(3);
  expect('hello').toMatch(/ell/);
  expect({ a: { b: 1 } }).toHaveProperty('a.b');
  assert.throws(() => expect('x').not.toBe('x'));
});
test('mocks record calls and restore their original methods', () => {
  /** Owned local synthetic function recorder cleared explicitly by the test. */
  const mock = fn((x) => x * 2);
  assert.equal(mock(3), 6);
  assert.deepEqual(mock.mock.calls, [[3]]);
  mock.mockReturnValue(9);
  assert.equal(mock(1), 9);
  mock.mockClear();
  assert.equal(mock.mock.calls.length, 0);
  /** Test-owned method container, restored before the fixture completes. */
  const obj = {
    value() {
      return 12;
    },
  };
  /** Owned test method replacement; legacy global restore is exercised only inside this isolated test process. */
  const spy = spyOn(obj, 'value');
  assert.equal(obj.value(), 12);
  assert.equal(spy.mock.calls.length, 1);
  restoreAllMocks();
  assert.equal(obj.value(), 12);
  assert.notEqual(obj.value, spy);
});
test('assertions support promise fulfillment and rejection', async () => {
  await expect(Promise.reject(new Error('failed'))).toReject('failed');
  await expect(Promise.resolve(3)).toResolve();
  await assert.rejects(() => expect(Promise.resolve(3)).toReject());
});
test('bail skips remaining tests, forbidOnly rejects focus', async () => {
  /** Independent inert fixture registry; all executed callbacks use only synthetic in-memory state. */
  const runner = createRunner();
  /** Synthetic later-callback observations proving bail never executes the next case. */
  const calls = [];
  runner.test('failure', () => {
    throw new Error('bad');
  });
  runner.test('later', () => {
    calls.push(1);
  });
  /** Actual fixture run summary derived from executed outcomes. */
  const summary = await runner.runTests({ bail: true });
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 1);
  assert.deepEqual(calls, []);
  runner.clearTests();
  runner.test.only('focus', () => {});
  await assert.rejects(runner.runTests({ forbidOnly: true }), /forbidden/);
});

test('CLI-style match strings stay literal; only actual RegExp objects enable pattern matching', async () => {
  /** Independent inert fixture registry; all executed callbacks use only synthetic in-memory state. */
  const runner = createRunner();
  runner.test('literal [a]+', () => {});
  runner.test('aaa', () => {});
  /** Actual literal-text selection result; special characters never become regex source. */
  const literal = await runner.runTests({ match: '[a]+' });
  assert.equal(literal.passed, 1);
  /** Explicit trusted compiled RegExp whose borrowed lastIndex must remain unchanged. */
  const pattern = /a+/gy;
  pattern.lastIndex = 99;
  /** Actual compiled-pattern selection result, distinct from literal matching. */
  const matched = await runner.runTests({ match: pattern });
  assert.equal(matched.passed, 2);
  assert.equal(pattern.lastIndex, 99);
  await assert.rejects(
    runner.runTests({ match: { source: '.*', flags: '' } }),
    /explicit RegExp/
  );
});

test('borrowed frozen and sticky patterns retain unanchored selection without mutation', async () => {
  /** Independent inert fixture registry; all executed callbacks use only synthetic in-memory state. */
  const runner = createRunner();
  runner.test('prefix target', () => {});
  runner.test('other', () => {});
  for (const pattern of [
    Object.freeze(/target/g),
    Object.freeze(/target/y),
    /target/gy,
  ]) {
    /** Borrowed compiled pattern position captured before repeated matching. */
    const previous = pattern.lastIndex;
    /** Actual isolated run receipt with explicit passed/failed/skipped/attempt outcomes. */
    const result = await runner.runTests({ match: pattern });
    assert.equal(result.passed, 1);
    assert.equal(pattern.lastIndex, previous);
  }
});
