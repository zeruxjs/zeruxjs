import {test} from 'node:test';import assert from 'node:assert/strict';
import {campaignDailyTrendsCharts} from '../dist/index.js';
const empty=()=>({pending:0,claimed:0,sending:0,sent:0,suppressed:0,uncertain:0,rejected:0});
const report={campaignId:'fall',from:'2026-10-10',to:'2026-10-11',mode:'database',complete:true,deliveryCoverage:'last-state-update-day',providerCoverage:'reported-events-only',snapshotConsistent:false,total:4,providerEvents:2,days:[
 {day:'2026-10-10',total:3,counts:{...empty(),sent:3},providerEvents:1,provider:{delivered:1,deferred:0,'hard-bounce':0,'soft-bounce':0,complaint:0}},
 {day:'2026-10-11',total:1,counts:{...empty(),suppressed:1},providerEvents:1,provider:{delivered:0,deferred:0,'hard-bounce':0,'soft-bounce':0,complaint:1}}
]};
test('native daily charts label persisted current states and provider notifications distinctly',()=>{
 const result=campaignDailyTrendsCharts(report);
 assert.deepEqual(result.smtpSentByDay.values,[3,0]);assert.equal(result.smtpSentByDay.queryMode,'database');
 assert.deepEqual(result.providerDeliveredByDay.values,[1,0]);assert.match(result.smtpSentByDay.title,/last update/);
 assert.equal(campaignDailyTrendsCharts({...report,providerCoverage:'not-configured',providerEvents:null,days:report.days.map(d=>({...d,provider:null,providerEvents:null}))}).providerDeliveredByDay,null);
});
test('charting fails closed for corrupted timeline or provider totals',()=>{
 assert.throws(()=>campaignDailyTrendsCharts({...report,total:5}),/Invalid|Inconsistent/);
 assert.throws(()=>campaignDailyTrendsCharts({...report,days:[report.days[1],report.days[0]]}),/Invalid/);
 assert.throws(()=>campaignDailyTrendsCharts({...report,providerEvents:3}),/Invalid|Inconsistent/);
});
