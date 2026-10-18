/** Utility compositions for document elements and component states. No raw CSS declarations. */
export default [
  {
    selector: ":root",
    apply: [
      "ui-[font-family:Inter,_ui-sans-serif,_system-ui,_-apple-system,_BlinkMacSystemFont,_Segoe_UI,_sans-serif]",
      "ui-[--bg:#fff]",
      "ui-[--text:#202836]",
      "ui-[--muted:#647184]",
      "ui-[--line:#e6ebef]",
      "ui-[--panel:#f7f9fb]",
      "ui-[--accent:#087f69]",
      "ui-[--accent-soft:#edf8f3]",
      "ui-[--code:#131e2b]",
      "ui-[--code-text:#dfebf3]",
      "ui-[--header:rgba(255,_255,_255,_0.96)]",
      "ui-text-[var(--text)]",
      "ui-[background:var(--bg)]",
      "ui-leading-[1.7]",
      "ui-color-scheme-light",
    ],
  },
  {
    selector: ':root[data-theme="dark"]',
    apply: [
      "ui-[--bg:#10151d]",
      "ui-[--text:#e6edf5]",
      "ui-[--muted:#a0aec1]",
      "ui-[--line:#283342]",
      "ui-[--panel:#17212e]",
      "ui-[--accent:#6cd5b4]",
      "ui-[--accent-soft:#17332b]",
      "ui-[--code:#0c1119]",
      "ui-[--code-text:#dce8f3]",
      "ui-[--header:rgba(16,_21,_29,_0.97)]",
      "ui-color-scheme-dark",
    ],
  },
  {
    selector: ':root:not([data-theme="light"])',
    apply: [
      "ui-[--bg:#10151d]",
      "ui-[--text:#e6edf5]",
      "ui-[--muted:#a0aec1]",
      "ui-[--line:#283342]",
      "ui-[--panel:#17212e]",
      "ui-[--accent:#6cd5b4]",
      "ui-[--accent-soft:#17332b]",
      "ui-[--code:#0c1119]",
      "ui-[--code-text:#dce8f3]",
      "ui-[--header:rgba(16,_21,_29,_0.97)]",
      "ui-color-scheme-dark",
    ],
    media: "(prefers-color-scheme: dark)",
  },
  {
    selector: "*",
    apply: ["ui-[box-sizing:border-box]"],
  },
  {
    selector: "[hidden]",
    apply: ["ui-!hidden"],
  },
  {
    selector: "body",
    apply: ["ui-m-[0]"],
  },
  {
    selector: "button, input",
    apply: ["ui-[font:inherit]"],
  },
  {
    selector: "button, summary",
    apply: ["ui-cursor-pointer"],
  },
  {
    selector: "button",
    apply: ["ui-text-[inherit]"],
  },
  {
    selector: "a",
    apply: ["ui-text-[var(--accent)]", "ui-[text-decoration:none]"],
  },
  {
    selector: "a:hover",
    apply: ["ui-[text-decoration:underline]"],
  },
  {
    selector:
      "a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible",
    apply: ["ui-[outline:3px_solid_var(--accent)]", "ui-outline-offset-[4px]"],
  },
  {
    selector: "img",
    apply: ["ui-max-w-full", "ui-h-auto"],
  },
  {
    selector: "::selection",
    apply: ["ui-[background:#92dcc3]", "ui-text-[#102e27]"],
  },
  {
    selector: ".site-header",
    apply: [
      "ui-h-[76px]",
      "ui-sticky",
      "ui-top-[0]",
      "ui-z-[20]",
      "ui-flex",
      "ui-items-center",
      "ui-gap-[42px]",
      "ui-p-[0_34px]",
      "ui-[border-bottom:1px_solid_var(--line)]",
      "ui-[background:var(--header)]",
      "ui-[backdrop-filter:blur(12px)]",
    ],
  },
  {
    selector: ".brand",
    apply: [
      "ui-flex",
      "ui-items-center",
      "ui-gap-[2px]",
      "ui-text-[23px]",
      "ui-tracking-[-1px]",
      "ui-font-[800]",
      "ui-text-[var(--text)]",
      "ui-whitespace-nowrap",
    ],
  },
  {
    selector: ".brand > span:not(.brand-mark)",
    apply: ["ui-text-[var(--accent)]"],
  },
  {
    selector: ".brand small",
    apply: [
      "ui-text-[13px]",
      "ui-tracking-[0]",
      "ui-font-[400]",
      "ui-text-[var(--muted)]",
      "ui-ml-[14px]",
      "ui-[border-left:1px_solid_var(--line)]",
      "ui-pl-[14px]",
    ],
  },
  {
    selector: ".brand-mark",
    apply: [
      "ui-grid",
      "ui-place-items-center",
      "ui-w-[31px]",
      "ui-h-[32px]",
      "ui-rounded-[8px]",
      "ui-[background:var(--accent)]",
      "ui-text-[var(--bg)]",
      "ui-text-[20px]",
      "ui-font-[750]",
      "ui-mr-[9px]",
    ],
  },
  {
    selector: ".top-nav",
    apply: ["ui-flex", "ui-gap-[26px]"],
  },
  {
    selector: ".top-nav a, .github-link",
    apply: ["ui-text-[12px]", "ui-font-[600]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".header-tools",
    apply: ["ui-ml-[auto]", "ui-flex", "ui-items-center", "ui-gap-[18px]"],
  },
  {
    selector: ".search-trigger",
    apply: [
      "ui-text-[12px]",
      "ui-flex",
      "ui-items-center",
      "ui-gap-[45px]",
      "ui-[background:var(--panel)]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[7px]",
      "ui-p-[8px_10px]",
      "ui-text-[var(--muted)]",
    ],
  },
  {
    selector: "kbd",
    apply: [
      "ui-[font:10px_ui-monospace,_monospace]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[4px]",
      "ui-p-[1px_4px]",
    ],
  },
  {
    selector: ".theme-toggle",
    apply: [
      "ui-[background:none]",
      "ui-[border:0]",
      "ui-text-[20px]",
      "ui-p-[3px]",
      "ui-min-w-[26px]",
    ],
  },
  {
    selector: ".version-switch",
    apply: ["ui-text-[12px]", "ui-relative"],
  },
  {
    selector: ".version-switch summary",
    apply: [
      "ui-[list-style:none]",
      "ui-whitespace-nowrap",
      "ui-text-[var(--muted)]",
    ],
  },
  {
    selector: ".version-switch nav",
    apply: [
      "ui-absolute",
      "ui-top-[33px]",
      "ui-right-[0]",
      "ui-min-w-[220px]",
      "ui-p-[12px]",
      "ui-[background:var(--bg)]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[8px]",
      "ui-[box-shadow:0_12px_24px_#0001]",
    ],
  },
  {
    selector: ".version-switch nav a",
    apply: ["ui-block", "ui-p-[7px]"],
  },
  {
    selector: ".version-switch small",
    apply: ["ui-block", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".docs-shell",
    apply: [
      "ui-max-w-[1540px]",
      "ui-m-[0_auto]",
      "ui-p-[0_32px]",
      "ui-grid",
      "ui-grid-template-columns-[238px_minmax(0,_790px)_205px]",
      "ui-gap-[43px]",
    ],
  },
  {
    selector: ".sidebar",
    apply: [
      "ui-sticky",
      "ui-top-[76px]",
      "ui-h-[calc(100dvh_-_76px)]",
      "ui-overflow-auto",
      "ui-p-[28px_20px_28px_0]",
      "ui-[border-right:1px_solid_var(--line)]",
      "ui-text-[12px]",
      "ui-[scrollbar-width:thin]",
      "ui-[scrollbar-color:var(--line)_transparent]",
    ],
  },
  {
    selector: ".mobile-navigation > summary",
    apply: ["ui-hidden"],
  },
  {
    selector: ".sidebar nav section",
    apply: ["ui-mb-[23px]"],
  },
  {
    selector: ".sidebar h2",
    apply: [
      "ui-text-[11px]",
      "ui-tracking-[0.03em]",
      "ui-text-[var(--text)]",
      "ui-m-[0_0_8px]",
      "ui-font-[750]",
    ],
  },
  {
    selector: ".sidebar nav a",
    apply: [
      "ui-block",
      "ui-p-[5px_10px]",
      "ui-ml-[-10px]",
      "ui-text-[var(--muted)]",
      "ui-rounded-[5px]",
      "ui-leading-[1.6]",
    ],
  },
  {
    selector: ".sidebar nav a:hover",
    apply: [
      "ui-text-[var(--accent)]",
      "ui-[text-decoration:none]",
      "ui-[background:var(--panel)]",
    ],
  },
  {
    selector: '.sidebar nav a[aria-current="page"]',
    apply: [
      "ui-[background:var(--accent-soft)]",
      "ui-text-[var(--accent)]",
      "ui-font-[650]",
    ],
  },
  {
    selector: ".package-navigation summary",
    apply: ["ui-text-[11px]", "ui-font-[750]", "ui-mb-[10px]"],
  },
  {
    selector: ".package-navigation summary span",
    apply: ["ui-text-[var(--muted)]", "ui-font-[400]", "ui-pl-[8px]"],
  },
  {
    selector: ".sidebar-foot",
    apply: [
      "ui-text-[10px]",
      "ui-text-[var(--muted)]",
      "ui-pt-[25px]",
      "ui-mt-[28px]",
      "ui-[border-top:1px_solid_var(--line)]",
      "ui-leading-[1.9]",
    ],
  },
  {
    selector: "main",
    apply: ["ui-p-[35px_0_30px]", "ui-min-w-[0]"],
  },
  {
    selector: ".breadcrumb",
    apply: [
      "ui-flex",
      "ui-gap-[10px]",
      "ui-text-[11px]",
      "ui-text-[var(--muted)]",
      "ui-mb-[38px]",
    ],
  },
  {
    selector: ".breadcrumb a",
    apply: ["ui-text-[var(--muted)]"],
  },
  {
    selector: ".breadcrumb span",
    apply: ["ui-text-[var(--muted)]"],
  },
  {
    selector: ".article-meta",
    apply: [
      "ui-text-[10px]",
      "ui-tracking-[0.05em]",
      "ui-text-[var(--muted)]",
      "ui-mb-[12px]",
    ],
  },
  {
    selector: ".article-meta > span:first-child",
    apply: [
      "ui-text-[var(--accent)]",
      "ui-font-[700]",
      "ui-[text-transform:uppercase]",
    ],
  },
  {
    selector: "h1",
    apply: [
      "ui-text-[clamp(31px,_3.4vw,_43px)]",
      "ui-leading-[1.16]",
      "ui-tracking-[-1.6px]",
      "ui-m-[0_0_18px]",
      "ui-[overflow-wrap:anywhere]",
    ],
  },
  {
    selector: ".lead",
    apply: [
      "ui-text-[17px]",
      "ui-leading-[1.65]",
      "ui-text-[var(--muted)]",
      "ui-m-[0_0_37px]",
    ],
  },
  {
    selector: ".doc-article",
    apply: ["ui-text-[14px]", "ui-leading-[1.9]"],
  },
  {
    selector: ".doc-article h2",
    apply: [
      "ui-text-[22px]",
      "ui-leading-[1.4]",
      "ui-tracking-[-0.5px]",
      "ui-m-[42px_0_16px]",
      "ui-[scroll-margin-top:100px]",
    ],
  },
  {
    selector: ".doc-article h3",
    apply: [
      "ui-text-[17px]",
      "ui-leading-[1.5]",
      "ui-tracking-[-0.2px]",
      "ui-m-[28px_0_12px]",
      "ui-[scroll-margin-top:100px]",
    ],
  },
  {
    selector: ".doc-article h4",
    apply: [
      "ui-text-[15px]",
      "ui-m-[23px_0_12px]",
      "ui-[scroll-margin-top:100px]",
    ],
  },
  {
    selector: ".doc-article p",
    apply: ["ui-text-[var(--muted)]", "ui-m-[16px_0]"],
  },
  {
    selector: ".doc-article li",
    apply: ["ui-text-[var(--muted)]", "ui-pl-[4px]", "ui-m-[6px_0]"],
  },
  {
    selector: ".doc-article ul, .doc-article ol",
    apply: ["ui-pl-[22px]"],
  },
  {
    selector: ".doc-article strong",
    apply: ["ui-text-[var(--text)]", "ui-font-[650]"],
  },
  {
    selector: ".doc-article a:not(.anchor)",
    apply: [
      "ui-[text-decoration:underline]",
      "ui-[text-decoration-color:color-mix(in_srgb,_var(--accent)_40%,_transparent)]",
      "ui-[text-underline-offset:3px]",
    ],
  },
  {
    selector: ".anchor",
    apply: ["ui-text-[16px]", "ui-font-[400]", "ui-[opacity:0]", "ui-ml-[9px]"],
  },
  {
    selector: "h2:hover .anchor, h3:hover .anchor, .anchor:focus-visible",
    apply: ["ui-[opacity:1]"],
  },
  {
    selector: ".callout, blockquote",
    apply: [
      "ui-[background:var(--accent-soft)]",
      "ui-[border:1px_solid_color-mix(in_srgb,_var(--accent)_18%,_var(--line))]",
      "ui-[border-left:3px_solid_var(--accent)]",
      "ui-p-[17px_21px]",
      "ui-m-[28px_0]",
      "ui-rounded-[7px]",
      "ui-text-[13px]",
    ],
  },
  {
    selector: ".callout p, blockquote p",
    apply: ["ui-!m-[5px_0]"],
  },
  {
    selector: ".callout > a",
    apply: ["ui-text-[12px]", "ui-inline-block", "ui-mt-[8px]"],
  },
  {
    selector: ".callout strong",
    apply: ["ui-text-[13px]"],
  },
  {
    selector: "code",
    apply: [
      "ui-[font-family:ui-monospace,_SFMono-Regular,_Consolas,_monospace]",
      "ui-text-[0.88em]",
    ],
  },
  {
    selector: "p code, li code, td > code",
    apply: [
      "ui-[background:var(--panel)]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[4px]",
      "ui-p-[1px_4px]",
      "ui-[overflow-wrap:anywhere]",
      "ui-text-[var(--text)]",
    ],
  },
  {
    selector: "pre",
    apply: [
      "ui-overflow-auto",
      "ui-[font:12px/1.85_ui-monospace,_SFMono-Regular,_Consolas,_monospace]",
      "ui-p-[18px_21px]",
      "ui-[tab-size:2]",
      "ui-[background:var(--code)]",
      "ui-text-[var(--code-text)]",
      "ui-rounded-[7px]",
      "ui-max-w-full",
    ],
  },
  {
    selector: "pre code",
    apply: ["ui-[font:inherit]"],
  },
  {
    selector: ".code-block",
    apply: [
      "ui-m-[22px_0]",
      "ui-[background:var(--code)]",
      "ui-text-[var(--code-text)]",
      "ui-rounded-[8px]",
      "ui-overflow-hidden",
      "ui-[border:1px_solid_var(--line)]",
    ],
  },
  {
    selector: ".code-block pre",
    apply: ["ui-m-[0]", "ui-rounded-none"],
  },
  {
    selector: ".code-bar",
    apply: [
      "ui-p-[8px_15px]",
      "ui-[border-bottom:1px_solid_#ffffff12]",
      "ui-[font:10px_ui-monospace,_monospace]",
      "ui-min-h-[34px]",
      "ui-text-[#b5c9d8]",
    ],
  },
  {
    selector: ".copy-code",
    apply: [
      "ui-[font:10px_ui-sans-serif,_system-ui]",
      "ui-[background:#ffffff0b]",
      "ui-[border:1px_solid_#ffffff20]",
      "ui-text-[#c8dce8]",
      "ui-rounded-[4px]",
      "ui-p-[3px_8px]",
    ],
  },
  {
    selector: "table",
    apply: [
      "ui-border-collapse",
      "ui-w-full",
      "ui-block",
      "ui-overflow-auto",
      "ui-m-[23px_0]",
      "ui-text-[12px]",
      "ui-leading-[1.8]",
    ],
  },
  {
    selector: "thead, tbody",
    apply: ["ui-w-full"],
  },
  {
    selector: "th",
    apply: [
      "ui-font-[650]",
      "ui-text-[var(--text)]",
      "ui-[background:var(--panel)]",
    ],
  },
  {
    selector: "td, th",
    apply: [
      "ui-text-left",
      "ui-p-[11px_13px]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-[vertical-align:top]",
    ],
  },
  {
    selector: "td",
    apply: ["ui-text-[var(--muted)]"],
  },
  {
    selector: "td pre",
    apply: [
      "ui-text-[10px]",
      "ui-[background:var(--panel)]",
      "ui-text-[var(--text)]",
      "ui-m-[0]",
      "ui-p-[9px]",
    ],
  },
  {
    selector: ".right-rail",
    apply: [
      "ui-sticky",
      "ui-top-[76px]",
      "ui-h-[max-content]",
      "ui-max-h-[calc(100dvh_-_100px)]",
      "ui-overflow-auto",
      "ui-pt-[39px]",
      "ui-[scrollbar-width:thin]",
    ],
  },
  {
    selector: ".right-rail h2",
    apply: ["ui-text-[11px]", "ui-m-[0_0_12px]", "ui-tracking-[0.03em]"],
  },
  {
    selector: ".right-rail nav",
    apply: ["ui-[border-left:1px_solid_var(--line)]"],
  },
  {
    selector: ".right-rail nav a",
    apply: [
      "ui-block",
      "ui-text-[11px]",
      "ui-leading-[1.7]",
      "ui-text-[var(--muted)]",
      "ui-p-[5px_0_5px_15px]",
      "ui-[border-left:1px_solid_transparent]",
      "ui-ml-[-1px]",
    ],
  },
  {
    selector: ".right-rail nav a.toc-depth-3",
    apply: ["ui-pl-[25px]", "ui-text-[10px]"],
  },
  {
    selector: ".right-rail nav a[aria-current]",
    apply: ["ui-text-[var(--accent)]", "ui-border-[var(--accent)]"],
  },
  {
    selector: ".rail-note",
    apply: [
      "ui-mt-[27px]",
      "ui-[border-top:1px_solid_var(--line)]",
      "ui-pt-[17px]",
      "ui-text-[10px]",
      "ui-text-[var(--muted)]",
      "ui-leading-[2]",
    ],
  },
  {
    selector: ".related",
    apply: [
      "ui-mt-[45px]",
      "ui-[border-top:1px_solid_var(--line)]",
      "ui-pt-[20px]",
    ],
  },
  {
    selector: ".related h2",
    apply: ["ui-text-[16px]"],
  },
  {
    selector: ".topic-card",
    apply: [
      "ui-p-[17px]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[7px]",
      "ui-text-[var(--text)]",
      "ui-min-w-[0]",
      "ui-[overflow-wrap:anywhere]",
    ],
  },
  {
    selector: ".topic-card:hover",
    apply: [
      "ui-border-[var(--accent)]",
      "ui-[text-decoration:none]",
      "ui-[background:var(--accent-soft)]",
    ],
  },
  {
    selector: ".topic-card strong",
    apply: ["ui-text-[12px]", "ui-block"],
  },
  {
    selector: ".topic-card strong span",
    apply: ["ui-[float:right]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".topic-card p",
    apply: [
      "ui-text-[11px]",
      "ui-leading-[1.8]",
      "ui-text-[var(--muted)]",
      "ui-m-[7px_0_0]",
    ],
  },
  {
    selector: ".topic-card small",
    apply: ["ui-text-[10px]", "ui-text-[var(--accent)]"],
  },
  {
    selector: ".source-details, .readme-reference",
    apply: [
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[7px]",
      "ui-p-[13px_17px]",
      "ui-text-[11px]",
      "ui-mt-[28px]",
      "ui-[overflow-wrap:anywhere]",
    ],
  },
  {
    selector: ".source-details summary, .readme-reference summary",
    apply: ["ui-text-[12px]", "ui-font-[600]"],
  },
  {
    selector: ".source-details p",
    apply: ["ui-text-[var(--muted)]"],
  },
  {
    selector: ".source-details ul",
    apply: ["ui-pl-[17px]"],
  },
  {
    selector: ".readme-reference > div",
    apply: ["ui-text-[13px]"],
  },
  {
    selector: ".readme-reference h2",
    apply: ["ui-text-[19px]"],
  },
  {
    selector: ".manifest-reference > h2",
    apply: ["ui-text-[20px]"],
  },
  {
    selector: ".manifest-reference details",
    apply: ["ui-text-[12px]"],
  },
  {
    selector: ".page-footer",
    apply: [
      "ui-flex",
      "ui-justify-between",
      "ui-gap-[15px]",
      "ui-p-[25px_0]",
      "ui-text-[10px]",
      "ui-text-[var(--muted)]",
      "ui-[border-bottom:1px_solid_var(--line)]",
    ],
  },
  {
    selector: ".page-footer a",
    apply: ["ui-text-[var(--muted)]"],
  },
  {
    selector: ".neighbors",
    apply: ["ui-mt-[24px]"],
  },
  {
    selector: ".neighbors a",
    apply: [
      "ui-block",
      "ui-p-[14px_17px]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[7px]",
      "ui-text-[12px]",
      "ui-text-[var(--text)]",
    ],
  },
  {
    selector: ".neighbors a:hover",
    apply: ["ui-border-[var(--accent)]", "ui-[text-decoration:none]"],
  },
  {
    selector: ".neighbors small",
    apply: [
      "ui-block",
      "ui-text-[var(--muted)]",
      "ui-text-[9px]",
      "ui-mb-[4px]",
    ],
  },
  {
    selector: ".neighbors span",
    apply: ["ui-[float:right]", "ui-text-[var(--accent)]"],
  },
  {
    selector: "footer",
    apply: ["ui-text-[10px]", "ui-mt-[32px]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".package-filter",
    apply: ["ui-m-[23px_0]"],
  },
  {
    selector: ".package-filter label",
    apply: ["ui-text-[12px]"],
  },
  {
    selector: ".package-filter input",
    apply: [
      "ui-block",
      "ui-w-full",
      "ui-mt-[8px]",
      "ui-[background:var(--panel)]",
      "ui-text-[var(--text)]",
      "ui-p-[11px_13px]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[7px]",
    ],
  },
  {
    selector: ".package-filter p",
    apply: ["ui-text-[11px]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".portal > h1, .portal > .lead",
    apply: ["ui-hidden"],
  },
  {
    selector: ".portal-intro",
    apply: ["ui-p-[10px_0_20px]"],
  },
  {
    selector: ".eyebrow",
    apply: [
      "ui-![font-size:10px]",
      "ui-tracking-[0.16em]",
      "ui-!text-[var(--accent)]",
      "ui-font-[700]",
    ],
  },
  {
    selector: ".portal .portal-intro h1",
    apply: [
      "ui-text-[clamp(30px,_3.5vw,_47px)]",
      "ui-tracking-[-1.7px]",
      "ui-leading-[1.16]",
      "ui-m-[16px_0_20px]",
    ],
  },
  {
    selector: ".portal-intro > p:not(.eyebrow)",
    apply: ["ui-max-w-[540px]", "ui-text-[16px]", "ui-leading-[1.8]"],
  },
  {
    selector: ".hero-actions",
    apply: ["ui-m-[25px_0_20px]"],
  },
  {
    selector: ".primary-button, .secondary-button",
    apply: [
      "ui-inline-flex",
      "ui-p-[10px_16px]",
      "ui-rounded-[6px]",
      "ui-text-[12px]",
      "ui-font-[650]",
      "ui-![text-decoration:none]",
    ],
  },
  {
    selector: ".primary-button",
    apply: ["ui-[background:var(--accent)]", "ui-text-[var(--bg)]"],
  },
  {
    selector: ".primary-button span",
    apply: ["ui-ml-[26px]"],
  },
  {
    selector: ".secondary-button",
    apply: ["ui-[border:1px_solid_var(--line)]", "ui-text-[var(--text)]"],
  },
  {
    selector: ".release-note",
    apply: ["ui-text-[10px]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".status-dot",
    apply: [
      "ui-inline-block",
      "ui-w-[6px]",
      "ui-h-[6px]",
      "ui-[background:var(--accent)]",
      "ui-rounded-[50%]",
      "ui-mr-[6px]",
    ],
  },
  {
    selector: ".portal .portal-section",
    apply: ["ui-text-[17px]", "ui-m-[25px_0_18px]"],
  },
  {
    selector: ".portal-card",
    apply: [
      "ui-p-[22px]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[9px]",
      "ui-text-[var(--text)]",
      "ui-[background:linear-gradient(140deg,_var(--bg),_var(--panel))]",
      "ui-![text-decoration:none]",
    ],
  },
  {
    selector: ".portal-card:hover",
    apply: ["ui-border-[var(--accent)]"],
  },
  {
    selector: ".card-number",
    apply: [
      "ui-[font:10px_ui-monospace,_monospace]",
      "ui-text-[var(--accent)]",
    ],
  },
  {
    selector: ".portal-card h3",
    apply: ["ui-text-[16px]", "ui-m-[16px_0_6px]"],
  },
  {
    selector: ".portal-card h3 span",
    apply: ["ui-[float:right]", "ui-font-[400]"],
  },
  {
    selector: ".portal-card p",
    apply: ["ui-text-[12px]", "ui-leading-[1.8]", "ui-m-[0]"],
  },
  {
    selector: ".portal-bottom",
    apply: [
      "ui-[border-top:1px_solid_var(--line)]",
      "ui-mt-[38px]",
      "ui-pt-[10px]",
    ],
  },
  {
    selector: ".portal-bottom h2",
    apply: ["ui-text-[20px]"],
  },
  {
    selector: ".portal-bottom p",
    apply: ["ui-text-[13px]"],
  },
  {
    selector: ".skip",
    apply: [
      "ui-fixed",
      "ui-top-[-100px]",
      "ui-left-[12px]",
      "ui-z-[100]",
      "ui-[background:var(--bg)]",
      "ui-p-[12px]",
      "ui-[border:1px_solid_var(--accent)]",
    ],
  },
  {
    selector: ".skip:focus",
    apply: ["ui-top-[8px]"],
  },
  {
    selector: ".visually-hidden",
    apply: [
      "ui-absolute",
      "ui-w-[1px]",
      "ui-h-[1px]",
      "ui-m-[-1px]",
      "ui-overflow-hidden",
      "ui-[clip:rect(0,_0,_0,_0)]",
      "ui-whitespace-nowrap",
    ],
  },
  {
    selector: "dialog",
    apply: [
      "ui-[background:var(--bg)]",
      "ui-text-[var(--text)]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[12px]",
      "ui-[box-shadow:0_30px_120px_#0004]",
      "ui-w-[min(640px,_calc(100vw_-_28px))]",
      "ui-max-h-[75dvh]",
      "ui-p-[24px]",
      "ui-m-[12dvh_auto_auto]",
      "ui-overflow-auto",
    ],
  },
  {
    selector: "dialog::backdrop",
    apply: ["ui-[background:#09172599]", "ui-[backdrop-filter:blur(3px)]"],
  },
  {
    selector: ".search-heading",
    apply: [
      "ui-flex",
      "ui-justify-between",
      "ui-items-center",
      "ui-gap-[15px]",
      "ui-mb-[20px]",
    ],
  },
  {
    selector: ".search-heading h2",
    apply: ["ui-text-[17px]", "ui-tracking-[-0.3px]", "ui-m-[0]"],
  },
  {
    selector: ".close-search",
    apply: [
      "ui-[border:1px_solid_var(--line)]",
      "ui-[background:var(--panel)]",
      "ui-rounded-[4px]",
      "ui-text-[10px]",
      "ui-p-[4px_8px]",
    ],
  },
  {
    selector: "#search-input",
    apply: [
      "ui-w-full",
      "ui-[background:var(--panel)]",
      "ui-text-[var(--text)]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[7px]",
      "ui-text-[14px]",
      "ui-p-[13px]",
    ],
  },
  {
    selector: "#search-status",
    apply: ["ui-text-[11px]", "ui-text-[var(--muted)]", "ui-m-[14px_0]"],
  },
  {
    selector: "#search-results a",
    apply: [
      "ui-block",
      "ui-[border-top:1px_solid_var(--line)]",
      "ui-p-[14px_10px]",
      "ui-text-[var(--text)]",
      "ui-rounded-[4px]",
    ],
  },
  {
    selector: "#search-results a:hover, #search-results a:focus",
    apply: ["ui-[background:var(--accent-soft)]", "ui-[text-decoration:none]"],
  },
  {
    selector:
      "#search-results small, #search-results strong, #search-results span",
    apply: ["ui-block"],
  },
  {
    selector: "#search-results small",
    apply: ["ui-text-[9px]", "ui-text-[var(--accent)]"],
  },
  {
    selector: "#search-results strong",
    apply: ["ui-text-[14px]", "ui-m-[3px_0]"],
  },
  {
    selector: "#search-results span",
    apply: ["ui-text-[11px]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".docs-shell",
    apply: ["ui-gap-[54px]"],
    media: "(min-width: 1700px)",
  },
  {
    selector: ".site-header",
    apply: ["ui-p-[0_max(34px,_calc((100vw_-_1480px)_/_2))]"],
    media: "(min-width: 1700px)",
  },
  {
    selector: ".docs-shell",
    apply: [
      "ui-grid-template-columns-[215px_minmax(0,_1fr)]",
      "ui-gap-[32px]",
      "ui-max-w-[1100px]",
    ],
    media: "(max-width: 1250px)",
  },
  {
    selector: ".right-rail",
    apply: ["ui-hidden"],
    media: "(max-width: 1250px)",
  },
  {
    selector: ".site-header",
    apply: ["ui-gap-[25px]"],
    media: "(max-width: 1250px)",
  },
  {
    selector: ".search-trigger",
    apply: ["ui-gap-[20px]"],
    media: "(max-width: 1250px)",
  },
  {
    selector: ".top-nav",
    apply: ["ui-gap-[18px]"],
    media: "(max-width: 1250px)",
  },
  {
    selector: ".top-nav",
    apply: ["ui-hidden"],
    media: "(max-width: 950px)",
  },
  {
    selector: ".github-link",
    apply: ["ui-hidden"],
    media: "(max-width: 950px)",
  },
  {
    selector: ".docs-shell",
    apply: [
      "ui-p-[0_22px]",
      "ui-grid-template-columns-[195px_minmax(0,_1fr)]",
      "ui-gap-[26px]",
    ],
    media: "(max-width: 950px)",
  },
  {
    selector: ".site-header",
    apply: ["ui-p-[0_22px]"],
    media: "(max-width: 950px)",
  },
  {
    selector: ".header-tools",
    apply: ["ui-gap-[14px]"],
    media: "(max-width: 950px)",
  },
  {
    selector: ".portal-card",
    apply: ["ui-p-[17px]"],
    media: "(max-width: 950px)",
  },
  {
    selector: ".portal-card h3",
    apply: ["ui-text-[14px]"],
    media: "(max-width: 950px)",
  },
  {
    selector: ".site-header",
    apply: ["ui-h-[64px]", "ui-p-[0_18px]", "ui-gap-[10px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".brand",
    apply: ["ui-text-[21px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".brand small",
    apply: ["ui-hidden"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".brand-mark",
    apply: ["ui-w-[28px]", "ui-h-[29px]", "ui-text-[18px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".header-tools",
    apply: ["ui-gap-[12px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".search-trigger",
    apply: ["ui-p-[6px_8px]", "ui-text-[10px]", "ui-gap-[0]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".search-trigger kbd",
    apply: ["ui-hidden"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".version-switch",
    apply: ["ui-text-[10px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".theme-toggle",
    apply: ["ui-text-[18px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".docs-shell",
    apply: ["ui-block", "ui-p-[0_20px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".sidebar",
    apply: [
      "ui-[position:static]",
      "ui-[border:0]",
      "ui-h-auto",
      "ui-p-[15px_0_0]",
    ],
    media: "(max-width: 700px)",
  },
  {
    selector: ".mobile-navigation > summary",
    apply: [
      "ui-block",
      "ui-text-[12px]",
      "ui-[background:var(--panel)]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[6px]",
      "ui-p-[9px_12px]",
    ],
    media: "(max-width: 700px)",
  },
  {
    selector: ".mobile-navigation > nav",
    apply: [
      "ui-max-h-[270px]",
      "ui-overflow-auto",
      "ui-p-[17px_10px]",
      "ui-[border-bottom:1px_solid_var(--line)]",
    ],
    media: "(max-width: 700px)",
  },
  {
    selector: ".sidebar-foot",
    apply: ["ui-hidden"],
    media: "(max-width: 700px)",
  },
  {
    selector: "main",
    apply: ["ui-pt-[22px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".breadcrumb",
    apply: ["ui-text-[10px]", "ui-mb-[25px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: "h1",
    apply: ["ui-text-[33px]", "ui-tracking-[-1px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".lead",
    apply: ["ui-text-[16px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".article-meta",
    apply: ["ui-text-[9px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".doc-article",
    apply: ["ui-text-[14px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".doc-article h2",
    apply: ["ui-text-[21px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".portal .portal-intro h1",
    apply: ["ui-text-[34px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".portal-card",
    apply: ["ui-p-[20px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".portal-card h3",
    apply: ["ui-text-[16px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".primary-button, .secondary-button",
    apply: ["ui-text-[11px]", "ui-p-[9px_12px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".release-note",
    apply: ["ui-text-[9px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".page-footer",
    apply: ["ui-text-[9px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".neighbors a",
    apply: ["ui-p-[12px]", "ui-text-[11px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: ".code-block",
    apply: ["ui-ml-[-4px]", "ui-mr-[-4px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: "pre",
    apply: ["ui-p-[16px]", "ui-text-[11px]"],
    media: "(max-width: 700px)",
  },
  {
    selector: "dialog",
    apply: ["ui-p-[18px]", "ui-mt-[8dvh]", "ui-max-h-[83dvh]"],
    media: "(max-width: 700px)",
  },
  {
    selector: "html",
    apply: ["ui-[scroll-behavior:smooth]"],
    media: "(prefers-reduced-motion: no-preference)",
  },
  {
    selector: ".topic-card, .portal-card",
    apply: ["ui-[transition:border-color_0.15s,_background_0.15s]"],
    media: "(prefers-reduced-motion: no-preference)",
  },
  {
    selector:
      ".site-header, .sidebar, .right-rail, .neighbors, .page-footer, footer, .copy-code, .related",
    apply: ["ui-hidden"],
    media: "print",
  },
  {
    selector: ".docs-shell",
    apply: ["ui-block"],
    media: "print",
  },
  {
    selector: "main",
    apply: ["ui-p-[0]"],
    media: "print",
  },
  {
    selector: ".doc-article",
    apply: ["ui-text-[11pt]"],
    media: "print",
  },
  {
    selector: ".code-block, pre",
    apply: [
      "ui-[background:#f5f5f5]",
      "ui-text-[#111]",
      "ui-[white-space:pre-wrap]",
      "ui-[break-inside:avoid]",
    ],
    media: "print",
  },
  {
    selector: ".code-bar",
    apply: ["ui-text-[#444]"],
    media: "print",
  },
  {
    selector: ".doc-article h2, .doc-article h3",
    apply: ["ui-[break-after:avoid]"],
    media: "print",
  },
  {
    selector: ".source-details",
    apply: ["ui-hidden"],
    media: "print",
  },
];
