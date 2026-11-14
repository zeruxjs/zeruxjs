import { installNavigationPrefetch } from '@zeruxjs/performance/navigation';

/** Progressive enhancement for already-rendered documentation. No telemetry, external services or cookies. */
import { installThemeControl } from '../../../../scripts/site-theme.ts';
installThemeControl();
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '.copy-code'
)) {
  if (!navigator.clipboard?.writeText) {
    continue;
  }
  button.hidden = false;
  button.addEventListener('click', async () => {
    /** Literal code block text copied only after the visitor activates its button. */
    const code = button
      .closest('.code-block')!
      .querySelector<HTMLElement>('code')!.textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select to copy';
    }
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 1800);
  });
}
/** Native search modal; ordinary page navigation does not require it. */
const dialog = document.querySelector<HTMLDialogElement>('#search-dialog')!;
/** Initially hidden enhancement trigger, revealed only when native dialog support exists. */
const openSearch = document.querySelector<HTMLButtonElement>('#open-search')!;
/** Explicit native modal close control. */
const closeSearch = document.querySelector<HTMLButtonElement>('.close-search')!;
/** Bounded search query input; its text is never interpreted as source. */
const input = document.querySelector<HTMLInputElement>('#search-input')!;
/** Owned result list rebuilt with DOM text nodes, never returned HTML. */
const results = document.querySelector<HTMLElement>('#search-results')!;
/** Live feedback region for loading, empty and unavailable search states. */
const status = document.querySelector<HTMLElement>('#search-status')!;
let singleKeys = true;
try {
  singleKeys = localStorage.getItem('zerux-single-shortcuts') !== 'off';
} catch {
  /* Browser persistence is optional; retain the usable default UI on storage failure. */
}
let searchModule: Promise<typeof import('./search.ts')> | undefined;
let searchTrigger: Element | null = null;
/** Load the search engine only on explicit search intent.
 * @returns {Promise<object>} Search module. Reads generated script URL only. */
function loadSearch() {
  searchModule ??= (
    import(document.body.dataset.searchModule!) as Promise<
      typeof import('./search.ts')
    >
  ).catch((error) => {
    searchModule = undefined;
    throw error;
  });
  return searchModule;
}
let queryVersion = 0;
/** Open the optional modal search.
 * @returns {void} Nothing. Reads dialog DOM only. */
