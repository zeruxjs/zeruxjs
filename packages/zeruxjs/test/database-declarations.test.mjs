import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { initializeDatabaseRuntime } from '../dist/bootstrap/database.js';
import { unregister } from '../dist/loader/registry.js';

test('generated default database declaration preserves default and named db imports', async () => {
  const previous = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), 'zerux-db-types-'));
  try {
    await symlink(path.resolve(previous, '../../node_modules'), path.join(root, 'node_modules'), 'dir');
    process.chdir(root);
    await initializeDatabaseRuntime({ db: {}, connectorManager: 'data:text/javascript,' + encodeURIComponent('export const createDatabaseManager = async () => ({connectionSlugs: [], getConnectionFacade(){throw Error("unused");}});') });
    const file = path.join(root, '.zerux/virtual/db/default.d.ts');
    const source = await readFile(file, 'utf8');
    assert.match(source, /export default __zerux_default_db;/);
    assert.match(source, /export const db:/);
    const program = ts.createProgram([file], { noEmit: true, strict: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')] });
    const errors = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
  } finally {
    unregister('db');
    process.chdir(previous);
    await rm(root, {recursive: true, force: true});
  }
});
