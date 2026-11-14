/** Generate a self-contained document-lifetime bootstrap from explicit public collection settings. No script executes on the server and no provider code/credentials are included.
 * @param {{
  endpoint: string;
  site: string;
  debug: boolean;
  autoEvents?: string[];
  defaultConsent?: 'granted' | 'denied';
}} config - Trusted public collector endpoint/site/debug/automatic trigger kinds and explicit initial consent.
 * @param {string} config.endpoint - Explicit collection endpoint, not a destination credential.
 * @param {string} config.site - Host-selected public site identifier.
 * @param {boolean} config.debug - Explicit public diagnostic switch.
 * @param {string[]} config.autoEvents - Optional published automatic trigger types.
 * @param {'granted' | 'denied'} config.defaultConsent - Optional initial telemetry policy.
 * @returns {string} Script-safe bootstrap text; generated native listeners belong to the document, not a mount/unmount scope.
 */
export function browserScript(config: {
  /** Explicit public collection endpoint, never a destination-secret URL. */
  endpoint: string;
  /** Host-selected public site identity; collector still verifies origin/site binding. */
  site: string;
  /** Explicit fixed diagnostic switch; browser config cannot overwrite it. */
  debug: boolean;
  /** Published enabled automatic trigger kinds; absent does not enable tracking automatically. */
  autoEvents?: string[];
  /** Explicit telemetry state, fallback granted; host must establish its privacy/consent policy. */
  defaultConsent?: 'granted' | 'denied';
}): string {
  /** JSON public settings escaped against HTML script termination; generated source bytes otherwise remain stable. */
  const settings = JSON.stringify(config).replace(/</g, '\\u003c');
  return `(function(){'use strict';
if(window.__zeruxTtagLoaded===true)return;window.__zeruxTtagLoaded=true;
var cfg=${settings}, alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
var data=window.dataLayer=Array.isArray(window.dataLayer)?window.dataLayer:[];
var state=Object.create(null),consent=cfg.defaultConsent||'granted',pending=[],scheduled=false;
function makeId(){if(!window.crypto||!window.crypto.getRandomValues)throw new Error('Secure random unavailable');var str='';while(str.length<16){var bytes=new Uint8Array(32);window.crypto.getRandomValues(bytes);for(var i=0;i<bytes.length&&str.length<16;i++){if(bytes[i]<248)str+=alphabet.charAt(bytes[i]%62);}}return str;}
function safe(v){var out=Object.create(null);if(!v||typeof v!=='object'||Array.isArray(v))return out;
  var keys=Object.keys(v);for(var i=0;i<Math.min(keys.length,40);i++){var k=keys[i],val=v[k];
    if(!/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(k)||k==='constructor'||k==='prototype'||k==='__proto__'||k==='zRequestId'||k==='zRequestUtcDay')continue;
    if(val===null||typeof val==='boolean'||typeof val==='string'&&val.length<=1024||typeof val==='number'&&Number.isFinite(val))out[k]=val;
  }return out;}
function log(){if(cfg.debug&&window.console&&console.debug)console.debug.apply(console,['[ttag]'].concat(Array.prototype.slice.call(arguments)));}
function send(item,attempt){if(consent!=='granted')return;var body=JSON.stringify(item);try{
  if(navigator.sendBeacon){var blob=new Blob([body],{type:'text/plain;charset=UTF-8'});if(navigator.sendBeacon(cfg.endpoint,blob)){log('beacon queued',item.requestId);return;}}
  if(window.fetch){fetch(cfg.endpoint,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:body,keepalive:true,credentials:'omit',cache:'no-store'}).then(function(res){if(res.status===409&&(attempt||0)<1&&consent==='granted'){item.requestId=makeId();send(item,1);}}).catch(function(){log('delivery unavailable');});}
}catch(e){log('delivery unavailable');}}
function flush(){scheduled=false;var batch=pending.splice(0);for(var i=0;i<batch.length;i++)send(batch[i]);}
function queue(event){if(consent!=='granted')return null;var id=makeId();
  var item={requestId:id,name:String(event.event),source:'web',site:cfg.site,pathname:location.pathname,consent:'granted',properties:safe(event.properties),data:safe(state)};
  if(typeof state.sessionId==='string'&&state.sessionId.length<=128)item.sessionId=state.sessionId;
  if(pending.length>=100||new Blob([JSON.stringify(item)]).size>16384)return null;pending.push(item);if(!scheduled){scheduled=true;Promise.resolve().then(flush);}return id;
}
var originalPush=data.push.bind(data);
data.push=function(){var result=originalPush.apply(data,arguments);if(data.length>500)data.splice(0,data.length-500);for(var i=0;i<arguments.length;i++){var item=arguments[i];if(item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.event==='string'&&item.event)queue(item);}return result;};
function ttag(command,a,b){if(command==='event'){
    var event={event:String(a),properties:safe(b)};originalPush(event);if(data.length>500)data.splice(0,data.length-500);return queue(event);
  }
  if(command==='set'){if((Object.prototype.hasOwnProperty.call(state,a)||Object.keys(state).length<40)&&typeof a==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(a)&&a!=='constructor'&&a!=='prototype'&&a!=='__proto__'&&(typeof b==='string'&&b.length<=1024||typeof b==='number'&&Number.isFinite(b)||typeof b==='boolean'||b===null)){state[a]=b;data.push({set:a,value:b});return true;}return false;}
  if(command==='get')return a==='site'?cfg.site:a==='debug'?cfg.debug:state[a];
  if(command==='consent'){if(a==='granted'||a==='denied'){consent=a;if(a==='denied')pending.length=0;log('consent',a);return true;}return false;}
  if(command==='config')return false; // Site and debug flags are controlled by the server.
  return false;
}
window.ttag=ttag;
for(var i=0,initial=data.slice(-500);i<initial.length;i++)if(initial[i]&&typeof initial[i].event==='string')queue(initial[i]);
if(document.addEventListener){document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});window.addEventListener('pagehide',flush);
 var auto=cfg.autoEvents||[];
 if(auto.indexOf('pageview')!==-1)ttag('event','page_view',{path:location.pathname});
 if(auto.indexOf('click')!==-1)document.addEventListener('click',function(e){var el=e.target&&e.target.closest?e.target.closest('a,button,[data-ttag-click]'):null;if(!el)return;
   ttag('event','click',{element:String(el.tagName||'').toLowerCase().slice(0,30),element_id:String(el.id||'').slice(0,96)});
 },{capture:true,passive:true});
 if(auto.indexOf('form')!==-1)document.addEventListener('submit',function(e){var el=e.target;
   ttag('event','form_submit',{form_id:String(el&&el.id||'').slice(0,96)});
 },{capture:true,passive:true});
 if(auto.indexOf('history')!==-1)window.addEventListener('popstate',function(){ttag('event','history_change',{path:location.pathname});});
 }
log('initialized');
})();`;
}
