import { lessons, explainers } from "./academy.mjs";
import { escape } from "./markdown.mjs";

/** Render nonessential reading enhancements and native course checks. @param {object} page Page metadata. @returns {string} Accessible static HTML. Reads authored data only; no I/O/globals. */
export function learningTools(page) {
  const base = `/docs/${page.version}/`;
  const lesson = lessons.find((item) => item.slug === page.slug);
  if (lesson) {
    const index = lessons.indexOf(lesson);
    return `<section class="knowledge-check" aria-labelledby="knowledge-title"><p class="eyebrow">PUT IT INTO PRACTICE</p><h2 id="knowledge-title">Check your understanding</h2><p>Try the exercise above, then answer both questions. Each correct answer earns 10 local learning points, once. You can retry; all lessons stay open.</p><form data-quiz="${escape(lesson.slug)}">${lesson.questions.map((q) => `<fieldset data-question="${escape(q.id)}"><legend>${escape(q.prompt)}</legend>${q.options.map((option, i) => `<label class="quiz-option"><input type="radio" name="${escape(q.id)}" value="${i}" required> <span>${escape(option)}</span></label>`).join("")}<p class="quiz-feedback" data-feedback="${escape(q.id)}" role="status"></p><details class="answer-explanation"><summary>Explain the answer</summary><p>${escape(q.options[q.answer])}. ${escape(q.explanation)}</p></details></fieldset>`).join("")}<button class="primary-button" type="submit" data-check-answers hidden>Check my answers</button><p data-quiz-summary role="status"></p></form><label class="exercise-confirm"><input type="checkbox" data-exercise="${escape(lesson.slug)}" disabled> I tried the exercise and compared the actual result with the expected result.</label><noscript><p>Questions and explanations work without JavaScript. Enable JavaScript for optional browser-local points and exercise tracking.</p></noscript><div class="course-next"><a href="${base}learn/">← Course overview</a>${lessons[index + 1] ? `<a class="primary-button" href="${base}${lessons[index + 1].slug}/">Next lesson →</a>` : `<a class="primary-button" href="${base}tutorial/">Build the notes application →</a>`}</div></section>`;
  }
  if (page.slug === "learn") return courseCards(page.version);
  if (page.slug === "solutions") return solutionCards(page.version);
  return "";
}

/** Render a beginner explanation without concealing the detailed reference. @param {object} page Current page. @returns {string} Optional disclosure. No globals. */
export function plainLanguage(page) {
  const content = explainers[page.slug];
  const lesson = lessons.find((item) => item.slug === page.slug);
  if (lesson)
    return `<div class="lesson-banner"><span class="lesson-step">LESSON ${lessons.indexOf(lesson) + 1} OF ${lessons.length}</span><span>${lesson.minutes} min + practice · ${escape(lesson.level)}</span><ul>${lesson.objectives.map((o) => `<li>${escape(o)}</li>`).join("")}</ul></div>`;
  return content
    ? `<details class="plain-language" open><summary>In plain language</summary><p><strong>${escape(content[0])}</strong> ${escape(content[1])}</p><a href="/docs/${page.version}/glossary/">Look up a word</a> · <a href="/docs/${page.version}/learn/">Learn step by step</a></details>`
    : "";
}

/** Render locally enhanced progress with no fabricated score before storage loads. @param {string} version Documentation line. @returns {string} Static panel. No globals. */
export function progressPanel(version) {
  return `<section class="learning-dashboard" data-learning-dashboard aria-labelledby="progress-title"><div><p class="eyebrow">YOUR WORKSPACE</p><h2 id="progress-title">A little progress, every visit.</h2><p>Continue learning or keep useful pages close. Saved in this browser only—no account or tracking.</p></div><div class="progress-stats" data-progress-panel hidden><span><strong data-total-points>0</strong> learning points</span><span><strong data-completed-count>0 / ${lessons.length}</strong> lessons complete</span><progress data-course-progress max="${lessons.length}" value="0" aria-label="Completed lessons"></progress><a data-resume class="secondary-button" href="/docs/${version}/${lessons[0].slug}/">Start the course →</a><div class="progress-actions"><button type="button" data-export-progress>Export progress</button><button type="button" data-reset-progress>Reset progress</button></div></div><p class="storage-status" data-storage-status role="status"></p><div class="saved-reading" data-saved-reading hidden><h3>Your reading list</h3><ul data-bookmark-list></ul><h3>Recently opened</h3><ul data-recent-list></ul></div><noscript><p>All lessons are readable without JavaScript. Local points/bookmarks are optional enhancements.</p></noscript></section>`;
}

