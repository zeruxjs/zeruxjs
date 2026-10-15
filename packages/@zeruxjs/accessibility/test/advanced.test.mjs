import test from 'node:test';import assert from 'node:assert/strict';
import {createRovingTabIndex,createLiveAnnouncer,createAccessibleDialog,createFocusTrap} from '../dist/index.js';
function node(opts={}){return {tabIndex:0,hidden:false,attributes:new Map(),focus(){this.focused=true},getAttribute(name){return this.attributes.get(name)??null},setAttribute(name,value){this.attributes.set(name,value)},hasAttribute(name){return this.attributes.has(name)},removeAttribute(name){this.attributes.delete(name)},...opts}}
test('roving index skips disabled, supports Home, End and RTL',()=>{
 const nodes=[node(),node(),node(),node()];nodes[1].setAttribute('aria-disabled','true');let prevented=0;
 const roving=createRovingTabIndex(()=>nodes,{direction:'rtl'});roving.refresh();assert.deepEqual(nodes.map(n=>n.tabIndex),[0,-1,-1,-1]);
 roving.onKey({key:'ArrowLeft',target:nodes[0],preventDefault(){prevented++}});assert.equal(roving.index,1);assert.equal(nodes[2].focused,true);
 roving.onKey({key:'End',target:nodes[2],preventDefault(){prevented++}});assert.equal(roving.index,2);assert.equal(nodes[3].focused,true);
 roving.onKey({key:'Home',target:nodes[3],preventDefault(){prevented++}});assert.equal(roving.index,0);assert.equal(prevented,3);
 assert.throws(()=>roving.setIndex(-1),RangeError);
});
test('roving respects no-loop and ignores modifiers',()=>{
 const nodes=[node(),node()];const control=createRovingTabIndex(()=>nodes,{loop:false,orientation:'vertical'});control.refresh();let prevented=0;
 control.onKey({key:'ArrowUp',target:nodes[0],preventDefault(){prevented++}});
 control.onKey({key:'ArrowRight',target:nodes[0],preventDefault(){prevented++}});
 control.onKey({key:'ArrowDown',target:nodes[0],ctrlKey:true,preventDefault(){prevented++}});
 assert.equal(control.index,0);assert.equal(prevented,0);
});
test('live announcer has semantics and destroys node',()=>{
 const el=node({style:{},textContent:'',remove(){this.removed=true}});
 const doc={createElement(){return el},body:{appendChild(child){assert.equal(child,el)}}};
 const live=createLiveAnnouncer(doc);live.announce('urgent',true);assert.equal(el.getAttribute('role'),'alert');assert.equal(el.textContent,'urgent');
 live.clear();assert.equal(el.textContent,'');live.destroy();live.announce('ignored');assert.equal(el.removed,true);assert.equal(el.textContent,'');
});
function docElement(){
 const listeners=new Map();const previous=node({isConnected:true});const doc={activeElement:previous,
 addEventListener(key,fn){listeners.set(key,fn)},removeEventListener(key){listeners.delete(key)}};
 const element=node({ownerDocument:doc,isConnected:true,hidden:true,querySelectorAll(){return []},contains(target){return target===element}});
 element.focus=()=>{doc.activeElement=element};previous.focus=()=>{doc.activeElement=previous};
 return {element,doc,listeners,previous};
}
test('accessible dialog opens, traps focus, closes and restores attributes',()=>{
 const {element,doc,previous}=docElement();const dialog=createAccessibleDialog(element,{labelledBy:'heading'});
 assert.equal(element.hidden,true);dialog.show();assert.equal(element.hidden,false);assert.equal(element.getAttribute('aria-modal'),'true');assert.equal(doc.activeElement,element);
 dialog.close();assert.equal(element.hidden,true);assert.equal(doc.activeElement,previous);dialog.destroy();assert.equal(element.getAttribute('role'),null);
 assert.throws(()=>dialog.show(),/destroyed/);
});
test('nested focus traps restore their own focus',()=>{
 const {element,doc,previous}=docElement();const inner=node({ownerDocument:doc,isConnected:true,querySelectorAll(){return []},contains(target){return target===inner}});
 inner.focus=()=>{doc.activeElement=inner};const first=createFocusTrap(element);const second=createFocusTrap(inner);
 first.activate();second.activate();assert.equal(doc.activeElement,inner);second.deactivate();assert.equal(doc.activeElement,element);first.deactivate();assert.equal(doc.activeElement,previous);
});
test('Escape closes only the topmost accessible dialog',()=>{
 const events=new Map(),previous=node({isConnected:true,focus(){document.activeElement=this}});
 const document={activeElement:previous,
  addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn)},
  removeEventListener(name,fn){events.get(name)?.delete(fn)}};
 const element=()=>{const el=node({ownerDocument:document,hidden:true,isConnected:true,querySelectorAll(){return[]},contains(other){return other===el}});
  el.focus=()=>{document.activeElement=el};return el};
 const first=createAccessibleDialog(element()),second=createAccessibleDialog(element());
 first.show();second.show();let prevented=0;
 const key={key:'Escape',preventDefault(){prevented++}};
 for(const handler of [...events.get('keydown')])handler(key);
 assert.equal(first.open,true);assert.equal(second.open,false);assert.equal(prevented,1);
 for(const handler of [...events.get('keydown')])handler(key);
 assert.equal(first.open,false);assert.equal(prevented,2);
 first.destroy();second.destroy();
});
