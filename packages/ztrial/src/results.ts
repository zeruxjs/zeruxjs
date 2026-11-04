import type { CoverageRecord } from './coverage.js';
import type { RunSummary, TestResult } from './types/test.js';
/** An unavailable optional environment is neither an assertion failure nor a skip. */
export class EnvironmentUnavailableError extends Error {
  constructor(readonly environment: string, cause?: unknown) {super(`Test environment unavailable: ${environment}`,{cause});this.name='EnvironmentUnavailableError';}
}
export class IntentionalSkipError extends Error {
  constructor(reason='Intentional skip'){super(reason);this.name='IntentionalSkipError';}
}
export function skipTest(reason?:string):never {if(reason!==undefined&&(typeof reason!=='string'||reason.length>2048))throw new TypeError('Invalid skip reason');throw new IntentionalSkipError(reason);}
export function failureStatus(error:unknown):TestResult['status'] {return error instanceof EnvironmentUnavailableError?'environment-unavailable':error instanceof IntentionalSkipError?'skipped':'failed';}
export interface NormalizedResultRecord {
  version:1;name:string;environment:'node'|'browser';status:TestResult['status'];durationMs:number;reason?:string;
  error?:{name:string;message:string};coverageStatus:'not-collected'|'reported'|'no-sources';
  coverage:readonly CoverageRecord[];artifacts:NonNullable<TestResult['artifacts']>;
}
/** Portable record without stacks/causes; artifact/source labels remain caller-controlled. */
export function normalizeResults(summary:RunSummary,environment:'node'|'browser'='node'):NormalizedResultRecord[] {
  return summary.results.map(result=>({version:1 as const,name:result.name,environment:result.environment??environment,status:result.status,durationMs:result.durationMs,reason:result.reason??(result.status==='skipped'?'intentional-or-filtered':undefined),...(result.error&&{error:{name:result.error.name,message:result.error.message}}),coverageStatus:result.coverage===undefined?'not-collected':result.coverage.length?'reported':'no-sources',coverage:result.coverage??[],artifacts:result.artifacts??[]}));
}