function showSearch() {
  if (!dialog.open) {
    searchTrigger = document.activeElement;
    dialog.showModal();
  }
  input.focus();
  void loadSearch().catch(() => {});
}
if (dialog && typeof dialog.showModal === 'function') {
  openSearch.hidden = false;
  openSearch.addEventListener('click', showSearch);
  closeSearch.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  document.addEventListener('keydown', (event) => {
    /** Editable targets suppress optional single-key shortcuts. */
    const typing =
      event.target instanceof Element &&
      event.target.closest('input,textarea,select,[contenteditable]');
    /** Optional unmodified shortcut; native visible controls remain available. */
    const slash =
      singleKeys &&
      event.key === '/' &&
      !typing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
    if (
      slash ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
    ) {
      event.preventDefault();
      showSearch();
    }
  });
  dialog.addEventListener('close', () =>
    (searchTrigger instanceof HTMLElement ? searchTrigger : null)?.focus()
  );
  input.addEventListener('input', async () => {
    /** Monotonic query token prevents a slow older search from overwriting current results. */
    const sequence = ++queryVersion;
    /** Normalized bounded input for local search or text filtering. */
    const query = input.value.trim().toLowerCase().slice(0, 120);
    results.replaceChildren();
    if (query.length < 2) {
      status.textContent = 'Type at least two characters.';
      return;
    }
    status.textContent = 'Searching…';
    try {
      /** Explicit on-demand generated search module; failures leave sidebar navigation usable. */
      const module = await loadSearch();
      /** Public current-version search results; labels are written with textContent. */
      const selected = await module.searchDocs(
        query,
        document.body.dataset.version!
      );
      if (sequence !== queryVersion) {
        return;
      }
      status.textContent = selected.length
        ? `Showing ${selected.length} matching topics.`
        : 'No matches. Try a package name or a shorter phrase.';
      if (!selected.length) {
        for (const [slug, title] of [
          ['solutions', 'Find a solution by symptom'],
          ['glossary', 'Look up a word'],
          ['learn', 'Follow the beginner course'],
        ]) {
          /** New native result link; public labels never enter innerHTML. */
          const link = document.createElement('a');
          link.href = `${document.body.dataset.basePath}/docs/${document.body.dataset.version}/${slug}/`;
          link.textContent = title;
          results.append(link);
        }
      }
      for (const page of selected) {
        /** New native result link; public labels never enter innerHTML. */
        const link = document.createElement('a');
        link.href = page.url;
        /** Result context written as inert text. */
        const context = document.createElement('small');
        context.textContent = page.section;
        /** Result heading written as inert text. */
        const title = document.createElement('strong');
        title.textContent = page.title;
        /** Result summary written as inert text. */
        const description = document.createElement('span');
        description.textContent = page.description;
        link.append(context, title, description);
        results.append(link);
      }
    } catch {
      if (sequence === queryVersion) {
        status.textContent =
          'Search unavailable. Browse the documentation sidebar.';
      }
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return;
    }
    /** Native links in current visual order for keyboard focus movement. */
    const links = [...results.querySelectorAll<HTMLAnchorElement>('a')];
    if (!links.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    /** Current focus position in the existing result list. */
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    /** Wrapped focus destination; negative indices never address an absent result. */
    let next;
    if (event.key === 'ArrowDown') {
      next = (current + 1) % links.length;
    } else if (current <= 0) {
      next = links.length - 1;
    } else {
      next = current - 1;
    }
    links[next].focus();
  });
}
/** Optional local package-card filter, independent of the search download. */
const packageFilter =
  document.querySelector<HTMLInputElement>('#package-filter')!;
if (packageFilter) {
  packageFilter.closest<HTMLElement>('.package-filter')!.hidden = false;
  /** Static owned card inventory; filtering only toggles visibility. */
  const cards = [...document.querySelectorAll<HTMLElement>('.package-card')];
  packageFilter.addEventListener('input', () => {
    /** Normalized bounded input for local search or text filtering. */
    const query = packageFilter.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      card.hidden = !card.textContent.toLowerCase().includes(query);
      if (!card.hidden) {
        visible++;
      }
    }
    document.querySelector<HTMLElement>('#package-count')!.textContent =
      `${visible} of ${cards.length} packages`;
  });
}
if ('IntersectionObserver' in window) {
  /** Native authored headings in document order for the visible outline indicator. */
  const headings = [
    ...document.querySelectorAll<HTMLElement>(
      '.doc-article h2[id], .doc-article h3[id]'
    ),
  ];
  /** Native links in current visual order for keyboard focus movement. */
  const links = [
    ...document.querySelectorAll<HTMLAnchorElement>('.right-rail nav a'),
  ];
  /** Currently intersecting headings; no per-route telemetry or retained user history. */
  const visible = new Set();
  /** Page-lifetime outline observer over existing headings. */
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target);
        } else {
          visible.delete(entry.target);
        }
      }
      /** Current focus position in the existing result list. */
      const current = headings.find((heading) => visible.has(heading));
      if (!current) {
        return;
      }
      for (const link of links) {
        if (link.hash === '#' + current.id) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      }
    },
    { rootMargin: '-140px 0px -55% 0px' }
  );
  headings.forEach((heading) => observer.observe(heading));
}

// Only known public documentation pages are eligible; no initial navigation requests.
/** Explicit public-only prefetch owner; nonpersisted pagehide destroys it. */
const navigation = installNavigationPrefetch({
  paths: [document.body.dataset.basePath + '/'],
  maxPages: 6,
  delayMs: 120,
});
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    navigation.destroy();
  }
});

// Raw content is fetched only after an explicit copy request.
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '.copy-page'
)) {
  if (!navigator.clipboard?.writeText) {
    continue;
  }
  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      /** Markdown is fetched only after explicit copy activation, with native-link fallback on failure. */
      const response = await fetch(button.dataset.markdown!);
      if (!response.ok) {
        throw new Error('Markdown unavailable');
      }
      await navigator.clipboard.writeText(await response.text());
      button.textContent = 'Copied Markdown';
    } catch {
      button.textContent = 'Open View Markdown to copy';
    } finally {
      button.disabled = false;
    }
  });
}

/** Optional reading indicator; no stored tracking record is created. */
const progress = document.querySelector<HTMLElement>('.reading-progress')!;
if (progress && document.body.dataset.docSlug !== 'home') {
  progress.hidden = false;
  let scheduled = false;
  /** One animation-frame update computes the local scroll ratio. */
  /** Update only the visible local reading-position indicator.
   * @returns {void} Writes a bounded CSS custom-property value.
   */
  const update = () => {
    scheduled = false;
    /** Scrollable document height; zero-height pages avoid division by zero. */
    const maximum = document.documentElement.scrollHeight - innerHeight;
    progress.style.setProperty(
      '--progress',
      String(maximum > 0 ? Math.min(1, Math.max(0, scrollY / maximum)) : 0)
    );
  };
  /** Coalesce scroll/resize events into one pending animation frame. */
  /** Coalesce native scroll/resize notifications into one frame.
   * @returns {void} Schedules at most one pending visual update.
   */
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  update();
}

// Keep disclosure-based menus usable without JS, adding normal dismiss behavior when enhanced.
/** Native disclosure remains fully usable without this dismiss enhancement. */
const versionMenu =
  document.querySelector<HTMLDetailsElement>('.version-switch')!;
