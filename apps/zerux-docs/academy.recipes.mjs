/** Accessible learning UI composed entirely from Zuixs utilities; no browser CSS runtime. */
const rule = (selector, apply, media) => ({
  selector,
  apply: apply.split(/\s+/),
  ...(media ? { media } : {}),
});
export const academyKeyframes = {
  "academy-drift":
    "0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}",
  "academy-flow":
    "0%,100%{opacity:0.45;transform:translateX(-3px)}50%{opacity:1;transform:translateX(3px)}",
};
export default [
  rule(".doc-article:not(.portal)", "ui-text-[16px] ui-leading-[1.85]"),
  rule(
    ".doc-article a.path-card, .doc-article a.solution-card, .doc-article .lesson-card > a, .doc-article .atlas-grid .topic-card",
    "ui-[text-decoration:none]",
  ),
  rule(
    ".path-card:focus-visible, .solution-card:focus-visible, .lesson-card:focus-within",
    "ui-[border-color:var(--accent)]",
  ),
  rule(
    ".portal-layout .docs-shell",
    "ui-block ui-max-w-[1240px] ui-p-[0_36px]",
  ),
  rule(
    ".portal-layout .sidebar, .portal-layout .right-rail, .portal-layout .breadcrumb, .portal-layout .article-meta",
    "ui-hidden",
  ),
  rule(".portal-layout main", "ui-p-[24px_0_40px]"),
  rule(
    ".academy-hero",
    "ui-grid ui-grid-template-columns-[1.1fr_1fr] ui-gap-[52px] ui-items-center ui-p-[55px_0_30px]",
  ),
  rule(
    ".portal .academy-hero h1",
    "ui-text-[clamp(46px,5.6vw,76px)] ui-tracking-[-3px] ui-leading-[1.04] ui-m-[14px_0_24px]",
  ),
  rule(".academy-hero h1 > span", "ui-text-[var(--accent)]"),
  rule(
    ".hero-description",
    "ui-text-[17px] ui-text-[var(--muted)] ui-max-w-[510px] ui-leading-[1.8]",
  ),
  rule(
    ".hero-actions",
    "ui-flex ui-flex-wrap ui-items-center ui-gap-[12px] ui-m-[24px_0_18px]",
  ),
  rule(".hero-proof", "ui-text-[12px] ui-text-[var(--muted)]"),
  rule(".eyebrow", "ui-text-[10px] ui-font-[750] ui-tracking-[0.12em]"),
  rule(
    ".request-visual",
    "ui-rounded-[22px] ui-overflow-hidden ui-[border:1px_solid_var(--line)] ui-[background:var(--code)] ui-text-[var(--code-text)] ui-[box-shadow:var(--shadow)] ui-[transform:rotate(-1deg)]",
  ),
  rule(
    ".visual-window",
    "ui-flex ui-items-center ui-gap-[6px] ui-p-[16px_20px] ui-[border-bottom:1px_solid_#ffffff20]",
  ),
  rule(
    ".visual-window > span",
    "ui-w-[7px] ui-h-[7px] ui-rounded-full ui-[background:#a6b0dc]",
  ),
  rule(
    ".visual-window small",
    "ui-ml-auto ui-text-[9px] ui-tracking-[0.1em] ui-text-[#b4bce7]",
  ),
  rule(
    ".visual-flow",
    "ui-flex ui-justify-between ui-items-center ui-gap-[8px] ui-p-[28px_20px_14px] ui-text-[11px]",
  ),
  rule(
    ".visual-flow > span",
    "ui-[border:1px_solid_#ffffff30] ui-rounded-[8px] ui-p-[8px_10px]",
  ),
  rule(
    ".visual-flow > i",
    "ui-text-[#b6aaff] ui-[font-style:normal] ui-text-[20px]",
  ),
  rule(
    ".portal .request-visual pre",
    "ui-m-[0] ui-p-[20px_28px] ui-text-[13px] ui-[border:0] ui-[background:transparent] ui-leading-[1.9]",
  ),
  rule(".code-comment", "ui-text-[#b5bfdf]"),
  rule(
    ".visual-caption",
    "ui-flex ui-items-center ui-gap-[9px] ui-p-[18px_20px] ui-text-[10px] ui-text-[#c0c8ed] ui-[background:#ffffff06]",
  ),
  rule(
    ".trace-button",
    "ui-w-full ui-[background:#ffffff0d] ui-text-[#e4e8ff] ui-[border:0] ui-[border-top:1px_solid_#ffffff20] ui-p-[12px_20px] ui-text-[11px] ui-[text-align:left]",
  ),
  rule(
    '.visual-flow [aria-current="step"]',
    "ui-[background:#b6aaff20] ui-[border-color:#b6aaff]",
  ),
  rule(
    ".live-pip",
    "ui-w-[6px] ui-h-[6px] ui-[background:#68d5d1] ui-rounded-full",
  ),
  rule(
    ".entry-paths",
    "ui-grid ui-grid-template-columns-[repeat(3,minmax(0,1fr))] ui-gap-[16px] ui-m-[32px_0_60px]",
  ),
  rule(
    ".path-card, .lesson-card, .solution-card",
    "ui-[background:var(--surface)] ui-[border:1px_solid_var(--line)] ui-rounded-[16px] ui-text-[var(--text)] ui-min-w-[0]",
  ),
  rule(".path-card", "ui-p-[26px] ui-flex ui-flex-col ui-items-start"),
  rule(
    ".path-card:hover, .lesson-card:hover, .solution-card:hover",
    "ui-[text-decoration:none] ui-[border-color:var(--accent)]",
  ),
  rule(
    ".path-icon",
    "ui-text-[12px] ui-font-[750] ui-text-[var(--accent)] ui-[background:var(--accent-soft)] ui-p-[5px_10px] ui-rounded-[7px]",
  ),
  rule(
    ".portal .path-card h2",
    "ui-text-[19px] ui-tracking-[-0.4px] ui-m-[22px_0_10px] ui-leading-[1.3]",
  ),
  rule(".path-card p", "ui-text-[13px] ui-text-[var(--muted)] ui-m-[0_0_22px]"),
  rule(
    ".path-card strong",
    "ui-text-[12px] ui-text-[var(--accent)] ui-mt-auto",
  ),
  rule(
    ".learning-dashboard",
    "ui-grid ui-grid-template-columns-[1fr_1fr] ui-gap-[30px] ui-[background:var(--panel)] ui-rounded-[20px] ui-p-[30px] ui-m-[34px_0_48px] ui-[border:1px_solid_var(--line)]",
  ),
  rule(
    ".learning-dashboard h2, .portal .learning-dashboard h2",
    "ui-text-[26px] ui-leading-[1.25] ui-m-[8px_0_14px] ui-tracking-[-0.8px]",
  ),
  rule(".learning-dashboard p", "ui-text-[13px] ui-text-[var(--muted)]"),
  rule(
    ".progress-stats",
    "ui-flex ui-flex-wrap ui-items-center ui-gap-[16px] ui-p-[20px] ui-[background:var(--surface)] ui-rounded-[12px] ui-[border:1px_solid_var(--line)]",
  ),
  rule(".progress-stats > span", "ui-text-[11px] ui-text-[var(--muted)]"),
  rule(
    ".progress-stats strong",
    "ui-block ui-text-[25px] ui-text-[var(--text)] ui-leading-[1.2]",
  ),
  rule("progress", "ui-w-full ui-h-[8px] ui-[accent-color:var(--accent)]"),
  rule(
    ".progress-stats .secondary-button",
    "ui-text-[12px] ui-w-full ui-[white-space:normal]",
  ),
  rule(
    ".progress-actions, .footer-controls",
    "ui-flex ui-flex-wrap ui-gap-[12px] ui-items-center",
  ),
  rule(
    ".progress-actions button, .footer-controls button, .utility-control",
    "ui-[font:inherit] ui-text-[var(--text)] ui-[background:var(--surface)] ui-[border:1px_solid_var(--line)] ui-rounded-[7px] ui-p-[7px_10px] ui-text-[11px] ui-min-h-[36px]",
  ),
  rule(".storage-status, .saved-reading", "ui-[grid-column:1/-1] ui-m-[0]"),
  rule(
    ".saved-reading",
    "ui-grid ui-grid-template-columns-[auto_1fr] ui-gap-[10px_28px] ui-[border-top:1px_solid_var(--line)] ui-pt-[20px]",
  ),
  rule(".saved-reading h3", "ui-text-[12px] ui-m-[0]"),
  rule(
    ".saved-reading ul",
    "ui-flex ui-flex-wrap ui-gap-[8px_18px] ui-list-none ui-p-[0] ui-m-[0] ui-text-[12px]",
  ),
  rule(
    ".section-heading",
    "ui-flex ui-justify-between ui-items-end ui-gap-[20px] ui-mb-[22px]",
  ),
  rule(
    ".section-heading h2, .portal .solution-finder h2, .portal .feature-atlas h2",
    "ui-text-[32px] ui-tracking-[-1px] ui-m-[5px_0_12px] ui-leading-[1.25]",
  ),
  rule(".section-heading > p", "ui-text-[12px] ui-text-[var(--muted)]"),
  rule(
    ".lesson-grid",
    "ui-grid ui-grid-template-columns-[repeat(2,minmax(0,1fr))] ui-gap-[14px] ui-list-none ui-p-[0] ui-m-[0]",
  ),
  rule(
    ".lesson-card > a",
    "ui-block ui-p-[25px] ui-text-[inherit] ui-[text-decoration:none] ui-h-full",
  ),
  rule(
    ".lesson-number",
    "ui-text-[13px] ui-text-[var(--accent)] ui-font-[750] ui-mr-[14px]",
  ),
  rule(".lesson-level", "ui-text-[10px] ui-text-[var(--muted)]"),
  rule(
    ".doc-article .lesson-card h3",
    "ui-text-[18px] ui-m-[16px_0_8px] ui-leading-[1.4]",
  ),
  rule(
    ".lesson-card p, .solution-card p",
    "ui-text-[13px] ui-text-[var(--muted)] ui-m-[0_0_15px]",
  ),
  rule(".lesson-state", "ui-text-[11px] ui-text-[var(--accent)] ui-font-[650]"),
  rule(
    '.lesson-card[data-complete="true"]',
    "ui-[border-color:var(--secondary)] ui-[background:var(--accent-soft)]",
  ),
  rule(".course-map, .solution-finder, .feature-atlas", "ui-m-[50px_0_70px]"),
  rule(
    ".solution-finder label",
    "ui-block ui-text-[12px] ui-font-[650] ui-m-[22px_0_8px]",
  ),
  rule(
    "#solution-filter",
    "ui-w-full ui-max-w-[620px] ui-p-[13px_16px] ui-[background:var(--surface)] ui-[border:1px_solid_var(--line)] ui-rounded-[10px] ui-text-[var(--text)] ui-[font:inherit]",
  ),
  rule("#solution-count", "ui-text-[11px] ui-text-[var(--muted)]"),
  rule(
    ".solution-grid, .atlas-grid",
    "ui-grid ui-grid-template-columns-[repeat(2,minmax(0,1fr))] ui-gap-[12px]",
  ),
  rule(".solution-card", "ui-p-[20px]"),
  rule(
    ".doc-article .solution-card h3",
    "ui-text-[14px] ui-m-[0_0_8px] ui-leading-[1.45]",
  ),
  rule(".solution-card h3 span", "ui-text-[var(--accent)] ui-[float:right]"),
  rule(".solution-card p", "ui-m-[0] ui-text-[12px]"),
  rule(".atlas-grid .topic-card h3", "ui-text-[17px] ui-m-[0_0_12px]"),
  rule(
    ".atlas-grid .topic-card > span",
    "ui-text-[11px] ui-font-[650] ui-text-[var(--accent)]",
  ),
  rule(
    ".handbook-promise",
    "ui-p-[30px] ui-rounded-[18px] ui-[border:1px_solid_var(--line)] ui-[background:linear-gradient(120deg,var(--panel),var(--surface))] ui-mb-[40px]",
  ),
  rule(".handbook-promise h2", "ui-m-[0_0_15px] ui-text-[25px]"),
  rule(".handbook-promise p", "ui-text-[14px] ui-text-[var(--muted)]"),
  rule(
    ".plain-language, .lesson-banner",
    "ui-[border:1px_solid_var(--line)] ui-[border-left:3px_solid_var(--secondary)] ui-rounded-[12px] ui-p-[18px_22px] ui-[background:var(--panel)] ui-m-[28px_0]",
  ),
  rule(".plain-language summary", "ui-font-[700] ui-text-[13px]"),
  rule(".plain-language p, .plain-language a", "ui-text-[13px]"),
  rule(
    ".lesson-banner",
    "ui-flex ui-flex-wrap ui-justify-between ui-gap-[10px] ui-text-[11px]",
  ),
  rule(
    ".lesson-step",
    "ui-font-[750] ui-text-[var(--accent)] ui-tracking-[0.08em]",
  ),
  rule(
    ".lesson-banner ul",
    "ui-[flex-basis:100%] ui-m-[0] ui-pl-[18px] ui-text-[13px]",
  ),
  rule(
    ".knowledge-check",
    "ui-m-[50px_0_20px] ui-p-[24px] ui-rounded-[16px] ui-[background:var(--panel)] ui-[border:1px_solid_var(--line)]",
  ),
  rule(".knowledge-check h2", "ui-m-[0_0_15px]"),
  rule(
    ".knowledge-check fieldset",
    "ui-min-w-[0] ui-[border:1px_solid_var(--line)] ui-rounded-[12px] ui-p-[18px] ui-m-[24px_0] ui-[background:var(--surface)]",
  ),
  rule(".knowledge-check legend", "ui-font-[650] ui-text-[14px] ui-p-[0_6px]"),
  rule(
    ".quiz-option",
    "ui-flex ui-items-start ui-gap-[10px] ui-p-[10px] ui-m-[6px_0] ui-rounded-[8px] ui-[border:1px_solid_var(--line)] ui-text-[13px] ui-cursor-pointer",
  ),
  rule(
    ".quiz-option:has(input:checked)",
    "ui-[background:var(--accent-soft)] ui-[border-color:var(--accent)]",
  ),
  rule(
    'input[type="radio"], input[type="checkbox"]',
    "ui-[accent-color:var(--accent)] ui-w-[17px] ui-h-[17px] ui-[flex-shrink:0] ui-mt-[4px]",
  ),
  rule(".quiz-feedback", "ui-text-[12px] ui-text-[var(--text)]"),
  rule('[data-result="correct"]', "ui-[border-color:var(--secondary)]"),
  rule(
    ".answer-explanation",
    "ui-text-[12px] ui-text-[var(--muted)] ui-mt-[12px]",
  ),
  rule(
    ".exercise-confirm",
    "ui-flex ui-items-start ui-gap-[10px] ui-text-[13px] ui-m-[24px_0]",
  ),
  rule(
    ".course-next",
    "ui-flex ui-flex-wrap ui-justify-between ui-gap-[14px] ui-items-center ui-mt-[30px] ui-text-[13px]",
  ),
  rule(
    ".shortcut-list",
    "ui-grid ui-grid-template-columns-[auto_1fr] ui-gap-[15px_25px] ui-text-[13px]",
  ),
  rule(".shortcut-list dd", "ui-m-[0]"),
  rule(".footer-controls", "ui-text-[11px]"),
  rule(".offline-page", "ui-max-w-[720px] ui-m-[10vh_auto] ui-p-[30px]"),
  rule(
    'select:focus-visible, textarea:focus-visible, input[type="radio"]:focus-visible, input[type="checkbox"]:focus-visible',
    "ui-[outline:3px_solid_var(--accent)] ui-outline-offset-[4px]",
  ),
  rule(
    ".request-visual",
    "ui-[animation:academy-drift_6s_ease-in-out_infinite]",
    "(prefers-reduced-motion: no-preference)",
  ),
  rule(
    ".visual-flow > i",
    "ui-[animation:academy-flow_2.5s_ease-in-out_infinite]",
    "(prefers-reduced-motion: no-preference)",
  ),
  rule(
    ".path-card, .lesson-card, .solution-card, [data-reveal]",
    "ui-[transition:transform_240ms_ease,border-color_240ms_ease,opacity_350ms_ease]",
    "(prefers-reduced-motion: no-preference)",
  ),
  rule(
    ".path-card:hover, .lesson-card:hover, .solution-card:hover",
    "ui-[transform:translateY(-3px)]",
    "(prefers-reduced-motion: no-preference)",
  ),
  rule(
    "[data-reveal].reveal-pending",
    "ui-[transform:translateY(16px)]",
    "(prefers-reduced-motion: no-preference)",
  ),
  rule(
    ':root[data-motion="off"], :root[data-motion="off"] *, :root[data-motion="off"] *::before, :root[data-motion="off"] *::after',
    "ui-![animation:none] ui-![transition:none] ui-![scroll-behavior:auto]",
  ),
  rule(".portal-layout .docs-shell", "ui-p-[0_22px]", "(max-width: 700px)"),
  rule(
    ".academy-hero",
    "ui-grid-template-columns-[1fr] ui-gap-[26px] ui-pt-[32px]",
    "(max-width: 900px)",
  ),
  rule(
    ".request-visual",
    "ui-max-w-[580px] ui-w-full ui-[transform:none]",
    "(max-width: 900px)",
  ),
  rule(
    ".entry-paths",
    "ui-grid-template-columns-[1fr] ui-gap-[12px]",
    "(max-width: 700px)",
  ),
  rule(".portal .path-card h2", "ui-mt-[14px]", "(max-width: 700px)"),
  rule(
    ".learning-dashboard",
    "ui-grid-template-columns-[1fr] ui-p-[20px] ui-gap-[18px]",
    "(max-width: 700px)",
  ),
  rule(
    ".lesson-grid, .solution-grid, .atlas-grid",
    "ui-grid-template-columns-[1fr]",
    "(max-width: 550px)",
  ),
  rule(
    ".saved-reading",
    "ui-grid-template-columns-[1fr]",
    "(max-width: 550px)",
  ),
  rule(".section-heading", "ui-block", "(max-width: 550px)"),
  rule(
    ".portal .academy-hero h1",
    "ui-text-[48px] ui-tracking-[-2px]",
    "(max-width: 550px)",
  ),
  rule(".hero-description", "ui-text-[15px]", "(max-width: 550px)"),
  rule(".knowledge-check", "ui-p-[16px]", "(max-width: 550px)"),
  rule(
    ".visual-flow",
    "ui-text-[10px] ui-p-[20px_15px_10px]",
    "(max-width: 550px)",
  ),
  rule(".visual-flow > span", "ui-p-[8px]", "(max-width: 550px)"),
  rule(
    ".utility-control",
    "ui-text-[10px] ui-p-[6px_8px]",
    "(max-width: 550px)",
  ),
  rule(
    ".learning-dashboard, .footer-controls, .quiz-option input, .exercise-confirm, .progress-actions, .course-next, .answer-explanation",
    "ui-hidden",
    "print",
  ),
  rule(
    ".portal-layout .docs-shell, .entry-paths, .lesson-grid, .solution-grid, .atlas-grid",
    "ui-block",
    "print",
  ),
];
