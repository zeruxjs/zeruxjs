import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createTsConfig, checkTypes } from '@zeruxjs/typescript';
/** Package-local module resolver used only to pack explicitly installed declared test prerequisites. */
const require = createRequire(import.meta.url);

test('offline installed exports own declarations and support HTTP fake and runner lifecycle consumers', () => {
  /** Owned temporary offline consumer/cache/archive namespace removed in finally. */
  const root = mkdtempSync(join(tmpdir(), 'ztrial-consumer-'));
  try {
    /** Invoke only explicit trusted offline consumer npm commands with a private cache and finite timeout.
     * @param {string[]} args Fixed test-owned npm pack/install arguments, never user-supplied shell text.
     * @returns {string} Actual command output; no package is published or dependency version selected from the network. */
    const npm = (args) =>
      execFileSync('npm', [...args, '--cache', join(root, 'cache')], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
      });
    /** Pack one explicit trusted local package archive into the private fixture namespace without lifecycle scripts.
     * @param {string} directory Explicit installed local package directory.
     * @returns {string} Private file archive reference for the isolated offline consumer. */
    const pack = (directory) => {
      /** Actual npm pack receipt normalized across supported array/object JSON output shapes. */
      const [archive] = Object.values(
        JSON.parse(
          npm([
            'pack',
            directory,
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            root,
          ])
        )
      );
      return `file:${join(root, archive.filename)}`;
    };
    /** Explicit local tarball references only; no remote dependency resolution is permitted by the fixture. */
    const dependencies = {
      ztrial: pack(fileURLToPath(new URL('..', import.meta.url))),
    };
    for (const name of ['@types/node', 'undici-types']) {
      dependencies[name] = pack(
        dirname(require.resolve(name + '/package.json'))
      );
    }
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'consumer',
        private: true,
        type: 'module',
        dependencies,
      })
    );
    npm([
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src/index.ts'),
      `import {createRunner,normalizeResults,normalizeV8Coverage,mergeCoverage,summarizeCoverage,type TestExecutionContext} from 'ztrial';
import {createBrowserRunner,runBrowserTests,withBrowser,type BrowserOptions} from 'ztrial/playwright';
const browserOptions:BrowserOptions={concurrency:2,timeoutMs:1000,coverage:{expectedSources:['https://test.invalid/app.js']}};
const browserRunner=createBrowserRunner(browserOptions);browserRunner.skip('intentional');const browserSummary=await browserRunner.runTests();void normalizeResults(browserSummary);
const records=normalizeV8Coverage([],{runtime:'node:fixture',expectedSources:['app.js']});void summarizeCoverage(mergeCoverage(records));
void runBrowserTests;void withBrowser;
import {createHttpFake,withHttpFake,createTestClock,createSequenceRandom,type HttpFakeOptions,type HttpReply} from 'ztrial/http';
import {createResultReport,createReportExporters,createPdfExporter,type ResultReportV1,type ReportExporter} from 'ztrial/reports';
const exportsApi=createReportExporters();
const empty={passed:0,failed:0,skipped:0,durationMs:0,results:[]};
const report:ResultReportV1=createResultReport(empty);const rendered=await exportsApi.render(empty,'json');void report;void rendered;void createPdfExporter;
const plugin:ReportExporter={format:'example',extension:'example.txt',kind:'summary',render:report=>new TextEncoder().encode(report.schema)};void plugin;
import {createExperimentCatalog,experimentAnalyticsSchema,type ExperimentAssignmentStore,type ExperimentRecorder} from 'ztrial/experiments';
const catalog=createExperimentCatalog([{id:'trial',version:1,salt:'explicit_salt_v1',migration:'initial',environments:['test'],variants:[{name:'one',weight:5000},{name:'two',weight:5000}]}]);void experimentAnalyticsSchema(catalog);
const recorder:ExperimentRecorder={contract:'ztrial-experiment-recorder-v1',recordOnce:async(_event,{limit})=>limit>0?'recorded':'capacity'};void recorder;
const runner=createRunner();
const reply:HttpReply={headers:{'content-type':'text/event-stream'},chunks:[{data:'data: ok\\n\\n',delayMs:1}]};
const options:HttpFakeOptions={routes:[{path:'/sse',responses:[reply]}]};
runner.test('fixture',async(context:TestExecutionContext)=>{const fake=createHttpFake({...options,scope:context,signal:context.signal});const response=await fake.fetch('https://fake.test/sse');await response.text();fake.assertDone();});
const summary=await runner.runTests();void summary;
const value:string=await withHttpFake({routes:[{path:'/',responses:[{body:'yes'}]}]},async fake=>(await fake.fetch('https://fake.test/')).text());void value;
const clock=createTestClock();clock.advance(1);clock.close();void createSequenceRandom([0.1]);
// @ts-expect-error unknown failure mode
const invalid:HttpReply={failure:'fabricate-live'};void invalid;
`
    );
    writeFileSync(
      join(root, 'src/experiments.ts'),
      readFileSync(
        new URL('../examples/experiments.ts', import.meta.url),
        'utf8'
      )
    );
    createTsConfig(root, { preset: 'node-server' });
    /** Actual shared-tooling consumer declaration-check receipt with no inferred framework parity. */
    const checked = checkTypes({
      cwd: root,
      files: [],
      checkDependencies: true,
    });
    assert.equal(
      checked.ok,
      true,
      checked.diagnostics
        .map((item) => JSON.stringify(item.messageText))
        .join('\n')
    );
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {createBrowserRunner} from 'ztrial/playwright';const runner=createBrowserRunner();runner.skip('no optional browser needed');if((await runner.runTests()).skipped!==1)throw Error('skip failed');import {createReportExporters} from 'ztrial/reports';const report=await createReportExporters().render({passed:0,failed:0,skipped:0,durationMs:0,results:[]},'json');if(JSON.parse(new TextDecoder().decode(report.bytes)).schema!=='ztrial-results')throw Error('report failed');import {createExperimentCatalog} from 'ztrial/experiments';createExperimentCatalog([{id:'trial',version:1,salt:'explicit_salt_v1',migration:'initial',environments:['test'],variants:[{name:'one',weight:5000},{name:'two',weight:5000}]}]);import {withHttpFake} from 'ztrial/http';await withHttpFake({routes:[{path:'/',responses:[{body:'ok'}]}]},async fake=>{const value=await(await fake.fetch('https://fake.test/')).text();if(value!=='ok')throw Error('bad');});`,
      ],
      { cwd: root, timeout: 3000 }
    );
    assert.equal(existsSync(join(root, 'node_modules/ztrial/src')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
