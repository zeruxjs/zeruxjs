import type {ChartData} from './types.js';
export interface ReportViewOptions {
 timeZone?:string;pageSize?:number;state?:'unavailable';receivedAt?:number;
 /** Trusted host code only; never stored in a report definition. Table alternative is always retained. */
 components?:{chart?:(container:HTMLElement,data:Readonly<ChartData>)=>void|(()=>void)};
}
/** DOM-free on import. Owns only its inserted subtree/listeners; source execution stays with the host.
 * This function is self-contained so the built-in CSP-hashed studio can share the same implementation. */
export function mountReportChart(host:HTMLElement,data:ChartData|null,options:ReportViewOptions={}) {
 if(!host?.ownerDocument||typeof host.append!=='function')throw new TypeError('A DOM host is required');
 const receivedAt=options.receivedAt??Date.now();if(!Number.isSafeInteger(receivedAt)||receivedAt<0||receivedAt>8640000000000000)throw new RangeError('Invalid result receipt time');
 const pageSize=options.pageSize??25,timeZone=options.timeZone??'UTC';if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||typeof timeZone!=='string'||timeZone.length>100)throw new RangeError('Invalid report view limits');try{new Intl.DateTimeFormat('en',{timeZone});}catch{throw new TypeError('Invalid display time zone');}
 if(data&&(!['bar','horizontal-bar','line','area','pie','doughnut','scatter','stacked-bar','table','kpi'].includes(data.type)||!Array.isArray(data.labels)||!Array.isArray(data.values)||data.labels.length!==data.values.length||data.labels.length>500||typeof data.title!=='string'||data.title.length>128||!Number.isFinite(data.total)||data.labels.some(s=>typeof s!=='string'||s.length>4096)||data.values.some(n=>!Number.isFinite(n))||data.coverage!==undefined&&(typeof data.coverage!=='string'||data.coverage.length>512)||typeof data.truncated!=='boolean'||!Number.isSafeInteger(data.sampledRows)||data.sampledRows<0))throw new TypeError('Invalid chart data');
 const document=host.ownerDocument,region=document.createElement('section');region.dataset.reportChart='';region.className='report-view';region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label',data?.title??'Unavailable chart');
 const cleanups:Array<()=>void>=[];let destroyed=false;const on=(node:EventTarget,event:string,callback:EventListener)=>{node.addEventListener(event,callback);cleanups.push(()=>node.removeEventListener(event,callback));};
 const text=(tag:string,value:string,parent:HTMLElement=region)=>{const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;};
 const status=text('p','');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 on(region,'keydown',((event:KeyboardEvent)=>{if(event.target!==region||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const siblings=[...((region.closest('[data-report-board]')??region.parentElement)?.querySelectorAll<HTMLElement>('[data-report-chart]')??[])];if(siblings.length>500)return;let index=siblings.indexOf(region);index=event.key==='Home'?0:event.key==='End'?siblings.length-1:Math.max(0,Math.min(siblings.length-1,index+(event.key==='ArrowRight'?1:-1)));siblings[index]?.focus();event.preventDefault();}) as EventListener);
 host.append(region);
 const destroy=()=>{if(destroyed)return;destroyed=true;for(const clean of cleanups.reverse())try{clean();}catch{/* Remaining owned listeners must still be released. */}region.remove();};
 try{
  if(!data||options.state==='unavailable'){status.textContent='Report unavailable. Retry through the authorized host.';return {element:region,destroy};}
  // Snapshot data before calling trusted custom components or retaining local interaction state.
  const snapshot:ChartData={...data,labels:[...data.labels],values:[...data.values]};
  status.textContent=snapshot.truncated?'Partial data: returned groups or source rows are limited.':snapshot.queryMode==='sampled'?'Bounded source sample; not a complete aggregate.':snapshot.queryMode==='materialized'?'Indexed numeric facts only; historical or failed facts may be missing.':snapshot.labels.length?'Returned report data.':'No data for the selected filters.';
  text('p','Result received: '+new Intl.DateTimeFormat('en',{timeZone,dateStyle:'medium',timeStyle:'long'}).format(receivedAt)+' (not a transaction snapshot).');
  text('p',`Coverage: ${snapshot.coverage??'unspecified'}; mode: ${snapshot.queryMode??'unknown'}; sampled rows: ${snapshot.sampledRows??0}. Display zone: ${timeZone}; date-only UTC groups are not shifted.`);
  if(options.components?.chart){const custom=text('div','');const dispose=options.components.chart(custom,Object.freeze({...snapshot,labels:Object.freeze([...snapshot.labels]) as unknown as string[],values:Object.freeze([...snapshot.values]) as unknown as number[]}));if(dispose!==undefined&&typeof dispose!=='function')throw new TypeError('Chart component must return a disposer');if(dispose)cleanups.push(dispose);}
  const label=text('label','Filter returned dimensions '),filter=document.createElement('input');filter.type='search';filter.maxLength=128;label.append(filter);
  const table=document.createElement('table');const caption=document.createElement('caption');caption.textContent=`${snapshot.title} — table alternative`;table.append(caption);const head=document.createElement('thead'),row=document.createElement('tr'),body=document.createElement('tbody');head.append(row);table.append(head,body);region.append(table);
  let sort:'dimension'|'value'='dimension',direction=1,page=0,term='';const headers:HTMLTableCellElement[]=[];
  for(const [name,key] of [['Dimension','dimension'],['Value','value']] as const){const th=document.createElement('th');th.scope='col';headers.push(th);const button=document.createElement('button');button.type='button';button.textContent=`Sort by ${name.toLowerCase()}`;th.append(button);row.append(th);on(button,'click',()=>{direction=sort===key?-direction:1;sort=key;page=0;render();});}
  const paging=text('p',''),previous=document.createElement('button'),next=document.createElement('button');previous.type=next.type='button';previous.textContent='Previous rows';next.textContent='Next rows';region.append(previous,next);
  const rows=snapshot.labels.map((label,i)=>({label,value:snapshot.values[i],index:i}));
  function render(){if(destroyed)return;const selected=rows.filter(r=>r.label.toLowerCase().includes(term)).sort((a,b)=>direction*(sort==='value'?a.value-b.value:a.label<b.label?-1:a.label>b.label?1:0)||a.index-b.index);const count=Math.max(1,Math.ceil(selected.length/pageSize));page=Math.min(page,count-1);body.replaceChildren();for(const item of selected.slice(page*pageSize,(page+1)*pageSize)){const tr=document.createElement('tr'),dimension=document.createElement('th'),value=document.createElement('td');dimension.scope='row';dimension.textContent=item.label;value.textContent=String(item.value);tr.append(dimension,value);body.append(tr);}headers.forEach((h,i)=>h.setAttribute('aria-sort',sort===(i===0?'dimension':'value')?(direction===1?'ascending':'descending'):'none'));paging.textContent=`Page ${page+1} of ${count}; ${selected.length} returned groups. Filtering/sorting does not query missing groups.`;previous.disabled=page===0;next.disabled=page+1>=count;}
  on(filter,'input',()=>{term=filter.value.slice(0,128).toLowerCase();page=0;render();});on(previous,'click',()=>{page--;render();});on(next,'click',()=>{page++;render();});render();return {element:region,destroy};
 }catch(error){destroy();throw error;}
}
