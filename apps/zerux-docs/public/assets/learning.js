import { lessons } from "../../src/lib/academy.mjs";

/** Browser-only learning enhancements. Storage is optional, bounded and never sent over the network. */
const base = document.body.dataset.basePath;
const version = document.body.dataset.version;
const key = `zerux-handbook:${base}:${version}:1`;
const blank = () => ({
  schema: 1,
  correct: {},
  exercises: [],
  bookmarks: [],
  recent: [],
});
let state = blank();
let persistent = true;

/** Validate a stored public reading link. @param {unknown} value Stored record. @returns {object|null} Safe same-mount URL/title. Reads current origin and docs metadata only. */
function readingLink(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.title !== "string" ||
    value.title.length > 200 ||
    typeof value.url !== "string" ||
    value.url.length > 500
  )
    return null;
  try {
    const url = new URL(value.url, location.origin);
    if (
      url.origin !== location.origin ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(`${base}/docs/${version}/`)
    )
      return null;
    return { title: value.title, url: url.pathname };
  } catch {
    return null;
  }
}

/** Parse only known lesson/question IDs and bounded reading lists. @param {string|null} text Browser storage. @returns {object} Validated local state. No I/O. */
function parseState(text) {
  const next = blank();
  if (!text || text.length > 100_000) return next;
  try {
    const input = JSON.parse(text);
    if (input?.schema !== 1) return next;
    for (const lesson of lessons) {
      const ids = input.correct?.[lesson.slug];
      next.correct[lesson.slug] = Array.isArray(ids)
        ? lesson.questions.filter((q) => ids.includes(q.id)).map((q) => q.id)
        : [];
    }
    next.exercises = lessons
      .filter(
        (lesson) =>
          Array.isArray(input.exercises) &&
          input.exercises.includes(lesson.slug),
      )
      .map((lesson) => lesson.slug);
    for (const field of ["bookmarks", "recent"]) {
      const seen = new Set();
      next[field] = (
        Array.isArray(input[field])
          ? input[field].slice(0, field === "bookmarks" ? 50 : 12)
          : []
      )
        .map(readingLink)
        .filter((item) => item && !seen.has(item.url) && seen.add(item.url));
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

/** Persist the bounded known schema; storage denial never blocks reading. @returns {void} Updates local status. */
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    persistent = false;
  }
  render();
}
const complete = (lesson) =>
  lesson.questions.every((q) => state.correct[lesson.slug]?.includes(q.id)) &&
  state.exercises.includes(lesson.slug);

/** Render local progress through text/DOM APIs only. @returns {void} No requests or HTML injection. */
function render() {
  const points = lessons.reduce(
    (sum, lesson) =>
      sum +
      lesson.questions.filter((q) => state.correct[lesson.slug]?.includes(q.id))
        .length *
        10,
    0,
  );
  const completed = lessons.filter(complete).length;
  document.querySelectorAll("[data-total-points]").forEach((node) => {
    node.textContent = String(points);
  });
  document.querySelectorAll("[data-completed-count]").forEach((node) => {
    node.textContent = `${completed} / ${lessons.length}`;
  });
  document.querySelectorAll("[data-course-progress]").forEach((node) => {
    node.value = completed;
  });
  document.querySelectorAll("[data-progress-panel]").forEach((node) => {
    node.hidden = false;
  });
  document.querySelectorAll("[data-storage-status]").forEach((node) => {
    node.textContent = persistent
      ? "Saved only in this browser. No account, sync or certification."
      : "Browser storage is unavailable. You can practice now, but changes may not survive this page.";
  });
  document.querySelectorAll("[data-lesson-card]").forEach((card) => {
    const lesson = lessons.find(
      (item) => item.slug === card.dataset.lessonCard,
    );
    const done = complete(lesson);
    card.dataset.complete = String(done);
    card.querySelector("[data-lesson-state]").textContent = done
      ? "Completed ✓ · Revisit lesson"
      : state.correct[lesson.slug]?.length
        ? "In progress · Continue →"
        : "Open lesson →";
  });
  const resume = lessons.find((lesson) => !complete(lesson));
  document.querySelectorAll("[data-resume]").forEach((link) => {
    link.href = `${base}/docs/${version}/${resume?.slug || "tutorial"}/`;
    link.textContent = resume
      ? `Continue: ${resume.title} →`
      : "Course complete · Build the notes app →";
  });
  document.querySelectorAll("[data-exercise]").forEach((input) => {
    input.disabled = false;
    input.checked = state.exercises.includes(input.dataset.exercise);
  });
  for (const [selector, field, empty] of [
    [
      "[data-bookmark-list]",
      "bookmarks",
      "No bookmarks yet. Use Save page on an article.",
    ],
    [
      "[data-recent-list]",
      "recent",
      "Open an article to begin your reading trail.",
    ],
  ]) {
    document.querySelectorAll(selector).forEach((list) => {
      list.replaceChildren();
      if (!state[field].length) {
        const item = document.createElement("li");
        item.textContent = empty;
        list.append(item);
      }
      for (const item of state[field]) {
        const li = document.createElement("li"),
          link = document.createElement("a");
        link.href = item.url;
        link.textContent = item.title;
        li.append(link);
        list.append(li);
      }
    });
  }
  document.querySelectorAll("[data-saved-reading]").forEach((node) => {
    node.hidden = false;
  });
  const bookmarked = state.bookmarks.some(
    (item) => item.url === location.pathname,
  );
  document.querySelectorAll("[data-bookmark]").forEach((button) => {
    button.hidden = !page;
    button.textContent = bookmarked ? "Saved ✓" : "Save page";
    button.setAttribute("aria-pressed", String(bookmarked));
  });
}

for (const form of document.querySelectorAll("[data-quiz]")) {
  const lesson = lessons.find((item) => item.slug === form.dataset.quiz);
  if (!lesson) continue;
  form.querySelector("[data-check-answers]").hidden = false;
  for (const question of lesson.questions) {
    if (state.correct[lesson.slug]?.includes(question.id))
      form.querySelector(
        `input[name="${question.id}"][value="${question.answer}"]`,
      ).checked = true;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let correct = 0,
      earned = 0;
    const answers = new FormData(form);
    for (const question of lesson.questions) {
      const field = form.querySelector(`[data-question="${question.id}"]`);
      const matches = answers.get(question.id) === String(question.answer);
      if (matches) {
        correct++;
        state.correct[lesson.slug] ??= [];
        if (!state.correct[lesson.slug].includes(question.id)) {
          state.correct[lesson.slug].push(question.id);
          earned += 10;
        }
      }
      field.dataset.result = matches ? "correct" : "retry";
      field.querySelector("[data-feedback]").textContent =
        `${matches ? "Correct." : "Try again."} ${question.explanation}`;
    }
    form.querySelector("[data-quiz-summary]").textContent =
      `${correct} of ${lesson.questions.length} correct. ${earned ? `+${earned} new learning points.` : "No duplicate points awarded."} ${correct === lesson.questions.length ? "Confirm your exercise when you have tried it." : "Read the explanation and retry whenever ready."}`;
    save();
  });
}
for (const input of document.querySelectorAll("[data-exercise]"))
  input.addEventListener("change", () => {
    const slug = input.dataset.exercise;
    state.exercises = state.exercises.filter((item) => item !== slug);
    if (input.checked && lessons.some((lesson) => lesson.slug === slug))
      state.exercises.push(slug);
    save();
  });