/** Render the complete static lesson inventory. @param {string} version Docs line. @returns {string} Cards. No globals. */
export function courseCards(version) {
  return `${progressPanel(version)}<section class="course-map" aria-labelledby="course-map-title"><div class="section-heading"><div><p class="eyebrow">A COURSE, NOT A WALL OF LINKS</p><h2 id="course-map-title">Eight small wins.</h2></div><p>Read → try → check → build.</p></div><ol class="lesson-grid">${lessons.map((lesson, i) => `<li class="lesson-card" data-lesson-card="${lesson.slug}" data-reveal><a href="/docs/${version}/${lesson.slug}/"><span class="lesson-number">${String(i + 1).padStart(2, "0")}</span><span class="lesson-level">${lesson.level} · ${lesson.minutes} min</span><h3>${escape(lesson.title)}</h3><p>${escape(lesson.summary)}</p><span class="lesson-state" data-lesson-state>Open lesson →</span></a></li>`).join("")}</ol></section>`;
}

export const solutions = [
  [
    "Missing npm script",
    "missing script build npm root command publish pack",
    "solutions/#npm-says-missing-script-build",
    "Check the working directory and the scripts actually declared in package.json.",
  ],
  [
    "My route returns 404",
    "404 route missing page not found file handler port",
    "solutions/#the-server-runs-but-my-route-returns-404",
    "Compare the real URL, app directory, file name and HTTP method.",
  ],
  [
    "Config changes do nothing",
    "config zerux.config ignored setup configuration database language",
    "solutions/#zeruxconfigjs-edits-have-no-effect",
    "Check file precedence and the code that actually consumes the option.",
  ],
  [
    "A service cannot connect",
    "database cache redis postgres mysql mongo sqlite undefined degraded connection",
    "solutions/#databasecache-is-undefined-degraded-or-cannot-connect",
    "Verify startup options, required secret names and the service owner.",
  ],
  [
    "Types fail after a successful build",
    "typescript types tsc build compile typecheck error imports",
    "solutions/#the-build-passes-but-typescript-reports-an-error",
    "Compilation and typechecking test different things; follow the public imports.",
  ],
  [
    "Translations are stale or leak",
    "zlocale translation language french arabic rtl locale race stale users",
    "solutions/#language-changes-leak-between-users-or-visible-text-stays-stale",
    "Use request-fixed translators and explicit reactive browser loading.",
  ],
  [
    "My data disappears",
    "memory map records lost restart persistence cache",
    "solutions/#my-data-disappears-after-restart",
    "A process-local teaching store is not a durable database.",
  ],
  [
    "Deploying a server to static hosting",
    "deploy github pages static node server hosting production",
    "solutions/#my-node-application-does-not-run-on-static-pages-hosting",
    "Choose hosting for the actual output: Node server or explicit static export.",
  ],
  [
    "Docs progress or offline problems",
    "offline pwa progress local storage keyboard shortcuts install",
    "solutions/#docs-progress-is-missing-offline-text-is-old-or-a-shortcut-interferes",
    "Check local storage, docs version and optional handbook controls.",
  ],
];

/** Render a fast local symptom filter; all answers stay linked without JS. @param {string} version Docs version. @returns {string} Static finder. No globals. */
export function solutionCards(version) {
  return `<section class="solution-finder" aria-labelledby="solution-title"><p class="eyebrow">LESS GUESSING. A CLEAR NEXT CHECK.</p><h2 id="solution-title">What is getting in your way?</h2><label for="solution-filter">Describe the symptom or task</label><input id="solution-filter" type="search" placeholder="Try: 404, database, language, build…" autocomplete="off" aria-describedby="solution-count"><p id="solution-count" role="status">${solutions.length} common starting points</p><div class="solution-grid">${solutions.map(([title, keywords, path, body]) => `<a class="solution-card" data-solution="${escape(title + " " + keywords)}" href="/docs/${version}/${path}"><h3>${escape(title)} <span aria-hidden="true">↗</span></h3><p>${escape(body)}</p></a>`).join("")}</div><p data-no-solutions hidden>No close match. Try another word, <button type="button" data-open-search>search all docs</button>, or <a href="/docs/${version}/learn-release/#turn-a-failure-into-a-small-question">prepare a small reproduction</a>.</p></section>`;
}

