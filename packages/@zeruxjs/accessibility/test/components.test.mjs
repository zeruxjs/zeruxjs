import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAccessibleDialog,createFocusTrap,createRovingTabIndex,validateComponentProps,applyComponentProps,applyLabelledComponentProps,AccessibilityValidationError } from '@zeruxjs/accessibility';
function dom(html){const environment=new JSDOM(html,{pretendToBeVisual:true});const {window}=environment;window.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{width:10,height:10}];};return environment;}
const modalMarkup='<button id="open">Open</button><main id="app"><button id="fallback">Next task</button></main><section id="outer" role="alertdialog" aria-labelledby="ot" hidden><h2 id="ot">Outer</h2><button id="of">First</button><button id="oi">Inner</button></section><section id="inner" aria-labelledby="it" hidden><h2 id="it">Inner</h2><button id="if">Inner first</button><button id="il">Inner last</button></section>';

test('explicit props validate names/references/roles, stay inert and preserve native/custom disabled behavior',()=>{
 const env=dom('<span id="name">Name</span><span id="help">Help</span><input id="field"><div id="custom" role="button" tabindex="0"></div>');const doc=env.window.document;
 try{
  const input=doc.getElementById('field');const binding=applyLabelledComponentProps(input,{labelledBy:'name',describedBy:'help',disabled:true});assert.equal(input.disabled,true);assert.equal(input.getAttribute('aria-labelledby'),'name');binding.destroy();assert.equal(input.disabled,false);assert.equal(input.hasAttribute('aria-labelledby'),false);
  const issues=validateComponentProps(input,{labelledBy:'missing'});assert.ok(issues.some(item=>item.code==='MISSING_ID'));assert.throws(()=>applyLabelledComponentProps(input,{}),AccessibilityValidationError);
  assert.throws(()=>applyComponentProps(input,{label:'x',labelledBy:'name'}),AccessibilityValidationError);assert.equal(input.hasAttribute('aria-label'),false);
  let invoked=0;const custom=doc.getElementById('custom'),disabled=applyLabelledComponentProps(custom,{label:'Save',disabled:true});custom.addEventListener('click',()=>invoked++);custom.click();assert.equal(invoked,0);
  custom.setAttribute('aria-label','Host update');disabled.destroy();assert.equal(custom.getAttribute('aria-label'),'Host update');assert.equal(custom.getAttribute('role'),'button');custom.click();assert.equal(invoked,1);
  assert.ok(validateComponentProps(custom,{role:'menuitem'}).some(item=>item.code==='CONFLICTING_ROLE'));
 }finally{env.window.close();}
});

test('ID validation handles duplicates, owned active descendants and malformed props without evaluating getters',()=>{
 const env=dom('<div id="list" role="listbox" tabindex="0"><span id="item">Item</span></div><div id="external"></div><span id="dup"></span><span id="dup"></span>');const doc=env.window.document;
 try{
  const list=doc.getElementById('list');assert.deepEqual(validateComponentProps(list,{activeDescendant:'item'}),[]);
  assert.ok(validateComponentProps(list,{activeDescendant:'external'}).some(item=>item.code==='INVALID_RELATIONSHIP'));
  assert.deepEqual(validateComponentProps(list,{activeDescendant:'external',owns:'external'}),[]);
  assert.ok(validateComponentProps(list,{labelledBy:'dup'}).some(item=>item.code==='DUPLICATE_ID'));
  assert.ok(validateComponentProps(list,{activeDescendant:'list'}).some(item=>item.code==='INVALID_RELATIONSHIP'));
  let read=false;const props={get label(){read=true;return 'bad';}};assert.ok(validateComponentProps(list,props).length);assert.equal(read,false);
  assert.throws(()=>validateComponentProps(list,{labelledBy:'item'},{maxElements:1}),/budget/);
 }finally{env.window.close();}
});

