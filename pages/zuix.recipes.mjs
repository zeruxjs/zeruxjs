/** Utility compositions for document elements and component states. No raw CSS declarations. */
export default [
  {
    selector: ":root",
    apply: [
      "ui-[font-family:Inter,_ui-sans-serif,_system-ui,_-apple-system,_BlinkMacSystemFont,_Segoe_UI,_sans-serif]",
      "ui-text-[#21312c]",
      "ui-[background:#fbfcfa]",
      "ui-leading-[1.7]",
      "ui-[--accent:#087e65]",
      "ui-[--muted:#66776f]",
      "ui-[--line:#dde6df]",
    ],
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
    selector: "a",
    apply: ["ui-text-[var(--accent)]", "ui-[text-decoration:none]"],
  },
  {
    selector: "a:hover",
    apply: ["ui-[text-decoration:underline]"],
  },
  {
    selector: "a:focus-visible, input:focus-visible",
    apply: ["ui-[outline:3px_solid_var(--accent)]", "ui-outline-offset-[5px]"],
  },
  {
    selector: "header, footer",
    apply: [
      "ui-max-w-[1260px]",
      "ui-m-[auto]",
      "ui-flex",
      "ui-items-center",
      "ui-justify-between",
      "ui-p-[27px_32px]",
    ],
  },
  {
    selector: "header",
    apply: ["ui-[border-bottom:1px_solid_var(--line)]"],
  },
  {
    selector: ".brand",
    apply: [
      "ui-flex",
      "ui-items-center",
      "ui-gap-[9px]",
      "ui-text-[21px]",
      "ui-font-[800]",
      "ui-tracking-[-0.8px]",
      "ui-text-[inherit]",
    ],
  },
  {
    selector: ".brand > span",
    apply: [
      "ui-grid",
      "ui-place-items-center",
      "ui-w-[30px]",
      "ui-h-[32px]",
      "ui-[background:var(--accent)]",
      "ui-text-[white]",
      "ui-rounded-[8px]",
      "ui-text-[19px]",
    ],
  },
  {
    selector: ".brand small",
    apply: [
      "ui-text-[11px]",
      "ui-tracking-[0.02em]",
      "ui-font-[400]",
      "ui-text-[var(--muted)]",
      "ui-[border-left:1px_solid_var(--line)]",
      "ui-ml-[8px]",
      "ui-pl-[16px]",
    ],
  },
  {
    selector: "nav",
    apply: ["ui-flex", "ui-gap-[26px]", "ui-text-[12px]"],
  },
  {
    selector: "nav a",
    apply: ["ui-text-[var(--muted)]"],
  },
  {
    selector: "main",
    apply: ["ui-max-w-[1196px]", "ui-m-[auto]", "ui-p-[0_32px]"],
  },
  {
    selector: ".hero",
    apply: ["ui-p-[90px_0_80px]", "ui-max-w-[800px]"],
  },
  {
    selector: ".eyebrow",
    apply: [
      "ui-text-[10px]",
      "ui-font-[700]",
      "ui-tracking-[0.15em]",
      "ui-text-[var(--accent)]",
      "ui-m-[0_0_20px]",
    ],
  },
  {
    selector: "h1",
    apply: [
      "ui-text-[clamp(44px,_7vw,_79px)]",
      "ui-leading-[1.05]",
      "ui-tracking-[-3.7px]",
      "ui-m-[0_0_28px]",
      "ui-font-[750]",
    ],
  },
  {
    selector: "h1 > span",
    apply: ["ui-text-[var(--accent)]"],
  },
  {
    selector: ".intro",
    apply: [
      "ui-text-[17px]",
      "ui-text-[var(--muted)]",
      "ui-max-w-[650px]",
      "ui-leading-[1.9]",
    ],
  },
  {
    selector: ".actions",
    apply: [
      "ui-flex",
      "ui-items-center",
      "ui-gap-[28px]",
      "ui-m-[30px_0_22px]",
      "ui-text-[13px]",
      "ui-font-[600]",
    ],
  },
  {
    selector: ".primary",
    apply: [
      "ui-[background:var(--accent)]",
      "ui-text-[white]",
      "ui-p-[12px_18px]",
      "ui-rounded-[7px]",
    ],
  },
  {
    selector: ".primary span",
    apply: ["ui-ml-[35px]"],
  },
  {
    selector: ".status",
    apply: ["ui-text-[10px]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".status > span",
    apply: [
      "ui-inline-block",
      "ui-w-[6px]",
      "ui-h-[6px]",
      "ui-rounded-[50%]",
      "ui-[background:var(--accent)]",
      "ui-mr-[6px]",
    ],
  },
  {
    selector: "main > section:not(.hero)",
    apply: [
      "ui-p-[45px_0_55px]",
      "ui-[border-top:1px_solid_var(--line)]",
      "ui-[scroll-margin-top:30px]",
    ],
  },
  {
    selector: ".section-title",
    apply: [
      "ui-flex",
      "ui-[align-items:end]",
      "ui-justify-between",
      "ui-gap-[20px]",
      "ui-mb-[30px]",
    ],
  },
  {
    selector: ".section-title h2, .closing h2",
    apply: [
      "ui-text-[29px]",
      "ui-leading-[1.2]",
      "ui-tracking-[-1px]",
      "ui-m-[0]",
    ],
  },
  {
    selector: ".section-title .eyebrow",
    apply: ["ui-mb-[11px]"],
  },
  {
    selector: ".section-title > p",
    apply: [
      "ui-text-[var(--muted)]",
      "ui-text-[12px]",
      "ui-text-right",
      "ui-m-[0]",
    ],
  },
  {
    selector: ".project",
    apply: [
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[10px]",
      "ui-p-[27px]",
      "ui-flex",
      "ui-flex-col",
      "ui-[background:white]",
    ],
  },
  {
    selector: ".featured",
    apply: ["ui-[background:#eef7f0]", "ui-border-[#c8dece]"],
  },
  {
    selector: ".project-type",
    apply: [
      "ui-[font:10px_ui-monospace,_monospace]",
      "ui-tracking-[0.05em]",
      "ui-text-[var(--muted)]",
    ],
  },
  {
    selector: "h3",
    apply: ["ui-text-[25px]", "ui-tracking-[-0.8px]", "ui-m-[22px_0_10px]"],
  },
  {
    selector: ".project p",
    apply: [
      "ui-text-[var(--muted)]",
      "ui-text-[13px]",
      "ui-m-[0_0_25px]",
      "ui-[flex:1]",
    ],
  },
  {
    selector: ".project a",
    apply: ["ui-text-[11px]", "ui-font-[650]"],
  },
  {
    selector: ".package",
    apply: [
      "ui-[border:1px_solid_var(--line)]",
      "ui-rounded-[8px]",
      "ui-p-[20px]",
      "ui-[background:white]",
      "ui-min-w-[0]",
    ],
  },
  {
    selector: ".package h3",
    apply: [
      "ui-text-[13px]",
      "ui-tracking-[0]",
      "ui-[overflow-wrap:anywhere]",
      "ui-m-[0]",
    ],
  },
  {
    selector: ".package p",
    apply: [
      "ui-text-[var(--muted)]",
      "ui-text-[11px]",
      "ui-leading-[1.8]",
      "ui-m-[10px_0_15px]",
    ],
  },
  {
    selector: ".package-links",
    apply: ["ui-flex", "ui-gap-[16px]", "ui-text-[10px]"],
  },
  {
    selector: ".package small",
    apply: ["ui-text-[9px]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".filter",
    apply: ["ui-m-[20px_0_25px]"],
  },
  {
    selector: ".filter label",
    apply: ["ui-block", "ui-text-[12px]", "ui-mb-[8px]"],
  },
  {
    selector: ".filter input",
    apply: [
      "ui-[font:inherit]",
      "ui-text-[13px]",
      "ui-[border:1px_solid_var(--line)]",
      "ui-p-[11px_14px]",
      "ui-rounded-[6px]",
      "ui-w-[min(100%,_450px)]",
      "ui-text-[inherit]",
      "ui-[background:white]",
    ],
  },
  {
    selector: ".filter p",
    apply: ["ui-text-[10px]", "ui-text-[var(--muted)]"],
  },
  {
    selector: ".closing",
    apply: ["ui-max-w-[800px]"],
  },
  {
    selector: ".closing p",
    apply: ["ui-text-[var(--muted)]", "ui-text-[15px]", "ui-m-[22px_0]"],
  },
  {
    selector: ".closing a",
    apply: ["ui-text-[13px]", "ui-font-[600]"],
  },
  {
    selector: "footer",
    apply: [
      "ui-[border-top:1px_solid_var(--line)]",
      "ui-gap-[25px]",
      "ui-text-[11px]",
      "ui-text-[var(--muted)]",
    ],
  },
  {
    selector: "footer p",
    apply: ["ui-[flex:1]"],
  },
  {
    selector: ".skip",
    apply: [
      "ui-fixed",
      "ui-top-[-100px]",
      "ui-left-[16px]",
      "ui-[background:white]",
      "ui-p-[10px]",
      "ui-[border:1px_solid_var(--accent)]",
    ],
  },
  {
    selector: ".skip:focus",
    apply: ["ui-top-[10px]"],
  },
  {
    selector: ".project",
    apply: ["ui-p-[24px]"],
    media: "(max-width: 850px)",
  },
  {
    selector: ".project h3",
    apply: ["ui-mt-[15px]"],
    media: "(max-width: 850px)",
  },
  {
    selector: "header nav",
    apply: ["ui-gap-[15px]"],
    media: "(max-width: 850px)",
  },
  {
    selector: "nav a:last-child",
    apply: ["ui-hidden"],
    media: "(max-width: 850px)",
  },
  {
    selector: ".brand small",
    apply: ["ui-hidden"],
    media: "(max-width: 850px)",
  },
  {
    selector: ".hero",
    apply: ["ui-p-[65px_0]"],
    media: "(max-width: 850px)",
  },
  {
    selector: "h1",
    apply: ["ui-tracking-[-2px]"],
    media: "(max-width: 850px)",
  },
  {
    selector: "header, footer",
    apply: ["ui-p-[21px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".brand",
    apply: ["ui-text-[18px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: "header nav",
    apply: ["ui-text-[10px]", "ui-gap-[13px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: "header nav a:first-child",
    apply: ["ui-hidden"],
    media: "(max-width: 550px)",
  },
  {
    selector: "main",
    apply: ["ui-p-[0_22px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".hero",
    apply: ["ui-p-[55px_0]"],
    media: "(max-width: 550px)",
  },
  {
    selector: "h1",
    apply: ["ui-text-[44px]", "ui-tracking-[-1.8px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".intro",
    apply: ["ui-text-[15px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".actions",
    apply: ["ui-gap-[18px]", "ui-text-[11px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".primary",
    apply: ["ui-p-[10px_12px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".primary span",
    apply: ["ui-ml-[17px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".status",
    apply: ["ui-text-[9px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".section-title",
    apply: ["ui-block"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".section-title > p",
    apply: ["ui-text-left", "ui-mt-[15px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: ".section-title h2, .closing h2",
    apply: ["ui-text-[25px]"],
    media: "(max-width: 550px)",
  },
  {
    selector: "footer",
    apply: ["ui-flex-wrap"],
    media: "(max-width: 550px)",
  },
  {
    selector: "footer p",
    apply: ["ui-[flex-basis:100%]", "ui-[order:2]", "ui-m-[0]"],
    media: "(max-width: 550px)",
  },
  {
    selector: "html",
    apply: ["ui-[scroll-behavior:smooth]"],
    media: "(prefers-reduced-motion: no-preference)",
  },
];
