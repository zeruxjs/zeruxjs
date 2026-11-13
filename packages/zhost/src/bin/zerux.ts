#!/usr/bin/env node
/** Executable CLI entry: importing this file dispatches process arguments; library consumers use the package export map. */
import chalk from 'chalk';
import {
  portlessProxy,
  portlessRun,
  portlessList,
  portlessGet,
  portlessHosts,
  portlessTrust,
  portlessStop,
  portlessRestart,
  portlessStatus,
} from '../portless/portless.js';
import { parseRunArguments } from './parse-run.js';
import { parseRollingRunArguments } from './parse-rolling.js';
import { parseFleetRunArguments } from './parse-fleet.js';
import { parseProxyStartArguments } from './parse-proxy.js';
import {
  startFleetFromCLI,
  fleetCLIAction,
} from '../portless/fleet-command.js';
import {
  startRollingFromCLI,
  rollingCLIAction,
  rollingReconcileAll,
} from '../portless/rolling-command.js';

export { parseRunArguments } from './parse-run.js';
export { parseRollingRunArguments } from './parse-rolling.js';
export { parseFleetRunArguments } from './parse-fleet.js';
export { parseProxyStartArguments } from './parse-proxy.js';

/** Fixed operator help text, preserved byte-for-byte alongside existing command compatibility. */
const HELP = `zerux-server commands:
  proxy start [--port 1355] [--https] [--bind 127.0.0.1]
      [--rate REQUESTS_PER_SEC] [--burst COUNT] [--max-active COUNT]
      [--max-body BYTES] [--compress|--no-compress]
      [--compression-min BYTES] [--compression-encodings br,zstd,gzip,deflate]
      [--cache] [--cache-max-entries COUNT] [--cache-max-entry-bytes BYTES]
      [--cache-max-total-bytes BYTES] [--cache-max-age SECONDS]
  proxy stop | proxy restart
  run [--name NAME] [--app-port PORT] [--force] [--ready-timeout MS]
      [--shutdown-timeout MS] [--no-ready] -- COMMAND [ARGS...]
      [--health-path /health] [--health-timeout MS] [--health-interval MS]
      [--health-failures N] [--restart never|on-failure|always]
      [--max-restarts N] [--restart-delay MS] [--restart-window MS]
      [--reload-signal]        Enable SIGUSR2 to restart a running app (POSIX)
  status [NAME] [--json]      Show private application runtime status
  rolling run --name NAME --ports P1,P2 [--health-path /health] [OPTIONS] -- COMMAND
  rolling deploy NAME        Deploy and health-check a new generation
  rolling stop NAME          Stop the owning wrapper and withdraw its route
  rolling recover NAME [--dry-run] [--json]  Inspect or recover orphaned children
  rolling reconcile [--dry-run] [--json]     Reconcile all verified orphaned controllers
  rolling prune NAME [--days N] [--max-events N]  Compact offline history
  rolling status NAME [--json] | rolling history NAME [--json]
  rolling backends NAME [--json]   Show live proxy backend health
  fleet run --name NAME --ports P1,P2,P3 --replicas 2 [OPTIONS] -- COMMAND
  fleet status NAME [--json]   Show durable status and restart budget
  fleet backends NAME [--json] Show live proxy backend health
  fleet reconcile NAME [--json]  Check unhealthy replicas and replace if permitted
  fleet recover NAME [--dry-run] [--json]  Recover verified orphaned generations
  fleet stop NAME [--json]     Stop the owning fleet supervisor
  fleet reset NAME [--json]    Reset offline fleet checkpoint after recovery
  fleet scale NAME REPLICAS [--json]  Scale online fleet; pauses autoscaling
  fleet autoscale NAME pause|resume [--json]  Control scaling policy
  fleet metrics NAME [--json|--prometheus]  Read request, latency, error and resource metrics
  fleet history NAME [--json]  Read bounded fleet scaling history
  fleet samples NAME [--json]  Read recent autoscale metric samples
  fleet doctor NAME [--json] [--live]  Check durable state or authenticated live health
  NAME COMMAND [ARGS...]      Run with NAME as local hostname
  list | get NAME | hosts [sync|clean] | trust

Application arguments are passed through unchanged after the command.
Example: zerux-server run --name demo -- npm run dev -- --host 127.0.0.1`;

/** Dispatch explicitly validated operator commands to the existing lifecycle owners without shell interpolation.
 * @param {string[]} args - CLI argument tokens after the executable; child argv remains preserved by dedicated parsers.
 * @returns {Promise<boolean>} Command success receipt; validation/native failures reject to the CLI error boundary.
 */
