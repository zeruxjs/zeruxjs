export function reportDashboard(prefix:string):string{
  const p=JSON.stringify(prefix);
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zerux Reports</title><style>
:root{font:14px/1.5 system-ui,sans-serif;color-scheme:light dark}body{max-width:1280px;margin:auto;padding:24px}h1{margin-bottom:3px}nav{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}button,input,select,textarea{font:inherit;padding:8px 12px;border:1px solid #9998;border-radius:6px;background:transparent;color:inherit}button{cursor:pointer}input,select,textarea{max-width:100%;box-sizing:border-box}textarea{width:100%;height:200px;font-family:monospace}main{display:grid;grid-template-columns:minmax(230px,1fr) 3fr;gap:18px}aside,article,.chart{padding:15px;border:1px solid #8885;border-radius:10px}aside label{display:block;margin:8px 0}aside input,aside select{width:100%}#charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}.chart{min-height:180px}canvas{width:100%;height:200px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:5px;border-bottom:1px solid #8885}.hint{color:#888}.warn{color:#b76a00}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:720px){main{display:block}aside{margin-bottom:12px}}
</style></head><body><h1>Zerux Reports</h1><p class="hint">Internal analytics reporting • authenticated workspace • page &amp; chart designer</p>
<nav><button id="reload">Reload</button><button id="newReport">New report</button><button id="newPage">Add page</button><button id="newChart">Add chart</button><button id="save">Publish report</button></nav>
<main><aside><label>Report<select id="report"></select></label><label>Page<select id="page"></select></label><label>Report title<input id="reportName"></label><label>Page title<input id="pageName"></label>
<label>Chart<select id="chart"></select></label><label>Chart title<input id="chartTitle"></label>
<label>Chart type<select id="chartType"><option>bar</option><option>horizontal-bar</option><option>line</option><option>area</option><option>pie</option><option>doughnut</option><option>scatter</option><option>stacked-bar</option><option>table</option><option>kpi</option></select></label>
<label>Metric<select id="chartMetric"><option>count</option><option>sum</option><option>average</option><option>min</option><option>max</option><option>distinct</option></select></label>
<label>Group by<input id="chartGroupBy" placeholder="event, day, source, property:plan"></label>
<label>Numeric value field<input id="chartValueField" placeholder="price"></label><label>Filter event<input id="chartEvent" placeholder="purchase"></label>
<button id="deleteChart">Delete chart</button>
<p class="hint">Chart editor (JSON). Types: bar, horizontal-bar, line, area, pie, doughnut, scatter, stacked-bar, table, kpi.</p><textarea id="chartsJson" spellcheck="false"></textarea><button id="applyCharts">Apply charts</button><p><button id="deletePage">Delete page</button></p></aside><article><h2 id="pageTitle">Report preview</h2><p class="hint" id="notice"></p><div id="charts"></div></article></main><pre role="status" aria-live="polite" id="status"></pre>
<script>(function(){'use strict';const prefix=${p},$=id=>document.getElementById(id);let doc,ridx=0,pidx=0,cidx=0;
const say=s=>$('status').textContent=s;
function opt(select,list,field){select.replaceChildren();list.forEach((v,i)=>{const el=document.createElement('option');el.value=String(i);el.textContent=v[field];select.append(el);});}
function selected(){return doc&&doc.reports[ridx]}function page(){return selected()&&selected().pages[pidx]}function chart(){return page()?.charts[cidx]}
async function load(){try{const response=await fetch(prefix+'/api',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);doc=await response.json();ridx=0;pidx=0;render();say('Reports loaded');}catch(e){say('Load failed: '+e.message);}}
function render(){opt($('report'),doc.reports,'name');$('report').value=String(ridx);opt($('page'),selected()?.pages||[],'name');$('page').value=String(pidx);$('reportName').value=selected()?.name||'';$('pageName').value=page()?.name||'';opt($('chart'),page()?.charts||[],'title');$('chart').value=String(cidx);
 for(const [input,key] of [['chartTitle','title'],['chartType','type'],['chartMetric','metric'],['chartGroupBy','groupBy'],['chartValueField','valueField'],['chartEvent','eventName']])$(''+input).value=chart()?.[key]||'';
 $('chartsJson').value=JSON.stringify(page()?.charts||[],null,2);void preview();}
$('report').onchange=e=>{ridx=Number(e.target.value);pidx=0;cidx=0;render();};$('page').onchange=e=>{pidx=Number(e.target.value);cidx=0;render();};
$('chart').onchange=e=>{cidx=Number(e.target.value);render();};
for(const [input,key] of [['chartTitle','title'],['chartType','type'],['chartMetric','metric'],['chartGroupBy','groupBy'],['chartValueField','valueField'],['chartEvent','eventName']])$(''+input).onchange=e=>{if(!chart())return;if(e.target.value)chart()[key]=e.target.value;else delete chart()[key];render();};
$('deleteChart').onclick=()=>{if(!chart())return;page().charts.splice(cidx,1);cidx=0;render();};
$('reportName').onchange=e=>{if(selected()){selected().name=e.target.value;render();}};
$('pageName').onchange=e=>{if(page()){page().name=e.target.value;render();}};
function uid(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.floor(Math.random()*9999);}
$('newReport').onclick=()=>{doc.reports.push({id:uid('report'),name:'New report',pages:[{id:uid('page'),name:'Overview',charts:[]}]});ridx=doc.reports.length-1;pidx=0;render();};
$('newPage').onclick=()=>{if(!selected())return;selected().pages.push({id:uid('page'),name:'New page',charts:[]});pidx=selected().pages.length-1;cidx=0;render();};
$('newChart').onclick=()=>{if(!page())return;page().charts.push({id:uid('chart'),title:'Events',type:'bar',groupBy:'event',metric:'count',limit:100});cidx=page().charts.length-1;render();};
$('applyCharts').onclick=()=>{try{if(!page())return;page().charts=JSON.parse($('chartsJson').value);cidx=0;render();say('Applied chart definitions (publish to save)');}catch(e){say('Invalid JSON: '+e.message);}};
$('deletePage').onclick=()=>{if(!selected()||!page())return;selected().pages.splice(pidx,1);pidx=0;render();};
$('reload').onclick=load;
$('save').onclick=async()=>{try{const next=JSON.parse(JSON.stringify(doc));next.version++;const res=await fetch(prefix+'/api',{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(next)});const result=await res.json();if(!res.ok)throw Error(result.error||res.status);doc=next;render();say('Published version '+next.version);}catch(e){say('Save failed: '+e.message);}};
async function preview(){const board=$('charts');board.replaceChildren();$('pageTitle').textContent=page()?.name||'No page';$('notice').textContent='';if(!page())return;
  for(const chart of page().charts){const section=document.createElement('div');section.className='chart';const h=document.createElement('h3');h.textContent=chart.title;section.append(h);board.append(section);
    try{const url=new URL(prefix+'/query',location.origin);url.searchParams.set('report',selected().id);url.searchParams.set('page',page().id);url.searchParams.set('chart',chart.id);
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const result=await response.json();
      if(['pie','doughnut'].includes(chart.type)&&result.values.some(v=>v<0)){const note=document.createElement('p');note.className='warn';note.textContent='Pie and doughnut charts cannot display negative values. Choose bar, line or table.';section.append(note);continue;}
      if(result.truncated||result.queryMode==='materialized'){const note=document.createElement('p');note.className='warn';note.textContent=result.queryMode==='materialized'?'Indexed numeric facts only ('+result.matchedFacts+' matching facts); older or failed writes may be missing.'+(result.truncated?' Group display limited.':''):result.queryMode==='database'?'Group display limited; total is a database event count.':'Sampled at most '+result.sampledRows+' source events; not a complete aggregate.';section.append(note);}draw(section,result);
    }catch(e){const error=document.createElement('p');error.textContent='Query unavailable: '+e.message;section.append(error);}}
}
function draw(section,d){const labels=d.labels||[],v=d.values||[];
  if(d.type==='kpi'){const h=document.createElement('h1');h.textContent=Number(d.total).toLocaleString();section.append(h);return;}
  if(d.type==='table'){const table=document.createElement('table'),head=document.createElement('tr');for(const label of ['Dimension','Value']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);labels.forEach((l,i)=>{const tr=document.createElement('tr');for(const text of [l,String(v[i])]){const cell=document.createElement('td');cell.textContent=text;tr.append(cell);}table.append(tr);});section.append(table);return;}
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;section.append(canvas);const c=canvas.getContext('2d');if(!c)return;
  const palette=['#2563eb','#0891b2','#d97706','#059669','#9333ea','#dc2626','#4f46e5','#64748b'];c.font='12px sans-serif';c.fillStyle='#777';
  if(d.type==='pie'||d.type==='doughnut'){let angle=-Math.PI/2;const total=v.reduce((a,b)=>a+Math.max(0,b),0)||1;v.slice(0,15).forEach((value,i)=>{const sweep=Math.PI*2*Math.max(0,value)/total;c.beginPath();c.moveTo(210,155);c.arc(210,155,125,angle,angle+sweep);c.closePath();c.fillStyle=palette[i%palette.length];c.fill();angle+=sweep;});if(d.type==='doughnut'){c.beginPath();c.arc(210,155,62,0,Math.PI*2);c.fillStyle=getComputedStyle(document.body).backgroundColor||'#fff';c.fill();}labels.slice(0,8).forEach((l,i)=>{c.fillStyle=palette[i%palette.length];c.fillRect(370,20+i*28,12,12);c.fillStyle='#888';c.fillText(String(l).slice(0,25),390,31+i*28);});return;}
  const lowest=Math.min(0,...v),highest=Math.max(0,...v),range=Math.max(1,highest-lowest),count=Math.max(v.length,1),w=520/count;
  const yValue=value=>278-230*(value-lowest)/range,zeroY=yValue(0);
  c.strokeStyle='#aaa';c.beginPath();c.moveTo(50,zeroY);c.lineTo(610,zeroY);c.stroke();
  if(d.type==='horizontal-bar'){const height=Math.min(28,240/Math.max(1,count)),zeroX=145+430*(-lowest)/range;
    v.slice(0,30).forEach((value,i)=>{const y=12+i*height,x=145+430*(value-lowest)/range;c.fillStyle=palette[i%palette.length];c.fillRect(Math.min(zeroX,x),y,Math.abs(x-zeroX),Math.max(2,height-4));c.fillStyle='#888';c.fillText(String(labels[i]).slice(0,18),4,y+height-5);});return;}
  if(d.type==='line'||d.type==='area'||d.type==='scatter'){c.strokeStyle=palette[0];c.fillStyle=palette[0];c.beginPath();v.forEach((value,i)=>{const x=65+i*(520/Math.max(1,count-1)),y=yValue(value);if(i===0)c.moveTo(x,y);else c.lineTo(x,y);});if(d.type==='area'){c.lineTo(65+(count-1)*(520/Math.max(1,count-1)),zeroY);c.lineTo(65,zeroY);c.closePath();c.globalAlpha=.2;c.fillStyle=palette[0];c.fill();c.globalAlpha=1;}if(d.type!=='scatter')c.stroke();v.forEach((value,i)=>{const x=65+i*(520/Math.max(1,count-1)),y=yValue(value);c.beginPath();c.arc(x,y,3,0,Math.PI*2);c.fill();});}
  else v.forEach((value,i)=>{c.fillStyle=palette[i%palette.length];const y=yValue(value);c.fillRect(60+i*w,Math.min(zeroY,y),Math.max(2,w-5),Math.abs(zeroY-y));});
  c.fillStyle='#888';labels.slice(0,8).forEach((l,i)=>c.fillText(String(l).slice(0,13),60+i*(520/Math.max(1,Math.min(count,8))),304));}
load();})();</script></body></html>`;
}
