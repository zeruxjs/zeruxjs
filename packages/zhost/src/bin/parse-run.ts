/** CLI argument grammar for launching application processes.
 * Supervisor options precede the command, separated optionally by `--`.
 * Everything following the first command token is passed through unchanged.
 */
export interface RunArguments {
  /** Validated application name; this identifier does not authorize process management. */
  name?: string;
  /** Explicit operator request to replace an existing route reservation. */
  force: boolean;
  /** Opt-in child reload signal handling; disabled unless requested. */
  reloadSignal?: boolean;
  /** Validated fixed application port, or host-selected allocation when omitted. */
  appPort?: number;
  /** Maximum readiness wait in milliseconds. */
  readyTimeoutMs?: number;
  /** Graceful child shutdown deadline in milliseconds. */
  shutdownTimeoutMs?: number;
  /** Whether startup waits for child readiness before exposing its route. */
  waitForReady: boolean;
  /** Validated relative HTTP health endpoint; never an arbitrary remote URL. */
  healthPath?: string;
  /** Per-probe health timeout in milliseconds. */
  healthTimeoutMs?: number;
  /** Interval between active health checks in milliseconds. */
  healthIntervalMs?: number;
  /** Consecutive failed probes required before marking a child unhealthy. */
  unhealthyThreshold?: number;
  /** Explicit restart behavior; does not imply replay of application requests. */
  restartPolicy?: 'never' | 'on-failure' | 'always';
  /** Maximum restart attempts within the configured accounting window. */
  maxRestarts?: number;
  /** Sliding restart accounting window in milliseconds. */
  restartWindowMs?: number;
  /** Delay before a permitted process restart in milliseconds. */
  restartDelayMs?: number;
  /** Trusted operator command and arguments preserved verbatim, never interpreted by a shell here. */
  command: string[];
}

/** Parse a complete decimal integer token within this option’s explicit bounds.
 * @param {string} value - Complete decimal argument token.
 * @param {string} name - Option label used in validation errors.
 * @param {number} maximum - Inclusive permitted upper bound.
 * @param {number} minimum - Inclusive permitted lower bound, defaulting to one.
 * @returns {number} Validated safe integer; malformed or out-of-range input throws.
 */
function portNumber(
  value: string,
  name: string,
  maximum: number,
  minimum = 1
): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer`);
  }
  /** Safe integer candidate validated before it enters runtime policy. */
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

/** Parse the run command into validated configuration without starting children, listeners or checkpoint writers.
 * @param {readonly string[]} args - Trusted CLI tokens; child arguments remain unchanged after the command boundary.
 * @returns {RunArguments} Validated supervisor options and the untouched child command.
 */
export function parseRunArguments(args: readonly string[]): RunArguments {
  /** Candidate supervisor options; returned only after cross-option validation. */
  const result: RunArguments = {
    force: false,
    waitForReady: true,
    command: [],
  };
  let i = 0;
  /** Consumed flags, preventing repeated options from silently overriding policy. */
  const seen = new Set<string>();
  for (; i < args.length; i++) {
    /** Argument proven present by the loop bounds; child flags stop supervisor parsing. */
    const token = args[i]!;
    if (token === '--') {
      i++;
      break;
    }
    if (!token.startsWith('--')) {
      break;
    }
    if (
      ![
        '--force',
        '--reload-signal',
        '--no-ready',
        '--name',
        '--app-port',
        '--ready-timeout',
        '--shutdown-timeout',
        '--health-path',
        '--health-timeout',
        '--health-interval',
        '--health-failures',
        '--restart',
        '--max-restarts',
        '--restart-delay',
        '--restart-window',
      ].includes(token)
    ) {
      throw new Error(
        `Unknown run option: ${token} (pass application flags after its command)`
      );
    }
    if (seen.has(token)) {
      throw new Error(`Repeated run option: ${token}`);
    }
    seen.add(token);
    if (token === '--force') {
      result.force = true;
      continue;
    }
    if (token === '--reload-signal') {
      result.reloadSignal = true;
      continue;
    }
    if (token === '--no-ready') {
      result.waitForReady = false;
      continue;
    }
    /** Following value token, checked before conversion or policy assignment. */
    const value = args[++i];
    if (!value || value.startsWith('--')) {
      throw new Error(`${token} needs a value`);
    }
    if (token === '--name') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value)) {
        throw new Error('Invalid application name');
      }
      result.name = value;
    } else if (token === '--app-port') {
      result.appPort = portNumber(value, token, 65535);
    } else if (token === '--ready-timeout') {
      result.readyTimeoutMs = portNumber(value, token, 300000);
    } else if (token === '--shutdown-timeout') {
      result.shutdownTimeoutMs = portNumber(value, token, 120000);
    } else if (token === '--health-path') {
      if (
        !value.startsWith('/') ||
        value.startsWith('//') ||
        /[^\x21-\x7E]|#/.test(value) ||
        value.length > 2048
      ) {
        throw new Error('Invalid health path');
      }
      result.healthPath = value;
    } else if (token === '--health-timeout') {
      result.healthTimeoutMs = portNumber(value, token, 30000);
    } else if (token === '--health-interval') {
      result.healthIntervalMs = portNumber(value, token, 300000, 100);
    } else if (token === '--health-failures') {
      result.unhealthyThreshold = portNumber(value, token, 20);
    } else if (token === '--restart') {
      if (!['never', 'on-failure', 'always'].includes(value)) {
        throw new Error('Restart policy must be never, on-failure, or always');
      }
      result.restartPolicy = value as RunArguments['restartPolicy'];
    } else if (token === '--max-restarts') {
      result.maxRestarts = portNumber(value, token, 100, 0);
    } else if (token === '--restart-delay') {
      result.restartDelayMs = portNumber(value, token, 60000);
    } else if (token === '--restart-window') {
      result.restartWindowMs = portNumber(value, token, 3600000, 100);
    }
  }
  result.command = args.slice(i);
  if (!result.waitForReady && (result.healthPath || result.healthIntervalMs)) {
    throw new Error('--no-ready cannot be combined with health checks');
  }
  if (!result.command.length) {
    throw new Error(
      'Missing application command (example: run --name web -- npm run dev)'
    );
  }
  return result;
}
