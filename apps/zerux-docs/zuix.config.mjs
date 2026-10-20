import { themeRecipes, siteKeyframes } from "../../scripts/site-design.mjs";
import recipes from "./zuix.recipes.mjs";
import academyRecipes, { academyKeyframes } from "./academy.recipes.mjs";
/** Docs utilities and component recipes, compiled at build time. */
export default {
  preflight: false,
  keyframes: { ...siteKeyframes, ...academyKeyframes },
  recipes: [
    ...recipes,
    ...themeRecipes,
    {
      selector: ".portal-intro",
      apply: [
        "ui-[background:radial-gradient(ellipse_at_80%_0%,var(--glow),transparent_65%)]",
        "ui-rounded-[20px]",
        "ui-p-[24px_20px]",
        "ui-[margin-left:-20px]",
        "ui-[margin-right:-20px]",
      ],
    },
    {
      selector: ".portal-card, .topic-card",
      apply: ["ui-rounded-[14px]", "ui-[background:var(--surface)]"],
    },
    { selector: ".eyebrow", apply: ["ui-text-[var(--secondary)]"] },
    {
      selector: ".primary-button",
      apply: ["ui-text-[var(--on-accent)]", "ui-rounded-[999px]"],
    },
    { selector: ".secondary-button", apply: ["ui-rounded-[999px]"] },
    {
      selector: ".brand-mark",
      apply: [
        "ui-[background:var(--accent)]",
        "ui-text-[var(--on-accent)]",
        "ui-rounded-[10px]",
      ],
    },
    { selector: ".site-header", apply: ["ui-gap-[24px]"] },
    { selector: ".top-nav", apply: ["ui-gap-[18px]"] },
    { selector: ".header-tools", apply: ["ui-gap-[12px]"] },
    {
      selector: ".page-actions",
      apply: [
        "ui-flex",
        "ui-flex-wrap",
        "ui-gap-[10px]",
        "ui-mt-[32px]",
        "ui-p-[16px_0]",
        "ui-[border-top:1px_solid_var(--line)]",
        "ui-text-[12px]",
      ],
    },
    {
      selector: ".page-actions a, .copy-page",
      apply: [
        "ui-[font:inherit]",
        "ui-[border:1px_solid_var(--line)]",
        "ui-[background:var(--surface)]",
        "ui-rounded-[8px]",
        "ui-p-[7px_12px]",
        "ui-text-[var(--accent)]",
      ],
    },
    {
      selector: ".reading-progress",
      apply: [
        "ui-fixed",
        "ui-top-[0]",
        "ui-left-[0]",
        "ui-w-full",
        "ui-h-[3px]",
        "ui-z-[50]",
        "ui-[background:linear-gradient(90deg,var(--accent),var(--secondary))]",
        "ui-[transform:scaleX(var(--progress,0))]",
        "ui-[transform-origin:left]",
        "ui-pointer-events-none",
      ],
    },
    {
      selector: ".site-header",
      apply: ["ui-gap-[10px]"],
      media: "(max-width: 950px)",
    },
    {
      selector: ".header-tools",
      apply: ["ui-gap-[8px]"],
      media: "(max-width: 700px)",
    },
    {
      selector: ".theme-toggle",
      apply: ["ui-text-[10px]", "ui-p-[6px_8px]"],
      media: "(max-width: 700px)",
    },
    {
      selector: ".brand",
      apply: ["ui-text-[19px]"],
      media: "(max-width: 700px)",
    },
    {
      selector: ".reading-progress, .page-actions",
      apply: ["ui-hidden"],
      media: "print",
    },
    ...academyRecipes,
  ],
  prefix: "ui-",
  extend: {
    screens: { wide: "701px", cards: "951px" },
    spacing: { card: "13px", neighbor: "15px", tight: "10px" },
  },
};
