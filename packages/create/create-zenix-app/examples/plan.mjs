import { planZenixApp } from 'create-zenix-js';
/** Inert reviewable public-import plan; this example does not write files, install or run code. */
export const plan = planZenixApp({
  name: 'cms',
  destination: './cms',
  port: 3000,
});
// Inspect plan.files. To write explicitly use writeProjectPlanAsync from zclivo.
