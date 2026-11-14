import type { Suite, TestCase, TestFunction } from '../types/test.js';
/** Registries are isolated: createRunner() can run independent projects in one process. */
export class TestContext {
  /** Registry-owned suite records keyed by local identifiers; no cross-project sharing is implied. */
  readonly suites = new Map<number, Suite>();
  /** Ordered deferred trusted case callbacks retained until explicit clear. */
  readonly cases: TestCase[] = [];
  /** Synchronous suite declaration stack; async declaration callbacks are rejected. */
  private stack: number[] = [0];
  /** Monotonic local registration identifier reset only by explicit clear. */
  private nextId = 1;
  /** Initialize one independent root suite without executing test, hook or suite-body code.
   */
  constructor() {
    this.suites.set(0, {
      id: 0,
      parent: null,
      name: '',
      ancestors: [],
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: [],
      skip: false,
      only: false,
    });
  }
  /** Read the suite at the synchronous registration stack head.
   * @returns {Suite} Borrowed mutable internal suite; consumers must not mutate registry ownership during execution.
   */
  current(): Suite {
    return this.suites.get(this.stack[this.stack.length - 1] ?? 0)!;
  }
  /** Register one named suite by synchronously invoking an explicitly trusted declaration callback, then always restore the previous registration stack.
   * @param {string} name - Nonempty human-readable suite label; omit private values from public reports.
   * @param {() => void} fn - Trusted synchronous registration callback; returning a promise rejects.
   * @param {boolean} skip - Explicit inherited intentional-skip flag.
   * @param {boolean} only - Explicit inherited focused-selection flag.
   * @returns {void} Adds registrations; suite declaration is executable trusted test code, not inert imported JSON.
   */
  suite(name: string, fn: () => void, skip = false, only = false): void {
    if (typeof fn !== 'function' || !name.trim()) {
      throw new TypeError('Suite must have a name and a synchronous callback');
    }
    /** Current borrowed suite whose selection/ancestry is inherited during synchronous declaration. */
    const parent = this.current();
    /** Monotonic registry-local suite identifier, not a cross-run stable identity. */
    const id = this.nextId++;
    this.suites.set(id, {
      id,
      parent: parent.id,
      name,
      ancestors: [...parent.ancestors, parent.id],
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: [],
      skip: parent.skip || skip,
      only: parent.only || only,
    });
    this.stack.push(id);
    try {
      /** Trusted declaration result checked so asynchronous suite registration cannot outlive the stack scope. */
      const result: unknown = fn();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        throw new TypeError('describe callbacks must be synchronous');
      }
    } finally {
      this.stack.pop();
    }
  }
  /** Register one trusted callback with inherited suite selection and explicit per-case options; execution is deferred.
   * @param {string} name - Nonempty report label, excluding secrets and private traits.
   * @param {TestFunction} fn - Trusted test callback receiving one invocation-owned cleanup/cancellation context.
   * @param {boolean} skip - Explicit intentional skip for this case.
   * @param {boolean} only - Explicit focused selection for this case.
   * @param {{ timeoutMs?: number; retries?: number }} options - Trusted per-case runner overrides; runtime execution owns their enforcement.
   * @param {number | undefined} options.timeoutMs - Explicit positive observation deadline in milliseconds; this API retains its documented direct/CLI bounds.
   * @param {number | undefined} options.retries - Explicit finite whole-case retry setting; retries may replay trusted test callbacks.
   * @returns {void} Appends one ordered registration without executing the callback.
   */
  test(
    name: string,
    fn: TestFunction,
    skip = false,
    only = false,
    options: { timeoutMs?: number; retries?: number } = {}
  ): void {
    if (!name.trim() || typeof fn !== 'function') {
      throw new TypeError('Test must have a name and callback');
    }
    /** Current borrowed suite owning this deferred test registration. */
    const suite = this.current();
    /** Ordered nonempty suite labels copied into this case’s public report name. */
    const names = [...suite.ancestors, suite.id]
      .map((id) => this.suites.get(id)?.name)
      .filter(Boolean);
    this.cases.push({
      id: this.nextId++,
      name: [...names, name].join(' > '),
      fn,
      skip: suite.skip || skip,
      only: suite.only || only,
      suiteId: suite.id,
      ...options,
    });
  }
  /** Register an explicitly trusted hook on the current suite without running it.
   * @param {'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach'} kind - Fixed supported setup/teardown lifecycle slot.
   * @param {TestFunction} fn - Trusted hook receiving its own invocation-scoped cleanup context.
   * @returns {void} Adds one ordered hook; resources spanning hooks/tests need explicit host lifetime management.
   */
  hook(
    kind: 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach',
    fn: TestFunction
  ): void {
    if (typeof fn !== 'function') {
      throw new TypeError('Hook must be a function');
    }
    this.current()[kind].push(fn);
  }
  /** Reset this registry to a new root suite; this does not cancel callbacks already copied by an active run.
   * @returns {void} Removes case/suite registration state only.
   */
  clear(): void {
    this.cases.length = 0;
    this.suites.clear();
    this.stack = [0];
    this.nextId = 1;
    this.suites.set(0, {
      id: 0,
      parent: null,
      name: '',
      ancestors: [],
      beforeAll: [],
      afterAll: [],
      beforeEach: [],
      afterEach: [],
      skip: false,
      only: false,
    });
  }
}
