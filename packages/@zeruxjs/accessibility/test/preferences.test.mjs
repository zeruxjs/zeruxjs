import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createPreferenceState,parsePreferenceSnapshot,serializePreferenceSnapshot,bindPreferenceStyles,createPreferencePanel,createSpeechController} from '@zeruxjs/accessibility';
function media(win){const queries=new Map();win.matchMedia=query=>{if(queries.has(query))return queries.get(query);const target=new win.EventTarget();Object.assign(target,{matches:false,media:query});const listeners=new Set(),add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);target.addEventListener=(type,fn)=>{listeners.add(fn);add(type,fn);};target.removeEventListener=(type,fn)=>{listeners.delete(fn);remove(type,fn);};target.change=value=>{target.matches=value;const event=new win.Event('change');Object.defineProperty(event,'matches',{value});target.dispatchEvent(event);};target.listeners=listeners;queries.set(query,target);return target;};return queries;}

test('headless preferences are stable, bounded, isolated and explicit about invalid values',()=>{
 const first=createPreferenceState(),second=createPreferenceState();let changes=0;const stop=first.subscribe(()=>changes++);
 const initial=first.getSnapshot();first.set({textScale:1});assert.equal(first.getSnapshot(),initial);first.set({textScale:1.5});assert.equal(changes,1);assert.equal(second.getSnapshot().values.textScale,1);
 first.setSystem({reducedMotion:true,forcedColors:true});first.set({motion:'system',contrast:'dark'});assert.equal(first.getSnapshot().effective.reducedMotion,true);assert.equal(first.getSnapshot().effective.contrast,'forced');
 assert.throws(()=>first.set({textScale:99}),/preference value/);assert.throws(()=>first.set({unknown:true}),/preference fields/);assert.throws(()=>first.setSystem({forcedColors:'yes'}),/system preference/);
 stop();first.reset();assert.equal(first.getSnapshot().values.textScale,1);assert.equal(first.getSnapshot().system.reducedMotion,true);first.destroy();second.destroy();assert.throws(()=>first.getSnapshot(),/destroyed/);
});

test('versioned migration writes only the declared current schema and reset removes only the scoped key',()=>{
 const rows=new Map([['app:a11y',JSON.stringify({version:1,preferences:{textSize:125,contrast:'high',reducedMotion:true}})],['other','unchanged']]);
 const storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>{rows.set(key,value);},removeItem:key=>{rows.delete(key);}};
 const state=createPreferenceState({persistence:{key:'app:a11y',storage}});
 assert.deepEqual(state.getSnapshot().values,{textScale:1.25,contrast:'high',motion:'reduce'});
 state.set({textScale:1.5});assert.equal(JSON.parse(rows.get('app:a11y')).version,2);assert.equal(parsePreferenceSnapshot(rows.get('app:a11y')).values.textScale,1.5);
 state.reset();assert.equal(rows.has('app:a11y'),false);assert.equal(rows.get('other'),'unchanged');state.destroy();
 assert.throws(()=>parsePreferenceSnapshot('{"version":99,"values":{}}'),/Unsupported/);assert.throws(()=>parsePreferenceSnapshot('x'.repeat(4097)),/byte limit/);
 assert.throws(()=>parsePreferenceSnapshot('{"version":2,"values":{"textScale":1,"contrast":"system","motion":"system","__proto__":{}}}'),/fields/);
 assert.equal(serializePreferenceSnapshot({textScale:1,contrast:'system',motion:'system'}),'{"version":2,"values":{"textScale":1,"contrast":"system","motion":"system"}}');
});

test('blocked storage, corrupt data and failing observers stay local and report fixed codes',()=>{
 const errors=[];const state=createPreferenceState({persistence:{key:'app',storage:()=>{throw new Error('PRIVATE_SENTINEL');}},onError:code=>errors.push(code)});
 assert.equal(state.getStatus().persistence,'failed');state.set({contrast:'dark'});assert.equal(state.getSnapshot().values.contrast,'dark');assert.deepEqual(errors,['STORAGE_READ']);assert.equal(JSON.stringify(errors).includes('PRIVATE_SENTINEL'),false);state.destroy();
 const failing=createPreferenceState({persistence:{key:'app',storage:{getItem:()=>'{broken',setItem(){throw new Error();},removeItem(){throw new Error();}}},onError:code=>errors.push(code)});
 failing.subscribe(()=>{throw new Error('private observer');});failing.set({motion:'reduce'});assert.equal(failing.getStatus().persistence,'failed');failing.reset();assert.ok(errors.includes('INVALID_SNAPSHOT'));assert.ok(errors.includes('STORAGE_WRITE'));assert.ok(errors.includes('STORAGE_RESET'));assert.ok(errors.includes('SUBSCRIBER_FAILED'));failing.destroy();
});

