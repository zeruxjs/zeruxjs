#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyPublicApiFreeze,
  writePublicApiFreeze,
} from './workspace-api-freeze.ts';
/** Local value for root. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Local value for args. */
const args = process.argv.slice(2);
if (
  args.length &&
  !(
    args.length === 2 &&
    args[0] === '--write' &&
    args[1] === '--approve-breaking-review'
  )
) {
  console.error(
    'Usage: node --experimental-strip-types scripts/api-freeze.ts [--write --approve-breaking-review]'
  );
  process.exit(2);
}
if (args.length) {
  writePublicApiFreeze(root);
}
/** Local value for result. */
const result = verifyPublicApiFreeze(root);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  process.exitCode = 1;
}
