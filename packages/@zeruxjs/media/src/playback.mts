/** Native browser playback. No DOM access or telemetry is started at module import. */
export type PlaybackError='UNSUPPORTED_SOURCE'|'SOURCE_EXPIRED'|'PLAY_DENIED'|'MEDIA_ERROR'|'CAPTION_ERROR'|'CAPABILITY_UNAVAILABLE';
export interface PlaybackVariant {
 id:string;contentType:string;source:{url:string;expiresAt?:number}|{blob:Blob};
 video?:{width:number;height:number;bitrate:number;framerate:number;contentType?:string};
 audio?:{channels:string;bitrate:number;samplerate:number;contentType?:string};
}
export interface PlaybackSupport {id:string;canPlay:''|'maybe'|'probably';supported:boolean;smooth?:boolean;powerEfficient?:boolean;probeFailed?:boolean}
export interface PlaybackSnapshot {state:'idle'|'ready'|'playing'|'paused'|'ended'|'error'|'destroyed';variantId?:string;error?:PlaybackError;time:number;duration:number|null;volume:number;muted:boolean;captions:{index:number;label:string;language:string;showing:boolean}[]}
export interface PlaybackOptions {
 variants:readonly PlaybackVariant[];allowedOrigins?:readonly string[];
 capabilities?:Pick<MediaCapabilities,'decodingInfo'>;
 onEvent?:(event:Readonly<{type:'source'|'error';variantId?:string;code?:PlaybackError}>)=>void;
}
const owners=new WeakSet<HTMLMediaElement>();
function contentType(value:string){if(typeof value!=='string'||value.length>256||! /^(?:audio|video)\/[A-Za-z0-9.+-]+(?:; codecs="[A-Za-z0-9., _-]{1,160}")?$/.test(value))throw new TypeError('Explicit media MIME/codec type required');}
function numeric(value:number,min:number,max:number){if(!Number.isFinite(value)||value<min||value>max)throw new RangeError('Invalid playback value');return value;}
/** Takes source ownership of an empty media element; never starts playback automatically. */
export function createMediaPlayback(media:HTMLMediaElement,options:PlaybackOptions){
 const win=media?.ownerDocument?.defaultView;
 if(!win||typeof win.HTMLMediaElement!=='function'||!(media instanceof win.HTMLMediaElement)||typeof media.canPlayType!=='function')throw new TypeError('DOM HTMLMediaElement required');
 if(media.autoplay||media.hasAttribute('autoplay')||media.srcObject||media.currentSrc||owners.has(media)||media.hasAttribute('src')||media.querySelector('source'))throw new Error('An empty, unowned media element is required');
 if(!options||!Array.isArray(options.variants)||!options.variants.length||options.variants.length>32)throw new TypeError('Register 1–32 playback variants');
 if(options.onEvent!==undefined&&typeof options.onEvent!=='function'||options.capabilities!==undefined&&typeof options.capabilities?.decodingInfo!=='function')throw new TypeError('Invalid playback callbacks');
 const origins=options.allowedOrigins??(win.location.origin==='null'?[]:[win.location.origin]);if(!Array.isArray(origins)||origins.length>32||origins.some(origin=>{try{return new URL(origin).origin!==origin;}catch{return true;}}))throw new TypeError('Invalid playback origin policy');
 const ids=new Set<string>();const variants=options.variants.map(variant=>{
  if(!variant||typeof variant.id!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(variant.id)||ids.has(variant.id))throw new TypeError('Invalid/duplicate playback variant');ids.add(variant.id);contentType(variant.contentType);
  const copy:PlaybackVariant={...variant,source:{...variant.source},...(variant.video?{video:{...variant.video}}:{}),...(variant.audio?{audio:{...variant.audio}}:{})};
  const sourceKeys=Object.keys(copy.source);if(sourceKeys.some(key=>!('url' in copy.source?['url','expiresAt']:['blob']).includes(key)))throw new TypeError('Invalid source fields');
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  if('url' in copy.source){const raw=copy.source.url;if(typeof raw!=='string'||raw.length>8192||/[\x00-\x20\x7f\\]/.test(raw))throw new TypeError('Invalid media URL');let url:URL;try{url=new URL(raw,win.location.href);}catch{throw new TypeError('Invalid media URL');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||!origins.includes(url.origin))throw new TypeError('Media origin denied');copy.source.url=url.href;if(copy.source.expiresAt!==undefined&&(!Number.isSafeInteger(copy.source.expiresAt)||copy.source.expiresAt<0))throw new TypeError('Invalid source expiry');}
  else if(!('blob' in copy.source)||!(copy.source.blob instanceof win.Blob))throw new TypeError('Registered URL or Blob required');
  if(copy.video){const type=copy.video.contentType??copy.contentType;contentType(type);if(!type.startsWith('video/'))throw new TypeError('Video capability MIME required');numeric(copy.video.width,1,16384);numeric(copy.video.height,1,16384);numeric(copy.video.bitrate,1,1000000000);numeric(copy.video.framerate,0.1,240);}
  if(copy.audio){const type=copy.audio.contentType??copy.contentType;contentType(type);if(!type.startsWith('audio/'))throw new TypeError('Audio capability MIME required');if(! /^[1-9][0-9]?$/.test(copy.audio.channels))throw new TypeError('Invalid audio channels');numeric(copy.audio.bitrate,1,10000000);numeric(copy.audio.samplerate,8000,384000);}
  return copy;
 });
 const capabilities=options.capabilities??win.navigator.mediaCapabilities;
 let destroyed=false,generation=0,state:PlaybackSnapshot['state']='idle',error:PlaybackError|undefined,current:string|undefined,lastSrc:string|undefined,ownedUrl:string|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const subscribers=new Set<(snapshot:PlaybackSnapshot)=>void>(),listeners:{target:EventTarget;name:string;fn:EventListener;capture:boolean}[]=[];
 if(media.textTracks.length>32)throw new RangeError('Caption track limit');
 let probing=0;
 const trackModes=new Map<TextTrack,{before:TextTrackMode;last:TextTrackMode}>();owners.add(media);
 const ensure=()=>{if(destroyed)throw new Error('Playback controller destroyed');};
 function tracks(){return Array.from({length:Math.min(media.textTracks.length,32)},(_,index)=>media.textTracks[index]).map((track,index)=>({track,index})).filter(({track})=>['captions','subtitles'].includes(track.kind));}
 function snapshot():PlaybackSnapshot{return {state,...(current?{variantId:current}:{}),...(error?{error}:{}),time:Number.isFinite(media.currentTime)?media.currentTime:0,duration:Number.isFinite(media.duration)?media.duration:null,volume:media.volume,muted:media.muted,captions:tracks().map(({track,index})=>({index,label:track.label.slice(0,256),language:track.language.slice(0,64),showing:track.mode==='showing'}))};}
 function emit(){if(destroyed)return;const view=snapshot();for(const subscriber of [...subscribers])try{subscriber(structuredClone(view));}catch{/* UI observers do not own playback. */}}
 function notify(type:'source'|'error',code?:PlaybackError){try{options.onEvent?.(Object.freeze({type,...(current?{variantId:current}:{}),...(code?{code}:{})}));}catch{/* No URL or platform error is emitted. */}}
 function failure(code:PlaybackError){error=code;state='error';if(current&&lastSrc!==undefined&&media.getAttribute('src')===lastSrc)media.pause();notify('error',code);emit();}
 function listen(target:EventTarget,name:string,fn:EventListener,capture=false){target.addEventListener(name,fn,capture);listeners.push({target,name,fn,capture});}
 function detach(){if(timer!==undefined)clearTimeout(timer);timer=undefined;if(lastSrc!==undefined&&media.getAttribute('src')===lastSrc){media.pause();media.removeAttribute('src');media.load();}if(ownedUrl!==undefined)win!.URL.revokeObjectURL(ownedUrl);ownedUrl=undefined;lastSrc=undefined;}
 const changed:EventListener=event=>{if(destroyed)return;if(event.type==='error'){failure((event.target as Element)?.tagName==='TRACK'?'CAPTION_ERROR':'MEDIA_ERROR');return;}if(!error){if(event.type==='play')state='playing';else if(event.type==='pause')state='paused';else if(event.type==='ended')state='ended';}emit();};
 for(const name of ['timeupdate','durationchange','loadedmetadata','play','pause','ended','volumechange'])listen(media,name,changed);listen(media,'error',changed,true);
 if(typeof media.textTracks.addEventListener==='function')for(const name of ['change','addtrack','removetrack'])listen(media.textTracks,name,()=>{if(media.textTracks.length>32)failure('CAPTION_ERROR');else emit();});
 async function probe(signal?:AbortSignal):Promise<PlaybackSupport[]>{
  ensure();if(probing>=4)throw new Error('Playback capability probe busy');probing++;try{const results:PlaybackSupport[]=[];for(const variant of variants){if(signal?.aborted)throw new Error('Playback selection cancelled');const raw=media.canPlayType(variant.contentType),canPlay=raw==='probably'?'probably':raw==='maybe'?'maybe':'';const result:PlaybackSupport={id:variant.id,canPlay,supported:!!canPlay};
   if(canPlay&&capabilities&&typeof capabilities.decodingInfo==='function'&&(variant.video||variant.audio))try{const info=await capabilities.decodingInfo({type:'file',...(variant.video?{video:{...variant.video,contentType:variant.video.contentType??variant.contentType}}:{}),...(variant.audio?{audio:{...variant.audio,contentType:variant.audio.contentType??variant.contentType}}:{})});if(typeof info.supported!=='boolean'||typeof info.smooth!=='boolean'||typeof info.powerEfficient!=='boolean')throw new Error();result.supported=info.supported;result.smooth=info.smooth;result.powerEfficient=info.powerEfficient;}catch{result.probeFailed=true;}
   results.push(result);
  }if(signal?.aborted)throw new Error('Playback selection cancelled');return results;}finally{probing--;}
 }
 return {
  media,getSnapshot:snapshot,probe,
  subscribe(callback:(snapshot:PlaybackSnapshot)=>void){ensure();if(typeof callback!=='function'||subscribers.size>=64)throw new TypeError('Invalid/excess playback observer');subscribers.add(callback);try{callback(snapshot());}catch(error){subscribers.delete(callback);throw error;}return()=>{subscribers.delete(callback);};},
  async select(id?:string,signal?:AbortSignal){
   ensure();if(id!==undefined&&!ids.has(id))throw new TypeError('Variant is not registered');const turn=++generation;detach();current=undefined;error=undefined;state='idle';emit();const supported=await probe(signal);if(destroyed||turn!==generation||signal?.aborted)return false;
   const variant=variants.find(v=>(id===undefined||v.id===id)&&supported.find(s=>s.id===v.id)?.supported&&(!('url' in v.source)||v.source.expiresAt===undefined||v.source.expiresAt>Date.now()));
   if(!variant){failure(variants.some(v=>(id===undefined||v.id===id)&&'url' in v.source&&v.source.expiresAt!==undefined&&v.source.expiresAt<=Date.now())?'SOURCE_EXPIRED':'UNSUPPORTED_SOURCE');return false;}
   detach();if(destroyed||turn!==generation)return false;error=undefined;current=variant.id;
   if('blob' in variant.source){if(typeof win.URL.createObjectURL!=='function'){failure('CAPABILITY_UNAVAILABLE');return false;}ownedUrl=win.URL.createObjectURL(variant.source.blob);lastSrc=ownedUrl;}else lastSrc=variant.source.url;
   media.setAttribute('src',lastSrc);media.load();state='ready';
   if('url' in variant.source&&variant.source.expiresAt!==undefined){const expiresAt=variant.source.expiresAt;const expire=()=>{if(destroyed||turn!==generation)return;const remaining=expiresAt-Date.now();if(remaining>0){timer=setTimeout(expire,Math.min(remaining,2147483647));return;}detach();failure('SOURCE_EXPIRED');};timer=setTimeout(expire,Math.min(Math.max(0,expiresAt-Date.now()),2147483647));}
   notify('source');emit();return true;
  },
  async play(){ensure();if(!current||error&&error!=='PLAY_DENIED'&&error!=='CAPTION_ERROR')return false;error=undefined;const turn=generation;try{await media.play();if(destroyed||turn!==generation)return false;state='playing';emit();return true;}catch{if(!destroyed&&turn===generation)failure('PLAY_DENIED');return false;}},
  pause(){ensure();media.pause();if(!error)state='paused';emit();},
  seek(seconds:number){ensure();numeric(seconds,0,Number.MAX_SAFE_INTEGER);if(!Number.isFinite(media.duration)||seconds>media.duration)throw new RangeError('Media is not seekable at this position');if(media.seekable.length&&!Array.from({length:media.seekable.length},(_,i)=>seconds>=media.seekable.start(i)&&seconds<=media.seekable.end(i)).some(Boolean))throw new RangeError('Position outside seekable ranges');media.currentTime=seconds;emit();},
  volume(value:number){ensure();media.volume=numeric(value,0,1);emit();},
  mute(value:boolean){ensure();if(typeof value!=='boolean')throw new TypeError('Mute requires boolean');media.muted=value;emit();},
  captions(index:number|null){ensure();if(media.textTracks.length>32)throw new RangeError('Caption track limit');const available=tracks();if(index!==null&&(!Number.isSafeInteger(index)||!available.some(v=>v.index===index)))throw new RangeError('Caption track not found');for(const {track,index:i} of available){if(!trackModes.has(track))trackModes.set(track,{before:track.mode,last:track.mode});const entry=trackModes.get(track)!;track.mode=i===index?'showing':'disabled';entry.last=track.mode;}emit();},
  destroy(){if(destroyed)return;destroyed=true;generation++;for(const {target,name,fn,capture} of listeners)target.removeEventListener(name,fn,capture);listeners.length=0;detach();for(const [track,entry] of trackModes)if(track.mode===entry.last)track.mode=entry.before;trackModes.clear();subscribers.clear();state='destroyed';owners.delete(media);}
 };
}
export type MediaPlayback=ReturnType<typeof createMediaPlayback>;
export interface PlaybackAccessibility {
 applyLabelledComponentProps(element:HTMLElement,props:{label:string}):{destroy():void};
 applyComponentProps(element:HTMLElement,props:{describedBy:string},options?:{requireLabel?:boolean}):{destroy():void};
}
let controlSequence=0;
/** Native labelled controls; inject @zeruxjs/accessibility's verified prop helpers. */
export function createMediaControls(host:HTMLElement,playback:MediaPlayback,options:{label:string;accessibility:PlaybackAccessibility;hideNativeControls?:boolean;returnFocus?:()=>HTMLElement|null}){
 const media=playback.media,document=host?.ownerDocument;
 if(!document?.defaultView||media.ownerDocument!==document||typeof options?.label!=='string'||!options.label.trim()||options.label.length>256||typeof options.accessibility?.applyLabelledComponentProps!=='function'||typeof options.accessibility.applyComponentProps!=='function'||options.hideNativeControls!==undefined&&typeof options.hideNativeControls!=='boolean'||options.returnFocus!==undefined&&typeof options.returnFocus!=='function')throw new TypeError('DOM host, authored label and accessibility helpers required');
 const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=options.label;group.append(legend);
 const status=document.createElement('output');do{status.id='media-player-status-'+(++controlSequence);}while(document.getElementById(status.id));status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const play=document.createElement('button');play.type='button';play.textContent='Play';group.append(play);
 function range(label:string,min:string,max:string,step:string){const field=document.createElement('label');field.append(document.createTextNode(label));const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;field.append(input);group.append(field);return input;}
 const seek=range('Position in seconds','0','0','0.1'),volume=range('Volume','0','1','0.05');
 const muteLabel=document.createElement('label'),mute=document.createElement('input');mute.type='checkbox';muteLabel.append(mute,document.createTextNode('Mute'));group.append(muteLabel);
 const captionLabel=document.createElement('label'),captions=document.createElement('select');captionLabel.append(document.createTextNode('Captions'),captions);group.append(captionLabel,status);
 let destroyed=false,unsubscribe:()=>void=()=>{},captionKey='';const removals:(()=>void)[]=[],props:{destroy():void}[]=[];
 const oldTab=media.getAttribute('tabindex'),oldControls=media.getAttribute('controls');
 function event(target:EventTarget,name:string,handler:EventListener){target.addEventListener(name,handler);removals.push(()=>target.removeEventListener(name,handler));}
 function show(view:PlaybackSnapshot){if(destroyed)return;play.textContent=view.state==='playing'?'Pause':'Play';play.disabled=!view.variantId||!!view.error&&view.error!=='PLAY_DENIED'&&view.error!=='CAPTION_ERROR';seek.disabled=view.duration===null||!!view.error;seek.max=String(view.duration??0);seek.value=String(view.time);volume.value=String(view.volume);mute.checked=view.muted;
  const key=JSON.stringify(view.captions.map(t=>[t.index,t.label,t.language]));if(key!==captionKey){captionKey=key;captions.replaceChildren();const off=document.createElement('option');off.value='';off.textContent='Off';captions.append(off);for(const track of view.captions){if(!track.label&&!track.language)continue;const option=document.createElement('option');option.value=String(track.index);option.textContent=track.label||track.language;captions.append(option);}}
  captions.disabled=captions.options.length===1;captions.value=String(view.captions.find(t=>t.showing)?.index??'');const message=view.error?({UNSUPPORTED_SOURCE:'No supported registered source.',SOURCE_EXPIRED:'Source access expired. Request a new authorized source.',PLAY_DENIED:'Playback could not start. Use Play to retry.',MEDIA_ERROR:'Media could not be decoded or loaded.',CAPTION_ERROR:'Captions could not be loaded.',CAPABILITY_UNAVAILABLE:'Playback capability is unavailable.'}[view.error]):view.state==='playing'?'Playing':view.state==='paused'?'Paused':view.state==='ended'?'Ended':'';if(status.textContent!==message)status.textContent=message;
 }
 function action(fn:()=>void){try{fn();}catch{status.textContent='This media control is currently unavailable.';}}
 try{
  host.append(group);props.push(options.accessibility.applyLabelledComponentProps(group,{label:options.label}));props.push(options.accessibility.applyComponentProps(media,{describedBy:[media.getAttribute('aria-describedby'),status.id].filter(Boolean).join(' ')},{requireLabel:true}));
  if(oldTab===null)media.setAttribute('tabindex','0');if(options.hideNativeControls)media.removeAttribute('controls');
  event(play,'click',()=>{if(playback.getSnapshot().state==='playing')playback.pause();else void playback.play();});event(seek,'input',()=>action(()=>playback.seek(Number(seek.value))));event(volume,'input',()=>action(()=>playback.volume(Number(volume.value))));event(mute,'change',()=>action(()=>playback.mute(mute.checked)));event(captions,'change',()=>action(()=>playback.captions(captions.value===''?null:Number(captions.value))));
  event(media,'keydown',raw=>{const event=raw as KeyboardEvent;if(event.target!==media||event.altKey||event.ctrlKey||event.metaKey)return;const view=playback.getSnapshot();if(event.key===' '||event.key==='k'){event.preventDefault();if(view.state==='playing')playback.pause();else void playback.play();}else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&view.duration!==null){event.preventDefault();action(()=>playback.seek(event.key==='Home'?0:event.key==='End'?view.duration!:Math.max(0,Math.min(view.duration!,view.time+(event.key==='ArrowRight'?5:-5)))));}else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();playback.volume(Math.max(0,Math.min(1,view.volume+(event.key==='ArrowUp'?0.05:-0.05))));}});
  unsubscribe=playback.subscribe(show);
 }catch(error){for(const remove of removals)remove();unsubscribe();for(const prop of props.reverse())prop.destroy();if(oldTab===null&&media.getAttribute('tabindex')==='0')media.removeAttribute('tabindex');if(options.hideNativeControls&&oldControls!==null&&!media.hasAttribute('controls'))media.setAttribute('controls',oldControls!);group.remove();throw error;}
 return {element:group,focus(){if(!destroyed)play.focus();},destroy(){if(destroyed)return;const hadFocus=group.contains(document.activeElement);destroyed=true;unsubscribe();for(const remove of removals)remove();for(const prop of props.reverse())prop.destroy();if(oldTab===null&&media.getAttribute('tabindex')==='0')media.removeAttribute('tabindex');if(options.hideNativeControls&&oldControls!==null&&!media.hasAttribute('controls'))media.setAttribute('controls',oldControls!);group.remove();if(hadFocus){let fallback:HTMLElement=media;try{fallback=options.returnFocus?.()??media;}catch{/* Focus callback failures must not strand playback ownership. */}if(fallback.isConnected)fallback.focus();}}};
}
