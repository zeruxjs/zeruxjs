/** Private source paths/import chains are retained for trusted build diagnostics. */
export class ModuleBoundaryError extends Error {
  /** Retain private build evidence for a server/client module boundary failure.
   * @param {string} code - Fixed diagnostic classification.
   * @param {readonly string[]} chain - Private source/import chain for trusted developer diagnostics.
   */
  constructor(
    readonly code: string,
    readonly chain: readonly string[]
  ) {
    super(`${code}: ${chain.join(' -> ')}`);
    this.name = 'ModuleBoundaryError';
  }
}