/** Render a content-first portal with paths for new and experienced readers. @param {string} version Current docs line. @returns {string} Hero and navigation. No I/O/globals. */
export function academyHome(version) {
  return `<section class="academy-hero"><div><p class="eyebrow"><span class="status-dot"></span> THE ZERUXJS FIELD GUIDE · ${version}</p><h1>Understand it.<br>Build it.<br><span>Make it yours.</span></h1><p class="hero-description">From “what is a route?” to a feature you can explain and verify. Learn in small steps, find a practical answer, or go straight to the source-backed contract.</p><div class="hero-actions"><a class="primary-button" href="/docs/${version}/learn/">Start learning <span aria-hidden="true">↗</span></a><a class="secondary-button" href="/docs/${version}/solutions/">Solve a problem</a></div><p class="hero-proof">No account. No assumed framework knowledge. Real examples.</p></div><div class="request-visual" aria-label="A request travels from a browser to a route and returns JSON"><div class="visual-window"><span></span><span></span><span></span><small>ONE SMALL WORKING THING</small></div><div class="visual-flow"><span data-trace-stage="0">Browser</span><i aria-hidden="true">→</i><span data-trace-stage="1">GET /hello</span><i aria-hidden="true">→</i><span data-trace-stage="2">Handler</span></div><pre><code><span class="code-comment">// A server response you can inspect.</span>\n{\n  "message": "Hello, builder",\n  "ready": true\n}</code></pre><div class="visual-caption"><span class="live-pip" aria-hidden="true"></span> <span data-trace-status role="status">Conceptual preview. Run a real route in lesson 2.</span></div><button type="button" class="trace-button" data-trace hidden>Trace this request →</button></div></section><div class="release-note">Preview docs ${version} · Packages retain their stated versions · <a href="/docs/${version}/capabilities/">See implemented features and boundaries →</a></div><section class="entry-paths" aria-label="Choose your experience"><a class="path-card" href="/docs/${version}/learn/" data-reveal><span class="path-icon" aria-hidden="true">01</span><h2>“I am starting from zero.”</h2><p>Learn the words, run one route, and check what actually happened. Exercises and explanations included.</p><strong>Follow the course →</strong></a><a class="path-card" href="/docs/${version}/configuration-handbook/" data-reveal><span class="path-icon" aria-hidden="true">02</span><h2>“I know what I want to build.”</h2><p>Find setup, working patterns, TypeScript contracts and the owner of each resource.</p><strong>Build a feature →</strong></a><a class="path-card" href="/docs/${version}/solutions/" data-reveal><span class="path-icon" aria-hidden="true">03</span><h2>“Something is not working.”</h2><p>Start with the symptom. Check the right layer. Compare the expected result before changing more.</p><strong>Find a solution →</strong></a></section>${courseCards(version)}${solutionCards(version)}<section class="feature-atlas" data-reveal><p class="eyebrow">KEEP BUILDING</p><h2>One ecosystem. Focused responsibilities.</h2><div class="atlas-grid">${[
    [
      "routing",
      "Routes & requests",
      "File handlers, parameters, middleware and deliberate errors.",
    ],
    [
      "configuration-handbook",
      "Application settings",
      "Database, cache, files, email and honest startup contracts.",
    ],
    [
      "typescript",
      "TypeScript & trust boundaries",
      "Public types, unknown data and checks that mean something.",
    ],
    [
      "localization-site-settings",
      "A site in more languages",
      "Host policy, request isolation and reactive browser translations.",
    ],
    [
      "localization-package-authoring",
      "Reusable modules & plugins",
      "Publish catalogs and typed features without owning the host.",
    ],
    [
      "packages",
      "Every public package",
      "Setup, examples, limitations and actual import entry points.",
    ],
  ]
    .map(
      ([slug, title, body]) =>
        `<a class="topic-card" href="/docs/${version}/${slug}/"><h3>${title}</h3><p>${body}</p><span>Open guide →</span></a>`,
    )
    .join(
      "",
    )}</div></section><section class="handbook-promise"><h2>Learn the reason behind the code.</h2><p>Every source-backed guide explains setup, ownership, failure behavior and the next useful check. Plain-language explanations sit alongside the detailed contracts. You can read every article without JavaScript.</p><a href="/docs/${version}/handbook-help/">Keyboard, offline reading and handbook controls →</a></section>`;
}
