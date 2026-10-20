import { installNavigationPrefetch } from "@zeruxjs/performance/navigation";

/** Progressive enhancement for already-rendered documentation. No telemetry, external services or cookies. */
import { installThemeControl } from "../../../../scripts/site-theme.mjs";
installThemeControl();
for (const button of document.querySelectorAll(".copy-code")) {
  if (!navigator.clipboard?.writeText) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const code = button
      .closest(".code-block")
      .querySelector("code").textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select to copy";
    }
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1800);
  });
}
const dialog = document.querySelector("#search-dialog");
const openSearch = document.querySelector("#open-search");
const closeSearch = document.querySelector(".close-search");
const input = document.querySelector("#search-input");
const results = document.querySelector("#search-results");
const status = document.querySelector("#search-status");
let singleKeys = true;
try {
  singleKeys = localStorage.getItem("zerux-single-shortcuts") !== "off";
} catch {}
let searchModule;
let searchTrigger;
/** Load the search engine only on explicit search intent. @returns {Promise<object>} Search module. Reads generated script URL only. */
function loadSearch() {
  searchModule ??= import(document.body.dataset.searchModule).catch((error) => {
    searchModule = undefined;
    throw error;
  });
  return searchModule;
}
let queryVersion = 0;
/** Open the optional modal search. @returns {void} Nothing. Reads dialog DOM only. */
function showSearch() {
  if (!dialog.open) {
    searchTrigger = document.activeElement;
    dialog.showModal();
  }
  input.focus();
  void loadSearch().catch(() => {});
}
if (dialog && typeof dialog.showModal === "function") {
  openSearch.hidden = false;
  openSearch.addEventListener("click", showSearch);
  closeSearch.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener("keydown", (event) => {
    const typing =
      event.target instanceof Element &&
      event.target.closest("input,textarea,select,[contenteditable]");
    const slash =
      singleKeys &&
      event.key === "/" &&
      !typing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
    if (
      slash ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
    ) {
      event.preventDefault();
      showSearch();
    }
  });
  dialog.addEventListener("close", () => searchTrigger?.focus());
  input.addEventListener("input", async () => {
    const sequence = ++queryVersion;
    const query = input.value.trim().toLowerCase().slice(0, 120);
    results.replaceChildren();
    if (query.length < 2) {
      status.textContent = "Type at least two characters.";
      return;
    }
    status.textContent = "Searching…";
    try {
      const module = await loadSearch();
      const selected = await module.searchDocs(
        query,
        document.body.dataset.version,
      );
      if (sequence !== queryVersion) return;
      status.textContent = selected.length
        ? `Showing ${selected.length} matching topics.`
        : "No matches. Try a package name or a shorter phrase.";
      if (!selected.length) {
        for (const [slug, title] of [
          ["solutions", "Find a solution by symptom"],
          ["glossary", "Look up a word"],
          ["learn", "Follow the beginner course"],
        ]) {
          const link = document.createElement("a");
          link.href = `${document.body.dataset.basePath}/docs/${document.body.dataset.version}/${slug}/`;
          link.textContent = title;
          results.append(link);
        }
      }
      for (const page of selected) {
        const link = document.createElement("a");
        link.href = page.url;
        const context = document.createElement("small");
        context.textContent = page.section;
        const title = document.createElement("strong");
        title.textContent = page.title;
        const description = document.createElement("span");
        description.textContent = page.description;
        link.append(context, title, description);
        results.append(link);
      }
    } catch {
      if (sequence === queryVersion)
        status.textContent =
          "Search unavailable. Browse the documentation sidebar.";
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
      return;
    }
    const links = [...results.querySelectorAll("a")];
    if (!links.length || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const current = links.indexOf(document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % links.length
        : current <= 0
          ? links.length - 1
          : current - 1;
    links[next].focus();
  });
}
const packageFilter = document.querySelector("#package-filter");
if (packageFilter) {
  packageFilter.closest(".package-filter").hidden = false;
  const cards = [...document.querySelectorAll(".package-card")];
  packageFilter.addEventListener("input", () => {
    const query = packageFilter.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      card.hidden = !card.textContent.toLowerCase().includes(query);
      if (!card.hidden) visible++;
    }
    document.querySelector("#package-count").textContent =
      `${visible} of ${cards.length} packages`;
  });
}
if ("IntersectionObserver" in window) {
  const headings = [
    ...document.querySelectorAll(".doc-article h2[id], .doc-article h3[id]"),
  ];
  const links = [...document.querySelectorAll(".right-rail nav a")];
  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      const current = headings.find((heading) => visible.has(heading));
      if (!current) return;
      for (const link of links) {
        if (link.hash === "#" + current.id)
          link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    },
    { rootMargin: "-90px 0px -55% 0px" },
  );
  headings.forEach((heading) => observer.observe(heading));
}

