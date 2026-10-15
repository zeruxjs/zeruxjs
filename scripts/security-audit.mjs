#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length > 2) { console.error('Usage: node scripts/security-audit.mjs'); process.exit(2); }
const report = inspectPackageReleaseSecurity(root);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