const page = readingLink({
  url: location.pathname,
  title: document.querySelector("main h1")?.textContent || document.title,
});
if (page) {
  state.recent = [
    page,
    ...state.recent.filter((item) => item.url !== page.url),
  ].slice(0, 12);
  save();
}
for (const button of document.querySelectorAll("[data-bookmark]"))
  button.addEventListener("click", () => {
    if (!page) return;
    const exists = state.bookmarks.some((item) => item.url === page.url);
    state.bookmarks = state.bookmarks.filter((item) => item.url !== page.url);
    if (!exists) state.bookmarks = [page, ...state.bookmarks].slice(0, 50);
    save();
    const notice = document.querySelector("[data-page-notice]");
    if (notice)
      notice.textContent = exists
        ? "Page removed from your local reading list."
        : persistent
          ? "Page saved in this browser. Find it on the course/home progress panel."
          : "Saved for this page only; browser storage is unavailable.";
  });
for (const button of document.querySelectorAll("[data-export-progress]"))
  button.addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...state, docsVersion: version }, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `zeruxjs-learning-${version}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
const reset = document.querySelector("#reset-progress-dialog");
for (const button of document.querySelectorAll("[data-reset-progress]"))
  button.addEventListener("click", () => reset.showModal());
reset?.querySelector("[data-confirm-reset]")?.addEventListener("click", () => {
  state = blank();
  save();
  for (const form of document.querySelectorAll("[data-quiz]")) form.reset();
  reset.close();
});
window.addEventListener("storage", (event) => {
  if (event.key === key) {
    state = parseState(event.newValue);
    render();
  }
});
render();

// Symptom matching is a bounded DOM filter, requiring no search index or network requests.
const filter = document.querySelector("#solution-filter");
if (filter) {
  const cards = [...document.querySelectorAll("[data-solution]")];
  filter.addEventListener("input", () => {
    const words = filter.value
      .trim()
      .toLowerCase()
      .slice(0, 120)
      .split(/\s+/)
      .filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      card.hidden = !words.every((word) =>
        card.dataset.solution.toLowerCase().includes(word),
      );
      if (!card.hidden) shown++;
    }
    document.querySelector("#solution-count").textContent =
      `${shown} of ${cards.length} starting points`;
    document.querySelector("[data-no-solutions]").hidden = shown > 0;
  });
}

// This conceptual walkthrough explains a request; it never executes application server code.
const trace = document.querySelector("[data-trace]");
if (trace) {
  trace.hidden = false;
  let stage = -1;
  const descriptions = [
    "1. The browser asks for a URL. No npm install happens in the visitor’s browser.",
    "2. GET /hello identifies the method and path. Routing selects the matching handler.",
    "3. The server runs the handler and returns the JSON response shown above.",
  ];
  trace.addEventListener("click", () => {
    stage = (stage + 1) % descriptions.length;
    document.querySelector("[data-trace-status]").textContent =
      descriptions[stage];
    document.querySelectorAll("[data-trace-stage]").forEach((node, index) => {
      if (index === stage) node.setAttribute("aria-current", "step");
      else node.removeAttribute("aria-current");
    });
    trace.textContent =
      stage === descriptions.length - 1
        ? "Trace it again →"
        : "Follow the next step →";
  });
}
