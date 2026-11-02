import {bindPreferenceStyles,preferenceId} from './preference-styles.js';
import {isFocusAvailable} from './focus.js';
import type {PreferenceState,PreferenceValues} from './preferences.js';
import type {SpeechController} from './speech.js';
export interface PreferencePanelLabels {legend:string;textSize:string;contrast:string;motion:string;reset:string;speak:string;pause:string;resume:string;stop:string}
const defaults:PreferencePanelLabels={legend:'Accessibility preferences',textSize:'Text size',contrast:'Contrast',motion:'Motion',reset:'Reset preferences',speak:'Read approved text',pause:'Pause speech',resume:'Resume speech',stop:'Stop speech'};
/** Optional inline native-controls panel. Borrowed state/speech remain host-owned; no automatic speech.
 * Targets one explicit container and never interprets arbitrary application text as a speech source.
 */
export function createPreferencePanel(host:HTMLElement,state:PreferenceState,options:{target?:HTMLElement;speech?:SpeechController;speechText?:()=>string;labels?:Partial<PreferencePanelLabels>;nonce?:string;returnFocus?:()=>HTMLElement|null}={}) {
 const labels={...defaults};
 for(const [key,value] of Object.entries(options.labels??{})){if(!Object.hasOwn(defaults,key)||typeof value!=='string'||!value.trim()||value.length>256)throw new TypeError('Invalid preference panel label');labels[key as keyof PreferencePanelLabels]=value;}
 if(options.speechText!==undefined&&typeof options.speechText!=='function')throw new TypeError('Invalid speech text provider');
 const target=options.target??host;if(target.ownerDocument!==host.ownerDocument)throw new TypeError('Preference target must share the panel document');
 const doc=host.ownerDocument,previous=doc.activeElement as HTMLElement|null,token=preferenceId(doc),fieldset=doc.createElement('fieldset'),legend=doc.createElement('legend'),style=doc.createElement('style');
 fieldset.id=token;legend.textContent=labels.legend;fieldset.appendChild(legend);
 style.textContent=`#${token}{font:inherit;color:inherit;}#${token} :where(select,button):focus-visible{outline:2px solid currentColor;outline-offset:2px;}`;if(options.nonce)style.setAttribute('nonce',options.nonce);fieldset.appendChild(style);
 const cleanup:(()=>void)[]=[];
 const listen=(element:HTMLElement,type:string,callback:(event:Event)=>void)=>{element.addEventListener(type,callback);cleanup.push(()=>element.removeEventListener(type,callback));};
 const select=(name:string,label:string,choices:readonly (readonly [string,string])[])=>{
  const wrapper=doc.createElement('p'),caption=doc.createElement('label'),control=doc.createElement('select');control.id=token+'-'+name;caption.htmlFor=control.id;caption.textContent=label;
  for(const [value,text] of choices){const option=doc.createElement('option');option.value=value;option.textContent=text;control.appendChild(option);}wrapper.append(caption,control);fieldset.appendChild(wrapper);return control;
 };
 const text=select('text',labels.textSize,[['1','100%'],['1.25','125%'],['1.5','150%'],['2','200%']]);
 const contrast=select('contrast',labels.contrast,[['system','Host default'],['light','Light'],['dark','Dark'],['high','High contrast']]);
 const motion=select('motion',labels.motion,[['system','Follow system'],['reduce','Reduce motion']]);
 const status=doc.createElement('output');status.id=token+'-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');contrast.setAttribute('aria-describedby',status.id);motion.setAttribute('aria-describedby',status.id);
 const button=(name:string,callback:(event:Event)=>void)=>{const control=doc.createElement('button');control.type='button';control.textContent=name;fieldset.appendChild(control);listen(control,'click',callback);return control;};
 listen(text,'change',()=>state.set({textScale:Number(text.value) as PreferenceValues['textScale']}));listen(contrast,'change',()=>state.set({contrast:contrast.value as PreferenceValues['contrast']}));listen(motion,'change',()=>state.set({motion:motion.value as PreferenceValues['motion']}));button(labels.reset,()=>{state.reset();options.speech?.stop();});
 let speechButtons:HTMLButtonElement[]=[];
 if(options.speech){
  speechButtons=[button(labels.speak,event=>{try{if(options.speechText){const outcome=options.speech!.speak(options.speechText(),event);if(outcome==='busy')status.textContent='Speech is already in use.';else if(outcome==='denied'||outcome==='error')status.textContent='Speech could not start; use the speech button with approved text.';}}catch{status.textContent='Speech text is unavailable.';}}),button(labels.pause,()=>options.speech!.pause()),button(labels.resume,event=>{options.speech!.resume(event);}),button(labels.stop,()=>options.speech!.stop())];
 }
 fieldset.appendChild(status);
 const update=()=>{
  const snapshot=state.getSnapshot();text.value=String(snapshot.values.textScale);contrast.value=snapshot.values.contrast;motion.value=snapshot.values.motion;contrast.disabled=snapshot.system.forcedColors;
  const messages=[state.getStatus().persistence==='failed'?'Preferences apply only to this page; storage is unavailable.':'Preferences apply to this container.'];
  if(snapshot.system.forcedColors)messages.push('System forced colors are active.');if(snapshot.system.reducedMotion)messages.push('System reduced motion is active.');
  if(options.speech){const speech=options.speech.getStatus();speechButtons[0].disabled=!speech.available||speech.active||!options.speechText;speechButtons[1].disabled=!speech.active||speech.paused;speechButtons[2].disabled=!speech.active||!speech.paused;speechButtons[3].disabled=!speech.active;if(!speech.available)messages.push('Speech is unavailable: a local voice is required.');if(speech.error==='FAILED')messages.push('Speech stopped because the browser could not complete it.');}
  status.textContent=messages.join(' ');
 };
 let binding:ReturnType<typeof bindPreferenceStyles>|undefined;
 try{binding=bindPreferenceStyles(target,state,{...(options.nonce?{nonce:options.nonce}:{})});host.appendChild(fieldset);cleanup.push(state.subscribe(update));if(options.speech)cleanup.push(options.speech.subscribe(update));update();}
 catch(error){for(const stop of cleanup.reverse())stop();fieldset.remove();binding?.destroy();throw error;}
 let disposed=false;
 return {element:fieldset,focus(){if(disposed)throw new Error('Preference panel destroyed');text.focus();},destroy(){if(disposed)return;disposed=true;const restore=fieldset.contains(doc.activeElement);for(const stop of cleanup.reverse())stop();fieldset.remove();binding?.destroy();if(restore){const target=options.returnFocus?.()??previous;if(target&&isFocusAvailable(target))target.focus();}}};
}
