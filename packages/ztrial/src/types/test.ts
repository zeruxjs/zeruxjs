export type TestFunction = () => unknown | Promise<unknown>;
export type HookFunction = TestFunction;
export interface TestCase { id: number; name: string; fn: TestFunction; skip: boolean; only: boolean; suiteId: number; timeoutMs?: number; retries?: number }
export interface Suite { id: number; parent: number | null; name: string; ancestors: number[]; beforeAll: HookFunction[]; afterAll: HookFunction[]; beforeEach: HookFunction[]; afterEach: HookFunction[]; skip: boolean; only: boolean }
export type TestStatus = 'passed'|'failed'|'skipped';
export interface TestResult { name: string; status: TestStatus; durationMs: number; error?: Error; attempts?: number }
export interface RunSummary { passed: number; failed: number; skipped: number; durationMs: number; results: TestResult[] }
export interface RunOptions { timeoutMs?: number; retries?: number; throwOnFailure?: boolean; match?: string | RegExp; bail?: boolean; forbidOnly?: boolean; onResult?: (result: TestResult) => void }
