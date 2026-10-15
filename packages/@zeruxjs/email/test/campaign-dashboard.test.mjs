import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCampaignPlanner,createMemoryCampaignStore,createCampaignDashboard} from '../dist/index.js';
const store=createMemoryCampaignStore(),planner=createCampaignPlanner({store,source:{page:async()=>({contacts:[],done:true,nextCursor:null})},isSubscribed:async()=>true,isSuppressed:async()=>false,ensureMessage:async()=>{},enqueue:async()=>{},now:()=>1000});
const prefix='https://app.example.test/_email/campaigns';
const csrf='1234567890abcdefghijklmnopqrstuvwxyz';
function dash(auth=true){return createCampaignDashboard({planner,authorize:async()=>auth?{id:'admin'}:null,verifyCsrf:async(req)=>req.headers.get('x-csrf-token')===csrf,csrfToken:async()=>csrf,authorizeCampaign:async(principal,id)=>principal?.id==='admin'&&id!=='restricted'});}
const req=(path,method='GET',body,headers={})=>new Request(prefix+path,{method,headers:body?{'content-type':'application/json','origin':'https://app.example.test','x-csrf-token':csrf,...headers}:headers,body:body?JSON.stringify(body):undefined});
test('dashboard requires host auth and CSRF; never exposes recipient identities, IDs, or lease tokens',async()=>{
 assert.equal((await dash(false).handle(req(''))).status,403);
 const d=dash();assert.equal((await d.handle(req(''))).status,200);
 assert.equal((await d.handle(req('/api','POST',{action:'create',id:'campa',name:'Welcome',sendAt:1000}, {'x-csrf-token':'wrong'}))).status,403);
 assert.equal((await d.handle(req('/api','POST',{action:'create',id:'campa',name:'Welcome',sendAt:1000}, {'origin':'https://other.example.test'}))).status,403);
 assert.equal((await d.handle(req('/api','POST',{action:'create',id:'campa',name:'Welcome',sendAt:1000}))).status,201);
 assert.equal((await d.handle(req('/api','POST',{action:'schedule',id:'campa'}))).status,200);
 const result=await (await d.handle(req('/api?id=campa'))).json();
 assert.equal(result.status,'scheduled');
 for(const key of ['lease','pending','cursor','tracking'])assert.equal(Object.hasOwn(result,key),false);
 assert.equal((await d.handle(req('/api?id=../../sneaky'))).status,400);
 assert.equal((await d.handle(req('/api?id=restricted'))).status,403);
});
