export type SpeechOutcome='started'|'resumed'|'unavailable'|'denied'|'busy'|'error';
export interface SpeechStatus {readonly available:boolean;readonly active:boolean;readonly paused:boolean;readonly error?:'UNAVAILABLE'|'FAILED'}
export interface SpeechController {
 getStatus():SpeechStatus;subscribe(listener:()=>void):()=>void;
 speak(text:string,event:Event):SpeechOutcome;pause():void;resume(event:Event):SpeechOutcome;stop():void;destroy():void;
}
const leases=new WeakMap<SpeechSynthesis,object>();
/** Native local-voice speech only, requiring a trusted in-dispatch click and exclusive host ownership.
 * The browser synthesis queue is window-global; unmanaged callers must not share it during a lease.
 */
export function createSpeechController(win:Window,options:{ownership:'exclusive';maxCharacters?:number;voiceURI?:string;onError?:(code:'UNAVAILABLE'|'FAILED')=>void}):SpeechController {
 if(options?.ownership!=='exclusive')throw new TypeError('Speech requires explicit exclusive engine ownership');
 options={...options};
 const max=options.maxCharacters??2000;if(!Number.isSafeInteger(max)||max<1||max>10000||options.voiceURI!==undefined&&(typeof options.voiceURI!=='string'||!options.voiceURI.trim()||options.voiceURI.length>256))throw new TypeError('Invalid speech policy');
 const browser=win as Window&typeof globalThis;
 let synth:SpeechSynthesis|undefined;try{synth=browser.speechSynthesis;}catch{/* Unavailable browser capability. */}
 const capable=!!synth&&typeof browser.SpeechSynthesisUtterance==='function'&&['speak','cancel','pause','resume','getVoices','addEventListener','removeEventListener'].every(name=>typeof (synth as unknown as Record<string,unknown>)[name]==='function');
 const owner={},listeners=new Set<()=>void>(),consumed=new WeakSet<Event>();let utterance:SpeechSynthesisUtterance|undefined,disposed=false,notifying=false,reporting=false,stopping=false,lastError:'UNAVAILABLE'|'FAILED'|undefined;
 const voices=()=>{if(!capable)return [];try{return synth!.getVoices().slice(0,256).filter(voice=>voice.localService===true&&(!options.voiceURI||voice.voiceURI===options.voiceURI));}catch{return [];}};
 const assertLive=()=>{if(disposed)throw new Error('Speech controller destroyed');};
 const status=():SpeechStatus=>Object.freeze({available:voices().length>0,active:!!utterance,paused:!!utterance&&!!synth?.paused,...(lastError?{error:lastError}:{})});
 const notify=()=>{if(notifying||disposed)return;notifying=true;try{for(const listener of [...listeners])if(listeners.has(listener))try{listener();}catch{/* Observers cannot take engine ownership. */}}finally{notifying=false;}};
 const report=(code:'UNAVAILABLE'|'FAILED')=>{lastError=code;if(!reporting){reporting=true;try{options.onError?.(code);}catch{}finally{reporting=false;}}notify();};
 const release=()=>{if(utterance){utterance.removeEventListener('end',onEnd);utterance.removeEventListener('error',onError);}utterance=undefined;if(synth&&leases.get(synth)===owner)leases.delete(synth);};
 const onEnd=()=>{release();notify();};const onError=()=>{release();report('FAILED');};
 const gesture=(event:Event)=>{
  if(!(event instanceof browser.Event)||!event.isTrusted||event.type!=='click'||event.eventPhase===0||consumed.has(event)||browser.navigator.userActivation?.isActive===false)return false;
  consumed.add(event);return true;
 };
 const stop=()=>{if(stopping||!utterance||!synth||leases.get(synth)!==owner)return;stopping=true;utterance.removeEventListener('end',onEnd);utterance.removeEventListener('error',onError);try{synth.cancel();if(synth.paused&&!synth.speaking&&!synth.pending)synth.resume();}catch{report('FAILED');}finally{release();stopping=false;notify();}};
 if(capable)synth!.addEventListener('voiceschanged',notify);
 return {
  getStatus(){assertLive();return status();},
  subscribe(listener){assertLive();if(typeof listener!=='function'||listeners.size>=32)throw new TypeError('Invalid or excessive speech observers');listeners.add(listener);return()=>{listeners.delete(listener);};},
  speak(text,event){
   assertLive();const voice=voices()[0];if(!voice){report('UNAVAILABLE');return 'unavailable';}
   if(!gesture(event))return 'denied';
   if(typeof text!=='string'||!text.trim()||text.length>max||/[<>]/.test(text))return 'denied';
   if(utterance||leases.has(synth!)||synth!.speaking||synth!.pending||synth!.paused)return 'busy';
   try{utterance=new browser.SpeechSynthesisUtterance(text);utterance.voice=voice;utterance.addEventListener('end',onEnd);utterance.addEventListener('error',onError);leases.set(synth!,owner);synth!.speak(utterance);lastError=undefined;notify();return 'started';}
   catch{release();report('FAILED');return 'error';}
  },
  pause(){assertLive();if(!utterance||leases.get(synth!)!==owner||synth!.paused)return;try{synth!.pause();notify();}catch{report('FAILED');}},
  resume(event){assertLive();if(!utterance||leases.get(synth!)!==owner)return voices().length?'denied':'unavailable';if(!gesture(event))return 'denied';try{synth!.resume();notify();return 'resumed';}catch{report('FAILED');return 'error';}},
  stop(){assertLive();stop();},
  destroy(){if(disposed)return;disposed=true;if(capable)synth!.removeEventListener('voiceschanged',notify);stop();release();listeners.clear();},
 };
}
