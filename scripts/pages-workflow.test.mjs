import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/github-pages-deploy.yml', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../apps/zerux-docs/package.json', import.meta.url), 'utf8'));

test('Pages builds every explicit docs prebuild scope before rendering sites', () => {
  const build = workflow.match(/run: node scripts\/build-workspaces\.mjs ([^\n]+)/)?.[1];
  assert.ok(build, 'Pages must compile workspace dependencies');
  const scopes = [...manifest.scripts.prebuild.matchAll(/--scope (\S+)/g)].map(match => match[1]);
  const actual = [...build.matchAll(/--scope (\S+)/g)].map(match => match[1]);
  for (const scope of scopes) {
    assert.ok(actual.includes(scope), `Pages is missing docs build dependency ${scope}`);
    assert.ok(workflow.includes(`'${scope}'`), `Pages must verify the ${scope} workspace link`);
  }
  assert.ok(workflow.indexOf('run: node scripts/build-workspaces.mjs') < workflow.indexOf('run: node scripts/build-sites.mjs'));
});
