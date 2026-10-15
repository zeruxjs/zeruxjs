import test from 'node:test';
import assert from 'node:assert/strict';
import {h,render,unmount,mount,renderToString,signal} from '../dist/index.js';
import {root} from './dom-fixture.mjs';

test('DOM text, reactive attributes, updates, and unmount disposal',()=>{
 const container=root();const count=signal(1);let clicks=0;
 const event=()=>clicks++;
 render(h('button',{className:'go',onClick:event,title:()=>`Count: ${count.value}`,href:()=>`javascript:alert(${count.value})`},()=>count.value),container);
 const node=container.childNodes[0];assert.equal(node.getAttribute('title'),'Count: 1');assert.equal(node.getAttribute('href'),null);
 node.dispatch('click');assert.equal(clicks,1);
 count.value=2;assert.equal(container.textContent,'2');assert.equal(node.getAttribute('title'),'Count: 2');
 unmount(container);assert.equal(container.textContent,'');count.value=3;node.dispatch('click');
 assert.equal(clicks,1);assert.equal(node.getAttribute('title'),'Count: 2');
});

test('keyed reconciliation retains stable node identity and removes old listeners',()=>{
 const container=root();let events=0;
 const item=id=>h('li',{key:id,onClick:()=>events++, 'data-id':id},String(id));
 render(h('ul',{},item(1),item(2),item(3)),container);
 const ul=container.childNodes[0];const original=[...ul.childNodes];
 render(h('ul',{},item(3),item(1),item(4)),container);
 assert.deepEqual(ul.childNodes.map(n=>n.getAttribute('data-id')),['3','1','4']);
 assert.equal(ul.childNodes[0],original[2]);assert.equal(ul.childNodes[1],original[0]);
 original[1].dispatch('click');assert.equal(events,0);
 ul.childNodes[0].dispatch('click');assert.equal(events,1);
 unmount(container);assert.equal(ul.childNodes.length,0);
});

test('dynamic element content and manual mounts are removed',()=>{
 const container=root();const show=signal(false);
 const child=()=>show.value ? h('strong',{},'yes') : h('span',{},'no');
 render(h('div',{},child),container);assert.equal(container.textContent,'no');
 show.value=true;assert.equal(container.textContent,'yes');
 mount(h('p',{},'aside'),container);assert.equal(container.textContent,'yesaside');
 unmount(container);assert.equal(container.childNodes.length,0);
 show.value=false;assert.equal(container.childNodes.length,0);
});

test('safe static SSR escapes text/attributes and excludes unsafe markup',()=>{
 const html=renderToString(h('a',{href:'JaVa\nScRiPt:alert(1)',title:'"<script>',innerHTML:'evil',onClick:()=>{},className:'safe'},'<b>hi & bye</b>'));
 assert.equal(html,'<a title="&quot;&lt;script&gt;" class="safe">&lt;b&gt;hi &amp; bye&lt;/b&gt;</a>');
 assert.throws(()=>renderToString(h('invalid tag',{},'bad')),/Invalid/);
});

test('two-way form model and reactive class do not leak listeners',()=>{
 const container=root();const value=signal('a'),checked=signal(false);
 render(h('div',{},h('input',{'bind:value':value}),h('input',{'bind:checked':checked})),container);
 const [text,checkbox]=container.childNodes[0].childNodes;
 assert.equal(text.value,'a');value.value='b';assert.equal(text.value,'b');
 text.value='changed';text.dispatch('input');assert.equal(value.value,'changed');
 checkbox.checked=true;checkbox.dispatch('change');assert.equal(checked.value,true);
 unmount(container);
 text.value='later';text.dispatch('input');assert.equal(value.value,'changed');
 value.value='after';assert.equal(text.value,'later');
});

test('repeated mount/reconcile/unmount does not retain reactive listeners',()=>{
 const container=root(),state=signal(0);
 for(let i=0;i<250;i++){
   render(h('div',{},()=>state.value),container);
   state.value++;
   assert.equal(container.textContent,String(i+1));
   unmount(container);
   assert.equal(container.childNodes.length,0);
 }
 state.value++;
 assert.equal(container.childNodes.length,0);
});
