import { themeRecipes, siteKeyframes } from "../scripts/site-design.mjs";
import recipes from "./zuix.recipes.mjs";
/** Homepage utility tokens; output uses only classes found in generated pages. */
export default {
  preflight: false,
  keyframes: siteKeyframes,
  recipes: [
    ...recipes,
    ...themeRecipes,
    {
      selector: "body",
      apply: [
        "ui-[background:radial-gradient(ellipse_at_75%_0%,var(--glow),transparent_60%)]",
      ],
    },
    { selector: "header", apply: ["ui-gap-[16px]", "ui-[flex-wrap:wrap]"] },
    { selector: "header nav", apply: ["ui-ml-[auto]"] },
    {
      selector: ".hero",
      apply: ["ui-relative", "ui-max-w-[920px]", "ui-p-[80px_0_64px]"],
    },
    { selector: ".hero h1 > span", apply: ["ui-text-[var(--accent)]"] },
    {
      selector: ".eyebrow",
      apply: ["ui-text-[var(--secondary)]", "ui-tracking-[0.12em]"],
    },
    {
      selector: ".hero-terminal",
      apply: [
        "ui-[background:var(--surface)]",
        "ui-[border:1px_solid_var(--line)]",
        "ui-rounded-[16px]",
        "ui-p-[20px_24px]",
        "ui-mt-[28px]",
        "ui-max-w-[580px]",
        "ui-shadow-[var(--shadow)]",
      ],
    },
    {
      selector: ".terminal-heading",
      apply: [
        "ui-text-[11px]",
        "ui-text-[var(--muted)]",
        "ui-mb-[14px]",
        "ui-flex",
        "ui-gap-[14px]",
      ],
    },
    {
      selector: ".terminal-heading > span",
      apply: ["ui-text-[var(--secondary)]", "ui-tracking-[3px]"],
    },
    {
      selector: ".hero-terminal code",
      apply: [
        "ui-font-mono",
        "ui-text-[clamp(12px,2vw,16px)]",
        "ui-text-[var(--text)]",
      ],
    },
    {
      selector: ".hero-terminal code > span",
      apply: ["ui-text-[var(--accent)]"],
    },
    {
      selector: ".hero-terminal p, .hero-terminal a",
      apply: ["ui-text-[11px]"],
    },
    {
      selector: ".hero-terminal p",
      apply: ["ui-text-[var(--muted)]", "ui-mb-[8px]"],
    },
    { selector: ".project, .package", apply: ["ui-rounded-[16px]"] },
    {
      selector: ".primary",
      apply: [
        "ui-text-[var(--on-accent)]",
        "ui-rounded-[999px]",
        "ui-shadow-[var(--shadow)]",
      ],
    },
    { selector: ".brand > span", apply: ["ui-text-[var(--on-accent)]"] },
    {
      selector: ".actions > a",
      apply: ["ui-[display:inline-flex]", "ui-items-center"],
    },
    {
      selector: ".hero",
      apply: ["ui-p-[48px_0]"],
      media: "(max-width: 550px)",
    },
    {
      selector: "header nav",
      apply: [
        "ui-[order:3]",
        "ui-w-full",
        "ui-[justify-content:space-between]",
        "ui-mt-[6px]",
      ],
      media: "(max-width: 550px)",
    },
    {
      selector: "header nav a:first-child, header nav a:last-child",
      apply: ["ui-block"],
      media: "(max-width: 550px)",
    },
  ],
  prefix: "ui-",
  extend: {
    screens: { tablet: "551px", desktop: "851px" },
    spacing: { neighbor: "15px" },
  },
};
