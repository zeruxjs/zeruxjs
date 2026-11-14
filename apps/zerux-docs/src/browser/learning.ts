import { lessons } from '../lib/academy.ts';

/** Browser-only learning enhancements. Storage is optional, bounded and never sent over the network. */
/** Exact docs mount is part of local progress identity and reading-link validation. */
const base = document.body.dataset.basePath;
/** Documentation version partitions local progress; no cross-site identifier is created. */
const version = document.body.dataset.version;
/** Versioned browser-only storage key; the value is never sent to a server. */
const key = `zerux-handbook:${base}:${version}:1`;
/** Allocate fresh nested state collections so reset does not share previous reading lists. */
/** Allocate a fresh empty local learning record.
 * @returns {object} Independent known-schema state with no identity or network behavior.
 */
/** Validated same-origin reading record, never executable storage content. */
interface ReadingLink {
  /** Inert title displayed with textContent. */
  title: string;
  /** Validated same-version path. */
  url: string;
}
/** Bounded local-only progress data; no account or analytics identity. */
interface LearningState {
  /** Persisted schema discriminator. */
  schema: 1;
  /** Known correct question IDs per authored lesson. */
  correct: Record<string, string[]>;
  /** Known lesson exercise confirmations. */
  exercises: string[];
  /** Same-version saved links. */
  bookmarks: ReadingLink[];
  /** Same-version recent links. */
  recent: ReadingLink[];
}
/** Allocate independent progress collections; reset never reuses the previous state.
 * @returns {LearningState} Fresh local-only progress state.
 */
const blank = (): LearningState => ({
  schema: 1,
  correct: {},
  exercises: [],
  bookmarks: [],
  recent: [],
});
let state = blank();
let persistent = true;

/** Validate a stored public reading link.
 * @param {unknown} value Stored record.
 * @returns {object|null} Safe same-mount URL/title. Reads current origin and docs metadata only. */
function readingLink(value: unknown): ReadingLink | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('title' in value) ||
    typeof value.title !== 'string' ||
    value.title.length > 200 ||
    !('url' in value) ||
    typeof value.url !== 'string' ||
    value.url.length > 500
  ) {
    return null;
  }
  try {
    /** Resolve stored reading links only against this origin before accepting the same-version path. */
    const url = new URL(value.url, location.origin);
    if (
      url.origin !== location.origin ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(`${base}/docs/${version}/`)
    ) {
      return null;
    }
    return { title: value.title, url: url.pathname };
  } catch {
    return null;
  }
}

/** Parse only known lesson/question IDs and bounded reading lists.
 * @param {string|null} text Browser storage.
 * @returns {object} Validated local state. No I/O. */
function parseState(text: string | null): LearningState {
  /** Fresh validated state; unknown/corrupt fields never become stored UI data. */
  const next = blank();
  if (!text || text.length > 100_000) {
    return next;
  }
  try {
    /** Parsed untrusted local storage still requires known schema/identity validation. */
    const input = JSON.parse(text);
    if (input?.schema !== 1) {
      return next;
    }
    for (const lesson of lessons) {
      /** Candidate recorded question IDs intersected with current authored questions. */
      const ids = input.correct?.[lesson.slug];
      next.correct[lesson.slug] = Array.isArray(ids)
        ? lesson.questions.filter((q) => ids.includes(q.id)).map((q) => q.id)
        : [];
    }
    next.exercises = lessons
      .filter(
        (lesson) =>
          Array.isArray(input.exercises) &&
          input.exercises.includes(lesson.slug)
      )
      .map((lesson) => lesson.slug);
    for (const field of ['bookmarks', 'recent'] as const) {
      /** Per-reading-list URL deduplication after same-mount validation. */
      const seen = new Set();
      next[field] = (
        Array.isArray(input[field])
          ? input[field].slice(0, field === 'bookmarks' ? 50 : 12)
          : []
      )
        .map(readingLink)
        .filter(
          (item: ReadingLink | null): item is ReadingLink =>
            item !== null && !seen.has(item.url) && Boolean(seen.add(item.url))
        );
    }
  } catch {
    /* Corrupt or old data starts a fresh optional learning record. */
  }
  return next;
}
try {
  state = parseState(localStorage.getItem(key));
} catch {
  persistent = false;
}

