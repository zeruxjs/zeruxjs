/** Dedicated CLI grammar. Options are always before `-- COMMAND`, never parsed
 * from the user's application arguments. */
export interface RollingRunArguments {
  /** Validated application name; this identifier does not authorize process management. */
  name: string;
  /** Distinct validated application ports, including required spare capacity. */
  ports: number[];
  /** Trusted operator command and arguments preserved verbatim, never interpreted by a shell here. */
  command: string[];
  /** Explicit operator request to replace an existing route reservation. */
  force: boolean;
  /** Validated relative HTTP health endpoint; never an arbitrary remote URL. */
  healthPath: string;
  /** Maximum readiness wait in milliseconds. */
  readyTimeoutMs?: number;
  /** Graceful child shutdown deadline in milliseconds. */
  shutdownTimeoutMs?: number;
  /** Maximum connection-drain wait in milliseconds; not forced JavaScript cancellation. */
  drainTimeoutMs?: number;
  /** Successful readiness observations required before replacing the routed generation. */
  preCutoverChecks?: number;
  /** Post-cutover health observations required before retiring the previous generation. */
  verificationChecks?: number;
  /** Delay between post-cutover verification probes in milliseconds. */
  verificationIntervalMs?: number;
}
/** Parse a complete decimal integer token within this option’s explicit bounds.
 * @param {string | undefined} value - Optional decimal argument token; missing values reject.
 * @param {string} name - Option label used in validation errors.
 * @param {number} min - Inclusive permitted lower bound.
 * @param {number} max - Inclusive permitted upper bound.
 * @returns {number} Validated safe integer; malformed or out-of-range input throws.
 */
function uint(
  value: string | undefined,
  name: string,
  min: number,
  max: number
): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer`);
  }
  /** Safe integer candidate validated before it enters runtime policy. */
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be ${min}–${max}`);
  }
  return n;
}
/** Parse the rolling command into validated configuration without starting children, listeners or checkpoint writers.
 * @param {readonly string[]} args - Trusted CLI tokens; child arguments remain unchanged after the command boundary.
 * @returns {RollingRunArguments} Validated supervisor options and the untouched child command.
 */
export function parseRollingRunArguments(
  args: readonly string[]
): RollingRunArguments {
  /** Candidate supervisor options; returned only after cross-option validation. */
  const result: RollingRunArguments = {
    name: '',
    ports: [],
    command: [],
    force: false,
    healthPath: '/health',
  };
  /** Consumed flags, preventing repeated options from silently overriding policy. */
  const seen = new Set<string>();
  let i = 0;
  for (; i < args.length; i++) {
    /** Argument proven present by the loop bounds before consuming a following value. */
    const flag = args[i]!;
    if (flag === '--') {
      i++;
      break;
    }
    if (!flag.startsWith('--')) {
      throw new Error('rolling run expects -- before the command');
    }
    if (seen.has(flag)) {
      throw new Error(`Repeated rolling option: ${flag}`);
    }
    seen.add(flag);
    if (flag === '--force') {
      result.force = true;
      continue;
    }
    /** Following value token, checked before conversion or policy assignment. */
    const value = args[++i];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    switch (flag) {
      case '--name':
        if (
          !/^[a-z0-9][a-z0-9._-]{0,100}$/.test(value) ||
          value.includes('..')
        ) {
          throw new Error('Invalid application name');
        }
        result.name = value;
        break;
      case '--ports':
        result.ports = value
          .split(',')
          .map((port) => uint(port, 'application port', 1, 65535));
        if (
          result.ports.length < 2 ||
          result.ports.length > 16 ||
          new Set(result.ports).size !== result.ports.length
        ) {
          throw new Error('Provide 2–16 distinct ports');
        }
        break;
      case '--health-path':
        if (
          !value.startsWith('/') ||
          value.startsWith('//') ||
          value.length > 2048 ||
          /[^\x21-\x7e]|#/.test(value)
        ) {
          throw new Error('Invalid health path');
        }
        result.healthPath = value;
        break;
      case '--ready-timeout':
        result.readyTimeoutMs = uint(value, flag, 1, 300000);
        break;
      case '--shutdown-timeout':
        result.shutdownTimeoutMs = uint(value, flag, 1, 120000);
        break;
      case '--drain-timeout':
        result.drainTimeoutMs = uint(value, flag, 0, 300000);
        break;
      case '--precutover-checks':
        result.preCutoverChecks = uint(value, flag, 1, 20);
        break;
      case '--verify-checks':
        result.verificationChecks = uint(value, flag, 1, 20);
        break;
      case '--verify-interval':
        result.verificationIntervalMs = uint(value, flag, 1, 30000);
        break;
      default:
        throw new Error(`Unknown rolling option: ${flag}`);
    }
  }
  result.command = args.slice(i);
  if (
    !result.name ||
    result.ports.length < 2 ||
    !result.command.length ||
    !result.command[0]
  ) {
    throw new Error(
      'Usage: rolling run --name NAME --ports P1,P2 [OPTIONS] -- COMMAND [ARGS...]'
    );
  }
  return result;
}
