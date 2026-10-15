#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublicApiFreeze, writePublicApiFreeze } from './workspace-api-freeze.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--write' && args[1] === '--approve-breaking-review')) {
  console.error('Usage: node scripts/api-freeze.mjs [--write --approve-breaking-review]'); process.exit(2);
}
if (args.length) writePublicApiFreeze(root);
const result = verifyPublicApiFreeze(root);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
