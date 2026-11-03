import { createWorkspace } from '../lib/workspace/application.js';
import { workspaceOptions } from '../lib/workspace/config.js';

// Explicit operator operation; creates schemas only, never a default password or external connection.
const application = await createWorkspace(workspaceOptions(process.cwd(), process.env, true));
await application.close();
console.log('Workspace schemas initialized. Sign in using the operator-provisioned credentials.');
