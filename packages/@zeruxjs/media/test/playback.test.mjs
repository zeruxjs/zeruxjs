import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as accessibility from '@zeruxjs/accessibility';
import {createMediaPlayback,createMediaControls} from '../dist/playback.mjs';
function fixture(){
 const dom=new JSDOM('<p id="description">Authored description</p><video controls="authored" aria-label="Lesson" aria-describedby="description"></video><div id="host"></div><button id="fallback">Return</button>',{url:'https://media.test/'}),win=dom.window,media=win.document.querySelector('video');
 let playing=false,time=0,fail=false,revoked=0,loaded=0;const track={kind:'captions',label:'English',language:'en',mode:'disabled'},tracks=new win.EventTarget();Object.assign(tracks,{0:track,length:1});tracks[Symbol.iterator]=function*(){yield track;};
 Object.defineProperties(media,{duration:{get:()=>120},currentTime:{get:()=>time,set:value=>{time=value;}},textTracks:{get:()=>tracks},seekable:{get:()=>({length:1,start:()=>0,end:()=>120})}});
 media.canPlayType=type=>type.includes('x-matroska')?'':type.includes('wav')?'probably':'maybe';media.load=()=>{loaded++;};media.pause=()=>{playing=false;media.dispatchEvent(new win.Event('pause'));};media.play=async()=>{if(fail)throw new Error('PRIVATE_SIGNED_URL');playing=true;media.dispatchEvent(new win.Event('play'));};
 win.URL.createObjectURL=()=> 'blob:https://media.test/fixture';win.URL.revokeObjectURL=()=>{revoked++;};
 return {dom,win,media,track,tracks,get playing(){return playing;},get revoked(){return revoked;},get loaded(){return loaded;},fail(value){fail=value;}};
}
const variants=[{id:'mkv',contentType:'video/x-matroska',source:{url:'https://media.test/private?token=PRIVATE'}},{id:'wav',contentType:'audio/wav',source:{url:'https://media.test/audio?token=PRIVATE'}}];
test('controller has explicit DOM/source ownership, codec detection and URL-free error diagnostics',async()=>{
 assert.throws(()=>createMediaPlayback(null,{variants}),/DOM/);const f=fixture(),events=[];const player=createMediaPlayback(f.media,{variants,onEvent:e=>events.push(e)});
 try{assert.throws(()=>createMediaPlayback(f.media,{variants}),/unowned/);assert.equal((await player.probe())[0].supported,false);assert.equal(await player.select('mkv'),false);assert.equal(player.getSnapshot().error,'UNSUPPORTED_SOURCE');assert.equal(f.media.hasAttribute('src'),false);
  assert.equal(await player.select(),true);assert.equal(player.getSnapshot().variantId,'wav');f.fail(true);assert.equal(await player.play(),false);assert.equal(player.getSnapshot().error,'PLAY_DENIED');f.fail(false);assert.equal(await player.play(),true);player.pause();player.seek(30);player.volume(0.4);player.mute(true);assert.equal(player.getSnapshot().time,30);assert.throws(()=>player.seek(121));assert.throws(()=>player.volume(2));assert.doesNotMatch(JSON.stringify(events),/PRIVATE|https:|token/);
 }finally{player.destroy();f.dom.window.close();}
});
test('captions/labelled native controls preserve user attributes, keyboard scope and focus on teardown',async()=>{
 const f=fixture(),player=createMediaPlayback(f.media,{variants});await player.select('wav');const controls=createMediaControls(f.win.document.getElementById('host'),player,{label:'Lesson playback',accessibility,hideNativeControls:true,returnFocus:()=>f.win.document.getElementById('fallback')});
 try{
  assert.equal(f.media.getAttribute('aria-describedby'),'description '+controls.element.querySelector('output').id);assert.equal(f.media.hasAttribute('controls'),false);assert.equal(f.media.tabIndex,0);
  const selects=controls.element.querySelector('select');selects.value='0';selects.dispatchEvent(new f.win.Event('change'));assert.equal(f.track.mode,'showing');
  f.tracks[1]={kind:'subtitles',label:'French',language:'fr',mode:'disabled'};f.tracks.length=2;f.tracks.dispatchEvent(new f.win.Event('addtrack'));assert.equal(selects.options.length,3);selects.value='1';selects.dispatchEvent(new f.win.Event('change'));assert.equal(f.tracks[1].mode,'showing');delete f.tracks[1];f.tracks.length=1;f.tracks.dispatchEvent(new f.win.Event('removetrack'));assert.equal(selects.options.length,2);
  f.media.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(player.getSnapshot().time,5);
  const slider=controls.element.querySelector('input');slider.value='20';slider.dispatchEvent(new f.win.Event('input'));assert.equal(player.getSnapshot().time,20);
  controls.focus();assert.equal(f.win.document.activeElement.tagName,'BUTTON');controls.destroy();assert.equal(f.win.document.activeElement.id,'fallback');assert.equal(f.media.getAttribute('controls'),'authored');assert.equal(f.media.getAttribute('aria-describedby'),'description');assert.equal(f.media.hasAttribute('tabindex'),false);
  f.media.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.equal(player.getSnapshot().time,20);player.destroy();assert.equal(f.track.mode,'disabled');
 }finally{controls.destroy();player.destroy();f.dom.window.close();}
});
test('Blob source leases, dynamic tracks, stale probes, source expiry and destroy release owned resources',async()=>{
 const f=fixture(),player=createMediaPlayback(f.media,{variants:[{id:'blob',contentType:'audio/wav',source:{blob:new f.win.Blob(['bytes'])}}]});await player.select();player.captions(0);f.track.mode='hidden';player.destroy();player.destroy();assert.equal(f.revoked,1);assert.equal(f.track.mode,'hidden');assert.equal(f.media.hasAttribute('src'),false);assert.equal(player.getSnapshot().state,'destroyed');f.dom.window.close();
 const expired=fixture(),p=createMediaPlayback(expired.media,{variants:[{id:'expired',contentType:'audio/wav',source:{url:'https://media.test/file?signature=SECRET',expiresAt:Date.now()-1}}]});assert.equal(await p.select(),false);assert.equal(p.getSnapshot().error,'SOURCE_EXPIRED');assert.equal(expired.media.hasAttribute('src'),false);p.destroy();expired.dom.window.close();
 const live=fixture(),q=createMediaPlayback(live.media,{variants:[{id:'short',contentType:'audio/wav',source:{url:'https://media.test/file',expiresAt:Date.now()+40}}]});await q.select();await new Promise(r=>setTimeout(r,60));assert.equal(q.getSnapshot().error,'SOURCE_EXPIRED');assert.equal(live.media.hasAttribute('src'),false);q.destroy();live.dom.window.close();
 const pending=fixture();let resolve;const promise=new Promise(r=>resolve=r),r=createMediaPlayback(pending.media,{variants:[{...variants[1],audio:{channels:'1',bitrate:128000,samplerate:8000}}],capabilities:{decodingInfo:()=>promise}});const selecting=r.select();r.destroy();resolve({supported:true,smooth:true,powerEfficient:false});assert.equal(await selecting,false);assert.equal(pending.media.hasAttribute('src'),false);pending.dom.window.close();
});
test('MediaCapabilities denial excludes a registered source; unavailable probes keep canPlayType fallback explicit',async()=>{
 const f=fixture(),variant={...variants[1],audio:{channels:'1',bitrate:128000,samplerate:8000}};
 const denied=createMediaPlayback(f.media,{variants:[variant],capabilities:{decodingInfo:async()=>({supported:false,smooth:false,powerEfficient:false})}});assert.equal(await denied.select(),false);denied.destroy();
 const failed=createMediaPlayback(f.media,{variants:[variant],capabilities:{decodingInfo:async()=>{throw new Error('private platform error');}}});try{assert.equal((await failed.probe())[0].probeFailed,true);assert.equal(await failed.select(),true);}finally{failed.destroy();f.dom.window.close();}
});