test('scoped styles respect media state, preserve outside containers and remove listeners/styles/attributes',()=>{
 const env=new JSDOM('<div id="target" data-zx-text="author"><p>Inside</p></div><p id="outside">Outside</p>'),win=env.window,doc=win.document,queries=media(win),state=createPreferenceState();let binding;
 try{
  const target=doc.getElementById('target');binding=bindPreferenceStyles(target,state);assert.equal(doc.querySelectorAll('style').length,1);assert.equal(doc.getElementById('outside').attributes.length,1);
  queries.get('(prefers-reduced-motion: reduce)').change(true);assert.equal(state.getSnapshot().effective.reducedMotion,true);assert.equal(target.getAttribute('data-zx-motion'),'reduce');queries.get('(forced-colors: active)').change(true);assert.equal(state.getSnapshot().effective.contrast,'forced');
  assert.throws(()=>bindPreferenceStyles(target,state),/already bound/);binding.destroy();assert.equal(target.getAttribute('data-zx-text'),'author');assert.equal(doc.querySelectorAll('style').length,0);assert.ok([...queries.values()].every(query=>query.listeners.size===0));
  state.set({textScale:2});assert.equal(target.getAttribute('data-zx-text'),'author');
 }finally{binding?.destroy();state.destroy();win.close();}
});

test('panel uses real labels/native controls, survives storage failure and handles unavailable speech',()=>{
 const env=new JSDOM('<button id="before">Before</button><main id="host"></main>',{pretendToBeVisual:true}),win=env.window,doc=win.document,queries=media(win),state=createPreferenceState({persistence:{key:'app',storage:()=>{throw new Error();}}}),speech=createSpeechController(win,{ownership:'exclusive'});let panel;
 try{
  doc.getElementById('before').focus();let reads=0;panel=createPreferencePanel(doc.getElementById('host'),state,{speech,speechText:()=>{reads++;return 'public';}});
  const selects=panel.element.querySelectorAll('select');for(const control of selects)assert.equal(control.labels.length,1);
  panel.focus();assert.equal(doc.activeElement,selects[0]);selects[0].value='1.5';selects[0].dispatchEvent(new win.Event('change'));assert.equal(state.getSnapshot().values.textScale,1.5);
  assert.match(panel.element.textContent,/storage is unavailable/);const buttons=panel.element.querySelectorAll('button');assert.equal(buttons[1].disabled,true);buttons[1].click();assert.equal(reads,0);assert.equal(speech.speak('public',new win.Event('click')),'unavailable');
  queries.get('(forced-colors: active)').change(true);assert.equal(selects[1].disabled,true);buttons[0].click();assert.equal(state.getSnapshot().values.textScale,1);panel.destroy();assert.equal(doc.getElementById('host').children.length,0);assert.equal(doc.activeElement.id,'before');assert.ok([...queries.values()].every(query=>query.listeners.size===0));
 }finally{panel?.destroy();speech.destroy();state.destroy();win.close();}
});

test('speech refuses synthetic actions, remote-only voices and foreign ownership without cancelling shared work',()=>{
 const env=new JSDOM(''),win=env.window;let cancelled=0,spoken=0;
 const engine=new win.EventTarget();Object.assign(engine,{speaking:true,pending:false,paused:false,getVoices:()=>[{localService:true,voiceURI:'local'}],speak(){spoken++;},cancel(){cancelled++;},pause(){},resume(){}});
 Object.defineProperty(win,'speechSynthesis',{value:engine});win.SpeechSynthesisUtterance=class extends win.EventTarget{};
 const controller=createSpeechController(win,{ownership:'exclusive'});assert.equal(controller.getStatus().available,true);assert.equal(controller.speak('public',new win.MouseEvent('click')),'denied');controller.stop();controller.destroy();assert.equal(cancelled,0);assert.equal(spoken,0);
 engine.getVoices=()=>[{localService:false,voiceURI:'remote'}];const remote=createSpeechController(win,{ownership:'exclusive'});assert.equal(remote.getStatus().available,false);assert.equal(remote.speak('text',new win.MouseEvent('click')),'unavailable');remote.destroy();win.close();
});