if (versionMenu) {
  document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node && !versionMenu.contains(event.target)) {
      versionMenu.open = false;
    }
  });
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Node && !versionMenu.contains(event.target)) {
      versionMenu.open = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && versionMenu.open) {
      versionMenu.open = false;
      versionMenu.querySelector<HTMLElement>('summary')!.focus();
    }
  });
}

// Native help dialogs and visible controls remain keyboard accessible; optional single-key shortcuts can be disabled.
/** Native labelled help dialog; opening it never changes authorization. */
const shortcuts =
  document.querySelector<HTMLDialogElement>('#shortcuts-dialog')!;
let shortcutTrigger: Element | null = null;
/** Open native help explicitly and retain its focus-return target.
 * @returns {void} Does nothing when the help dialog is absent/already open.
 */
function showShortcuts() {
  if (!shortcuts || shortcuts.open) {
    return;
  }
  shortcutTrigger = document.activeElement;
  shortcuts.showModal();
}
for (const button of document.querySelectorAll<HTMLElement>(
  '[data-open-shortcuts]'
)) {
  button.hidden = false;
  button.addEventListener('click', showShortcuts);
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-open-search]'
)) {
  button.addEventListener('click', showSearch);
}
/** Optional single-key shortcut preference; denied browser storage leaves controls usable. */
const shortcutOption = document.querySelector<HTMLInputElement>(
  '[data-single-shortcuts]'
)!;
if (shortcutOption) {
  shortcutOption.checked = singleKeys;
  shortcutOption.addEventListener('change', () => {
    singleKeys = shortcutOption.checked;
    try {
      localStorage.setItem('zerux-single-shortcuts', singleKeys ? 'on' : 'off');
    } catch {
      /* Browser persistence is optional; retain the usable default UI on storage failure. */
    }
  });
}
shortcuts?.addEventListener('close', () =>
  (shortcutTrigger instanceof HTMLElement ? shortcutTrigger : null)?.focus()
);
for (const modal of document.querySelectorAll<HTMLDialogElement>(
  'dialog:not(#search-dialog)'
)) {
  for (const button of modal.querySelectorAll<HTMLElement>(
    '[data-close-dialog]'
  )) {
    button.addEventListener('click', () => modal.close());
  }
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.close();
    }
  });
}
document.addEventListener('keydown', (event) => {
  /** Editable targets suppress optional single-key shortcuts. */
  const typing =
    event.target instanceof Element &&
    event.target.closest('input,textarea,select,[contenteditable]');
  if (
    event.key === '?' &&
    singleKeys &&
    !typing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !document.querySelector<HTMLDialogElement>('dialog[open]')!
  ) {
    event.preventDefault();
    showShortcuts();
  }
});

// Animate decorative relationships and one-time reveals only when allowed; never hide content without a live observer.
let motion = true;
try {
  motion = localStorage.getItem('zerux-docs-motion') !== 'off';
} catch {
  /* Browser persistence is optional; retain the usable default UI on storage failure. */
}
/** Live system motion preference, authoritative over decorative local opt-in. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** Apply local and system reduced-motion policy to decorative controls.
 * @returns {void} Updates only display state; never stores or starts remote work.
 */
function syncMotion() {
  /** Decorative motion requires both local permission and a non-reduced system preference. */
  const allowed = motion && !reducedMotion.matches;
  document.documentElement.dataset.motion = allowed ? 'on' : 'off';
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-motion-toggle]'
  )) {
    button.hidden = false;
    if (reducedMotion.matches) {
      button.textContent = 'Motion: reduced by system';
    } else if (motion) {
      button.textContent = 'Pause motion';
    } else {
      button.textContent = 'Enable motion';
    }
    button.disabled = reducedMotion.matches;
    button.setAttribute('aria-pressed', String(!allowed));
  }
  if (!allowed) {
    document
      .querySelectorAll<HTMLElement>('.reveal-pending')
      .forEach((node) => node.classList.remove('reveal-pending'));
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-motion-toggle]'
)) {
  button.addEventListener('click', () => {
    motion = !motion;
    try {
      localStorage.setItem('zerux-docs-motion', motion ? 'on' : 'off');
    } catch {
      /* Browser persistence is optional; retain the usable default UI on storage failure. */
    }
    syncMotion();
  });
}
reducedMotion.addEventListener('change', syncMotion);
syncMotion();
if (motion && !reducedMotion.matches && 'IntersectionObserver' in window) {
  /** Page-lifetime one-shot observer; content starts visible and is never hidden without observer support. */
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.remove('reveal-pending');
          reveal.unobserve(entry.target);
        } else {
          entry.target.classList.add('reveal-pending');
        }
      }
    },
    { threshold: 0.08 }
  );
  for (const node of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
    reveal.observe(node);
  }
}
