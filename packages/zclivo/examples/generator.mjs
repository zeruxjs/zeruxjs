import {
  minimalProjectGenerator,
  writeProjectPlanAsync,
  registerGeneratorCommand,
  CommandRegistry,
} from 'zclivo';

// Explicitly invoked by a host; importing this file performs no generation.
export async function generate(destination, signal) {
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
export function creatorCommands(generator, out) {
  const commands = new CommandRegistry();
  registerGeneratorCommand(commands, {
    keyword: 'creator',
    command: 'create',
    generator,
    out,
  });
  return commands; // dispatch('creator', ['create', path, '--yes', '--dry-run'])
}
