import { planZyroApp } from 'create-zyro-app';
/** Inert reviewable static-mode plan; importing never writes, installs or starts the app. */
export const plan = planZyroApp({
  name: 'demo',
  destination: './demo',
  language: 'javascript',
  mode: 'static',
  port: 3000,
  basePath: '/demo',
});
// Inspect plan.files; writing requires an explicit writeProjectPlanAsync(plan) from zclivo.
