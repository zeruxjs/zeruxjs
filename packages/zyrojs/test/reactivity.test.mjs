import test from 'node:test';
import assert from 'node:assert/strict';
import {signal, effect, batch, reactive, computed, createEffectScope, onScopeDispose, useEffect, useMemo} from '../dist/index.js';

test('dynamic dependency tracking, batching, cleanup and independent scopes',()=>{
  const choose=signal(true), left=signal(1), right=signal(10);
  const values=[];let cleanups=0;
  const stop=effect(()=>{values.push(choose.value ? left.value : right.value);return()=>{cleanups++}});
  batch(()=>{left.value=2;left.value=3;});
  assert.deepEqual(values,[1,3]);
  choose.value=false;left.value=100;right.value=20;
  assert.deepEqual(values,[1,3,10,20]);
  stop();stop();right.value=40;
  assert.equal(values.length,4);assert.equal(cleanups,4);
  const scope=createEffectScope();let runs=0,disposed=0;
  scope.run(()=>{onScopeDispose(()=>disposed++);effect(()=>{right.value;runs++});});
  right.value=50;assert.equal(runs,2);
  scope.dispose();scope.dispose();right.value=60;
  assert.equal(runs,2);assert.equal(disposed,1);
  assert.throws(()=>scope.run(()=>{}),/disposed/);
});

test('reactive tracks get/has/ownKeys, deletions, nested fields and arrays',()=>{
 const model=reactive({user:{name:'a'},items:[1],status:'idle'});
 const output=[];
 const stop=effect(()=>output.push([model.user.name,'status' in model,Object.keys(model).join(','),model.items.length]));
 batch(()=>{model.user.name='b';delete model.status;model.items.push(2);});
 assert.deepEqual(output.at(-1),['b',false,'user,items',2]);
 assert.equal(output.length,2);
 stop();model.user.name='c';assert.equal(output.length,2);
});

test('computeds release dependencies and hooks expose explicit stop',()=>{
 const x=signal(2);const y=computed(()=>x.value*3);const memo=useMemo(()=>y.value+1);
 assert.equal(memo(),7);x.value=4;assert.equal(memo(),13);
 memo.dispose();y.dispose();x.value=6;assert.equal(memo(),13);
 let effects=0;const dispose=useEffect(()=>{x.value;effects++});x.value=7;dispose();x.value=8;assert.equal(effects,2);
});

test('exceptions do not retain failed initial effects',()=>{
 const value=signal(1);let observed=0;
 assert.throws(()=>effect(()=>{value.value;observed++;throw new Error('boom')}),/boom/);
 value.value=2;assert.equal(observed,1);
});

test('effects keep their scope on later reruns and frozen values obey proxy invariants',()=>{
 const scope=createEffectScope(), value=signal(1);let disposed=0;
 scope.run(()=>effect(()=>{value.value;onScopeDispose(()=>disposed++)}));
 value.value=2;scope.dispose();assert.equal(disposed,2);
 const frozen=reactive(Object.freeze({child:Object.freeze({ready:true})}));
 assert.equal(frozen.child.ready,true);
});

test('self-triggering effects are stopped by a bounded update loop',()=>{
 const n=signal(0);
 assert.throws(()=>effect(()=>{n.value++;}),/possible reactive update loop/);
});

test('native objects retain internal slots rather than being proxied',()=>{
 const date=new Date('2026-01-01T00:00:00Z');const m=new Map([['a',1]]);
 const x=reactive({date,m});assert.equal(x.date.getUTCFullYear(),2026);assert.equal(x.m.get('a'),1);
});
