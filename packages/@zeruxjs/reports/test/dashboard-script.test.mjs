import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {reportDashboard} from '../dist/dashboard.js';
test('reports studio JavaScript is syntactically executable after HTML generation',()=>{
 const html=reportDashboard('/_reports');const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(source);assert.doesNotThrow(()=>new vm.Script(source));
});
