import { fileURLToPath } from 'node:url';
/** Absolute script filename for explicit child-process entrypoints. */
const __filename = fileURLToPath(import.meta.url);
/** Directory anchor for repository-owned paths. */
const __dirname = path.dirname(__filename);
/** Local value for destructured values. */
import { readState } from './helper.ts';
/** Local value for destructured values. */
import { execFileSync } from 'node:child_process';
/** Local value for path. */
import path from 'node:path';

/** Local value for state. */
const state = readState();
/** Local value for previous type. */
const previousType = state ? state.type : null;

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
    '\nNo previous state available to determine mode. Run dev.js or start.js explicitly first.'
  );
}
