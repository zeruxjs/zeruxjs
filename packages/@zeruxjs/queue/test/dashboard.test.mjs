import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQueueService} from '../dist/index.js';

const fake=()=>{
 const calls=[],jobs=new Map();
 class Queue {
  constructor(name){this.name=name;}
  async waitUntilReady(){}
  async add(name,data,opts){const job={id:opts.jobId,name,data,attemptsMade:1,getState:async()=>job.state??'failed',retry:async()=>{job.state='waiting';calls.push('retry');}};jobs.set(job.id,job);return job;}
  async addBulk(){return []}
  async getJob(id){return jobs.get(id)}
  async getJobs(){return [...jobs.values()]}
  async getJobCounts(){return {waiting:0,failed:jobs.size}}
  async pause(){calls.push('pause')}
  async resume(){calls.push('resume')}
  async close(){}
 }
 class Worker {on(){return this}async close(){}async pause(){calls.push('localPause')}resume(){calls.push('localResume')}}
 return {Queue,Worker,calls};
};
const dashboard={
 authorize:request=>request.headers.get('cookie')==='session=operator'?{id:'operator'}:null,
 csrfToken:()=> '1234567890abcdef1234',
 verifyCsrf:request=>request.headers.get('x-csrf-token')==='1234567890abcdef1234'
};
function req(url,options={}){return new Request(url,{...options,headers:{cookie:'session=operator',...(options.headers??{})}});}
async function dispatch(service,url,options){const pathname=new URL(url).pathname;const route=service.routes().find(r=>r.pattern===pathname);assert.ok(route,pathname);return route.handler(req(url,options));}
test('queue admin is opt-in and requires both session authorization and CSRF',async()=>{
 const f=fake();
 await assert.rejects(createQueueService({redis:{host:'localhost'},queues:['emails'],dashboard},f),/administrative authorization/);
 const s=await createQueueService({redis:{host:'localhost'},queues:['emails'],administration:{authorize:async(_,queue,identity)=>queue==='emails'&&identity?.id==='operator'},dashboard},f);
 assert.equal(s.routes().length,4);
 const base='https://example.test/_queue/admin';
 const noAuth=await s.routes()[0].handler(new Request(base));assert.equal(noAuth.status,403);
 const html=await dispatch(s,base);assert.equal(html.status,200);const body=await html.text();assert.ok(body.includes('csrf-token'));assert.ok(!body.includes('redis://'));
 assert.equal((await dispatch(s,base+'/app.js')).status,200);
 assert.equal((await dispatch(s,base+'/app.css')).status,200);
 const counts=await (await dispatch(s,base+'/api?kind=queues')).json();assert.equal(counts.queues[0].name,'emails');
 await s.queue('emails').add('email.deliver',{password:'HIDDEN'},{jobId:'secure1'});
 const inspection=await (await dispatch(s,base+'/api?kind=jobs&queue=emails')).text();assert.ok(inspection.includes('secure1'));assert.ok(!inspection.includes('HIDDEN'));
 const payload=JSON.stringify({queue:'emails',action:'retry',id:'secure1'});
 const post={method:'POST',body:payload,headers:{'content-type':'application/json',origin:'https://example.test'}};
 assert.equal((await dispatch(s,base+'/api',post)).status,403,'csrf absent');
 assert.equal((await dispatch(s,base+'/api',{...post,headers:{...post.headers,'x-csrf-token':'1234567890abcdef1234',origin:'https://attacker.test'}})).status,403,'wrong origin');
 assert.equal((await dispatch(s,base+'/api',{...post,headers:{...post.headers,'x-csrf-token':'1234567890abcdef1234'}})).status,200);
 assert.deepEqual(f.calls,['retry']);
 await s.close();
});
test('unauthorized queue names are not disclosed; dashboard validation rejects unsafe settings',async()=>{
 const f=fake();
 const s=await createQueueService({redis:{host:'localhost'},queues:['allowed','secret'],administration:{authorize:async(_,queue)=>queue==='allowed'},dashboard},f);
 const base='https://example.test/_queue/admin';
 const list=await(await dispatch(s,base+'/api?kind=queues')).json();assert.deepEqual(list.queues.map(q=>q.name),['allowed']);
 const hidden=await dispatch(s,base+'/api?kind=jobs&queue=secret');assert.equal(hidden.status,403);
 await s.close();
 for(const bad of [{...dashboard,prefix:'//invalid'},{...dashboard,csrfToken:undefined},{...dashboard,verifyCsrf:undefined}]){
  await assert.rejects(createQueueService({redis:{host:'localhost'},queues:['q'],administration:{authorize:()=>true},dashboard:bad},f),/Invalid|requires/);
 }
});
