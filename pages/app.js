import { installThemeControl } from "../scripts/site-theme.mjs";
import { installNavigationPrefetch } from "@zeruxjs/performance/navigation";

installThemeControl();

/** Optional local package filtering. No network requests, analytics, cookies or storage. */
const input = document.querySelector("#package-filter");
if (input) {
  const cards = [...document.querySelectorAll(".package")];
  input.closest(".filter").hidden = false;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      card.hidden = !card.textContent.toLowerCase().includes(query);
      if (!card.hidden) visible++;
    }
    document.querySelector("#package-status").textContent =
      `${visible} of ${cards.length} packages`;
  });
}

const navigation = installNavigationPrefetch({
  paths: ["/zeruxjs/"],
  maxPages: 4,
  delayMs: 120,
});
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) navigation.destroy();
});

/** Enhance static examples with keyboard-accessible tabs; both examples remain readable without JS.
 * @returns {void} Nothing. Reads/writes example DOM and focus only; no network or storage.
 */
function installExampleTabs() {
  const list = document.querySelector("[data-code-tabs]");
  if (!list) return;
  const tabs = [...list.querySelectorAll("[data-code-tab]")];
  const panels = [...document.querySelectorAll("[data-code-panel]")];
  /** Select an example. @param {HTMLButtonElement} tab Selected button. @returns {void} Updates local ARIA/visibility. */
  const select = (tab) => {
    for (const button of tabs) {
      const selected = button === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels)
      panel.hidden = panel.dataset.codePanel !== tab.dataset.codeTab;
  };
  list.setAttribute("role", "tablist");
  for (const tab of tabs) {
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      let index = tabs.indexOf(tab);
      if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        index = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabs.length - 1;
      else return;
      event.preventDefault();
      select(tabs[index]);
      tabs[index].focus();
    });
  }
  for (const panel of panels) {
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = 0;
  }
  select(tabs[0]);
  list.hidden = false;
}
installExampleTabs();

/** Enable copying the visible install command when Clipboard is available.
 * @returns {void} Nothing. Uses DOM and navigator.clipboard only after a user click.
 */
function installCommandCopy() {
  const button = document.querySelector("#copy-install");
  const command = document.querySelector("#install-command");
  const status = document.querySelector("#copy-status");
  if (!button || !command || !status || !navigator.clipboard?.writeText) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command.textContent.trim());
      status.textContent = "Copied. Follow the tutorial for complete setup.";
    } catch {
      status.textContent =
        "Copy unavailable. Select the command above to copy it.";
    }
  });
}
installCommandCopy();
