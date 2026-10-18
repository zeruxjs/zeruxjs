/** Shared build-time design tokens. Every declaration is compiled by Zuixs. */
const light = {
  bg: "#f8f9fe",
  surface: "#ffffff",
  text: "#20233c",
  muted: "#606682",
  line: "#dfe3f1",
  panel: "#f0f2fb",
  accent: "#5546d9",
  "accent-soft": "#eeebff",
  "on-accent": "#ffffff",
  secondary: "#087f83",
  glow: "#8170ee15",
  selection: "#d9d3ff",
  header: "rgba(248,249,254,0.94)",
  code: "#171c35",
  "code-text": "#e4e8ff",
  shadow: "0_12px_32px_rgba(45,38,101,0.10)",
};
const dark = {
  bg: "#101321",
  surface: "#191d31",
  text: "#ecedff",
  muted: "#b0b5d0",
  line: "#303650",
  panel: "#20263d",
  accent: "#b6aaff",
  "accent-soft": "#302849",
  "on-accent": "#191329",
  secondary: "#68d5d1",
  glow: "#8170ee19",
  selection: "#493d73",
  header: "rgba(16,19,33,0.94)",
  code: "#0d1020",
  "code-text": "#e3e7ff",
  shadow: "0_16px_40px_rgba(0,0,0,0.24)",
};
/** Convert trusted palette values into custom-property utilities. @param {object} palette Theme tokens. @returns {string[]} Utilities. No globals. */
const tokens = (palette) =>
  Object.entries(palette).map(([key, value]) => `ui-[--${key}:${value}]`);
export const themeRecipes = [
  { selector: ":root", apply: [...tokens(light), "ui-color-scheme-light"] },
  {
    selector: ':root[data-theme="dark"]',
    apply: [...tokens(dark), "ui-color-scheme-dark"],
  },
  {
    selector: ':root:not([data-theme="light"])',
    apply: [...tokens(dark), "ui-color-scheme-dark"],
    media: "(prefers-color-scheme: dark)",
  },
  {
    selector: "::selection",
    apply: ["ui-[background:var(--selection)]", "ui-text-[var(--text)]"],
  },
  {
    selector: ".theme-toggle",
    apply: [
      "ui-[font:inherit]",
      "ui-text-[12px]",
      "ui-font-[650]",
      "ui-text-[var(--text)]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-[background:var(--surface)]",
      "ui-rounded-[999px]",
      "ui-p-[8px_12px]",
      "ui-cursor-pointer",
      "ui-whitespace-nowrap",
      "ui-[flex-shrink:0]",
    ],
  },
  {
    selector: ".theme-toggle:focus-visible",
    apply: ["ui-[outline:3px_solid_var(--accent)]", "ui-outline-offset-[4px]"],
  },
  {
    selector:
      ".project, .package, .portal-card, .topic-card, .primary, .primary-button, .secondary-button, .theme-toggle",
    apply: [
      "ui-[transition:transform_180ms_ease,box-shadow_180ms_ease,border-color_180ms_ease,background-color_180ms_ease]",
    ],
    media: "(prefers-reduced-motion: no-preference)",
  },
  {
    selector:
      ".project:hover, .package:hover, .portal-card:hover, .topic-card:hover",
    apply: [
      "ui-[transform:translateY(-3px)]",
      "ui-shadow-[var(--shadow)]",
      "ui-border-[var(--accent)]",
    ],
    media: "(hover: hover) and (prefers-reduced-motion: no-preference)",
  },
  {
    selector: ".hero, .portal-intro",
    apply: ["ui-animate-[site-enter_450ms_ease-out_both]"],
    media: "(prefers-reduced-motion: no-preference)",
  },
];
export const siteKeyframes = {
  "site-enter":
    "from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}",
};
