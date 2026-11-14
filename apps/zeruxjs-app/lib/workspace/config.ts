import { resolve } from 'node:path';
import type { WorkspaceOptions } from './application.js';

/** Read required private host configuration without creating a database or starting services.
 * @param {string} root - Trusted resolved application root; private state is fixed beneath .workspace.
 * @param {NodeJS.ProcessEnv} env - Host environment; errors identify missing keys without exposing their values.
 * @param {boolean} migrate - Explicit operator-only schema-initialization permission, false during ordinary startup.
 * @returns {WorkspaceOptions} Private options including an independently decoded key; never serialize this record into browser config.
 */
export function workspaceOptions(
  root: string,
  env: NodeJS.ProcessEnv,
  migrate = false
): WorkspaceOptions {
  /** Require one named host setting without including its value in a failure.
   * @param {string} name - Fixed application-owned environment key.
   * @returns {string} Nonempty configured value, still subject to owner-specific validation.
   */
  const required = (name: string) => {
    /** Private value remains inside this server-only configuration projection. */
    const value = env[name];
    if (!value) {
      throw new Error(`Workspace requires ${name}`);
    }
    return value;
  };
  /** Strict unpadded base64url encoding of the stable private 32-byte session key. */
  const encoded = required('WORKSPACE_KEY');
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(encoded) ||
    Buffer.from(encoded, 'base64url').length !== 32
  ) {
    throw new Error('WORKSPACE_KEY must be a 32-byte base64url secret');
  }
  return {
    origin: required('WORKSPACE_ORIGIN'),
    tenant: required('WORKSPACE_TENANT'),
    site: required('WORKSPACE_SITE'),
    username: required('WORKSPACE_USERNAME'),
    passwordHash: required('WORKSPACE_PASSWORD_HASH'),
    key: Buffer.from(encoded, 'base64url'),
    directory: resolve(root, '.workspace'),
    migrate,
  };
}
