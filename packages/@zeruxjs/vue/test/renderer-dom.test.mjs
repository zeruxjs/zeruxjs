import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createVueBindings} from '../dist/index.js';
import {createVueView,VUE_RENDER_CONTEXT} from '../dist/rendering.js';
import {mountVue,hydrateVue} from '../dist/browser.js';
import {renderVueToString} from '../dist/server.js';
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://app.test/'}),saved=new Map();
for(const name of ['window','document','Node','Element','HTMLElement','SVGElement','HTMLInputElement']){saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value:name==='window'?dom.window:name==='document'?dom.window.document:dom.window[name],writable:true,configurable:true})}
after(()=>{dom.window.close();for(const [name,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]});
const Vue=await import('@vue/runtime-dom'),bridge=createVueBindings(Vue);
const container=()=>{const element=document.createElement('main');document.body.appendChild(element);return element};
function store(initial){let value=initial;const listeners=new Set();return{getSnapshot:()=>value,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},set(next){value=next;for(const fn of [...listeners])fn()},get active(){return listeners.size}}}

test('real Vue ref/computed/scoped watch updates survive prop update and stop on unmount',async()=>{
 const host=container(),source=store(1);let count,watched=0,setups=0,disposed=0;
 const Component=Vue.defineComponent({props:['label','source'],setup(props){setups++;count=Vue.ref(1);const doubled=Vue.computed(()=>count.value*2),external=bridge.useStore(props.source);Vue.watch(count,()=>watched++,{flush:'sync'});return()=>Vue.h('p',null,props.label+':'+doubled.value+':'+external.value)}});
 const root=await mountVue(createVueView(Component,{label:'first',source}),host,{onDispose:()=>disposed++});
 assert.equal(host.textContent,'first:2:1');assert.equal(source.active,1);count.value=3;source.set(4);await Vue.nextTick();assert.equal(host.textContent,'first:6:4');
 const node=host.firstChild;await root.update(createVueView(Component,{label:'next',source}));assert.equal(host.firstChild,node);assert.equal(setups,1);assert.equal(host.textContent,'next:6:4');
 await assert.rejects(mountVue(createVueView(Component,{source}),host),e=>e.code==='ROOT_ALREADY_OWNED');
 await root.unmount();await root.unmount();assert.equal(source.active,0);const before=watched;count.value++;assert.equal(watched,before);assert.equal(disposed,1);assert.equal(host.childNodes.length,0);
 await assert.rejects(root.update(createVueView(Component)),e=>e.code==='ROOT_CLOSED');host.remove();
});

test('native hydration matches IDs and controlled forms follow Vue model/event semantics',async()=>{
 const host=container();let state;
 const Form=Vue.defineComponent({props:['initial'],setup(props){state=Vue.ref(props.initial);const context=Vue.inject(VUE_RENDER_CONTEXT),id=Vue.useId();return()=>Vue.h('section',null,[Vue.h('label',{for:id},'Name'),Vue.h('input',{id,value:state.value,onInput:event=>{if(!context.signal.aborted)state.value=event.target.value}}),Vue.h('b',null,state.value)])}});
 host.innerHTML=await renderVueToString(createVueView(Form,{initial:'initial'}),{idPrefix:'form'});
 const input=host.querySelector('input'),id=input.id;input.value='pre-hydration edit';
 const root=await hydrateVue(createVueView(Form,{initial:'initial'}),host,{idPrefix:'form'});
 assert.equal(host.querySelector('input'),input);assert.equal(input.id,id);assert.equal(host.querySelector('label').htmlFor,id);
 assert.equal(input.value,'initial');
 input.value='typed';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await Vue.nextTick();assert.equal(state.value,'typed');assert.equal(host.querySelector('b').textContent,'typed');
 await root.unmount();const previous=state.value;input.value='detached';input.dispatchEvent(new dom.window.Event('input'));assert.equal(state.value,previous);host.remove();
});

test('abort and failed setup own cleanup; templates cannot be compiled during mount/update',async()=>{
 const host=container(),source=store(1),signal=new AbortController();let disposed=0;
 const Good=Vue.defineComponent({setup(){const value=bridge.useStore(source);Vue.inject(VUE_RENDER_CONTEXT).onDispose(()=>disposed++);return()=>Vue.h('p',null,value.value)}});
 const root=await mountVue(createVueView(Good),host,{signal:signal.signal});signal.abort();await root.unmount();assert.equal(source.active,0);assert.equal(disposed,1);
 const Broken=Vue.defineComponent({setup(){bridge.useStore(source);throw Error('PRIVATE_FAILURE')}});
 await assert.rejects(mountVue(createVueView(Broken),host),e=>e.code==='VUE_MOUNT_FAILED');assert.equal(source.active,0);assert.equal(host.childNodes.length,0);
 const next=await mountVue(createVueView(Good),host);await assert.rejects(next.update({component:{template:'<p>bad</p>'}}),e=>e.code==='TEMPLATE_BUILD_REQUIRED');assert.equal(host.textContent,'1');await next.unmount();host.remove();
});

test('native bridges roll back a failing subscription re-read and preserve proxy prop semantics',async()=>{
 let calls=0,active=0;
 const broken={getSnapshot(){if(calls++===0)return 1;throw Error('dependency read failed')},subscribe(){active++;return()=>active--}};
 assert.throws(()=>bridge.connect(broken),/dependency read failed/);assert.equal(active,0);
 const host=container(),count=Vue.ref(2),props=Vue.reactive({count});
 const View=Vue.defineComponent({props:['count'],setup(p){return()=>Vue.h('b',null,String(p.count))}});
 const root=await mountVue(createVueView(View,props),host);assert.equal(host.textContent,'2');await root.unmount();host.remove();
});

test('native class/style normalization uses a mutable Vue prop copy and dynamic templates fail closed',async()=>{
 const host=container(),View=Vue.defineComponent({render:()=>Vue.h('p',null,'class')});
 const root=await mountVue(createVueView(View,{class:['one',{two:true}],style:{color:'red'}}),host);
 assert.equal(host.firstChild.className,'one two');assert.equal(host.firstChild.style.color,'red');await root.unmount();
 const Dynamic=Vue.defineComponent({setup(){return()=>Vue.h({template:'<p>blocked</p>'})}});
 await assert.rejects(mountVue(createVueView(Dynamic),host),error=>error.code==='TEMPLATE_BUILD_REQUIRED');assert.equal(host.childNodes.length,0);host.remove();
});

test('failed native updates reject and scoped fromRef watchers stop with their Vue owner',async()=>{
 const native=Vue.ref(0),scope=Vue.effectScope();let observed=0;
 scope.run(()=>{bridge.fromRef(native).subscribe(()=>observed++)});native.value++;assert.equal(observed,1);scope.stop();native.value++;assert.equal(observed,1);
 const host=container(),Good=Vue.defineComponent({render:()=>Vue.h('p',null,'ok')}),Bad=Vue.defineComponent({setup(){throw Error('dependency unavailable')}});
 const root=await mountVue(createVueView(Good),host);await assert.rejects(root.update(createVueView(Bad)),error=>error.code==='VUE_UPDATE_FAILED');
 await root.unmount();assert.equal(host.childNodes.length,0);host.remove();
});
