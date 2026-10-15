import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVariableRegistry} from '../dist/variables.js';

test('application variable registry supports nested JSON and asynchronously registered values',async()=>{
 const registry=createVariableRegistry();
 registry.register('app.company',async context=>'Zerux '+context.name);
 assert.equal(await registry.render('Dear {{name}} - {{account.plan}} at {{app.company}}',{name:'Ava',account:{plan:'Pro'}}),
   'Dear Ava - Pro at Zerux Ava');
 const unsubscribe=registry.register('link',()=>'<https://example.org/?a=1&b=2>');
 assert.equal(await registry.render('<b>{{name}}</b> {{link}}',{name:'<Alice>'},{escape:'html'}),
   '<b>&lt;Alice&gt;</b> &lt;https://example.org/?a=1&amp;b=2&gt;');
 assert.equal(await registry.render('{{unknown}}',{}, {missing:'keep'}),'{{unknown}}');
 await assert.rejects(registry.render('{{unknown}}',{}, {missing:'error'}),/Missing variable/);
 assert.throws(()=>registry.register('__proto__',()=>1),/Invalid/);
 assert.throws(()=>registry.register('name',null),/Invalid/);
 await assert.rejects(registry.render('{{constructor}}'),/Forbidden/);
 unsubscribe();
 assert.equal(await registry.render('{{link}}'), '');
});
