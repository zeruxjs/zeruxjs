import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunner,expect,fn,spyOn,restoreAllMocks} from '../dist/index.js';
test('isolated runner executes suite hooks in order and .only selections',async()=>{
 const runner=createRunner(),events=[];
 runner.describe('outer',()=>{
  runner.beforeAll(()=>events.push('beforeAll'));
  runner.afterAll(()=>events.push('afterAll'));
  runner.beforeEach(()=>events.push('beforeEach'));
  runner.afterEach(()=>events.push('afterEach'));
  runner.test('first',()=>events.push('first'));
  runner.test('second',()=>events.push('second'));
 });
 const result=await runner.runTests();assert.deepEqual([result.passed,result.failed,result.skipped],[2,0,0]);
 assert.deepEqual(events,['beforeAll','beforeEach','first','afterEach','beforeEach','second','afterEach','afterAll']);
 runner.clearTests();runner.test.only('selected',()=>{});runner.test('hidden',()=>assert.fail('not executed'));
 const second=await runner.runTests();assert.equal(second.passed,1);assert.equal(second.skipped,1);
});
test('retries and hooks clean up after failures, timeout is reported',async()=>{
 const runner=createRunner();let tries=0,cleanup=0;
 runner.afterEach(()=>cleanup++);
 runner.test.withOptions('retry',{retries:2},()=>{if(++tries<3)throw new Error('retry');});
 runner.test('timeout',()=>new Promise(()=>{}));
 const result=await runner.runTests({timeoutMs:20});
 assert.equal(result.passed,1);assert.equal(result.failed,1);assert.equal(tries,3);assert.equal(cleanup,4);
 assert.match(result.results[1].error.message,/timeout/i);
});
test('deep equality handles cycles, dates, maps, sets, negatives',()=>{
 const a={id:1};a.self=a;const b={id:1};b.self=b;
 expect(a).toEqual(b);expect(new Map([['a',2]])).toEqual(new Map([['a',2]]));expect(new Date('2025-01-01')).toEqual(new Date('2025-01-01'));
 expect([1,2]).not.toContain(3);expect('hello').toMatch(/ell/);expect({a:{b:1}}).toHaveProperty('a.b');
 assert.throws(()=>expect('x').not.toBe('x'));
});
test('mocks record calls and restore their original methods',()=>{
 const mock=fn((x)=>x*2);assert.equal(mock(3),6);assert.deepEqual(mock.mock.calls,[[3]]);
 mock.mockReturnValue(9);assert.equal(mock(1),9);mock.mockClear();assert.equal(mock.mock.calls.length,0);
 const obj={value(){return 12;}};const spy=spyOn(obj,'value');assert.equal(obj.value(),12);assert.equal(spy.mock.calls.length,1);
 restoreAllMocks();assert.equal(obj.value(),12);assert.notEqual(obj.value,spy);
});
test('assertions support promise fulfillment and rejection',async()=>{
 await expect(Promise.reject(new Error('failed'))).toReject('failed');
 await expect(Promise.resolve(3)).toResolve();
 await assert.rejects(()=>expect(Promise.resolve(3)).toReject());
});
test('bail skips remaining tests, forbidOnly rejects focus',async()=>{
 const runner=createRunner(),calls=[];
 runner.test('failure',()=>{throw new Error('bad')});runner.test('later',()=>{calls.push(1)});
 const summary=await runner.runTests({bail:true});assert.equal(summary.failed,1);assert.equal(summary.skipped,1);assert.deepEqual(calls,[]);
 runner.clearTests();runner.test.only('focus',()=>{});
 await assert.rejects(runner.runTests({forbidOnly:true}),/forbidden/);
});
