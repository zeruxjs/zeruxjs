import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVariableRegistry} from '../dist/variables.js';
test('batch variable renderer shares async resolution across fields, HTML-escapes and enforces limits',async()=>{
 const r=createVariableRegistry();let calls=0;
 r.register('company.support',async()=>{calls++;return '<team@example.com>';});
 const result=await r.renderFields({subject:'Hi {{company.support}}',html:'<p>{{company.support}} {{name}}</p>',text:'{{company.support}}'},
   {name:'Sam & Jay'},{escape:{html:'html'}});
 assert.equal(result.subject,'Hi <team@example.com>');assert.equal(result.html,'<p>&lt;team@example.com&gt; Sam &amp; Jay</p>');
 assert.equal(result.text,'<team@example.com>');assert.equal(calls,1);
 assert.equal((await r.render('Hello {{name}}',{name:'Jane'})),'Hello Jane');
 assert.deepEqual(r.extract('{{company.support}} {{name}} {{name}}'),['company.support','name']);
 await assert.rejects(r.renderFields({html:'{{missing}}'}, {}, {missing:'error'}),/Missing variable/);
 await assert.rejects(r.renderFields({html:'{{name}}'},{name:'123456'},{maxOutput:2}),/too large/);
});
