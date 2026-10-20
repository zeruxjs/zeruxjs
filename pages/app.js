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

/** Install visible homepage motion with an explicit pause control.
 * @returns {void} Nothing. Uses DOM, matchMedia, IntersectionObserver and Web Animations;
 * no network, environment values, cookies or storage. Content remains visible without JS.
 */
function installHomeMotion() {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const toggle = document.querySelector("[data-motion-toggle]");
  const animations = new Set();
  let paused = false;
  const allowed = () => !paused && !preference.matches;
  /** Animate a visible element once. @param {Element} element Target. @param {number} delay Stagger in milliseconds. @returns {void} Tracks and releases the animation. */
  const reveal = (element, delay = 0) => {
    if (!allowed() || typeof element.animate !== "function") return;
    const animation = element.animate(
      [
        { opacity: 0, transform: "translateY(28px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: 700,
        delay,
        easing: "cubic-bezier(0.16,1,0.3,1)",
        fill: "backwards",
      },
    );
    animations.add(animation);
    animation.finished.then(
      () => animations.delete(animation),
      () => animations.delete(animation),
    );
  };
  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            entries
              .filter((entry) => entry.isIntersecting)
              .forEach((entry, index) => {
                observer.unobserve(entry.target);
                reveal(entry.target, Math.min(index, 2) * 120);
              });
          },
          { threshold: 0.12 },
        )
      : null;
  for (const element of document.querySelectorAll(
    "#why article, #how-it-works > div, #ecosystem article, main > div > section:last-child",
  ))
    observer?.observe(element);
  /** Synchronize CSS motion and the accessible pause button. @returns {void} Cancels active effects when motion is disabled. */
  const render = () => {
    const stopped = !allowed();
    if (stopped) document.documentElement.dataset.motion = "paused";
    else document.documentElement.dataset.motion = "running";
    if (stopped) for (const animation of animations) animation.cancel();
    if (toggle) {
      toggle.hidden = false;
      toggle.disabled = preference.matches;
      toggle.textContent = preference.matches
        ? "Reduced motion enabled"
        : paused
          ? "Resume animations"
          : "Pause animations";
      toggle.setAttribute("aria-pressed", String(stopped));
    }
  };
  toggle?.addEventListener("click", () => {
    paused = !paused;
    render();
  });
  preference.addEventListener("change", render);
  // Animate code-panel changes as well as the page sections.
  for (const tab of document.querySelectorAll("[data-code-tab]"))
    tab.addEventListener("click", () => {
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) reveal(panel);
    });
  render();
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    observer?.disconnect();
    preference.removeEventListener("change", render);
    for (const animation of animations) animation.cancel();
  });
}
installHomeMotion();
