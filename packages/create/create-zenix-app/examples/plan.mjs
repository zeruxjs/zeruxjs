import { planZenixApp } from "create-zenix-js";
export const plan = planZenixApp({
  name: "cms",
  destination: "./cms",
  port: 3000,
});
// Inspect plan.files. To write explicitly use writeProjectPlanAsync from zclivo.
