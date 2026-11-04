import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMediaTranscoder} from '../dist/transcode.js';
const bytes=new Uint8Array([1,2,3]),sha256=createHash('sha256').update(bytes).digest('hex'),identity={tenant:'tenant',subject:'user'};
const quotas={maxInputBytes:100,maxOutputBytes:100,maxCpuMs:100,maxWallMs:100,maxMemoryBytes:1024,maxFiles:2};
function fixture(extra={}){let creates=0,disposed=0,terminated=0;const executor={isolation:'process',network:'disabled',filesystem:'job-private',privilege:'unprivileged',hardLimits:{cpu:true,memory:true,files:true},supportedPresets:['webm-opus'],async create(input){creates++;assert.equal(input.preset,'webm-opus');return {async run(){return {output:(async function*(){yield bytes;})(),cpuMs:1,peakMemoryBytes:100,filesCreated:2};},async terminate(){terminated++;},async dispose(){disposed++;}};},...extra};return {executor,get creates(){return creates;},get disposed(){return disposed;},get terminated(){return terminated;}};}
test('fixed preset transcoding validates identity/hash/quotas and disposes successful output without URLs or commands',async()=>{
 const f=fixture(),events=[],transcoder=createMediaTranscoder({executor:f.executor,presets:['webm-opus'],quotas,authorize:()=>true,onEvent:e=>events.push(e)});
 try{const result=await transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256});assert.equal(result.sha256,sha256);assert.equal(result.contentType,'audio/webm; codecs="opus"');assert.equal(f.disposed,1);assert.equal(f.terminated,0);assert.deepEqual(events,[{preset:'webm-opus',status:'complete'}]);await assert.rejects(transcoder.transcode(identity,{preset:'arbitrary --command /path',bytes,sha256}));assert.equal(events.length,1);await assert.rejects(transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256:'0'.repeat(64)}),{code:'TRANSCODE_INTEGRITY'});assert.equal(f.creates,1);}finally{await transcoder.close();}
});
test('denied/missing isolator, dependency failure and oversized output never expose partial bytes and clean jobs',async()=>{
 const f=fixture();assert.throws(()=>createMediaTranscoder({executor:{...f.executor,isolation:'in-process'},presets:['webm-opus'],quotas,authorize:()=>true}),/isolated/);
 const denied=createMediaTranscoder({executor:f.executor,presets:['webm-opus'],quotas,authorize:()=>false});await assert.rejects(denied.transcode(identity,{preset:'webm-opus',bytes,sha256}),{code:'TRANSCODE_FORBIDDEN'});assert.equal(f.creates,0);await denied.close();
 let disposed=0,terminated=0;
 for(const run of [async()=>{throw new Error('PRIVATE_CODEC_STDERR');},async()=>({output:(async function*(){yield new Uint8Array(101);})(),cpuMs:1,peakMemoryBytes:1,filesCreated:1})]){
  const executor={...f.executor,create:async()=>({run,terminate:async()=>{terminated++;},dispose:async()=>{disposed++;}})},transcoder=createMediaTranscoder({executor,presets:['webm-opus'],quotas,authorize:()=>true});
  try{await assert.rejects(transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256}),error=>!error.message.includes('PRIVATE'));}finally{await transcoder.close();}
 }assert.equal(disposed,2);assert.equal(terminated,2);
});
test('deadline/cancellation retains slots until process termination and disposal actually settle',async()=>{
 const f=fixture();let finish,terminated=0,disposed=0;const executor={...f.executor,create:async()=>({run:()=>new Promise(resolve=>{finish=()=>resolve({output:(async function*(){yield bytes;})(),cpuMs:1,peakMemoryBytes:1,filesCreated:1});}),terminate:async()=>{terminated++;await new Promise(r=>setTimeout(r,5));finish();},dispose:async()=>{disposed++;}})};
 const transcoder=createMediaTranscoder({executor,presets:['webm-opus'],quotas:{...quotas,maxWallMs:10},authorize:()=>true});const work=transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256});await assert.rejects(transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256}),{code:'TRANSCODER_BUSY'});await assert.rejects(work,{code:'TRANSCODE_DEADLINE'});assert.equal(terminated,1);assert.equal(disposed,1);await transcoder.close();await assert.rejects(transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256}),{code:'TRANSCODER_CLOSED'});
});
test('cleanup failure is surfaced and never reports completed output; codec arguments/paths reject before execution',async()=>{
 const f=fixture(),events=[],transcoder=createMediaTranscoder({executor:{...f.executor,create:async()=>({run:async()=>({output:(async function*(){yield bytes;})(),cpuMs:1,peakMemoryBytes:1,filesCreated:1}),terminate:async()=>{},dispose:async()=>{throw new Error('private temporary path');}})},presets:['webm-opus'],quotas,authorize:()=>true,onEvent:e=>events.push(e)});
 try{await assert.rejects(transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256}),{code:'TRANSCODE_CLEANUP_FAILED'});assert.equal(events[0].status,'failed');await assert.rejects(transcoder.transcode(identity,{preset:'webm-opus',bytes,sha256,path:'../outside',args:['-anything']}),{code:'TRANSCODE_INPUT'});}finally{await transcoder.close();}
});
