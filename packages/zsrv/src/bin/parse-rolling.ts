/** Dedicated CLI grammar. Options are always before `-- COMMAND`, never parsed
 * from the user's application arguments. */
export interface RollingRunArguments {
  name: string;
  ports: number[];
  command: string[];
  force: boolean;
  healthPath: string;
  readyTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  drainTimeoutMs?: number;
  verificationChecks?: number;
  verificationIntervalMs?: number;
}
function uint(value: string | undefined, name: string, min: number, max: number): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be ${min}–${max}`);
  return n;
}
export function parseRollingRunArguments(args: readonly string[]): RollingRunArguments {
  const result: RollingRunArguments = { name: '', ports: [], command: [], force: false, healthPath: '/health' };
  const seen = new Set<string>();
  let i = 0;
  for (; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--') { i++; break; }
    if (!flag.startsWith('--')) throw new Error('rolling run expects -- before the command');
    if (seen.has(flag)) throw new Error(`Repeated rolling option: ${flag}`);
    seen.add(flag);
    if (flag === '--force') { result.force = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    switch (flag) {
      case '--name':
        if (!/^[a-z0-9][a-z0-9._-]{0,100}$/.test(value) || value.includes('..')) throw new Error('Invalid application name');
        result.name = value; break;
      case '--ports':
        result.ports = value.split(',').map(port => uint(port, 'application port', 1, 65535));
        if (result.ports.length < 2 || result.ports.length > 16 || new Set(result.ports).size !== result.ports.length) throw new Error('Provide 2–16 distinct ports');
        break;
      case '--health-path':
        if (!value.startsWith('/') || value.startsWith('//') || value.length > 2048 || /[^\x21-\x7e]|#/.test(value)) throw new Error('Invalid health path');
        result.healthPath = value; break;
      case '--ready-timeout': result.readyTimeoutMs = uint(value, flag, 1, 300000); break;
      case '--shutdown-timeout': result.shutdownTimeoutMs = uint(value, flag, 1, 120000); break;
      case '--drain-timeout': result.drainTimeoutMs = uint(value, flag, 0, 300000); break;
      case '--verify-checks': result.verificationChecks = uint(value, flag, 1, 20); break;
      case '--verify-interval': result.verificationIntervalMs = uint(value, flag, 1, 30000); break;
      default: throw new Error(`Unknown rolling option: ${flag}`);
    }
  }
  result.command = args.slice(i);
  if (!result.name || result.ports.length < 2 || !result.command.length || !result.command[0]) {
    throw new Error('Usage: rolling run --name NAME --ports P1,P2 [OPTIONS] -- COMMAND [ARGS...]');
  }
  return result;
}
