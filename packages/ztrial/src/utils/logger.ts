import {createResultReport,type ReportOptions} from '../reports/schema.js';
import type {RunSummary} from '../types/test.js';
export function formatSummary(summary:RunSummary, reporter:'pretty'|'json'|'tap' = 'pretty',options:ReportOptions={}) {
  const report=createResultReport(summary,options);
  if(reporter==='json') return JSON.stringify(report,null,2);
  if(reporter==='tap') return ['TAP version 13',...report.results.map((r,i)=>`${r.status==='failed'||r.status==='environment-unavailable'?'not ok':'ok'} ${i+1} - ${r.name.replace(/[\r\n]/g,' ')}${r.status==='skipped'?' # SKIP':r.status==='environment-unavailable'?' # environment-unavailable':''}`),`1..${report.results.length}`].join('\n');
  return [...report.results.map(r=>`${r.status==='passed'?'✓':r.status==='skipped'?'○':'✗'} ${r.name} (${r.durationMs}ms)${r.error?`\n  ${r.error.message}`:''}`),`\n${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped, ${report.unavailable??0} unavailable (${report.durationMs}ms)`].join('\n');
}
