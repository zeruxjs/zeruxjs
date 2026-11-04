import { planZyroApp } from 'create-zyro-app';
export const plan = planZyroApp({ name: 'demo', destination: './demo', language: 'javascript', mode: 'static', port: 3000, basePath: '/demo' });
// Inspect plan.files; writing requires an explicit writeProjectPlanAsync(plan) from zclivo.
