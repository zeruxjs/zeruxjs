export function dashboard(prefix:string):string{
  const api=JSON.stringify(prefix+'/admin/api');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zerux Tags — Container Manager</title><style>
:root{color-scheme:light dark;font:15px system-ui,sans-serif}body{max-width:1000px;margin:0 auto;padding:22px}h1{margin-bottom:3px}p{color:#777}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}button{cursor:pointer;border:1px solid #888;border-radius:6px;padding:9px 14px;background:transparent;color:inherit}button:hover{opacity:.8}
section{border:1px solid #8885;padding:16px;border-radius:10px;margin:12px 0}label{display:block;margin:8px 0}input,select,textarea{padding:10px;box-sizing:border-box;width:100%;border:1px solid #8887;border-radius:6px;background:transparent;color:inherit}textarea{min-height:160px;font:13px monospace}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.help{font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere}strong{color:inherit}.small{font-size:12px}
</style></head><body><h1>Zerux Tags</h1><p>Versioned triggers, tags and variables. All destination credentials stay on the server.</p>
<nav><button id="reload">Reload</button><button id="addTrigger">Add trigger</button><button id="addVariable">Add variable</button><button id="addTag">Add tag</button><button id="save">Publish changes</button><button id="test">Dry-run trigger</button></nav>
<main><section><label>Container name<input id="name"></label><div class="small" id="version"></div></section>
<section><h2>Triggers</h2><div id="triggers"></div></section><section><h2>Variables</h2><div id="variables"></div></section><section><h2>Tags</h2><div id="tags"></div></section>
<section><h2>Dry-run debug</h2><label>Event name<input id="testEvent" value="page_view"></label><label>Properties JSON<textarea id="testProps" spellcheck="false">{}</textarea></label><pre id="testOutput"></pre></section>
<section><h2>Advanced JSON editor</h2><p class="help">Edit the full container definition. Publish saves with optimistic version checking; a 409 requires a reload.</p><textarea id="editor" spellcheck="false"></textarea></section>
<pre role="status" aria-live="polite" id="status"></pre></main>
<script>(function(){'use strict';const api=${api},$=id=>document.getElementById(id);let current;
const say=t=>$('status').textContent=t;
const input=(label,val,callback)=>{const box=document.createElement('label');box.textContent=label;const el=document.createElement('input');el.value=val==null?'':String(val);el.onchange=()=>callback(el.value);box.append(el);return box;};
function picker(label,value,options,cb){const box=document.createElement('label');box.textContent=label;const select=document.createElement('select');for(const entry of options){const option=document.createElement('option');option.value=entry;option.textContent=entry;select.append(option);}select.value=value;select.onchange=()=>cb(select.value);box.append(select);return box;}
function renderList(id,arr,fields){const container=$(id);container.replaceChildren();arr.forEach((obj,i)=>{const section=document.createElement('section');const title=document.createElement('strong');title.textContent=obj.name||obj.id;section.append(title);
 fields.forEach(([field,name])=>section.append(input(name,obj[field],v=>{obj[field]=v;render();})));
 if(id==='triggers'){section.append(picker('Trigger type',obj.type,['all','event','pageview','click','form','history'],v=>{obj.type=v;render();}));section.append(input('Conditions (JSON)',JSON.stringify(obj.conditions||[]),v=>{try{obj.conditions=JSON.parse(v);render();}catch{say('Invalid conditions JSON');}}));}
 if(id==='variables'){section.append(picker('Variable type',obj.type,['constant','event','dataLayer','context'],v=>{obj.type=v;render();}));section.append(input('Constant value',obj.value??'',v=>{obj.value=v;render();}));}
 if(id==='tags'){section.append(picker('Tag destination',obj.type,['analytics','ga4','webhook'],v=>{obj.type=v;render();}));
 for(const field of ['measurementId','credentialRef','destinationRef','clientIdVariable'])section.append(input(field,obj[field],v=>{obj[field]=v;render();}));
 section.append(input('Trigger IDs (comma-separated)',obj.triggerIds.join(','),v=>{obj.triggerIds=v.split(',').map(x=>x.trim()).filter(Boolean);render();}));}
 const del=document.createElement('button');del.textContent='Delete';del.onclick=()=>{arr.splice(i,1);render();};section.append(del);container.append(section);});}
function render(){if(!current)return;$('name').value=current.name;$('version').textContent='Published version: '+current.version;
 renderList('triggers',current.triggers,[['id','ID'],['name','Name'],['event','Event (for event trigger)']]);
 renderList('variables',current.variables,[['id','ID'],['name','Name'],['key','Property key']]);
 renderList('tags',current.tags,[['id','ID'],['name','Name'],['eventName','Event override']]);
 $('editor').value=JSON.stringify(current,null,2);}
async function load(){try{const r=await fetch(api,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);current=await r.json();render();say('Container loaded');}catch(e){say('Load failed: '+e.message);}}
$('reload').onclick=load;$('name').onchange=e=>{current.name=e.target.value;render();};
$('addTrigger').onclick=()=>{const id='trigger_'+Date.now().toString(36);current.triggers.push({id,name:id,type:'event',event:'page_view'});render();};
$('addVariable').onclick=()=>{const id='var_'+Date.now().toString(36);current.variables.push({id,name:id,type:'event',key:'value'});render();};
$('addTag').onclick=()=>{const id='tag_'+Date.now().toString(36);current.tags.push({id,name:id,type:'analytics',triggerIds:[current.triggers[0]?.id||'all_events']});render();};
$('test').onclick=async()=>{try{const res=await fetch(api.slice(0,-3)+'preview',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('testEvent').value,properties:JSON.parse($('testProps').value)})});$('testOutput').textContent=JSON.stringify(await res.json(),null,2);}catch(e){say('Preview failed: '+e.message);}};
$('save').onclick=async()=>{try{const proposal=JSON.parse($('editor').value);proposal.version=current.version+1;const r=await fetch(api,{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(proposal)});const body=await r.json();if(!r.ok)throw Error(body.error||r.status);current=proposal;render();say('Published version '+body.version);}catch(e){say('Publish failed: '+e.message);}};
load();})();</script></body></html>`;
}
