import recipes from "./zuix.recipes.mjs";
/** Homepage utility tokens; output uses only classes found in generated pages. */
export default {
  preflight: false,
  recipes,
  prefix: "ui-",
  extend: {
    screens: { tablet: "551px", desktop: "851px" },
    spacing: { neighbor: "15px" },
  },
};
