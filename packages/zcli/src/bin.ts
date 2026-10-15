#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createZeruxProject } from './scaffold.js';

export function runZcli(argv: readonly string[], out: (message:string)=>void=console.log, err:(message:string)=>void=console.error): number {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {out('zcli create <folder> [--js|--ts] [--dry-run]\nCreates a minimal ZeruxJS application without overwriting files.');return 0;}
  if (argv[0] !== 'create') {err(`Unknown command: ${argv[0]}`);return 2;}
  const flags=argv.slice(2);
  if (!argv[1] || flags.some(f=>!['--js','--ts','--dry-run'].includes(f)) || (flags.includes('--js') && flags.includes('--ts'))) {
    err('Usage: zcli create <folder> [--js|--ts] [--dry-run]');return 2;
  }
  try {const result=createZeruxProject(argv[1],{language:flags.includes('--js')?'javascript':'typescript',dryRun:flags.includes('--dry-run')});out(`${result.created?'Created':'Would create'} ${result.directory} (${result.files.length} files)`);return 0;}
  catch(error) {err(`zcli: ${error instanceof Error?error.message:String(error)}`);return 1;}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = runZcli(process.argv.slice(2));
