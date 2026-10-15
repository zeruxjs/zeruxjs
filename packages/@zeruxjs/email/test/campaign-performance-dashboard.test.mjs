import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCampaignPlanner,createMemoryCampaignStore,createCampaignDashboard} from '../dist/index.js';
const planner=()=>createCampaignPlanner({store:createMemoryCampaignStore(),source:{page:async()=>({contacts:[],nextCursor:null,done:true})},isSubscribed:async()=>true,isSuppressed:async()=>false,ensureMessage:async()=>{},enqueue:async()=>{},now:()=>1000});
const performance={campaignId:'camp58',mode:'database',complete:true,total:101001,counts:{pending:0,claimed:0,sending:0,sent:101000,suppressed:0,uncertain:1,rejected:0},smtpAcceptedPercent:100*101000/101001,dailyCoverage:'not-computed',activityCoverage:'not-computed',provider:{events:2,coverage:'reported-events-only',counts:{delivered:1,deferred:0,'hard-bounce':1,'soft-bounce':0,complaint:0}}};
const req=id=>new Request(`https://app.example.test/_email/campaigns/api?id=${id}&view=performance`);
const configure=async()=>{const p=planner();await p.create({id:'camp58',name:'Campaign',sendAt:1000});return {planner:p,authorize:async()=>({id:'admin'}),authorizeCampaign:async(_,id)=>id==='camp58',verifyCsrf:async()=>true,csrfToken:async()=> 'csrf-long-very-secret-12345678'};};
test('performance dashboard only serves authorized, PII-free summaries',async()=>{
 const options=await configure();
 const app=createCampaignDashboard({...options,performanceReport:async()=>({...performance,recipient:'hidden@example.test',provider:{...performance.provider,secret:'private-secret',messageId:'mail-1'},secret:'top-secret'})});
 const res=await app.handle(req('camp58'));assert.equal(res.status,200);
 const text=await res.text();assert.equal(text.includes('hidden@example.test'),false);assert.equal(text.includes('secret'),false);
 const body=JSON.parse(text);assert.equal(body.total,101001);assert.equal(body.provider.counts.delivered,1);
 assert.equal((await app.handle(req('other'))).status,403);
 assert.equal((await createCampaignDashboard({...options,authorize:async()=>null,performanceReport:async()=>performance}).handle(req('camp58'))).status,403);
});
test('performance endpoint rejects broken totals and fails closed when unconfigured',async()=>{
 const options=await configure();
 assert.equal((await createCampaignDashboard(options).handle(req('camp58'))).status,404);
 const invalid=createCampaignDashboard({...options,performanceReport:async()=>({...performance,total:11})});
 assert.equal((await invalid.handle(req('camp58'))).status,503);
});
