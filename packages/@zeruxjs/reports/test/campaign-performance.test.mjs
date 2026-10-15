import {test} from 'node:test';import assert from 'node:assert/strict';
import {campaignPerformanceCharts} from '../dist/index.js';
const summary={campaignId:'camp',mode:'database',complete:true,total:100_012,counts:{pending:0,claimed:0,sending:0,sent:100_010,suppressed:1,uncertain:1,rejected:0},smtpAcceptedPercent:99,dailyCoverage:'not-computed',activityCoverage:'not-computed',provider:{coverage:'reported-events-only',events:3,counts:{delivered:2,deferred:0,'hard-bounce':1,'soft-bounce':0,complaint:0}}};
test('native campaign chart shows exact states and reported-only provider notifications',()=>{
 const charts=campaignPerformanceCharts(summary);
 assert.equal(charts.statuses.total,100_012);assert.equal(charts.statuses.queryMode,'database');assert.equal(charts.statuses.truncated,false);
 assert.equal(charts.providerOutcomes.total,3);assert.deepEqual(charts.providerOutcomes.labels,['delivered','deferred','hard-bounce','soft-bounce','complaint']);
 assert.equal(campaignPerformanceCharts({...summary,provider:null}).providerOutcomes,null);
});
test('corrupt totals and provider events are rejected rather than charted',()=>{
 assert.throws(()=>campaignPerformanceCharts({...summary,total:5}),/Invalid/);
 assert.throws(()=>campaignPerformanceCharts({...summary,provider:{...summary.provider,events:4}}),/Invalid/);
});
