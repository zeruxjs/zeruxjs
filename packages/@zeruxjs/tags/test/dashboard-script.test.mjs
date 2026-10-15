import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {dashboard} from '../dist/dashboard.js';
import {browserScript} from '../dist/browser.js';
test('tag studio JavaScript is syntactically executable after HTML generation',()=>{
 const html=dashboard('/_tags');const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(source);assert.doesNotThrow(()=>new vm.Script(source));
 assert.doesNotThrow(()=>new vm.Script(browserScript({endpoint:'/_tags/collect',site:'app',debug:false})));
});
