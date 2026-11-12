import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { reportDashboard } from '../dist/dashboard.js';
test('reports studio JavaScript is syntactically executable after HTML generation', () => {
  /** Generated trusted studio markup; stored labels must remain inert text. */
  const html = reportDashboard('/_reports');
  /** Borrowed synthetic source or explicit adapter; no real provider is queried. */
  const source = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(source);
  assert.doesNotThrow(() => new vm.Script(source));
});
