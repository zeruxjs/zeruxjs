/** CLI argument grammar for launching application processes.
 * Supervisor options precede the command, separated optionally by `--`.
 * Everything following the first command token is passed through unchanged.
 */
export interface RunArguments {
  name?: string;
  force: boolean;
  reloadSignal?: boolean;
  appPort?: number;
  readyTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  waitForReady: boolean;
  healthPath?: string;
  healthTimeoutMs?: number;
  healthIntervalMs?: number;
  unhealthyThreshold?: number;
  restartPolicy?: 'never' | 'on-failure' | 'always';
  maxRestarts?: number;
  restartWindowMs?: number;
  restartDelayMs?: number;
  command: string[];
}

function portNumber(value: string, name: string, maximum: number, minimum = 1): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseRunArguments(args: readonly string[]): RunArguments {
  const result: RunArguments = { force: false, waitForReady: true, command: [] };
  let i = 0;
  const seen = new Set<string>();
  for (; i < args.length; i++) {
    const token = args[i];
    if (token === '--') { i++; break; }
    if (!token.startsWith('--')) break;
    if (!['--force', '--reload-signal', '--no-ready', '--name', '--app-port', '--ready-timeout', '--shutdown-timeout', '--health-path', '--health-timeout', '--health-interval', '--health-failures', '--restart', '--max-restarts', '--restart-delay', '--restart-window'].includes(token)) {
      throw new Error(`Unknown run option: ${token} (pass application flags after its command)`);
    }
    if (seen.has(token)) throw new Error(`Repeated run option: ${token}`);
    seen.add(token);
    if (token === '--force') { result.force = true; continue; }
    if (token === '--reload-signal') { result.reloadSignal = true; continue; }
    if (token === '--no-ready') { result.waitForReady = false; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${token} needs a value`);
    if (token === '--name') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value)) throw new Error('Invalid application name');
      result.name = value;
    } else if (token === '--app-port') result.appPort = portNumber(value, token, 65535);
    else if (token === '--ready-timeout') result.readyTimeoutMs = portNumber(value, token, 300000);
    else if (token === '--shutdown-timeout') result.shutdownTimeoutMs = portNumber(value, token, 120000);
    else if (token === '--health-path') {
      if (!value.startsWith('/') || value.startsWith('//') || /[^\x21-\x7E]|#/.test(value) || value.length > 2048) throw new Error('Invalid health path');
      result.healthPath = value;
    }
    else if (token === '--health-timeout') result.healthTimeoutMs = portNumber(value, token, 30000);
    else if (token === '--health-interval') result.healthIntervalMs = portNumber(value, token, 300000, 100);
    else if (token === '--health-failures') result.unhealthyThreshold = portNumber(value, token, 20);
    else if (token === '--restart') {
      if (!['never', 'on-failure', 'always'].includes(value)) throw new Error('Restart policy must be never, on-failure, or always');
      result.restartPolicy = value as RunArguments['restartPolicy'];
    }
    else if (token === '--max-restarts') result.maxRestarts = portNumber(value, token, 100, 0);
    else if (token === '--restart-delay') result.restartDelayMs = portNumber(value, token, 60000);
    else if (token === '--restart-window') result.restartWindowMs = portNumber(value, token, 3600000, 100);
  }
  result.command = args.slice(i);
  if (!result.waitForReady && (result.healthPath || result.healthIntervalMs)) throw new Error('--no-ready cannot be combined with health checks');
  if (!result.command.length) throw new Error('Missing application command (example: run --name web -- npm run dev)');
  return result;
}
