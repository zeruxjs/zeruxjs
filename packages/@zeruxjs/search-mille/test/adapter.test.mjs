import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMilleSearchAdapter,createMilleSearchFactory} from '@zeruxjs/search-mille';
import {registerSearchService} from '@zeruxjs/search/adapters';
const hash=v=>createHash('sha256').update(v).digest('hex');
const call=(tenant='a')=>({tenant,signal:new AbortController().signal,deadline:Date.now()+5000});
const key=new Uint8Array(32).fill(7);
function fixture(overrides={}) {
 const requests=[];let state='enqueued',uid=10;
 const settings={searchableAttributes:['text'],filterableAttributes:['_zxTenant','category','price'],sortableAttributes:['id','price'],displayedAttributes:['_zxId','_zxTenant','id','text','category','price'],distinctAttribute:null,pagination:{maxTotalHits:10000}};
 const dispatch=async(method,input)=>{requests.push({method,...input});const path=input.path;
  if(path==='version')return {pkgVersion:'1.12.0'};
  if(path==='indexes/catalog')return {uid:'catalog',primaryKey:'_zxId'};
  if(path==='indexes/catalog/settings'&&method==='get')return structuredClone(settings);
  if(path.startsWith('tasks/'))return {uid:Number(path.split('/')[1]),indexUid:'catalog',status:state,error:{code:'invalid_document_id',message:'private token payload'},details:{receivedDocuments:2,indexedDocuments:1,private:'private recipient'}};
  if(path==='indexes/catalog/search')return {hits:[{_zxId:hash(JSON.stringify([hash('a'),'1'])),_zxTenant:hash('a'),id:'1',text:'boots',category:'books',price:10}],estimatedTotalHits:1};
  return {taskUid:uid++,indexUid:'catalog',status:'enqueued'};
 };
 const client={httpRequest:Object.fromEntries(['get','post','put','patch'].map(method=>[method,async input=>overrides[method]?overrides[method](input,dispatch):dispatch(method,input)])),close(){throw Error('Borrowed client must not close');}};
 return {requests,settings,client,options:{client,index:'catalog',fields:{category:'string',price:'number'},filterable:['category','price'],sortable:['id','price'],taskKey:key,taskScope:'fixture'},state(value){state=value;}};
}
test('accepted tasks are not completion; tenant-bound status/wait reports success/failure without private details',async()=>{
 const f=fixture(),a=await createMilleSearchAdapter(f.options);
 try {
  const receipt=await a.index([{id:'1',text:'boots'}],call());assert.equal(receipt.state,'accepted');assert.match(receipt.taskId,/^m1\.10\./);
  assert.equal((await a.taskStatus(receipt.taskId,call())).state,'enqueued');
  assert.throws(()=>a.taskStatus(receipt.taskId,call('other')),{code:'DENIED'});
  assert.throws(()=>a.taskStatus(receipt.taskId.replace('.10.','.11.'),call()),{code:'DENIED'});
  f.state('succeeded');assert.equal((await a.waitForTask(receipt.taskId,call())).state,'succeeded');
  f.state('failed');const failed=await a.waitForTask(receipt.taskId,call());assert.equal(failed.failureCode,'invalid_document_id');assert.equal(failed.indexedDocuments,1);assert(!JSON.stringify(failed).includes('private'));
  f.state('processing');await assert.rejects(a.waitForTask(receipt.taskId,call(),{maxPolls:2,intervalMs:10}),{code:'DEADLINE'});
 }finally{await a.close();}assert.equal(key[0],7);
 assert.throws(()=>a.taskStatus('forged',call()),{code:'CLOSED'});
});
test('literal structured filters are ANDed outside tenant scope; IDs and response fields are verified',async()=>{
 const f=fixture(),a=await createMilleSearchAdapter(f.options);
 try {
  const hostile='books" OR _zxTenant = "other';
  const page=await a.search({text:'literal q',filters:[{field:'category',operator:'eq',value:hostile,caseSensitive:false},{field:'price',operator:'gte',value:1}],sort:{field:'price',direction:'asc'}},call());
  const request=f.requests.find(r=>r.path.endsWith('/search'));
  assert.equal(request.body.filter[0],`_zxTenant = "${hash('a')}"`);assert.equal(request.body.filter[1],`category = ${JSON.stringify(hostile)}`);assert.deepEqual(request.body.sort,['price:asc','id:asc']);
  assert.equal(page.coverage,'partial');assert.equal(page.hits[0].document._zxTenant,undefined);
  await assert.rejects(a.search({text:'x'},call('other')),{code:'DENIED'});
  await a.index([{id:'same',text:'x'}],call());await a.delete(['same'],call('other'));
  const index=f.requests.find(r=>r.path.endsWith('/documents')),del=f.requests.find(r=>r.path.endsWith('/delete-batch'));
  assert.notEqual(index.body[0]._zxId,del.body[0]);
  await a.search({text:'',filters:[{field:'category',operator:'in',value:[],caseSensitive:false}]},call());
  assert.equal(f.requests.at(-1).body.filter[1],'_zxTenant = "impossible-non-hash-tenant"');
 }finally{await a.close();}
});
test('direct unsafe input, attributes, native DSL, oversized batches and mismatched settings reject before writes',async()=>{
 const f=fixture(),a=await createMilleSearchAdapter(f.options);
 try {
  for(const query of [{text:'x',filter:'_zxTenant = other'},{text:'x',filters:[{field:'_zxTenant',operator:'eq',value:'other'}]},{text:'x',filters:[{field:'category',operator:'eq',value:'books'}]},{text:'x',filters:[{field:'category',operator:'contains',value:'a'}]},{text:'x',offset:10000}])await assert.rejects(a.search(query,call()));
  await assert.rejects(a.index([{id:'1',text:'x',_zxTenant:'forged'}],call()));
  await assert.rejects(a.index(Array(101).fill({id:'1',text:'x'}),call()),{code:'LIMIT'});
  let getter=false;await assert.rejects(a.index([{id:'x',get text(){getter=true;return 'x'}}],call()));assert.equal(getter,false);
  assert(!f.requests.some(r=>r.path.endsWith('/documents')));
  f.settings.filterableAttributes=[];
  await assert.rejects(a.index([{id:'1',text:'x'}],call()),{code:'UNSUPPORTED'});
 }finally{await a.close();}
 await assert.rejects(createMilleSearchAdapter({...f.options,index:'*'}),{code:'INVALID'});
 assert.throws(()=>createMilleSearchFactory({index:'catalog',taskKey:'unsafe',taskScope:'fixture'}));
});
test('create/settings remain explicit tasks; unavailable engines and failed status are never replayed',async()=>{
 const f=fixture(),a=await createMilleSearchAdapter(f.options);
 try {
  assert.equal((await a.createIndex(call())).state,'accepted');assert.equal((await a.configureIndex(call())).state,'accepted');
  const setup=f.requests.find(r=>r.method==='patch');assert.deepEqual(setup.body.filterableAttributes,['_zxTenant','category','price']);
 }finally{await a.close();}
 let sends=0;const g=fixture({post:async(input)=>{sends++;throw Error('credential private body');}}),b=await createMilleSearchAdapter(g.options);
 try{await assert.rejects(b.index([{id:'1',text:'x'}],call()),e=>e.code==='UNAVAILABLE'&&e.outcome==='unknown'&&!e.message.includes('private'));assert.equal(sends,1);}finally{await b.close();}
 await assert.rejects(createMilleSearchAdapter(fixture({get:async()=>{throw Error('engine down')}}).options),{code:'UNAVAILABLE'});
});
test('cancelled native work retains capacity and close drains without closing borrowed SDK',async()=>{
 let finish,signal;const f=fixture({post:async(input,dispatch)=>{if(!input.path.endsWith('/search'))return dispatch('post',input);signal=input.extraRequestInit.signal;return new Promise(r=>finish=r);}}),a=await createMilleSearchAdapter({...f.options,maxPending:1});
 const ctrl=new AbortController(),work=a.search({text:'x'},{...call(),signal:ctrl.signal});
 await new Promise(r=>setImmediate(r));ctrl.abort();assert(signal.aborted);
 await assert.rejects(a.health(call()),{code:'LIMIT'});
 let closed=false;const closing=a.close().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false);
 finish({hits:[],estimatedTotalHits:0});await assert.rejects(work,{code:'CANCELLED'});await closing;
});
test('shared manager registration keeps authentication mandatory and adapter version checks fail closed',async()=>{
 const f=fixture();const r=registerSearchService({factories:{mille:()=>createMilleSearchAdapter(f.options)},connections:[{name:'catalog',backend:'mille',requirePersistent:true}],authorize:context=>context==='verified'?{tenant:'a'}:null});
 const manager=await r.start();try{assert.equal((await manager.search('catalog','verified',{text:'x'})).hits.length,1);await assert.rejects(manager.search('catalog','forged',{text:'x'}),{code:'DENIED'});}finally{await manager.close();}
 await assert.rejects(createMilleSearchAdapter(fixture({get:async()=>({pkgVersion:'2.0.0'})}).options),{code:'UNSUPPORTED'});
});

test('stable references survive wrapper replacement but reject a different engine scope',async()=>{
 const f=fixture(),a=await createMilleSearchAdapter(f.options);
 const receipt=await a.index([{id:'1',text:'x'}],call());await a.close();
 const b=await createMilleSearchAdapter(f.options);
 try{assert.equal((await b.taskStatus(receipt.taskId,call())).state,'enqueued');}finally{await b.close();}
 const c=await createMilleSearchAdapter({...f.options,taskScope:'different-engine'});
 try{assert.throws(()=>c.taskStatus(receipt.taskId,call()),{code:'DENIED'});}finally{await c.close();}
});
