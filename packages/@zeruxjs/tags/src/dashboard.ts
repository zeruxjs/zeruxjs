/** Generate the optional authored admin HTML using escaped host settings. This low-level serializer grants no permissions; runtime owns fresh authorization, CSRF, exact CSP hashes and private responses.
 * @param {string} prefix - Validated host telemetry prefix used only for compatible default API resolution.
 * @param {{apiBaseUrl?:string;csrfToken?:string;styleHref?:string;scriptSrc?:string}} settings - Explicit validated API/token/asset references; module asset replaces built-in inline UI code.
 * @param {string} settings.apiBaseUrl - Optional explicit API location, default prefix/admin.
 * @param {string} settings.csrfToken - Optional session-bound host token for protected writes.
 * @param {string} settings.styleHref - Optional host-validated stylesheet URL.
 * @param {string} settings.scriptSrc - Optional host-validated module replacing inline client.
 * @returns {string} Serialized admin HTML; no listener, fetch, asset compiler or server execution starts here.
 */
export function dashboard(
  prefix: string,
  settings: {
    /** Explicit admin API base independent of UI asset paths. */
    apiBaseUrl?: string;
    /** Host-issued authenticated session token; never a destination/provider secret. */
    csrfToken?: string;
    /** Optional validated host-served stylesheet supplementing built-in styles. */
    styleHref?: string;
    /** Optional validated host module replacing built-in inline script. */
    scriptSrc?: string;
  } = {}
): string {
  /** Script-context encoded fixed administrative API URL. */
  const api = JSON.stringify(
    (settings.apiBaseUrl ?? prefix + '/admin') + '/api'
  ).replace(/</g, '\\u003c');
  /** Script-context encoded host-issued session CSRF token, not authorization by itself. */
  const csrf = JSON.stringify(settings.csrfToken ?? '').replace(
    /</g,
    '\\u003c'
  );
  /** Encode a quoted HTML attribute value, independently of script JSON policy.
   * @param {string} value - Validated authored setting rendered in an attribute.
   * @returns {string} HTML-escaped attribute content; not a URL permission grant.
   */
  const attr = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;');
  /** Authored static UI shell plus script-safe settings; saved container values use text/native inputs. */
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="zerux-tags-api" content="${attr(settings.apiBaseUrl ?? prefix + '/admin')}"><meta name="zerux-tags-csrf" content="${attr(settings.csrfToken ?? '')}"><title>Zerux Tags — Container Manager</title><style>
:root{--tags-border:#8885;--tags-radius:10px;--tags-focus:#2563eb;--tags-gap:12px;color-scheme:light dark;font:15px system-ui,sans-serif}body{max-width:1000px;margin:0 auto;padding:22px}h1{margin-bottom:3px}p{color:#777}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}button{cursor:pointer;border:1px solid #888;border-radius:6px;padding:9px 14px;background:transparent;color:inherit}button:hover{opacity:.8}
section{border:1px solid var(--tags-border);padding:16px;border-radius:var(--tags-radius);margin:12px 0}label{display:block;margin:8px 0}input,select,textarea{padding:10px;box-sizing:border-box;width:100%;border:1px solid #8887;border-radius:6px;background:transparent;color:inherit}textarea{min-height:160px;font:13px monospace}
.two{display:grid;grid-template-columns:1fr 1fr;gap:var(--tags-gap)}.help{font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere}strong{color:inherit}.small{font-size:12px}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--tags-focus);outline-offset:3px}
</style>${settings.styleHref ? '<link rel="stylesheet" href="' + attr(settings.styleHref) + '">' : ''}</head><body><h1>Zerux Tags</h1><p>Versioned triggers, tags and variables. All destination credentials stay on the server.</p>
<nav><button id="reload">Reload</button><button id="addTrigger">Add trigger</button><button id="addVariable">Add variable</button><button id="addTag">Add tag</button><button id="save">Save draft</button><button id="publish">Publish draft</button><button id="test">Dry-run trigger</button></nav>
<main><section><label>Container name<input id="name"></label><div class="small" id="version"></div><div class="small" id="release"></div></section>
<section><h2>Triggers</h2><div id="triggers"></div></section><section><h2>Variables</h2><div id="variables"></div></section><section><h2>Tags</h2><div id="tags"></div></section>
<section><h2>Release history and rollback</h2><label>Restore published release<select id="rollbackRelease"></select></label><button id="rollback">Roll back live release</button><p class="help">Rollback changes the live version without deleting the current draft. Publishing requires an independent publisher role.</p></section>
<section><h2>Dry-run debug</h2><label>Inspect<select id="previewMode"><option value="draft">Draft</option><option value="published">Published</option></select></label><label>Event name<input id="testEvent" value="page_view"></label><label>Properties JSON<textarea id="testProps" spellcheck="false">{}</textarea></label><pre id="testOutput"></pre></section>
<section><h2>Advanced JSON editor</h2><p class="help">Edit the draft. Save increments its revision; publish is a separate authorized operation. A 409 requires reload and re-apply.</p><textarea id="editor" aria-label="Draft container JSON" spellcheck="false"></textarea></section>
<pre role="status" aria-live="polite" id="status"></pre></main>
<script>(function(){'use strict';const api=${api},csrf=${csrf},$=id=>document.getElementById(id);let current,latestStatus;
const say=t=>$('status').textContent=t;
const input=(label,val,callback)=>{const box=document.createElement('label');box.textContent=label;const el=document.createElement('input');el.value=val==null?'':String(val);el.onchange=()=>callback(el.value);box.append(el);return box;};
function picker(label,value,options,cb){const box=document.createElement('label');box.textContent=label;const select=document.createElement('select');for(const entry of options){const option=document.createElement('option');option.value=entry;option.textContent=entry;select.append(option);}select.value=value;select.onchange=()=>cb(select.value);box.append(select);return box;}
function renderList(id,arr,fields){const container=$(id);container.replaceChildren();arr.forEach((obj,i)=>{const section=document.createElement('section');const title=document.createElement('strong');title.textContent=obj.name||obj.id;section.append(title);
 fields.forEach(([field,name])=>section.append(input(name,obj[field],v=>{obj[field]=v;render();})));
 if(id==='triggers'){section.append(picker('Trigger type',obj.type,['all','event','pageview','click','form','history','group'],v=>{obj.type=v;if(v==='group')obj.composition??={mode:'all',triggerIds:current.triggers.filter(t=>t.id!==obj.id).slice(0,1).map(t=>t.id)};else delete obj.composition;render();}));if(obj.type==='group')section.append(input('Composition (JSON)',JSON.stringify(obj.composition),v=>{try{obj.composition=JSON.parse(v);render();}catch{say('Invalid group JSON');}}));section.append(input('Conditions (JSON)',JSON.stringify(obj.conditions||[]),v=>{try{obj.conditions=JSON.parse(v);render();}catch{say('Invalid conditions JSON');}}));}
 if(id==='variables'){section.append(picker('Variable type',obj.type,['constant','event','dataLayer','context'],v=>{obj.type=v;render();}));section.append(input('Constant value',obj.value??'',v=>{obj.value=v;render();}));}
 if(id==='tags'){section.append(picker('Tag destination',obj.type,['analytics','ga4','webhook','provider'],v=>{obj.type=v;if(v==='provider')obj.providerVersion??=1;else{delete obj.providerRef;delete obj.providerVersion;delete obj.publicConfig;}render();}));
 if(obj.type==='provider'){section.append(input('Provider reference',obj.providerRef,v=>{obj.providerRef=v;render();}),input('Provider schema version',obj.providerVersion,v=>{obj.providerVersion=Number(v);render();}),input('Public config (JSON)',JSON.stringify(obj.publicConfig||{}),v=>{try{obj.publicConfig=JSON.parse(v);render();}catch{say('Invalid public config JSON');}}));}
 for(const field of ['measurementId','credentialRef','destinationRef','clientIdVariable'])section.append(input(field,obj[field],v=>{obj[field]=v;render();}));
 section.append(input('Trigger IDs (comma-separated)',obj.triggerIds.join(','),v=>{obj.triggerIds=v.split(',').map(x=>x.trim()).filter(Boolean);render();}));}
 const del=document.createElement('button');del.textContent='Delete';del.onclick=()=>{arr.splice(i,1);render();};section.append(del);container.append(section);});}
function render(){if(!current)return;$('name').value=current.name;$('version').textContent='Draft revision: '+current.version;
 renderList('triggers',current.triggers,[['id','ID'],['name','Name'],['event','Event (for event trigger)']]);
 renderList('variables',current.variables,[['id','ID'],['name','Name'],['key','Property key']]);
 renderList('tags',current.tags,[['id','ID'],['name','Name'],['eventName','Event override']]);
 $('editor').value=JSON.stringify(current,null,2);}
async function load(){try{const r=await fetch(api,{credentials:'include',cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);current=await r.json();render();await refreshStatus();say('Draft loaded');}catch(e){say('Load failed: '+e.message);}}
async function refreshStatus(){const r=await fetch(api.slice(0,-3)+'status',{credentials:'include',cache:'no-store'});if(!r.ok)throw Error('Status HTTP '+r.status);latestStatus=await r.json();
 $('release').textContent='Published release: '+latestStatus.publishedRelease+' (draft unpublished: '+latestStatus.unpublishedChanges+')';
 const picker=$('rollbackRelease');picker.replaceChildren();for(const entry of latestStatus.history.slice().reverse()){
  const option=document.createElement('option');option.value=String(entry.id);option.textContent='#'+entry.id+' '+entry.action+' at '+entry.at;picker.append(option);
 }}
async function transition(endpoint,body){const r=await fetch(api.slice(0,-3)+endpoint,{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-zerux-csrf':csrf},body:JSON.stringify(body)});
 const payload=await r.json();if(!r.ok)throw Error(payload.committed==='unknown'?'Operation outcome unknown; reload status before any retry.':payload.committed===true?'Operation committed; audit unavailable. Reload status; do not retry.':r.status===409?'Revision conflict; your edits are retained. Reload before reapplying.':payload.error||r.status);await load();return payload;}
$('reload').onclick=load;$('name').onchange=e=>{current.name=e.target.value;render();};
$('addTrigger').onclick=()=>{const id='trigger_'+Date.now().toString(36);current.triggers.push({id,name:id,type:'event',event:'page_view'});render();};
$('addVariable').onclick=()=>{const id='var_'+Date.now().toString(36);current.variables.push({id,name:id,type:'event',key:'value'});render();};
$('addTag').onclick=()=>{const id='tag_'+Date.now().toString(36);current.tags.push({id,name:id,type:'analytics',triggerIds:[current.triggers[0]?.id||'all_events']});render();};
$('test').onclick=async()=>{try{const res=await fetch(api.slice(0,-3)+'preview',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-zerux-csrf':csrf},body:JSON.stringify({name:$('testEvent').value,properties:JSON.parse($('testProps').value),mode:$('previewMode').value})});$('testOutput').textContent=JSON.stringify(await res.json(),null,2);}catch(e){say('Preview failed: '+e.message);}};
$('save').onclick=async()=>{try{const proposal=JSON.parse($('editor').value);delete proposal.governance;proposal.version=current.version+1;const r=await fetch(api,{method:'PUT',credentials:'include',headers:{'content-type':'application/json','x-zerux-csrf':csrf},body:JSON.stringify(proposal)});const body=await r.json();if(!r.ok)throw Error(r.status===409?'Revision conflict; your edits are retained. Reload before reapplying.':body.error||r.status);current=proposal;await load();say('Saved draft revision '+body.version+'; not live until published');}catch(e){say('Save failed: '+e.message);}};
$('publish').onclick=async()=>{try{await transition('publish',{expectedVersion:current.version});say('Draft published successfully');}catch(e){say('Publish failed: '+e.message);}};
$('rollback').onclick=async()=>{try{const id=Number($('rollbackRelease').value);if(!Number.isSafeInteger(id))throw Error('Select a release');await transition('rollback',{expectedVersion:current.version,releaseId:id});say('Live release rolled back; draft unchanged');}catch(e){say('Rollback failed: '+e.message);}};
load();})();</script></body></html>`;
  return settings.scriptSrc
    ? html.replace(
        /<script>[\s\S]*?<\/script>/i,
        '<script type="module" src="' + attr(settings.scriptSrc) + '"></script>'
      )
    : html;
}
