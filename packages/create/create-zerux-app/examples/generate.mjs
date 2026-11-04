import { planZeruxApp } from 'create-zerux-js';
import { writeProjectPlanAsync } from 'zclivo';

// Explicitly invoked only. Importing this example never generates, installs or starts an app.
export async function generate(destination, signal, renderer = 'zyro') {
  const plan = planZeruxApp({
    destination,
    name: 'example-app',
    language: 'typescript',
    renderer,
    mode: 'ssr',
    port: 3000,
  });
  // Review plan.files and plan.digest before choosing to write.
  return writeProjectPlanAsync(plan, { signal });
}
