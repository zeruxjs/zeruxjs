import { resolve } from 'node:path';
import type { WorkspaceOptions } from './application.js';

/** Private host settings only. Never serialize this result into a client manifest. */
export function workspaceOptions(
  root: string,
  env: NodeJS.ProcessEnv,
  migrate = false
): WorkspaceOptions {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`Workspace requires ${name}`);
    return value;
  };
  const encoded = required('WORKSPACE_KEY');
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(encoded) ||
    Buffer.from(encoded, 'base64url').length !== 32
  )
    throw new Error('WORKSPACE_KEY must be a 32-byte base64url secret');
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