export async function runCli(args: string[]): Promise<boolean> {
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP);
    return true;
  }
  /** Nonempty command tuple proven by the initial help/empty-argument guard; remaining tokens stay ordered. */
  const [command, ...rest] = args as [string, ...string[]];
  switch (command) {
    case 'proxy': {
      /** Subcommand and remaining operator flags, parsed by the owning command branch. */
      const [action, ...flags] = rest;
      if (action === 'start') {
        /** Validated explicit proxy policy before any listener or state acquisition. */
        const options = parseProxyStartArguments(flags);
        return portlessProxy(options.port, options);
      }
      if (flags.length) {
        throw new Error('Unknown proxy arguments');
      }
      if (action === 'stop') {
        return portlessStop();
      }
      if (action === 'restart') {
        return portlessRestart();
      }
      throw new Error(`Unknown proxy action: ${action ?? ''}`);
    }
    case 'fleet': {
      /** Subcommand and remaining operator flags, parsed by the owning command branch. */
      const [action, ...flags] = rest;
      if (action === 'run') {
        await startFleetFromCLI(parseFleetRunArguments(flags));
        return true;
      }
      if (action === 'scale') {
        /** Fleet scale arguments validated before converting replica count or calling the private control API. */
        const [name, count, ...extra] = flags;
        if (
          !name ||
          !/^[0-9]+$/.test(count ?? '') ||
          extra.some((f) => f !== '--json') ||
          extra.length > 1
        ) {
          throw new Error('Usage: fleet scale NAME REPLICAS [--json]');
        }
        return fleetCLIAction(
          'scale',
          name,
          extra.includes('--json'),
          false,
          Number(count)
        );
      }
      if (action === 'autoscale') {
        /** Explicit fleet autoscale control arguments; client-supplied roles are not used. */
        const [name, mode, ...extra] = flags;
        if (
          !name ||
          !['pause', 'resume'].includes(mode ?? '') ||
          extra.some((f) => f !== '--json') ||
          extra.length > 1
        ) {
          throw new Error('Usage: fleet autoscale NAME pause|resume [--json]');
        }
        return fleetCLIAction(
          mode as 'pause' | 'resume',
          name,
          extra.includes('--json')
        );
      }
      if (
        ![
          'status',
          'backends',
          'reconcile',
          'stop',
          'recover',
          'reset',
          'metrics',
          'history',
          'samples',
          'doctor',
        ].includes(action ?? '')
      ) {
        throw new Error(
          'Usage: fleet run|status|backends|reconcile|stop|recover'
        );
      }
      /** Validated operator application label required by this command branch. */
      const name = flags[0];
      if (!name || name.startsWith('-')) {
        throw new Error(`Usage: fleet ${action} NAME [--json]`);
      }
      /** Remaining fleet option tokens checked for exact vocabulary and duplicates. */
      const extras = flags.slice(1);
      /** Action-specific exact fleet flag vocabulary; no extra option is forwarded silently. */
      const allowed = (() => {
        if (action === 'recover') {
          return ['--json', '--dry-run'];
        }
        if (action === 'metrics') {
          return ['--json', '--prometheus'];
        }
        if (action === 'doctor') {
          return ['--json', '--live'];
        }
        return ['--json'];
      })();
      if (
        extras.some((flag) => !allowed.includes(flag)) ||
        new Set(extras).size !== extras.length
      ) {
        throw new Error(`Invalid fleet ${action} options`);
      }
      if (extras.includes('--prometheus') && extras.includes('--json')) {
        throw new Error('Choose only one metrics output format');
      }
      return fleetCLIAction(
        action as
          | 'status'
          | 'backends'
          | 'reconcile'
          | 'stop'
          | 'recover'
          | 'reset'
          | 'metrics'
          | 'history'
          | 'samples'
          | 'doctor',
        name,
        extras.includes('--json'),
        extras.includes('--dry-run'),
        undefined,
        extras.includes('--prometheus') || extras.includes('--live')
      );
    }
    case 'rolling': {
      /** Subcommand and remaining operator flags, parsed by the owning command branch. */
      const [action, ...flags] = rest;
      if (action === 'run') {
        await startRollingFromCLI(parseRollingRunArguments(flags));
        return true;
      }
      if (action === 'reconcile') {
        if (
          flags.some((f) => f !== '--json' && f !== '--dry-run') ||
          new Set(flags).size !== flags.length
        ) {
          throw new Error('Usage: rolling reconcile [--dry-run] [--json]');
        }
        return rollingReconcileAll(
          flags.includes('--json'),
          flags.includes('--dry-run')
        );
      }
      if (
        ![
          'deploy',
          'stop',
          'status',
          'history',
          'backends',
          'recover',
          'prune',
        ].includes(action ?? '')
      ) {
        throw new Error(
          'Usage: rolling run|deploy|stop|status|history|backends|recover|reconcile|prune'
        );
      }
      if (action === 'recover') {
        /** Validated operator application label required by this command branch. */
        const name = flags[0];
        if (
          !name ||
          name.startsWith('-') ||
          flags.slice(1).some((f) => f !== '--json' && f !== '--dry-run') ||
          new Set(flags.slice(1)).size !== flags.length - 1
        ) {
          throw new Error('Usage: rolling recover NAME [--dry-run] [--json]');
        }
        return rollingCLIAction(
          'recover',
          name,
          flags.includes('--json'),
          undefined,
          flags.includes('--dry-run')
        );
      }
      if (action === 'prune') {
        /** Validated operator application label required by this command branch. */
        const name = flags[0];
        if (!name || name.startsWith('-')) {
          throw new Error(
            'Usage: rolling prune NAME [--days N] [--max-events N] [--json]'
          );
        }
        let json = false;
        /** Explicit bounded history-prune candidate; no deletion occurs during parsing. */
        const retention: { days?: number; maxEvents?: number } = {};
        /** Prune options already consumed, rejecting repeats instead of overwriting values. */
        const seen = new Set<string>();
        for (let i = 1; i < flags.length; i++) {
          /** Prune flag proven present by the loop bounds before consuming its value. */
          const flag = flags[i]!;
          if (seen.has(flag)) {
            throw new Error(`Repeated option: ${flag}`);
          }
          seen.add(flag);
          if (flag === '--json') {
            json = true;
            continue;
          }
          if (flag !== '--days' && flag !== '--max-events') {
            throw new Error(`Unknown prune option: ${flag}`);
          }
          /** Following complete decimal token, validated before numeric conversion. */
          const value = flags[++i];
          if (!value || !/^\d+$/.test(value)) {
            throw new Error(`Invalid ${flag} value`);
          }
          /** Safe bounded numeric prune-policy value. */
          const n = Number(value);
          if (
            !Number.isSafeInteger(n) ||
            n < 0 ||
            n > (flag === '--days' ? 3650 : 50)
          ) {
            throw new Error(`Invalid ${flag} value`);
          }
          if (flag === '--days') {
            retention.days = n;
          } else {
            retention.maxEvents = n;
          }
        }
        return rollingCLIAction('prune', name, json, retention);
      }
      /** Explicit operator request for JSON output, limited to the commands supporting it. */
      const json = flags.includes('--json');
      /** Positional application labels after removing the explicit JSON switch. */
      const names = flags.filter((arg) => arg !== '--json');
      if (
        names.length !== 1 ||
        names[0]!.startsWith('-') ||
        (json &&
          action !== 'status' &&
          action !== 'history' &&
          action !== 'backends')
      ) {
        throw new Error('Usage: rolling ACTION NAME [--json]');
      }
      return rollingCLIAction(
        action as 'deploy' | 'stop' | 'status' | 'history' | 'backends',
        names[0]!,
        json
      );
    }
    case 'run': {
      /** Validated direct-run supervisor options and untouched application argv. */
      const run = parseRunArguments(rest);
      return portlessRun(run.command, run);
    }
    case 'status': {
      /** Explicit operator request for JSON output, limited to the commands supporting it. */
      const json = rest.includes('--json');
      /** Positional application labels after removing the explicit JSON switch. */
      const names = rest.filter((arg) => arg !== '--json');
      if (names.length > 1 || names.some((arg) => arg.startsWith('-'))) {
        throw new Error('Usage: status [NAME] [--json]');
      }
      return portlessStatus(names[0], json);
    }
    case 'list':
      return portlessList();
    case 'get': {
      if (rest.length !== 1) {
        throw new Error('get requires exactly one hostname');
      }
      /** Observed registered app URL; false remains the existing get failure result. */
      const url = await portlessGet(rest[0]!);
      if (url) {
        console.log(url);
      }
      return url !== false;
    }
    case 'hosts':
      return portlessHosts(rest[0] === 'clean' ? 'clean' : 'sync');
    case 'trust':
      return portlessTrust();
    default:
      if (!rest.length || command.startsWith('-')) {
        throw new Error(`Unknown command: ${command}`);
      }
      return portlessRun(rest, { name: command });
  }
}

// CLI entry point: keep invocations via npm symlinks fully supported.
runCli(process.argv.slice(2))
  .then((success) => {
    if (!success) {
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(
      chalk.red(
        `zerux-server: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exitCode = 1;
  });