/** Persist the bounded known schema; storage denial never blocks reading.
 * @returns {void} Updates local status. */
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    persistent = false;
  }
  render();
}
/** Completion requires every known question plus explicit exercise confirmation, not a certification. */
/** Check the explicit local lesson completion rule.
 * @param {object} lesson - Current authored lesson and known question IDs.
 * @returns {boolean} Whether all questions and the exercise confirmation are recorded.
 */
const complete = (lesson: (typeof lessons)[number]): boolean =>
  lesson.questions.every((q) => state.correct[lesson.slug]?.includes(q.id)) &&
  state.exercises.includes(lesson.slug);

/** Render local progress through text/DOM APIs only.
 * @returns {void} No requests or HTML injection. */
function render() {
  /** Local self-assessment total from unique known correct answers only. */
  const points = lessons.reduce(
    (sum, lesson) =>
      sum +
      lesson.questions.filter((q) => state.correct[lesson.slug]?.includes(q.id))
        .length *
        10,
    0
  );
  /** Number of lessons satisfying the explicit local completion rule. */
  const completed = lessons.filter(complete).length;
  document
    .querySelectorAll<HTMLElement>('[data-total-points]')
    .forEach((node) => {
      node.textContent = String(points);
    });
  document
    .querySelectorAll<HTMLElement>('[data-completed-count]')
    .forEach((node) => {
      node.textContent = `${completed} / ${lessons.length}`;
    });
  document
    .querySelectorAll<HTMLProgressElement>('[data-course-progress]')
    .forEach((node) => {
      node.value = completed;
    });
  document
    .querySelectorAll<HTMLElement>('[data-progress-panel]')
    .forEach((node) => {
      node.hidden = false;
    });
  document
    .querySelectorAll<HTMLElement>('[data-storage-status]')
    .forEach((node) => {
      node.textContent = persistent
        ? 'Saved only in this browser. No account, sync or certification.'
        : 'Browser storage is unavailable. You can practice now, but changes may not survive this page.';
    });
  document
    .querySelectorAll<HTMLElement>('[data-lesson-card]')
    .forEach((card) => {
      /** Exact authored lesson lookup; browser role/trait claims are never involved. */
      const lesson = lessons.find(
        (item) => item.slug === card.dataset.lessonCard
      );
      /** Current local completion status used only for display/navigation. */
      if (!lesson) {
        return;
      }
      /** Completion is derived only from known lesson questions and explicit exercise confirmation. */
      const done = complete(lesson);
      card.dataset.complete = String(done);
      /** Existing lesson status element; select once before choosing its display text. */
      const lessonState = card.querySelector<HTMLElement>(
        '[data-lesson-state]'
      )!;
      if (done) {
        lessonState.textContent = 'Completed ✓ · Revisit lesson';
      } else if (state.correct[lesson.slug]?.length) {
        lessonState.textContent = 'In progress · Continue →';
      } else {
        lessonState.textContent = 'Open lesson →';
      }
    });
  /** First unfinished authored lesson; every lesson remains accessible regardless. */
  const resume = lessons.find((lesson) => !complete(lesson));
  document
    .querySelectorAll<HTMLAnchorElement>('[data-resume]')
    .forEach((link) => {
      link.href = `${base}/docs/${version}/${resume?.slug || 'tutorial'}/`;
      link.textContent = resume
        ? `Continue: ${resume.title} →`
        : 'Course complete · Build the notes app →';
    });
  document
    .querySelectorAll<HTMLInputElement>('[data-exercise]')
    .forEach((input) => {
      input.disabled = false;
      input.checked = state.exercises.includes(input.dataset.exercise ?? '');
    });
  for (const [selector, field, empty] of [
    [
      '[data-bookmark-list]',
      'bookmarks',
      'No bookmarks yet. Use Save page on an article.',
    ],
    [
      '[data-recent-list]',
      'recent',
      'Open an article to begin your reading trail.',
    ],
  ] as const) {
    document.querySelectorAll(selector).forEach((list) => {
      list.replaceChildren();
      if (!state[field].length) {
        /** Inert empty-state list item or validated reading record, never HTML from storage. */
        const item = document.createElement('li');
        item.textContent = empty;
        list.append(item);
      }
      for (const item of state[field]) {
        /** Native reading-list row owned by this render. */
        const li = document.createElement('li'),
          link = document.createElement('a');
        link.href = item.url;
        link.textContent = item.title;
        li.append(link);
        list.append(li);
      }
    });
  }
  document
    .querySelectorAll<HTMLElement>('[data-saved-reading]')
    .forEach((node) => {
      node.hidden = false;
    });
  /** Current page membership in the bounded local reading list. */
  const bookmarked = state.bookmarks.some(
    (item) => item.url === location.pathname
  );
  document
    .querySelectorAll<HTMLElement>('[data-bookmark]')
    .forEach((button) => {
      button.hidden = !page;
      button.textContent = bookmarked ? 'Saved ✓' : 'Save page';
      button.setAttribute('aria-pressed', String(bookmarked));
    });
}

