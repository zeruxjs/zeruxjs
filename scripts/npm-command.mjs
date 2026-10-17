import fs from 'node:fs';
import path from 'node:path';

/**
 * Title: Resolve a shell-free npm invocation.
 * Description: Runs npm's JavaScript CLI through Node, avoiding Windows .cmd spawn failures and shell argument interpolation.
 * Global Variables: Reads process.execPath, process.platform, process.env.npm_execpath and the local filesystem. No environment values are logged.
 * @param args Literal npm arguments.
 * @param options Optional executable, platform and CLI locations for controlled callers.
 * @returns Command and argument array suitable for spawn or spawnSync.
 */
export function npmCommand(args, { execPath = process.execPath, platform = process.platform, npmExecPath = process.env.npm_execpath } = {}) {
  const candidates = [
    npmExecPath,
    path.join(path.dirname(execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const cli = candidates.find(candidate => candidate && path.basename(candidate) === 'npm-cli.js' && fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
  if (cli) return { command: execPath, args: [cli, ...args] };
  if (platform === 'win32') throw new Error('Cannot locate npm-cli.js; run this command through npm run or install npm alongside Node');
  return { command: 'npm', args };
}
