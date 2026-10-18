import type { ZuixRecipe } from "./types.js";
import { safeCondition, cssEscapeClass } from "./safety.js";

/** Compose base utilities into ordered component/typography recipes without raw declarations.
 * @param recipes Trusted application recipes; selectors and conditions are bounded and validated.
 * @param compile Compile one base utility using the application's theme, prefix and plugins.
 * @param limit Maximum recipes and total utility applications.
 * @returns CSS rules, preserving author order and declaration importance. No globals or I/O.
 */
export function compileRecipes(
  recipes: readonly ZuixRecipe[],
  compile: (token: string) => string | undefined,
  limit: number,
): string[] {
  if (!Array.isArray(recipes) || recipes.length > limit)
    throw new Error("zuix: recipe limit exceeded");
  let applications = 0;
  return recipes.map((recipe) => {
    // Block rule/declaration escapes; selectors remain trusted configuration, never visitor input.
    if (
      !recipe ||
      typeof recipe.selector !== "string" ||
      !recipe.selector.trim() ||
      recipe.selector.length > 1024 ||
      !/^[a-zA-Z0-9\s.#:[\]_'"()=~+*>|,-]+$/.test(recipe.selector) ||
      /[\r\n\t]/.test(recipe.selector) ||
      !Array.isArray(recipe.apply) ||
      !recipe.apply.length
    )
      throw new Error("zuix: invalid utility recipe");
    applications += recipe.apply.length;
    if (applications > limit)
      throw new Error("zuix: recipe utility limit exceeded");
    const declarations = recipe.apply
      .map((token: string) => {
        const compiled = typeof token === "string" ? compile(token) : undefined;
        // Variants produce selectors or at-rules. Recipes put those in selector/conditions explicitly.
        const opening = compiled?.indexOf("{") ?? -1;
        const selector = opening >= 0 ? compiled!.slice(0, opening) : "";
        if (
          !compiled ||
          selector !== `.${cssEscapeClass(token)}` ||
          compiled.slice(opening + 1, -1).includes("{")
        )
          throw new Error(`zuix: unsupported recipe utility: ${String(token)}`);
        return compiled.slice(opening + 1, -1);
      })
      .join("");
    let rule = `${recipe.selector}{${declarations}}`;
    for (const kind of ["container", "supports", "media"] as const) {
      const condition = recipe[kind];
      if (condition === undefined) continue;
      if (typeof condition !== "string" || !safeCondition(condition))
        throw new Error(`zuix: invalid recipe ${kind} condition`);
      rule = `@${kind} ${condition}{${rule}}`;
    }
    return rule;
  });
}
