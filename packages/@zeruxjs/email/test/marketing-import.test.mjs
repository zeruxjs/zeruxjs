import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createMarketingCampaignService,importMarketingRecipients,parseMarketingRecipientCSV} from '../dist/index.js';
const require=createRequire(import.meta.url),{createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
async function setup(){const connector=await createConnector({filename:':memory:',driver:'node'});
 const db=Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,args=>connector.execute({op,...args},ctx)]));
 return {db,close:()=>connector.disconnect()};}
const delivery=()=>{const state=new Map();return {async create(v){if(state.has(v.id))return false;state.set(v.id,v);return true;},async load(id){return state.get(id)??null;}};};
test('large streamed CSV import is bounded, replay-safe, and enqueues only message IDs',async()=>{
 const {db,close}=await setup();try{
  const jobs=[],service=createMarketingCampaignService({db,delivery:delivery(),queue:{async add(name,data,options){jobs.push({name,data,options});}},now:()=>1000});
  const campaign=await service.create({name:'Bulk',subject:'Hello {{name}}',text:'{{name}} {{offer}}',account:'smtp',
    recipients:['seed@example.com'],autoEnqueue:false});
  const csv='email,name,data.offer\r\n'+Array.from({length:457},(_,i)=>`contact${i}@example.org,Person${i},OFFER-${i}\r\n`).join('');
  async function* chunks(){for(let i=0;i<csv.length;i+=7)yield Buffer.from(csv.slice(i,i+7));}
  const progress=[];
  const result=await importMarketingRecipients(service,campaign,parseMarketingRecipientCSV(chunks()),{
    batchSize:90,onProgress:value=>progress.push(value),enqueueAfter:true});
  assert.equal(result.added,457);assert.equal(result.queued,458);assert.equal(progress.length,6);
  assert.equal(jobs.length,458);
  assert.ok(jobs.every(j=>Object.keys(j.data).join(',')==='messageId'));
  const second=await importMarketingRecipients(service,campaign,parseMarketingRecipientCSV(csv),{batchSize:100});
  assert.equal(second.existing,457);assert.equal(second.added,0);
  const overview=await service.overview(campaign);
  assert.equal(overview.recipientCount,458);assert.equal(overview.enqueued,458);
  assert.equal(overview.storedCountMatches,true);
  const previews=await service.previewPage(campaign,{limit:3});assert.equal(previews.items.length,3);
  assert.equal(previews.done,false);
  assert.ok(previews.items.every(v=>!('data' in v)));
 }finally{await close();}
});
test('CSV parser handles escaped quotes, JSON, empty cells, malformed and oversized data',async()=>{
 const csv='email,name,data,data.tier\r\na@example.com,"Sam ""The Ace""","{""level"":2}",pro\r\n';
 const values=[];for await(const v of parseMarketingRecipientCSV(csv))values.push(v);
 assert.equal(values[0].name,'Sam "The Ace"');assert.deepEqual(values[0].data,{level:2,tier:'pro'});
 const read=async source=>{for await(const _row of parseMarketingRecipientCSV(source)){};};
 await assert.rejects(read('email,name\na@example.com,"unterminated'),/Unterminated/);
 await assert.rejects(read('email,data.__proto__\na@example.com,bad'),/safe names|Unsafe/);
 await assert.rejects(read('email,email\na@example.com,b@example.com'),/safe names/);
 await assert.rejects(read('email,name\na@example.com,Sam,extra'),/header/);
 await assert.rejects((async()=>{for await(const _ of parseMarketingRecipientCSV('email\na@example.com\nb@example.com',{maxRows:1})){};})(),/limit/);
});
