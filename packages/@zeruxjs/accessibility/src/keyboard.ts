import {attributeOwner} from './ownership.js';
import {isFocusAvailable} from './focus.js';
export interface RovingOptions {orientation?:'horizontal'|'vertical'|'both';loop?:boolean;direction?:'ltr'|'rtl';isDisabled?:(node:HTMLElement)=>boolean;maxElements?:number}
/** Dynamic list ownership. refresh after reconciliation; removed nodes/listeners restore immediately.
 * Only zero/-1 are written. Role/selection/activation semantics remain with the component owner.
 */
export function createRovingTabIndex(elements:()=>HTMLElement[],options:RovingOptions={}) {
 options={...options};
 if(options.loop!==undefined&&typeof options.loop!=='boolean'||options.isDisabled!==undefined&&typeof options.isDisabled!=='function')throw new TypeError('Invalid roving policy');
 if(typeof elements!=='function'||options.orientation!==undefined&&!['horizontal','vertical','both'].includes(options.orientation)||options.direction!==undefined&&!['ltr','rtl'].includes(options.direction))throw new TypeError('Invalid roving options');
 const max=options.maxElements??10000;if(!Number.isSafeInteger(max)||max<1||max>50000)throw new RangeError('Invalid roving list budget');
 let current:HTMLElement|undefined,all:HTMLElement[]=[],disposed=false,hadFocus=false;
 const owned=attributeOwner(),fallback=new Map<HTMLElement,{before:number;applied:number}>(),bindings=new Map<HTMLElement,()=>void>(),containers=new Set<HTMLElement>();
 const orientation=options.orientation??'both';
 const assertLive=()=>{if(disposed)throw new Error('Roving list destroyed');};
 const list=()=>{
  const value=elements();if(!Array.isArray(value)||value.length>max||value.some(node=>!node||typeof node.focus!=='function'))throw new TypeError('Invalid or oversized roving list');
  return [...new Set(value)];
 };
 const enabled=(values:HTMLElement[])=>values.filter(node=>{const disabled=options.isDisabled?.(node);if(disabled!==undefined&&typeof disabled!=='boolean')throw new TypeError('Roving disabled predicate must be synchronous boolean');return !disabled&&isFocusAvailable(node);});
 const write=(node:HTMLElement,value:number)=>{
  if(typeof node.setAttribute==='function')owned.set(node,'tabindex',String(value));
  if(node.tabIndex!==value){const old=fallback.get(node),record=old&&node.tabIndex===old.applied?old:{before:node.tabIndex,applied:node.tabIndex};record.applied=value;fallback.set(node,record);node.tabIndex=value;}
 };
 const release=(node:HTMLElement)=>{owned.release(node);const record=fallback.get(node);if(record&&node.tabIndex===record.applied)node.tabIndex=record.before;fallback.delete(node);bindings.get(node)?.();bindings.delete(node);};
 const update=()=>{for(const node of all)write(node,node===current?0:-1);};
 const refresh=()=>{
  assertLive();const next=list(),available=enabled(next),oldIndex=Math.max(0,all.indexOf(current!)),removed=!!current&&!available.includes(current);
  const doc=current?.ownerDocument,active=doc?.activeElement;
  for(const node of all)if(!next.includes(node))release(node);
  all=next;
  if(!available.includes(current!))current=available[Math.min(oldIndex,available.length-1)];
  for(const node of all)if(!bindings.has(node)&&node.addEventListener){
   const onFocus=()=>{if(disposed||!enabled(all).includes(node))return;hadFocus=true;current=node;update();};
   const onBlur=(event:FocusEvent)=>{if(event.relatedTarget&&!all.some(item=>item===event.relatedTarget||item.contains?.(event.relatedTarget as Node)))hadFocus=false;};
   node.addEventListener('focusin',onFocus);node.addEventListener('focusout',onBlur);
   bindings.set(node,()=>{node.removeEventListener('focusin',onFocus);node.removeEventListener('focusout',onBlur);});
  }
  update();
  if(removed&&hadFocus&&current&&(!active||active===doc?.body||!active.isConnected))current.focus();
 };
 const onKey=(event:KeyboardEvent)=>{
  if(disposed||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  const keys=orientation==='horizontal'?['ArrowLeft','ArrowRight']:orientation==='vertical'?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
  if(!keys.includes(event.key)&&event.key!=='Home'&&event.key!=='End')return;
  refresh();const available=enabled(all),selected=available.findIndex(node=>node===event.target||node.contains?.(event.target as Node));if(selected<0)return;
  let next:number;if(event.key==='Home')next=0;else if(event.key==='End')next=available.length-1;
  else{let delta=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;if(options.direction==='rtl'&&['ArrowLeft','ArrowRight'].includes(event.key))delta=-delta;
   next=selected+delta;if(options.loop===false&&(next<0||next>=available.length))return;next=(next+available.length)%available.length;}
  event.preventDefault();hadFocus=true;current=available[next];update();current.focus();
 };
 return {
  refresh,onKey,
  setIndex(value:number){assertLive();refresh();const available=enabled(all);if(!Number.isInteger(value)||value<0||value>=available.length)throw new RangeError('Invalid focus index');current=available[value];update();},
  get index(){assertLive();return enabled(list()).indexOf(current!);},
  /** Optional owned event binding. Existing manual onKey registration remains supported. */
  attach(container:HTMLElement){assertLive();if(!container||typeof container.addEventListener!=='function')throw new TypeError('A roving event container is required');if(!containers.has(container)){containers.add(container);container.addEventListener('keydown',onKey);}return()=>{container.removeEventListener('keydown',onKey);containers.delete(container);};},
  destroy(){if(disposed)return;disposed=true;for(const container of containers)container.removeEventListener('keydown',onKey);containers.clear();for(const node of all)release(node);all=[];current=undefined;},
 };
}
