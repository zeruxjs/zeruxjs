import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createTsConfig, checkTypes } from '@zeruxjs/typescript';
/** Package-local resolver used to archive installed declaration dependencies. */
const require = createRequire(import.meta.url);

test('offline installed exports own declarations and support watcher lifecycle consumers', () => {
  /** Owned temporary fixture root, removed after watcher and scan cleanup. */
  const root = mkdtempSync(join(tmpdir(), 'zlook-consumer-'));
  try {
    /** Run bounded npm operations only inside the isolated consumer fixture.
     * @param {string[]} args - Argument vector without shell interpolation.
     * @returns {string} Captured UTF-8 command output.
     */
    const npm = (args) =>
      execFileSync('npm', [...args, '--cache', join(root, 'cache')], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
      });
    /** Create an archive for an explicitly selected local dependency.
     * @param {string} directory - Trusted package directory.
     * @returns {string} File dependency URL for the owned archive.
     */
    const pack = (directory) => {
      /** Single package archive receipt returned by npm’s structured output. */
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
    /** Isolated consumer dependencies pointing only at locally packed archives. */
    const dependencies = {
      zlook: pack(fileURLToPath(new URL('..', import.meta.url))),
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
      `import {watchDirectory,startWatcher,scan,diff,watcherDiagnostics,type WatchOptions,type WatcherDiagnostics,type Entry} from 'zlook';
const controller=new AbortController();
const options:WatchOptions={signal:controller.signal,maxEntries:1000,maxPendingEvents:50,pollingOnly:true};
const handle=watchDirectory(process.cwd(),event=>{const type:'new'|'update'|'delete'=event.type;void type;},options);
await handle.ready;await handle.flush();const status:WatcherDiagnostics=handle.diagnostics();void status;
handle.close();await handle.closed;void watcherDiagnostics;
// Existing framework/lint/host call shape stays compatible.
const stop:()=>void=startWatcher(process.cwd(),(event,type)=>{void event.file;void type;},{debounceMs:100,onError:error=>{void error.message;}});stop();
const entries:Map<string,Entry>=await scan(process.cwd(),()=>false,{maxEntries:1000,signal:controller.signal});void diff(entries,entries);
// @ts-expect-error pollingOnly is a runtime boolean
const invalid:WatchOptions={pollingOnly:'yes'};void invalid;
`
    );
    createTsConfig(root, { preset: 'node-server' });
    /** Public-declaration typecheck result from the installed consumer, not source aliases. */
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
        `import {watchDirectory} from 'zlook';const handle=watchDirectory('.',()=>{},{maxEntries:10000,pollingOnly:true});await handle.ready;handle.close();await handle.closed;`,
      ],
      { cwd: root, timeout: 3000 }
    );
    assert.equal(existsSync(join(root, 'node_modules/zlook/src')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
