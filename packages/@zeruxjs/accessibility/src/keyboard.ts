export function onEscape(target:EventTarget,callback:(event:KeyboardEvent)=>void):()=>void{const handler=(event:Event)=>{const key=event as KeyboardEvent;if(key.key==='Escape')callback(key)};target.addEventListener('keydown',handler);return()=>target.removeEventListener('keydown',handler)}
export interface RovingOptions {orientation?:'horizontal'|'vertical'|'both';loop?:boolean;direction?:'ltr'|'rtl';isDisabled?:(node:HTMLElement)=>boolean}
export function createRovingTabIndex(elements:()=>HTMLElement[],options:RovingOptions={}){
 let current:HTMLElement|undefined;
 const orientation=options.orientation??'both';
 const available=()=>elements().filter(node=>!options.isDisabled?.(node)&&!node.hasAttribute?.('disabled')&&!node.hasAttribute?.('inert')&&node.getAttribute?.('aria-disabled')!=='true'&& !node.hidden);
 const refresh=()=>{const all=elements(),enabled=available();if(!enabled.includes(current as HTMLElement))current=enabled[0];all.forEach(node=>{node.tabIndex=node===current?0:-1})};
 const onKey=(event:KeyboardEvent)=>{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey)return;
  const keys=orientation==='horizontal'?['ArrowLeft','ArrowRight']:orientation==='vertical'?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
  if(!keys.includes(event.key)&&event.key!=='Home'&&event.key!=='End')return;
  const enabled=available();const selected=enabled.indexOf(event.target as HTMLElement);if(selected<0)return;
  let next:number;if(event.key==='Home')next=0;else if(event.key==='End')next=enabled.length-1;
  else {let delta=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;if(options.direction==='rtl'&&['ArrowLeft','ArrowRight'].includes(event.key))delta=-delta;
   next=selected+delta;if(options.loop===false&&(next<0||next>=enabled.length))return;next=(next+enabled.length)%enabled.length}
  event.preventDefault();current=enabled[next];refresh();current.focus();
 };
 return{refresh,onKey,setIndex(value:number){const list=available();if(!Number.isInteger(value)||value<0||value>=list.length)throw new RangeError('Invalid focus index');current=list[value];refresh()},get index(){return available().indexOf(current as HTMLElement)}};
}
