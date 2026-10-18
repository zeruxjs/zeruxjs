import recipes from "./zuix.recipes.mjs";
/** Docs utilities and component recipes, compiled at build time. */
export default {
  preflight: false,
  recipes,
  prefix: "ui-",
  extend: {
    screens: { wide: "701px", cards: "951px" },
    spacing: { card: "13px", neighbor: "15px", tight: "10px" },
  },
};
