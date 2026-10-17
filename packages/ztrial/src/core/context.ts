import type { Suite, TestCase, TestFunction } from '../types/test.js';
/** Registries are isolated: createRunner() can run independent projects in one process. */
export class TestContext {
  readonly suites = new Map<number, Suite>();
  readonly cases: TestCase[] = [];
  private stack: number[] = [0];
  private nextId = 1;
  constructor() { this.suites.set(0, { id: 0, parent: null, name: '', ancestors: [], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [], skip: false, only: false }); }
  current(): Suite { return this.suites.get(this.stack[this.stack.length - 1])!; }
  suite(name: string, fn: () => void, skip = false, only = false): void {
    if (typeof fn !== 'function' || !name.trim()) throw new TypeError('Suite must have a name and a synchronous callback');
    const parent = this.current(); const id = this.nextId++;
    this.suites.set(id, { id, parent: parent.id, name, ancestors: [...parent.ancestors, parent.id], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [], skip: parent.skip || skip, only: parent.only || only });
    this.stack.push(id);
    try { const result: unknown = fn(); if (result && typeof (result as Promise<unknown>).then === 'function') throw new TypeError('describe callbacks must be synchronous'); }
    finally { this.stack.pop(); }
  }
  test(name: string, fn: TestFunction, skip = false, only = false, options: {timeoutMs?:number; retries?:number} = {}): void {
    if (!name.trim() || typeof fn !== 'function') throw new TypeError('Test must have a name and callback');
    const suite = this.current(); const names = [...suite.ancestors, suite.id].map(id => this.suites.get(id)?.name).filter(Boolean);
    this.cases.push({ id: this.nextId++, name: [...names, name].join(' > '), fn, skip: suite.skip || skip, only: suite.only || only, suiteId: suite.id, ...options });
  }
  hook(kind: 'beforeAll'|'afterAll'|'beforeEach'|'afterEach', fn: TestFunction): void { if (typeof fn !== 'function') throw new TypeError('Hook must be a function'); this.current()[kind].push(fn); }
  clear(): void { this.cases.length = 0; this.suites.clear(); this.stack = [0]; this.nextId = 1; this.suites.set(0, { id: 0, parent: null, name:'', ancestors:[], beforeAll:[], afterAll:[], beforeEach:[], afterEach:[], skip:false, only:false }); }
}
