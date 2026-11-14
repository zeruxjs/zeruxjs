import {
  minimalProjectGenerator,
  writeProjectPlanAsync,
  registerGeneratorCommand,
  CommandRegistry,
} from 'zclivo';

// Explicitly invoked by a host; importing this file performs no generation.
/** Explicitly plan/write a new minimal app without installing or starting it.
 * @param {string} destination - New exclusive target under a trusted existing parent.
 * @param {AbortSignal} signal - Optional cooperative write lifetime.
 * @returns {Promise<object>} Shared-engine write receipt after owned cleanup.
 */
export async function generate(destination, signal) {
  /** Reviewable deterministic plan; no file is written until the explicit writer below. */
  const plan = minimalProjectGenerator.plan({
    destination,
    name: 'example-app',
    language: 'typescript',
    port: 3000,
    mode: 'minimal',
    renderer: 'none',
  });
  // Review plan.files / plan.digest before explicitly invoking its writer.
  return writeProjectPlanAsync(plan, { signal });
}

// Creator packages register their own trusted templates with createProjectGenerator,
// then use this command registration; no discovery or shell commands are needed.
/** Register one explicit host generator with an isolated command registry.
 * @param {import('zclivo').ProjectGenerator} generator - Trusted explicitly registered template engine.
 * @param {(message: string) => void} out - Public plan/write receipt callback.
 * @returns {import('zclivo').CommandRegistry} Inert registry; dispatch is a separate explicit host action.
 */
export function creatorCommands(generator, out) {
  /** Isolated inert registry; no process listeners or CLI run are created here. */
  const commands = new CommandRegistry();
  registerGeneratorCommand(commands, {
    keyword: 'creator',
    command: 'create',
    generator,
    out,
  });
  return commands; // dispatch('creator', ['create', path, '--yes', '--dry-run'])
}
