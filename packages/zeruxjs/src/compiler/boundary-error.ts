/** Private source paths/import chains are retained for trusted build diagnostics. */
export class ModuleBoundaryError extends Error {
  constructor(readonly code:string,readonly chain:readonly string[]){super(`${code}: ${chain.join(' -> ')}`);this.name='ModuleBoundaryError';}
}