test('nested modal portals suspend only owned inert state and restore focus/roles/attributes on close',()=>{
 const env=dom(modalMarkup),doc=env.window.document;const by=id=>doc.getElementById(id);let outer,inner;
 try{
  by('open').focus();outer=createAccessibleDialog(by('outer'),{inertBackground:true});inner=createAccessibleDialog(by('inner'),{inertBackground:true});
  outer.show();assert.equal(by('outer').getAttribute('role'),'alertdialog');assert.equal(doc.activeElement.id,'of');assert.equal(by('app').hasAttribute('inert'),true);
  by('oi').focus();inner.show();assert.equal(by('inner').hasAttribute('inert'),false);assert.equal(by('outer').hasAttribute('inert'),true);assert.equal(doc.activeElement.id,'if');
  doc.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(inner.open,false);assert.equal(outer.open,true);assert.equal(doc.activeElement.id,'oi');assert.equal(by('app').hasAttribute('inert'),true);
  outer.close();assert.equal(doc.activeElement.id,'open');assert.equal(by('app').hasAttribute('inert'),false);
  by('inner').setAttribute('aria-modal','false');inner.destroy();assert.equal(by('inner').getAttribute('aria-modal'),'false');assert.equal(by('inner').hasAttribute('role'),false);outer.destroy();assert.equal(by('outer').getAttribute('role'),'alertdialog');
 }finally{inner?.destroy();outer?.destroy();env.window.close();}
});

test('removed opener uses explicit fallback; failed focus acquisition and ancestor close release ownership',()=>{
 const env=dom(modalMarkup),doc=env.window.document,by=id=>doc.getElementById(id);let dialog,bad;
 try{
  by('app').setAttribute('inert','author');by('open').focus();dialog=createAccessibleDialog(by('outer'),{inertBackground:true,focus:{returnFocusFallback:()=>by('fallback')}});dialog.show();by('open').remove();
  by('app').removeAttribute('inert');dialog.close();assert.equal(doc.activeElement.id,'fallback');assert.equal(by('app').hasAttribute('inert'),false);
  bad=createAccessibleDialog(by('inner'),{inertBackground:true,focus:{initialFocus:()=>{throw new Error('focus dependency failed');}}});assert.throws(()=>bad.show(),/dependency failed/);assert.equal(bad.open,false);assert.equal(by('app').hasAttribute('inert'),false);
  const outside=doc.createElement('button');doc.body.append(outside);const trap=createFocusTrap(by('inner'),{initialFocus:()=>outside});by('inner').hidden=false;assert.throws(()=>trap.activate(),/inside the trap/);assert.equal(trap.active,false);trap.destroy();
 }finally{bad?.destroy();dialog?.destroy();env.window.close();}
});

test('roving lists retain one tab stop across RTL, disabled fieldsets and focused removal, with full disposal',()=>{
 const env=dom('<div id="list"><button id="a">A</button><button id="b" disabled>B</button><button id="c">C</button><button id="d">D</button></div>'),doc=env.window.document;let control;
 try{
  const container=doc.getElementById('list'),items=()=>[...container.querySelectorAll('button')];control=createRovingTabIndex(items,{direction:'rtl',orientation:'horizontal'});control.attach(container);control.refresh();doc.getElementById('a').focus();
  doc.activeElement.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.equal(doc.activeElement.id,'c');
  const removed=doc.activeElement;removed.remove();control.refresh();assert.equal(doc.activeElement.id,'d');assert.equal(removed.hasAttribute('tabindex'),false);
  doc.activeElement.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.equal(doc.activeElement.id,'a');assert.equal(items().filter(node=>node.tabIndex===0).length,1);
  doc.getElementById('d').setAttribute('tabindex','-3');control.destroy();assert.equal(doc.getElementById('d').getAttribute('tabindex'),'-3');assert.equal(doc.getElementById('a').hasAttribute('tabindex'),false);assert.equal(doc.getElementById('b').hasAttribute('tabindex'),false);
  assert.throws(()=>control.refresh(),/destroyed/);
 }finally{control?.destroy();env.window.close();}
});

test('closing an ancestor closes its managed DOM descendants and retains pre-existing inert attributes',()=>{
 const env=dom(modalMarkup),doc=env.window.document,by=id=>doc.getElementById(id);let outer,inner;
 try{
  by('outer').appendChild(by('inner'));by('app').setAttribute('inert','authored');by('open').focus();
  outer=createAccessibleDialog(by('outer'),{inertBackground:true});inner=createAccessibleDialog(by('inner'),{inertBackground:true});outer.show();inner.show();outer.close();
  assert.equal(inner.open,false);assert.equal(outer.open,false);assert.equal(doc.activeElement.id,'open');assert.equal(by('app').getAttribute('inert'),'authored');
 }finally{inner?.destroy();outer?.destroy();env.window.close();}
});

test('authored hidden attribute values survive show/close/destroy exactly',()=>{
 const env=dom(modalMarkup),element=env.window.document.getElementById('outer');let dialog;
 try{element.setAttribute('hidden','until-found');dialog=createAccessibleDialog(element);dialog.show();dialog.close();dialog.destroy();assert.equal(element.getAttribute('hidden'),'until-found');}
 finally{dialog?.destroy();env.window.close();}
});
