#!/usr/bin/env node
/** Version-bump publishing driver. Only --publish performs registry writes. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverWorkspaces } from './workspace-graph.mjs';
import { selectPublishCandidates, compareReleaseVersions, summarizePublication } from './workspace-publish.mjs';
import { checkEntryTargets } from './workspace-public-consumer.mjs';
import { npmCommand } from './npm-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.npm-release');
const planFile = path.join(output, 'plan.json');
const registry = 'https://registry.npmjs.org/';
const args = process.argv.slice(2);
let publishingPlan, activePublication;
if (args.length !== 1 || !['--plan', '--pack', '--publish'].includes(args[0])) {
  console.error('Usage: node scripts/publish-packages.mjs --plan|--pack|--publish'); process.exit(2);
}

/** Run literal arguments without a shell; npm secrets stay in the inherited environment. */
function run(command, callArgs, cwd = root, inherit = false) {
  const result = spawnSync(command, callArgs, {cwd, encoding:'utf8', stdio:inherit?'inherit':'pipe', maxBuffer:16*1024*1024, timeout:600000});
  if (result.error || result.status !== 0) throw Error(`${command} ${callArgs[0]} failed${result.error ? `: ${result.error.message}` : ''}`);
  return result.stdout?.trim();
}
/** Invoke npm through its JavaScript CLI on every platform. */
function npm(callArgs, cwd, inherit) { const cmd = npmCommand(callArgs); return run(cmd.command, cmd.args, cwd, inherit); }
/** Read public registry metadata; only a confirmed 404 is considered unpublished. */
async function metadata(name, version) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {signal:AbortSignal.timeout(30000)});
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Registry lookup failed for ${name}@${version}: HTTP ${response.status}`);
  const manifest = await response.json();
  // npm's temporary staged holding package is not a published application release.
  return manifest.stub === true || manifest.version === '0.0.0-stage' ? null : manifest;
}
/** Persist the reviewable release plan, including packed archive integrity. */
function save(plan) { fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(planFile,JSON.stringify(plan,null,2)+'\n'); }
/** Hash the exact bytes that will be sent to npm. */
function integrity(file) { return 'sha512-'+crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64'); }

try {
  const commit = run('git',['rev-parse','HEAD']);
  const entries = discoverWorkspaces(root);
  if (args[0] === '--plan') {
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')) : {};
    const all = process.env.PUBLISH_UNPUBLISHED === 'true';
    const previous = new Map();
    if (!all) {
      if (!/^[a-f0-9]{40}$/.test(event.before ?? '') || /^0+$/.test(event.before)) throw Error('No valid push base; use the manual publish-unpublished workflow for the initial release');
      run('git',['cat-file','-e',`${event.before}^{commit}`]);
      for (const entry of entries.values()) {
        const directory = path.relative(root,entry.dir).split(path.sep).join('/');
        const result = spawnSync('git',['show',`${event.before}:${directory}/package.json`],{cwd:root,encoding:'utf8'});
        if (result.status === 0) previous.set(directory,JSON.parse(result.stdout));
        else if (result.error || !/does not exist in|exists on disk, but not in/.test(result.stderr ?? '')) throw Error(`Cannot read previous manifest: ${directory}`);
      }
    }
    const candidates = selectPublishCandidates(root,entries,previous,all);
    const packages = [], skipped = [], issues = [];
    // Independent public metadata reads are bounded and parallel; retain dependency order in the result.
    for (let offset = 0; offset < candidates.length; offset += 6) {
      const checked = await Promise.all(candidates.slice(offset,offset+6).map(async item=>({
        item, published:await metadata(item.name,item.version), latest:await metadata(item.name,'latest')
      })));
      for (const {item,published,latest} of checked) {
        if (published) skipped.push(`${item.name}@${item.version}`);
        else if (latest && compareReleaseVersions(latest.version,item.version) >= 0) {
          issues.push(`${item.name}: refusing to move latest backwards; bump above ${latest.version} if you own it, otherwise choose another name`);
        } else packages.push(item);
      }
    }
    const selected = new Set(packages.map(item=>item.name));
    // Missing required local dependency releases must be included or already exist on npm.
    for (const item of packages) for (const dependency of item.dependencies) {
      if (!selected.has(dependency) && !await metadata(dependency,entries.get(dependency).pkg.version)) {
        issues.push(`${item.name}: ${dependency} must be published first; use the manual publish-unpublished run`);
      }
    }
    const plan={schemaVersion:1,commit,packages,skipped,issues,releaseTargets:candidates.map(({name,version})=>({name,version}))};
    save(plan);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`has_releases=${packages.length>0 && issues.length===0}\n`);
    console.log(JSON.stringify({packages,skipped,issues},null,2));
    if (issues.length) throw Error('Release plan blocked: '+issues.join('; '));
    if (!packages.length && candidates.length) {
      const summary=summarizePublication(plan);
      fs.writeFileSync(path.join(output,'publication-summary.md'),summary.markdown);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary.markdown);
      console.log(`[publish] COMPLETE: ${summary.confirmed}/${summary.total} selected package versions already verified on npm.`);
    }
  } else {
    const plan = JSON.parse(fs.readFileSync(planFile,'utf8'));
    if (plan.schemaVersion !== 1 || plan.commit !== commit || plan.issues?.length) throw Error('Release plan is blocked or does not match this commit');
    if (args[0] === '--publish') {
      publishingPlan=plan;
      plan.publicationResults=plan.packages.map(({name,version})=>({name,version,status:'pending'}));
      save(plan);
    }
    for (const item of plan.packages) {
      if (publishingPlan) activePublication=plan.publicationResults.find(result=>result.name===item.name);
      const entry = entries.get(item.name);
      if (!entry || entry.pkg.private || entry.pkg.version !== item.version || path.relative(root,entry.dir).split(path.sep).join('/') !== item.directory ||
        item.directory.split('/').some(part=>part.startsWith('sample'))) throw Error('Release plan no longer matches public package manifests');
      if (args[0] === '--pack') {
        const missing = checkEntryTargets(entry.dir,entry.pkg);
        if (missing.length) throw Error(`${item.name}: missing entrypoints: ${missing.join(', ')}`);
        const report = JSON.parse(npm(['pack','--json','--pack-destination',output],entry.dir));
        const packed = Array.isArray(report)?report:Object.values(report);
        if (packed.length !== 1 || !/^[\w.-]+\.tgz$/.test(packed[0].filename)) throw Error('Unexpected npm archive report');
        item.archive = packed[0].filename;
        item.integrity = integrity(path.join(output,item.archive));
        save(plan);
      } else {
        if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/master') throw Error('Registry writes are restricted to GitHub Actions on master');
        if (!/^[\w.-]+\.tgz$/.test(item.archive ?? '') || integrity(path.join(output,item.archive)) !== item.integrity) throw Error('Release archive missing or changed');
        const position=plan.packages.indexOf(item)+1;
        console.log(`[publish] ${position}/${plan.packages.length}: ${item.name}@${item.version}`);
        if (await metadata(item.name,item.version)) {
          activePublication.status='already-published';save(plan);
          console.log(`[publish] ${position}/${plan.packages.length} ALREADY PUBLISHED: ${item.name}@${item.version}`);continue;
        }
        const latest = await metadata(item.name,'latest');
        if (latest && compareReleaseVersions(latest.version,item.version) >= 0) throw Error(`${item.name}: refusing a stale release`);
        npm(['publish',path.join(output,item.archive),'--access','public','--tag','latest','--provenance','--ignore-scripts','--registry',registry],entry.dir,true);
        let published;
        for (let attempt = 0; attempt < 5; attempt++) {
          published = await metadata(item.name,item.version);
          if (published) break;
          await new Promise(resolve=>setTimeout(resolve,2000));
        }
        if (!published) throw Error(`${item.name}@${item.version} is not publicly available; check npm stage list and approve the pending release before retrying`);
        activePublication.status='published';save(plan);
        console.log(`[publish] ${position}/${plan.packages.length} PUBLISHED AND VERIFIED: ${item.name}@${item.version}`);
      }
    }
  }
} catch (error) {
  if (activePublication) activePublication.status='failed';
  console.error(`[publish] ${error.message}`);process.exitCode = 1;
} finally {
  if (publishingPlan) {
    save(publishingPlan);
    const summary=summarizePublication(publishingPlan);
    fs.writeFileSync(path.join(output,'publication-summary.md'),summary.markdown);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary.markdown);
    console.log(`[publish] ${summary.complete?'COMPLETE':'INCOMPLETE'}: ${summary.confirmed}/${summary.total} selected package versions verified on npm (${summary.published} newly published; ${summary.alreadyPublished} already available).`);
    if (!summary.complete) process.exitCode=1;
  }
}
