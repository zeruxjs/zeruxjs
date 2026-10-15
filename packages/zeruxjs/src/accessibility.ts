/** Small browser-only progressive enhancement; safe to import during SSR. */
export interface AccessibleTabs {select(index:number,focus?:boolean):void; destroy():void}
/**
 * Bind ARIA tabs with managed roving tabindex. Author semantic markup using
 * role=tablist, role=tab, aria-controls=<panel id>; this function does not invent IDs.
 */
export function bindAccessibleTabs(tabList:HTMLElement,options:{orientation?:'horizontal'|'vertical';direction?:'ltr'|'rtl'}={}):AccessibleTabs {
 const tabs=[...tabList.querySelectorAll<HTMLElement>('[role="tab"]')];
 const doc=tabList.ownerDocument;
 if(!tabs.length)throw new Error('Tabs require at least one role=tab element');
 const panels=tabs.map(tab=>{
  const id=tab.getAttribute('aria-controls');
  const panel=id?doc.getElementById(id):null;
  if(!panel||panel.getAttribute('role')!=='tabpanel'||!tab.id||!doc.contains(panel)||panel.getAttribute('aria-labelledby')!==tab.id)
   throw new Error('Each tab must identify a role=tabpanel with matching aria-labelledby');
  return panel;
 });
 if(new Set(panels).size!==panels.length)throw new Error('Tabs cannot share a tabpanel');
 const enabled=(i:number)=>!tabs[i].hasAttribute('disabled')&&tabs[i].getAttribute('aria-disabled')!=='true';
 let selected=tabs.findIndex((tab,i)=>enabled(i)&&tab.getAttribute('aria-selected')==='true');
 if(selected<0)selected=tabs.findIndex((_tab,i)=>enabled(i));
 if(selected<0)throw new Error('Tabs require an enabled tab');
 let destroyed=false;
 const select=(i:number,focus=false)=>{
  if(destroyed||!Number.isInteger(i)||i<0||i>=tabs.length||!enabled(i))return;
  selected=i;
  tabs.forEach((tab,j)=>{tab.setAttribute('aria-selected',String(j===i));tab.tabIndex=j===i?0:-1;panels[j].hidden=j!==i});
  if(focus)tabs[i].focus();
 };
 const indexFrom=(target:EventTarget|null)=>tabs.findIndex(tab=>target===tab||typeof Node!=='undefined'&&target instanceof Node&&tab.contains(target));
 const click=(event:MouseEvent)=>{const i=indexFrom(event.target);if(i>=0)select(i)};
 const keydown=(event:KeyboardEvent)=>{
  const i=indexFrom(event.target);if(i<0||!enabled(i))return;
  const vertical=options.orientation==='vertical'||tabList.getAttribute('aria-orientation')==='vertical';
  const direction=options.direction??(doc.defaultView?.getComputedStyle(tabList).direction==='rtl'?'rtl':'ltr');
  let step=0;
  if(vertical){if(event.key==='ArrowDown')step=1;else if(event.key==='ArrowUp')step=-1}
  else {if(event.key==='ArrowRight')step=direction==='rtl'?-1:1;else if(event.key==='ArrowLeft')step=direction==='rtl'?1:-1}
  let next=i;
  if(event.key==='Home')next=tabs.findIndex((_tab,j)=>enabled(j));
  else if(event.key==='End'){for(let j=tabs.length-1;j>=0;j--)if(enabled(j)){next=j;break}}
  else if(step){do{next=(next+step+tabs.length)%tabs.length}while(!enabled(next)&&next!==i)}
  else return;
  event.preventDefault();select(next,true);
 };
 tabList.addEventListener('click',click);tabList.addEventListener('keydown',keydown);
 select(selected);
 return {select,destroy(){if(destroyed)return;destroyed=true;tabList.removeEventListener('click',click);tabList.removeEventListener('keydown',keydown)}};
}
/** An SSR-safe preference read; never infer that motion is safe to force. */
export function prefersReducedMotion(win:Pick<Window,'matchMedia'>|undefined=typeof window==='undefined'?undefined:window):boolean {
 return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
