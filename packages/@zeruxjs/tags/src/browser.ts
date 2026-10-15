/** No browser bundles/dependencies required: the generated bootstrap is self-contained. */
export function browserScript(config:{endpoint:string;site:string;debug:boolean;autoEvents?:string[];defaultConsent?:'granted'|'denied'}):string{
  const settings=JSON.stringify(config).replace(/</g,'\\u003c');
  return `(function(){'use strict';
if(window.__zeruxTtagLoaded===true)return;window.__zeruxTtagLoaded=true;
var cfg=${settings}, alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
var data=window.dataLayer=Array.isArray(window.dataLayer)?window.dataLayer:[];
var state=Object.create(null),consent=cfg.defaultConsent||'granted',pending=[],scheduled=false;
function makeId(){if(!window.crypto||!window.crypto.getRandomValues)throw new Error('Secure random unavailable');var str='';while(str.length<16){var bytes=new Uint8Array(32);window.crypto.getRandomValues(bytes);for(var i=0;i<bytes.length&&str.length<16;i++){if(bytes[i]<248)str+=alphabet.charAt(bytes[i]%62);}}return str;}
function safe(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function log(){if(cfg.debug&&window.console&&console.debug)console.debug.apply(console,['[ttag]'].concat(Array.prototype.slice.call(arguments)));}
function send(item){var body=JSON.stringify(item);try{
  if(navigator.sendBeacon){var blob=new Blob([body],{type:'text/plain;charset=UTF-8'});if(navigator.sendBeacon(cfg.endpoint,blob)){log('beacon queued',item.requestId);return;}}
  if(window.fetch){fetch(cfg.endpoint,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:body,keepalive:true,credentials:'omit',cache:'no-store'}).then(function(res){if(res.status===409){item.requestId=makeId();send(item);}}).catch(function(){log('delivery unavailable');});}
}catch(e){log('delivery unavailable');}}
function flush(){scheduled=false;var batch=pending.splice(0);for(var i=0;i<batch.length;i++)send(batch[i]);}
function queue(event){if(consent==='denied')return null;var id=event.zRequestId||makeId();
  var item={requestId:id,name:String(event.event),source:'web',site:cfg.site,pathname:location.pathname,properties:safe(event.properties),data:Object.assign({},state)};
  if(state.sessionId)item.sessionId=String(state.sessionId);
  pending.push(item);if(!scheduled){scheduled=true;Promise.resolve().then(flush);}return id;
}
var originalPush=data.push.bind(data);
data.push=function(){var result=originalPush.apply(data,arguments);for(var i=0;i<arguments.length;i++){var item=arguments[i];if(item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.event==='string'&&item.event)queue(item);}return result;};
function ttag(command,a,b){if(command==='event'){
    var event={event:String(a),properties:safe(b),zRequestId:makeId()};data.push(event);return event.zRequestId;
  }
  if(command==='set'){if(typeof a==='string'&&a.length<=96&&(typeof b==='string'||typeof b==='number'||typeof b==='boolean'||b===null)){state[a]=b;data.push({set:a,value:b});return true;}return false;}
  if(command==='get')return a==='site'?cfg.site:a==='debug'?cfg.debug:state[a];
  if(command==='consent'){if(a==='granted'||a==='denied'){consent=a;log('consent',a);return true;}return false;}
  if(command==='config'){if(a&&typeof a==='object'){if(typeof a.site==='string')cfg.site=a.site;if(typeof a.debug==='boolean')cfg.debug=a.debug;}return true;}
  return false;
}
window.ttag=ttag;
for(var i=0,initial=data.slice();i<initial.length;i++)if(initial[i]&&typeof initial[i].event==='string')queue(initial[i]);
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