// Desktop keeps navigation visible; mobile starts with a compact disclosure.
const mobileNavigation = document.querySelector(".mobile-navigation");
if (mobileNavigation && window.matchMedia) {
  const mobile = window.matchMedia("(max-width: 700px)");
  const synchronizeNavigation = () => {
    mobileNavigation.open = !mobile.matches;
  };
  synchronizeNavigation();
  mobile.addEventListener("change", synchronizeNavigation);
}

// Only known public documentation pages are eligible; no initial navigation requests.
const navigation = installNavigationPrefetch({
  paths: [document.body.dataset.basePath + "/"],
  maxPages: 6,
  delayMs: 120,
});
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) navigation.destroy();
});

// Raw content is fetched only after an explicit copy request.
for (const button of document.querySelectorAll(".copy-page")) {
  if (!navigator.clipboard?.writeText) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch(button.dataset.markdown);
      if (!response.ok) throw new Error("Markdown unavailable");
      await navigator.clipboard.writeText(await response.text());
      button.textContent = "Copied Markdown";
    } catch {
      button.textContent = "Open View Markdown to copy";
    } finally {
      button.disabled = false;
    }
  });
}

const progress = document.querySelector(".reading-progress");
if (progress && document.body.dataset.docSlug !== "home") {
  progress.hidden = false;
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const maximum = document.documentElement.scrollHeight - innerHeight;
    progress.style.setProperty(
      "--progress",
      maximum > 0 ? Math.min(1, Math.max(0, scrollY / maximum)) : 0,
    );
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  update();
}

// Keep disclosure-based menus usable without JS, adding normal dismiss behavior when enhanced.
const versionMenu = document.querySelector(".version-switch");
if (versionMenu) {
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !versionMenu.contains(event.target))
      versionMenu.open = false;
  });
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Node && !versionMenu.contains(event.target))
      versionMenu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && versionMenu.open) {
      versionMenu.open = false;
      versionMenu.querySelector("summary").focus();
    }
  });
}

// Native help dialogs and visible controls remain keyboard accessible; optional single-key shortcuts can be disabled.
const shortcuts = document.querySelector("#shortcuts-dialog");
let shortcutTrigger;
function showShortcuts() {
  if (!shortcuts || shortcuts.open) return;
  shortcutTrigger = document.activeElement;
  shortcuts.showModal();
}
for (const button of document.querySelectorAll("[data-open-shortcuts]")) {
  button.hidden = false;
  button.addEventListener("click", showShortcuts);
}
for (const button of document.querySelectorAll("[data-open-search]"))
  button.addEventListener("click", showSearch);
const shortcutOption = document.querySelector("[data-single-shortcuts]");
if (shortcutOption) {
  shortcutOption.checked = singleKeys;
  shortcutOption.addEventListener("change", () => {
    singleKeys = shortcutOption.checked;
    try {
      localStorage.setItem("zerux-single-shortcuts", singleKeys ? "on" : "off");
    } catch {}
  });
}
shortcuts?.addEventListener("close", () => shortcutTrigger?.focus());
for (const modal of document.querySelectorAll("dialog:not(#search-dialog)")) {
  for (const button of modal.querySelectorAll("[data-close-dialog]"))
    button.addEventListener("click", () => modal.close());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.close();
  });
}
document.addEventListener("keydown", (event) => {
  const typing =
    event.target instanceof Element &&
    event.target.closest("input,textarea,select,[contenteditable]");
  if (
    event.key === "?" &&
    singleKeys &&
    !typing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    showShortcuts();
  }
});

// Animate decorative relationships and one-time reveals only when allowed; never hide content without a live observer.
let motion = true;
try {
  motion = localStorage.getItem("zerux-docs-motion") !== "off";
} catch {}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function syncMotion() {
  const allowed = motion && !reducedMotion.matches;
  document.documentElement.dataset.motion = allowed ? "on" : "off";
  for (const button of document.querySelectorAll("[data-motion-toggle]")) {
    button.hidden = false;
    button.textContent = reducedMotion.matches
      ? "Motion: reduced by system"
      : motion
        ? "Pause motion"
        : "Enable motion";
    button.disabled = reducedMotion.matches;
    button.setAttribute("aria-pressed", String(!allowed));
  }
  if (!allowed)
    document
      .querySelectorAll(".reveal-pending")
      .forEach((node) => node.classList.remove("reveal-pending"));
}
for (const button of document.querySelectorAll("[data-motion-toggle]"))
  button.addEventListener("click", () => {
    motion = !motion;
    try {
      localStorage.setItem("zerux-docs-motion", motion ? "on" : "off");
    } catch {}
    syncMotion();
  });
reducedMotion.addEventListener("change", syncMotion);
syncMotion();
if (motion && !reducedMotion.matches && "IntersectionObserver" in window) {
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.remove("reveal-pending");
          reveal.unobserve(entry.target);
        } else entry.target.classList.add("reveal-pending");
      }
    },
    { threshold: 0.08 },
  );
  for (const node of document.querySelectorAll("[data-reveal]")) {
    reveal.observe(node);
  }
}
