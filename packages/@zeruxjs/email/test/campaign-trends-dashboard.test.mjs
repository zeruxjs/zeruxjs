import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCampaignPlanner,createMemoryCampaignStore,createCampaignDashboard} from '../dist/index.js';
async function setup(){const planner=createCampaignPlanner({store:createMemoryCampaignStore(),source:{page:async()=>({contacts:[],nextCursor:null,done:true})},isSubscribed:async()=>true,isSuppressed:async()=>false,ensureMessage:async()=>{},enqueue:async()=>{},now:()=>1000});await planner.create({id:'fall',name:'Fall',sendAt:1000});return {planner,authorize:async()=>({id:'admin'}),authorizeCampaign:async(_,id)=>id==='fall',csrfToken:async()=> 'token-not-short-123456',verifyCsrf:async()=>true};}
const req=(id='fall',from='2026-10-10',to='2026-10-11')=>new Request(`https://app.example.test/_email/campaigns/api?id=${id}&view=trends&from=${from}&to=${to}`);
const empty={pending:0,claimed:0,sending:0,sent:1,suppressed:0,uncertain:0,rejected:0};
const trend={campaignId:'fall',from:'2026-10-10',to:'2026-10-11',mode:'database',complete:true,deliveryCoverage:'last-state-update-day',providerCoverage:'not-configured',snapshotConsistent:false,total:1,providerEvents:null,days:[{day:'2026-10-10',counts:empty,total:1,provider:null,providerEvents:null}]};
test('trends endpoint protects campaign and excludes PII even when callback returns secret fields',async()=>{
 const base=await setup();const dashboard=createCampaignDashboard({...base,trendsReport:async()=>({...trend,recipient:'secret@example.test',days:trend.days.map(d=>({...d,messageId:'secret-mail'}))})});
 const response=await dashboard.handle(req());assert.equal(response.status,200);
 const serialized=await response.text();assert.equal(serialized.includes('secret'),false);assert.equal(JSON.parse(serialized).days[0].counts.sent,1);
 assert.equal((await dashboard.handle(req('other'))).status,403);
 assert.equal((await dashboard.handle(req('fall','invalid'))).status,400);
 assert.equal((await createCampaignDashboard({...base,authorize:async()=>null,trendsReport:async()=>trend}).handle(req())).status,403);
});
test('invalid callback output and unavailable trends fail closed',async()=>{
 const base=await setup();
 assert.equal((await createCampaignDashboard(base).handle(req())).status,404);
 const bad=createCampaignDashboard({...base,trendsReport:async()=>({...trend,total:4})});
 assert.equal((await bad.handle(req())).status,503);
});
