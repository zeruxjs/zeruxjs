import assert from 'node:assert/strict';
import type { CommandResult } from 'zclivo';

/** Require a public diagnostic before making content assertions.
 * @param {Pick<CommandResult, 'message'>} result - Actual dispatch receipt under test.
 * @returns {string} Present public message; missing diagnostics fail the fixture.
 */
export function requiredMessage(
  result: Pick<CommandResult, 'message'>
): string {
  assert.ok(typeof result.message === 'string');
  return result.message;
}
