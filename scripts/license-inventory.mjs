#!/usr/bin/env node
/** Lockfile metadata inventory. Licenses still require artifact/SPDX review after npm ci. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverWorkspaces } from './workspace-graph.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length > 2) { console.error('Usage: node scripts/license-inventory.mjs'); process.exit(2); }
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const local = [...discoverWorkspaces(root).values()].map(({ name, pkg }) => ({ name, version: pkg.version, license: pkg.license ?? null, private: pkg.private === true })).sort((a,b) => a.name.localeCompare(b.name));
const external = Object.entries(lock.packages ?? {}).filter(([name, pkg]) => name.startsWith('node_modules/') && !pkg.link).map(([name, pkg]) => ({ name, version: pkg.version ?? null, license: pkg.license ?? null }));
const missing = external.filter(entry => !entry.license).map(entry => entry.name);
console.log(JSON.stringify({ local, lockedExternalCount: external.length, unknownExternalLicenseMetadata: missing, status: 'LOCK METADATA ONLY — not a third-party license clearance, advisory check or installed artifact audit' }, null, 2));