for (const form of document.querySelectorAll<HTMLFormElement>('[data-quiz]')) {
  /** Exact authored lesson lookup; browser role/trait claims are never involved. */
  const lesson = lessons.find((item) => item.slug === form.dataset.quiz);
  if (!lesson) {
    continue;
  }
  form.querySelector<HTMLElement>('[data-check-answers]')!.hidden = false;
  for (const question of lesson.questions) {
    if (state.correct[lesson.slug]?.includes(question.id)) {
      form.querySelector<HTMLInputElement>(
        `input[name="${question.id}"][value="${question.answer}"]`
      )!.checked = true;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let correct = 0,
      earned = 0;
    /** Native form values compared to authored answer identities; no expressions are evaluated. */
    const answers = new FormData(form);
    for (const question of lesson.questions) {
      /** Known question’s owned feedback container. */
      const field = form.querySelector<HTMLElement>(
        `[data-question="${question.id}"]`
      )!;
      /** String equality against the authored option index; retries never award duplicate points. */
      const matches = answers.get(question.id) === String(question.answer);
      if (matches) {
        correct++;
        state.correct[lesson.slug] ??= [];
        if (!state.correct[lesson.slug].includes(question.id)) {
          state.correct[lesson.slug].push(question.id);
          earned += 10;
        }
      }
      field.dataset.result = matches ? 'correct' : 'retry';
      field.querySelector<HTMLElement>('[data-feedback]')!.textContent =
        `${matches ? 'Correct.' : 'Try again.'} ${question.explanation}`;
    }
    form.querySelector<HTMLElement>('[data-quiz-summary]')!.textContent =
      `${correct} of ${lesson.questions.length} correct. ${earned ? `+${earned} new learning points.` : 'No duplicate points awarded.'} ${correct === lesson.questions.length ? 'Confirm your exercise when you have tried it.' : 'Read the explanation and retry whenever ready.'}`;
    save();
  });
}
for (const input of document.querySelectorAll<HTMLInputElement>(
  '[data-exercise]'
)) {
  input.addEventListener('change', () => {
    /** Known lesson identity from the explicit exercise control. */
    const slug = input.dataset.exercise!;
    state.exercises = state.exercises.filter((item) => item !== slug);
    if (input.checked && lessons.some((lesson) => lesson.slug === slug)) {
      state.exercises.push(slug);
    }
    save();
  });
}
/** Current public reading record, accepted only after same-origin/version validation. */
const page = readingLink({
  url: location.pathname,
  title:
    document.querySelector<HTMLElement>('main h1')?.textContent ||
    document.title,
});
if (page) {
  state.recent = [
    page,
    ...state.recent.filter((item) => item.url !== page.url),
  ].slice(0, 12);
  save();
}
for (const button of document.querySelectorAll<HTMLElement>(
  '[data-bookmark]'
)) {
  button.addEventListener('click', () => {
    if (!page) {
      return;
    }
    /** Previous bookmark membership distinguishes remove from explicit save. */
    const exists = state.bookmarks.some((item) => item.url === page.url);
    state.bookmarks = state.bookmarks.filter((item) => item.url !== page.url);
    if (!exists) {
      state.bookmarks = [page, ...state.bookmarks].slice(0, 50);
    }
    save();
    /** Optional live feedback; storage failure does not block the reading action. */
    const notice = document.querySelector<HTMLElement>('[data-page-notice]')!;
    if (notice) {
      if (exists) {
        notice.textContent = 'Page removed from your local reading list.';
      } else if (persistent) {
        notice.textContent =
          'Page saved in this browser. Find it on the course/home progress panel.';
      } else {
        notice.textContent =
          'Saved for this page only; browser storage is unavailable.';
      }
    }
  });
}
for (const button of document.querySelectorAll<HTMLElement>(
  '[data-export-progress]'
)) {
  button.addEventListener('click', () => {
    /** Resolve stored reading links only against this origin before accepting the same-version path. */
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...state, docsVersion: version }, null, 2)], {
        type: 'application/json',
      })
    );
    /** Native download/reading link populated from known local records. */
    const link = document.createElement('a');
    link.href = url;
    link.download = `zeruxjs-learning-${version}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
/** Native confirmation dialog; reset is never triggered by importing stored preferences. */
const reset = document.querySelector<HTMLDialogElement>(
  '#reset-progress-dialog'
)!;
for (const button of document.querySelectorAll<HTMLElement>(
  '[data-reset-progress]'
)) {
  button.addEventListener('click', () => reset.showModal());
}
reset
  ?.querySelector<HTMLElement>('[data-confirm-reset]')
  ?.addEventListener('click', () => {
    state = blank();
    save();
    for (const form of document.querySelectorAll<HTMLFormElement>(
      '[data-quiz]'
    )) {
      form.reset();
    }
    reset.close();
  });
window.addEventListener('storage', (event) => {
  if (event.key === key) {
    state = parseState(event.newValue);
    render();
  }
});
render();

// Symptom matching is a bounded DOM filter, requiring no search index or network requests.
/** Optional symptom filter over fixed public cards; no network request is sent. */
const filter = document.querySelector<HTMLInputElement>('#solution-filter')!;
if (filter) {
  /** Static symptom cards whose visibility is derived from bounded plain-text matching. */
  const cards = [...document.querySelectorAll<HTMLElement>('[data-solution]')];
  filter.addEventListener('input', () => {
    /** At most 120 input characters become literal tokens; no user regular expression is compiled. */
    const words = filter.value
      .trim()
      .toLowerCase()
      .slice(0, 120)
      .split(/\s+/)
      .filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      card.hidden = !words.every((word) =>
        (card.dataset.solution ?? '').toLowerCase().includes(word)
      );
      if (!card.hidden) {
        shown++;
      }
    }
    document.querySelector<HTMLElement>('#solution-count')!.textContent =
      `${shown} of ${cards.length} starting points`;
    document.querySelector<HTMLElement>('[data-no-solutions]')!.hidden =
      shown > 0;
  });
}

// This conceptual walkthrough explains a request; it never executes application server code.
/** Explicit conceptual walkthrough control, never an application/server executor. */
const trace = document.querySelector<HTMLElement>('[data-trace]')!;
if (trace) {
  trace.hidden = false;
  let stage = -1;
  /** Authored explanatory stages; clicking only changes local display text. */
  const descriptions = [
    '1. The browser asks for a URL. No npm install happens in the visitor’s browser.',
    '2. GET /hello identifies the method and path. Routing selects the matching handler.',
    '3. The server runs the handler and returns the JSON response shown above.',
  ];
  trace.addEventListener('click', () => {
    stage = (stage + 1) % descriptions.length;
    document.querySelector<HTMLElement>('[data-trace-status]')!.textContent =
      descriptions[stage];
    document
      .querySelectorAll<HTMLElement>('[data-trace-stage]')
      .forEach((node, index) => {
        if (index === stage) {
          node.setAttribute('aria-current', 'step');
        } else {
          node.removeAttribute('aria-current');
        }
      });
    trace.textContent =
      stage === descriptions.length - 1
        ? 'Trace it again →'
        : 'Follow the next step →';
  });
}
