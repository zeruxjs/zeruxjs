import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState } from './helper.ts';

// Resolve the stop/start script entrypoints without relying on the invoking cwd.
/** Absolute filename used to anchor restart script paths. */
const __filename = fileURLToPath(import.meta.url);
/** Directory containing the restart script. */
const __dirname = path.dirname(__filename);

/** Local value for state. */
const state = readState();
/** Local value for previous type. */
const previousType = state.type;

// Use the current process path to avoid PATH lookup issues
/** Local value for node path. */
const nodePath = process.execPath;

console.log('Executing stop script...');
try {
  execFileSync(
    nodePath,
    ['--experimental-strip-types', path.resolve(__dirname, 'stop.ts')],
    {
      stdio: 'inherit',
    }
  );
} catch (e) {
  console.error(
    'Stop script execution failed:',
    e instanceof Error ? e.message : String(e)
  );
}

if (previousType === 'start') {
  console.log('\nRestarting start processes...');
  try {
    execFileSync(
      nodePath,
      ['--experimental-strip-types', path.resolve(__dirname, 'start.ts')],
      {
        stdio: 'inherit',
      }
    );
  } catch (e) {
    console.error(
      'Start script execution failed:',
      e instanceof Error ? e.message : String(e)
    );
  }
} else if (previousType === 'dev') {
  console.log('\nRestarting dev processes...');
  try {
    execFileSync(
      nodePath,
      ['--experimental-strip-types', path.resolve(__dirname, 'dev.ts')],
      {
        stdio: 'inherit',
      }
    );
  } catch (e) {
    console.error(
      'Dev script execution failed:',
      e instanceof Error ? e.message : String(e)
    );
  }
} else {
  console.log(
    '\nNo previous state available to determine mode. Run dev.ts or start.ts explicitly first.'
  );
}
