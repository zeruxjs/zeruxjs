import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campaignDeliveryCharts} from '../dist/index.js';
const snapshot={campaignId:'c01',complete:true,scanned:4,counts:{pending:0,claimed:0,sending:0,sent:2,suppressed:1,uncertain:1,rejected:0},days:[{day:'2026-10-14',sent:1,suppressed:1,uncertain:0,other:0},{day:'2026-10-13',sent:1,suppressed:0,uncertain:1,other:0}]};
test('campaign delivery charts preserve state categories, exactness and UTC day order',()=>{
 const result=campaignDeliveryCharts(snapshot);
 assert.equal(result.statuses.total,4);assert.equal(result.statuses.truncated,false);
 assert.deepEqual(result.sentByDay.labels,['2026-10-13','2026-10-14']);assert.deepEqual(result.sentByDay.values,[1,1]);
 assert.equal(campaignDeliveryCharts({...snapshot,complete:false}).statuses.truncated,true);
});
test('rejects corrupted summaries and inconsistent totals instead of displaying fabricated charts',()=>{
 assert.throws(()=>campaignDeliveryCharts({...snapshot,scanned:5}),/Invalid/);
 assert.throws(()=>campaignDeliveryCharts({...snapshot,days:[{...snapshot.days[0],sent:9},snapshot.days[1]]}),/mismatch/);
});
