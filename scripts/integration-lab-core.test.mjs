import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseLabArgs,suitesFor,suiteReadiness,parseTapSummary,testResult,overallStatus,safeReportPath,labSuites} from './integration-lab-core.mjs';

test('suite plan selects only requested packages and validates allowed flags',()=>{
 assert.equal(suitesFor(parseLabArgs(['--only=sqlite'])).length,1);
 assert.equal(suitesFor(parseLabArgs(['--live'])).every(s=>s.kind==='live'),true);
 assert.equal(suitesFor(parseLabArgs([])).every(s=>s.kind==='offline'),true);
 assert.equal(new Set(labSuites.map(s=>s.id)).size,labSuites.length);
 assert.throws(()=>parseLabArgs(['--verbose']),/Invalid lab option/);
 assert.throws(()=>parseLabArgs(['--only=unknown']),/Unknown suite/);
 assert.throws(()=>parseLabArgs(['--only=source','--require=smtp']),/Required suite/);
 assert.throws(()=>parseLabArgs(['--report=']),/Invalid report/);
});
test('live suite requires explicit consent and credential key presence without saving values',()=>{
 const smtp=labSuites.find(s=>s.id==='smtp');
 assert.equal(suiteReadiness(smtp,{}).ready,false);
 assert.equal(suiteReadiness(smtp,{ZERUX_TEST_LIVE_SMTP:'true',ZERUX_TEST_SMTP_HOST:'127.0.0.1',ZERUX_TEST_SMTP_USER:'lab',ZERUX_TEST_SMTP_PASSWORD:'do-not-log'}).ready,false);
 assert.equal(suiteReadiness(smtp,{ZERUX_TEST_LIVE_SMTP:'1',ZERUX_TEST_SMTP_HOST:'127.0.0.1',ZERUX_TEST_SMTP_USER:'lab',ZERUX_TEST_SMTP_PASSWORD:'do-not-log'}).ready,true);
});
test('zero-pass TAP, malformed output and failed child exit cannot certify a suite',()=>{
 const good=parseTapSummary('TAP version 13\n# tests 4\n# pass 3\n# fail 0\n# skipped 1\n');
 assert.deepEqual(good,{tests:4,passed:3,failed:0,skipped:1});
 assert.equal(testResult(0,good),'passed');
 assert.equal(testResult(0,parseTapSummary('# tests 2\n# pass 0\n# fail 0\n# skipped 2\n')),'failed');
 assert.equal(testResult(0,null),'failed');
 assert.equal(testResult(1,good),'failed');
});
test('requirements prevent skipped certified claims',()=>{
 const rows=[{id:'source',status:'passed'},{id:'pg',status:'skipped'}];
 assert.equal(overallStatus(rows,[]),'partial');
 assert.equal(overallStatus(rows,['pg']),'failed');
 assert.equal(overallStatus([{id:'source',status:'passed'}],['source']),'passed');
 assert.equal(overallStatus([{id:'source',status:'blocked'}],[]),'incomplete');
 assert.equal(overallStatus([],[]),'failed');
});
test('relative and absolute evidence reports must remain in workspace',t=>{
 const root=mkdtempSync(join(tmpdir(),'lab-report-safe-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 assert.equal(safeReportPath(root,'evidence/report.json'),join(root,'evidence','report.json'));
 assert.throws(()=>safeReportPath(root,'../outside.json'),/escapes workspace/);
 assert.throws(()=>safeReportPath(root,'.'),/escapes workspace/);
 assert.throws(()=>safeReportPath(root,'/tmp/absolute-outside.json'),/escapes workspace/);
});
test('evidence report paths reject symlinked parent and symlinked report leaf',t=>{
 const root=mkdtempSync(join(tmpdir(),'lab-report-security-'));
 const outside=mkdtempSync(join(tmpdir(),'lab-report-outside-'));
 t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});});
 mkdirSync(join(root,'reports')); symlinkSync(outside,join(root,'linked'));
 assert.throws(()=>safeReportPath(root,'linked/report.json'),/symlink|escapes workspace/);
 symlinkSync(join(outside,'not-yet-created'),join(root,'dangling'));
 assert.throws(()=>safeReportPath(root,'dangling/report.json'),/symlink/);
 writeFileSync(join(outside,'report.json'),'existing');
 symlinkSync(join(outside,'report.json'),join(root,'reports','report.json'));
 assert.throws(()=>safeReportPath(root,'reports/report.json'),/symlink/);
 assert.equal(safeReportPath(root,'reports/nested/new.json'),join(root,'reports','nested','new.json'));
});
