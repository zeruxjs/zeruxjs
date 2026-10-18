/** Progressive enhancement for already-rendered documentation. No telemetry, external services or cookies. */
const root = document.documentElement;
const themeButton = document.querySelector('.theme-toggle');
const modes = ['system', 'light', 'dark'];
let theme = 'system';
try {
  const saved = localStorage.getItem('zerux-docs-theme');
  if (modes.includes(saved)) theme = saved;
} catch {
  /* Private browsing may deny storage. */
}
/** Apply a display preference only. @returns {void} Nothing. Reads module theme and browser DOM. */
function applyTheme() {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  themeButton.textContent =
    theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐';
  themeButton.setAttribute('aria-label', `Color theme: ${theme}. Change theme`);
  themeButton.title = `Theme: ${theme}`;
}
if (themeButton) {
  themeButton.hidden = false;
  applyTheme();
  themeButton.addEventListener('click', () => {
    theme = modes[(modes.indexOf(theme) + 1) % modes.length];
    try {
      localStorage.setItem('zerux-docs-theme', theme);
    } catch {
      /* Optional preference persistence. */
    }
    applyTheme();
  });
}
for (const button of document.querySelectorAll('.copy-code')) {
  if (!navigator.clipboard?.writeText) continue;
  button.hidden = false;
  button.addEventListener('click', async () => {
    const code = button
      .closest('.code-block')
      .querySelector('code').textContent;
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
const dialog = document.querySelector('#search-dialog');
const openSearch = document.querySelector('#open-search');
const closeSearch = document.querySelector('.close-search');
const input = document.querySelector('#search-input');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
let indexPromise;
let queryVersion = 0;
/** Open the optional modal search. @returns {void} Nothing. Reads dialog DOM only. */
function showSearch() {
  if (!dialog.open) dialog.showModal();
  input.focus();
}
if (dialog && typeof dialog.showModal === 'function') {
  openSearch.hidden = false;
  openSearch.addEventListener('click', showSearch);
  closeSearch.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      showSearch();
    }
  });
  input.addEventListener('input', async () => {
    const sequence = ++queryVersion;
    const query = input.value.trim().toLowerCase().slice(0, 120);
    results.replaceChildren();
    if (query.length < 2) {
      status.textContent = 'Type at least two characters.';
      return;
    }
    status.textContent = 'Searching…';
    try {
      indexPromise ??= fetch(
        `${document.body.dataset.basePath || ''}/assets/search.json`,
      )
        .then((response) => {
          if (!response.ok) throw new Error('Search index unavailable');
          return response.json();
        })
        .catch((error) => {
          indexPromise = undefined;
          throw error;
        });
      const index = await indexPromise;
      if (sequence !== queryVersion) return;
      const words = query.split(/\s+/);
      const version = document.body.dataset.version;
      const matches = index
        .filter((page) => page.version === version)
        .map((page) => {
          const title = page.title.toLowerCase(),
            section = page.section.toLowerCase(),
            body = page.text.toLowerCase();
          const score = words.reduce(
            (sum, word) =>
              sum +
              (title.includes(word)
                ? 12
                : section.includes(word)
                  ? 5
                  : body.includes(word)
                    ? 1
                    : -1000),
            0,
          );
          return { ...page, score };
        })
        .filter((page) => page.score > 0)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
      const selected = matches.slice(0, 12);
      status.textContent = matches.length
        ? `${matches.length} matching topics. Showing ${selected.length}.`
        : 'No matches. Try a package name or a shorter phrase.';
      for (const page of selected) {
        const link = document.createElement('a');
        link.href = page.url;
        const context = document.createElement('small');
        context.textContent = page.section;
        const title = document.createElement('strong');
        title.textContent = page.title;
        const description = document.createElement('span');
        description.textContent = page.description;
        link.append(context, title, description);
        results.append(link);
      }
    } catch {
      if (sequence === queryVersion)
        status.textContent =
          'Search unavailable. Browse the documentation sidebar.';
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return;
    }
    const links = [...results.querySelectorAll('a')];
    if (!links.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const current = links.indexOf(document.activeElement);
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % links.length
        : current <= 0
          ? links.length - 1
          : current - 1;
    links[next].focus();
  });
}
const packageFilter = document.querySelector('#package-filter');
if (packageFilter) {
  packageFilter.closest('.package-filter').hidden = false;
  const cards = [...document.querySelectorAll('.package-card')];
  packageFilter.addEventListener('input', () => {
    const query = packageFilter.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      card.hidden = !card.textContent.toLowerCase().includes(query);
      if (!card.hidden) visible++;
    }
    document.querySelector('#package-count').textContent =
      `${visible} of ${cards.length} packages`;
  });
}
if ('IntersectionObserver' in window) {
  const headings = [
    ...document.querySelectorAll('.doc-article h2[id], .doc-article h3[id]'),
  ];
  const links = [...document.querySelectorAll('.right-rail nav a')];
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
        if (link.hash === '#' + current.id)
          link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    },
    { rootMargin: '-90px 0px -55% 0px' },
  );
  headings.forEach((heading) => observer.observe(heading));
}

// Desktop keeps navigation visible; mobile starts with a compact disclosure.
const mobileNavigation = document.querySelector('.mobile-navigation');
if (mobileNavigation && window.matchMedia) {
  const mobile = window.matchMedia('(max-width: 700px)');
  const synchronizeNavigation = () => {
    mobileNavigation.open = !mobile.matches;
  };
  synchronizeNavigation();
  mobile.addEventListener('change', synchronizeNavigation);
}
