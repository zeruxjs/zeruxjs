import type {RunSummary} from '../types/test.js';
export function formatSummary(summary:RunSummary, reporter:'pretty'|'json'|'tap' = 'pretty') {
  if(reporter==='json') return JSON.stringify(summary,(_key,value)=>value instanceof Error ? {name:value.name,message:value.message,stack:value.stack} : value,2);
  if(reporter==='tap') return ['TAP version 13',...summary.results.map((r,i)=>`${r.status==='failed'?'not ok':'ok'} ${i+1} - ${r.name.replace(/[\r\n]/g,' ')}${r.status==='skipped'?' # SKIP':''}`),`1..${summary.results.length}`].join('\n');
  return [...summary.results.map(r=>`${r.status==='passed'?'✓':r.status==='skipped'?'○':'✗'} ${r.name} (${r.durationMs}ms)${r.error?`\n  ${r.error.message}`:''}`),`\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.durationMs}ms)`].join('\n');
}
