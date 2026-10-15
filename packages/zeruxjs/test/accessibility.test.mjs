import test from 'node:test';import assert from 'node:assert/strict';
import {bindAccessibleTabs,prefersReducedMotion} from '../dist/accessibility.js';
function fixture(){
 const panels=[],tabs=[],listeners=new Map();const doc={active:null,getElementById:id=>panels.find(p=>p.id===id)||null,
 contains:panel=>panels.includes(panel),defaultView:{getComputedStyle:()=>({direction:'ltr'})}};
 for(let i=0;i<3;i++){
  const attrs=new Map([['role','tab'],['aria-controls','p'+i],['aria-selected',i===0?'true':'false']]);
  const tab={id:'t'+i,attrs,hasAttribute:k=>attrs.has(k),getAttribute:k=>attrs.get(k)||null,setAttribute:(k,v)=>attrs.set(k,v),
   focus(){doc.active=this},contains:()=>false,tabIndex:0};tabs.push(tab);
  const panel={id:'p'+i,attrs:new Map([['role','tabpanel'],['aria-labelledby','t'+i]]),
   getAttribute(k){return this.attrs.get(k)||null},hidden:false};panels.push(panel);
 }
 const list={ownerDocument:doc,querySelectorAll:()=>tabs,getAttribute:()=>null,
  addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 return {list,doc,panels,tabs,listeners,trigger(type,index,key){let prevented=false;
  listeners.get(type)?.({target:tabs[index],key,preventDefault(){prevented=true}});return prevented}};
}
test('ARIA tabs maintain focus, keyboard roving tabindex and skip disabled tabs',()=>{
 const f=fixture();f.tabs[2].attrs.set('aria-disabled','true');
 const binding=bindAccessibleTabs(f.list);
 assert.equal(f.tabs[0].tabIndex,0);assert.equal(f.tabs[1].tabIndex,-1);
 assert.equal(f.trigger('keydown',0,'ArrowRight'),true);
 assert.equal(f.doc.active,f.tabs[1]);assert.equal(f.panels[0].hidden,true);
 assert.equal(f.panels[1].hidden,false);assert.equal(f.tabs[1].attrs.get('aria-selected'),'true');
 assert.equal(f.trigger('keydown',1,'ArrowRight'),true);assert.equal(f.doc.active,f.tabs[0]);
 binding.destroy();binding.destroy();assert.equal(f.listeners.size,0);
});
test('accessibility validation is strict; motion preference is SSR-safe',()=>{
 const f=fixture();f.tabs[0].attrs.delete('aria-controls');
 assert.throws(()=>bindAccessibleTabs(f.list),/tabpanel/);
 assert.equal(prefersReducedMotion(undefined),false);
 assert.equal(prefersReducedMotion({matchMedia:()=>({matches:true})}),true);
});
test('RTL horizontal navigation reverses arrow direction and vertical navigation uses Up/Down',()=>{
 const f=fixture();const binding=bindAccessibleTabs(f.list,{direction:'rtl'});
 assert.equal(f.trigger('keydown',0,'ArrowLeft'),true);assert.equal(f.doc.active,f.tabs[1]);
 assert.equal(f.trigger('keydown',1,'ArrowRight'),true);assert.equal(f.doc.active,f.tabs[0]);
 binding.destroy();
 const vertical=fixture();const v=bindAccessibleTabs(vertical.list,{orientation:'vertical'});
 assert.equal(vertical.trigger('keydown',0,'ArrowDown'),true);assert.equal(vertical.doc.active,vertical.tabs[1]);
 assert.equal(vertical.trigger('keydown',1,'Home'),true);assert.equal(vertical.doc.active,vertical.tabs[0]);
 v.destroy();
});
