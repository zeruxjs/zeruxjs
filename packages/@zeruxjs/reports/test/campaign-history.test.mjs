import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campaignTransitionHistoryCharts} from '../dist/index.js';
test('immutable transition history chart adapter distinguishes observed transitions from current states',()=>{
 const labels=['pending','claimed','sending','sent','suppressed','uncertain','rejected'];
 const counts=Object.fromEntries(labels.map(label=>[label,0]));counts.sent=5;counts.uncertain=2;
 const report={campaignId:'camp1',from:'2026-10-01',to:'2026-10-01',coverage:'recorded-transitions-only',snapshotConsistent:false,
   days:[{day:'2026-10-01',counts,total:7}]};
 const {sentTransitions,uncertainTransitions}=campaignTransitionHistoryCharts(report);
 assert.deepEqual(sentTransitions.values,[5]);assert.deepEqual(uncertainTransitions.values,[2]);
 assert.match(sentTransitions.title,/Observed/);
 assert.throws(()=>campaignTransitionHistoryCharts({...report,days:[{...report.days[0],total:8}]}),/Invalid/);
 assert.throws(()=>campaignTransitionHistoryCharts({...report,coverage:'complete'}),/Invalid/);
});
