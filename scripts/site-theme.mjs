/** Restore the public appearance preference before CSS paints. No network, cookies or environment access. */
export const themeBootstrap =
  "try{const t=localStorage.getItem('zerux-theme')||localStorage.getItem('zerux-docs-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}";

/** Install accessible appearance controls shared by every ecosystem site.
 * @returns {void} Nothing. Reads/writes only the public theme preference in localStorage and the document DOM.
 */
export function installThemeControl() {
  const modes = ["system", "light", "dark"];
  let theme = "system";
  try {
    const saved =
      localStorage.getItem("zerux-theme") ||
      localStorage.getItem("zerux-docs-theme");
    if (modes.includes(saved)) theme = saved;
  } catch {
    /* Optional browser storage. */
  }
  const buttons = [...document.querySelectorAll(".theme-toggle")];
  /** Synchronize document and labels. @returns {void} Nothing. Reads module theme and DOM. */
  function render() {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    for (const button of buttons) {
      button.hidden = false;
      button.textContent = {
        system: "◐ System",
        light: "☀ Light",
        dark: "☾ Dark",
      }[theme];
      button.setAttribute(
        "aria-label",
        `Color theme: ${theme}. Switch to ${modes[(modes.indexOf(theme) + 1) % 3]}.`,
      );
      button.title = "Choose system, light or dark appearance";
    }
  }
  for (const button of buttons)
    button.addEventListener("click", () => {
      theme = modes[(modes.indexOf(theme) + 1) % 3];
      try {
        localStorage.setItem("zerux-theme", theme);
      } catch {
        /* Optional browser storage. */
      }
      render();
    });
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === "zerux-theme") {
      theme = modes.includes(event.newValue) ? event.newValue : "system";
      render();
    }
  });
  render();
}
