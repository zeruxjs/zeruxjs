#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectOwnedPackageVersions } from './workspace-version-policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = inspectOwnedPackageVersions(root);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
