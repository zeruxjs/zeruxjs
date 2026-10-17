import { TestContext } from './context.js';
import type { TestCase, TestFunction, TestResult, RunSummary, RunOptions, Suite } from '../types/test.js';
function errorOf(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
export async function withTimeout(fn: TestFunction, timeoutMs: number, name: string): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(fn), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Test timeout: ${name}`)), timeoutMs); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function executeTests(context: TestContext, options: RunOptions = {}): Promise<RunSummary> {
  const begin = Date.now(); const results: TestResult[] = [];
  const tests = [...context.cases]; const hasOnly = tests.some(test => test.only && !test.skip);
  if(hasOnly && options.forbidOnly)throw new Error('Focused tests are forbidden by configuration');
  const ancestors = (test: TestCase): Suite[] => [...context.suites.get(test.suiteId)!.ancestors, test.suiteId].map(id => context.suites.get(id)!);
  const eligible = (test: TestCase) => !test.skip && (!hasOnly || test.only) && (options.match === undefined || (typeof options.match === 'string' ? test.name.includes(options.match) : new RegExp(options.match.source, options.match.flags.replace('g','').replace('y','')).test(test.name)));
  const selected = tests.filter(eligible);
  const suiteCount = new Map<number, number>(); for (const t of selected) for (const suite of ancestors(t)) suiteCount.set(suite.id, (suiteCount.get(suite.id) || 0) + 1);
  const started = new Set<number>(); const closed = new Set<number>(); const finished = new Map<number, number>(); const suiteErrors = new Map<number, Error>();
  const timeout = options.timeoutMs ?? 5000; const retries = options.retries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100) throw new RangeError('Invalid retries');
  let bailed = false;
  for (const item of tests) {
    if (bailed || !eligible(item)) { const result: TestResult = {name: item.name, status:'skipped', durationMs:0}; results.push(result); options.onResult?.(result); continue; }
    const chain = ancestors(item); const start = Date.now(); let failure: Error | undefined; let attempts = 0;
    for (const suite of chain) {
      if (started.has(suite.id)) continue;
      started.add(suite.id);
      try { for (const hook of suite.beforeAll) await withTimeout(hook, timeout, 'beforeAll'); }
      catch (e) { suiteErrors.set(suite.id, errorOf(e)); }
    }
    const setupError = chain.map(s => suiteErrors.get(s.id)).find(Boolean);
    if (setupError) failure = setupError;
    else {
      const total = (item.retries ?? retries) + 1;
      for (let run = 0; run < total; run++) {
        attempts++;
        failure = undefined;
        const active: Suite[] = [];
        try {
          for (const suite of chain) { active.push(suite); for (const hook of suite.beforeEach) await withTimeout(hook, timeout, 'beforeEach'); }
          await withTimeout(item.fn, item.timeoutMs ?? timeout, item.name);
        } catch (e) { failure = errorOf(e); }
        finally {
          for (const suite of active.reverse()) for (const hook of suite.afterEach) {
            try { await withTimeout(hook, timeout, 'afterEach'); } catch (e) { failure ??= errorOf(e); }
          }
        }
        if (!failure) break;
      }
    }
    for (const suite of [...chain].reverse()) {
      const done = (finished.get(suite.id) ?? 0) + 1; finished.set(suite.id, done);
      if (done === suiteCount.get(suite.id)) { closed.add(suite.id); for (const hook of suite.afterAll) {
        try { await withTimeout(hook, timeout, 'afterAll'); } catch (e) { failure ??= errorOf(e); }
      }}
    }
    const result: TestResult = {name:item.name,status:failure ? 'failed':'passed',durationMs:Date.now()-start,attempts,...(failure ? { error: failure } : {})};
    results.push(result); options.onResult?.(result);
    if(options.bail && failure)bailed = true;
  }
  // On bail, the normal per-suite last-test path is never reached for some
  // already-started suites. Always run their afterAll hooks for resource cleanup.
  for (const suite of [...started].map(id=>context.suites.get(id)!).sort((a,b)=>b.ancestors.length-a.ancestors.length)) {
    if (closed.has(suite.id)) continue;
    for (const hook of suite.afterAll) {
      try { await withTimeout(hook,timeout,'afterAll'); }
      catch (error) {
        const result: TestResult={name:`afterAll: ${suite.name}`,status:'failed',durationMs:0,error:errorOf(error)};
        results.push(result); options.onResult?.(result);
      }
    }
  }
  const summary: RunSummary = {passed:results.filter(r=>r.status==='passed').length, failed:results.filter(r=>r.status==='failed').length, skipped:results.filter(r=>r.status==='skipped').length,durationMs:Date.now()-begin,results};
  if (options.throwOnFailure && summary.failed) throw new AggregateError(results.flatMap(r=>r.error ? [r.error] : []), `${summary.failed} tests failed`);
  return summary;
}
