#!/usr/bin/env node
/** Real installed artifact inspection; manual SPDX compatibility review still required. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectInstalledLicenses} from './workspace-installed-licenses.mjs';
const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>arg!=='--strict')){console.error('Usage: node scripts/installed-license-review.mjs [--strict]');process.exit(2);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const result=inspectInstalledLicenses(root,lock);
console.log(JSON.stringify({status:result.ok?'metadata-checked':'unresolved',scope:'Installed external artifacts; not a legal opinion or license compatibility approval',...result},null,2));
if(args.includes('--strict')&&!result.ok)process.exitCode=1;
