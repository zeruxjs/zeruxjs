import { planZeruxApp } from 'create-zerux-js';
import { writeProjectPlanAsync } from 'zclivo';

// Explicitly invoked only. Importing this example never generates, installs or starts an app.
/** Explicitly write a reviewed plan; importing this example performs no generation.
 * @param {string} destination - New exclusive target validated by zclivo.
 * @param {AbortSignal} signal - Optional cooperative write cancellation.
 * @param {string} renderer - Supported SSR renderer, defaulting to ZyroJS.
 * @returns {Promise<unknown>} Shared engine write result; dependencies and generated code remain unexecuted.
 */
export async function generate(destination, signal, renderer = 'zyro') {
  /** Reviewable public-import plan; writing occurs only when this exported example function is invoked. */
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
