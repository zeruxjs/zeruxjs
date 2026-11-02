/** Documentation chrome: build-time Zuixs utilities, existing shared palette unchanged. */
const rule = (selector, tokens, media) => ({
  selector,
  apply: tokens.split(" "),
  ...(media ? { media } : {}),
});
export default [
  rule(
    ".site-header",
    "ui-h-[66px] ui-p-[0_max(24px,_calc((100vw_-_1440px)_/_2))] ui-gap-[20px]",
  ),
  rule(".brand", "ui-text-[22px] ui-tracking-[-0.7px]"),
  rule(
    ".brand small",
    "ui-text-[11px] ui-font-[500] ui-tracking-[0] ui-ml-[10px] ui-text-[var(--muted)]",
  ),
  rule(".brand-mark", "ui-rounded-[7px]"),
  rule(".header-tools", "ui-ml-auto ui-gap-[14px]"),
  rule(
    ".search-trigger",
    "ui-w-[250px] ui-gap-[8px] ui-whitespace-nowrap ui-justify-between ui-text-[12px] ui-p-[7px_11px] ui-rounded-[7px] ui-[background:var(--surface)]",
  ),
  rule(
    ".docs-navigation",
    "ui-sticky ui-top-[66px] ui-z-[19] ui-flex ui-items-center ui-justify-between ui-gap-[20px] ui-h-[48px] ui-p-[0_max(24px,_calc((100vw_-_1440px)_/_2))] ui-[background:var(--header)] ui-[backdrop-filter:blur(12px)] ui-[border-bottom:1px_solid_var(--line)]",
  ),
  rule(
    ".docs-tabs",
    "ui-flex ui-items-stretch ui-gap-[28px] ui-h-full ui-overflow-x-auto ui-whitespace-nowrap ui-[scrollbar-width:thin]",
  ),
  rule(
    ".docs-tabs a",
    "ui-flex ui-items-center ui-text-[13px] ui-font-[550] ui-text-[var(--muted)] ui-[border-bottom:2px_solid_transparent]",
  ),
  rule(".docs-tabs a:hover", "ui-text-[var(--text)] ui-[text-decoration:none]"),
  rule(
    '.docs-tabs a[aria-current="page"]',
    "ui-text-[var(--accent)] ui-[border-bottom-color:var(--accent)]",
  ),
  rule(
    ".ecosystem-link",
    "ui-text-[12px] ui-whitespace-nowrap ui-text-[var(--muted)]",
  ),
  rule(
    ".docs-shell",
    "ui-max-w-[1488px] ui-p-[0_24px] ui-grid-template-columns-[232px_minmax(0,_1fr)_208px] ui-gap-[48px]",
  ),
  rule(
    ".sidebar",
    "ui-top-[114px] ui-h-[calc(100dvh_-_114px)] ui-p-[28px_22px_28px_0] ui-text-[13px]",
  ),
  rule(
    ".sidebar-intro",
    "ui-mb-[24px] ui-pb-[20px] ui-[border-bottom:1px_solid_var(--line)]",
  ),
  rule(".sidebar-intro strong", "ui-text-[14px] ui-font-[650]"),
  rule(
    ".sidebar-intro p",
    "ui-text-[12px] ui-text-[var(--muted)] ui-leading-[1.6] ui-m-[9px_0_0]",
  ),
  rule(
    ".sidebar-icon",
    "ui-inline-flex ui-items-center ui-justify-center ui-w-[26px] ui-h-[26px] ui-rounded-[6px] ui-mr-[9px] ui-text-[var(--accent)] ui-[background:var(--accent-soft)]",
  ),
  rule(
    ".sidebar nav a",
    "ui-ml-[0] ui-p-[6px_10px] ui-text-[12px] ui-rounded-[5px]",
  ),
  rule(
    ".sidebar h2, .package-navigation summary",
    "ui-text-[12px] ui-font-[650] ui-tracking-[0]",
  ),
  rule("main", "ui-min-w-[0] ui-pt-[32px]"),
  rule(".breadcrumb", "ui-mb-[26px] ui-text-[12px] ui-flex-wrap"),
  rule(".article-meta", "ui-text-[11px] ui-text-[var(--muted)] ui-mb-[10px]"),
  rule(
    ".doc-article h1",
    "ui-text-[38px] ui-leading-[1.2] ui-tracking-[-1.2px] ui-m-[0_0_18px]",
  ),
  rule(
    ".lead",
    "ui-text-[17px] ui-leading-[1.8] ui-text-[var(--muted)] ui-mb-[26px]",
  ),
  rule(
    ".page-actions",
    "ui-m-[20px_0_30px] ui-p-[12px_0] ui-[border-bottom:1px_solid_var(--line)]",
  ),
  rule(
    ".page-actions a, .page-actions button",
    "ui-p-[5px_9px] ui-rounded-[5px] ui-text-[11px]",
  ),
  rule(
    ".right-rail",
    "ui-top-[114px] ui-pt-[34px] ui-max-h-[calc(100dvh_-_138px)]",
  ),
  rule(
    ".right-rail nav",
    "ui-[border-left:1px_solid_var(--line)] ui-pl-[14px]",
  ),
  rule(".right-rail h2", "ui-text-[12px] ui-font-[600]"),
  rule(
    ".doc-article h2[id], .doc-article h3[id]",
    "ui-[scroll-margin-top:140px]",
  ),
  rule(
    ".collection-grid",
    "ui-grid ui-grid-template-columns-[repeat(2,_minmax(0,_1fr))] ui-gap-[16px] ui-my-[32px]",
  ),
  rule(
    ".collection-card",
    "ui-block ui-p-[22px] ui-[border:1px_solid_var(--line)] ui-rounded-[10px] ui-[background:var(--surface)]",
  ),
  rule(
    ".doc-article a.collection-card, .doc-article a.collection-card:hover",
    "ui-[text-decoration:none]",
  ),
  rule(
    ".collection-card:hover",
    "ui-[border-color:var(--accent)] ui-[text-decoration:none]",
  ),
  rule(
    ".collection-number, .preview-label",
    "ui-text-[11px] ui-text-[var(--accent)] ui-font-[650] ui-tracking-[0.04em]",
  ),
  rule(
    ".collection-card h2",
    "ui-text-[18px] ui-m-[8px_0] ui-flex ui-justify-between ui-text-[var(--text)]",
  ),
  rule(
    ".collection-card p",
    "ui-text-[13px] ui-text-[var(--muted)] ui-m-[0] ui-leading-[1.7]",
  ),
  rule(".docs-welcome", "ui-py-[10px]"),
  rule(
    ".docs-welcome p",
    "ui-text-[16px] ui-leading-[1.9] ui-text-[var(--muted)]",
  ),
  rule(
    ".docs-learning",
    "ui-my-[36px] ui-p-[22px] ui-[border:1px_solid_var(--line)] ui-rounded-[10px]",
  ),
  rule(
    ".docs-shell",
    "ui-grid-template-columns-[218px_minmax(0,_1fr)] ui-gap-[32px]",
    "(max-width: 1200px)",
  ),
  rule(".right-rail", "ui-hidden", "(max-width: 1200px)"),
  rule(".search-trigger", "ui-w-[210px]", "(max-width: 1050px)"),
  rule(
    ".brand small, .ecosystem-link, .utility-control",
    "ui-hidden",
    "(max-width: 900px)",
  ),
  rule(".site-header", "ui-p-[0_18px] ui-gap-[12px]", "(max-width: 900px)"),
  rule(".docs-navigation", "ui-p-[0_18px]", "(max-width: 900px)"),
  rule(".docs-shell", "ui-block ui-p-[0_20px]", "(max-width: 760px)"),
  rule(
    ".sidebar",
    "ui-[position:static] ui-h-auto ui-p-[16px_0_0] ui-[border:0]",
    "(max-width: 760px)",
  ),
  rule(
    ".mobile-navigation > summary",
    "ui-block ui-text-[12px] ui-p-[10px_12px] ui-rounded-[7px] ui-[background:var(--surface)] ui-[border:1px_solid_var(--line)]",
    "(max-width: 760px)",
  ),
  rule(".sidebar-intro", "ui-hidden", "(max-width: 760px)"),
  rule(
    ".mobile-navigation > nav",
    "ui-max-h-[300px] ui-overflow-auto ui-p-[14px_8px]",
    "(max-width: 760px)",
  ),
  rule(".sidebar-foot", "ui-hidden", "(max-width: 760px)"),
  rule(".doc-article h1", "ui-text-[32px]", "(max-width: 760px)"),
  rule(".search-trigger", "ui-w-[auto] ui-gap-[8px]", "(max-width: 600px)"),
  rule(".search-trigger kbd, .github-link", "ui-hidden", "(max-width: 600px)"),
  rule(".version-switch", "ui-text-[11px]", "(max-width: 600px)"),
  rule(".brand", "ui-text-[18px]", "(max-width: 600px)"),
  rule(
    ".search-trigger",
    "ui-[font-size:0px] ui-p-[8px]",
    "(max-width: 480px)",
  ),
  rule(".search-trigger span", "ui-text-[20px]", "(max-width: 480px)"),
  rule(".header-tools", "ui-gap-[8px]", "(max-width: 480px)"),
  rule(".docs-tabs", "ui-gap-[22px]", "(max-width: 600px)"),
  rule(
    ".collection-grid",
    "ui-grid-template-columns-[minmax(0,_1fr)]",
    "(max-width: 600px)",
  ),
  rule(".docs-navigation", "ui-hidden", "print"),
];
