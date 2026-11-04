/** Authored learning contracts shared by static rendering and browser progress. No I/O or global state. */
export const lessons = [
  {
    slug: "learn-foundations",
    title: "Understand what you are building",
    minutes: 12,
    level: "Start here",
    summary:
      "Browser, server, terminal and packages—explained with one request.",
    objectives: [
      "Explain a request and a response",
      "Choose the right ecosystem layer",
      "Know what AI-generated code still needs you to verify",
    ],
    questions: [
      {
        id: "request",
        prompt:
          "You open /welcome in a browser. What does a server handler do?",
        options: [
          "Installs npm packages for the visitor",
          "Receives the request and returns a response",
          "Automatically creates a database",
        ],
        answer: 1,
        explanation:
          "A handler runs on the server and returns content, data or an error for that request.",
      },
      {
        id: "layers",
        prompt: "Which tool handles reactive browser UI?",
        options: ["ZyroJS", "The database connector", "An npm organization"],
        answer: 0,
        explanation:
          "ZyroJS supplies browser UI primitives. ZeruxJS coordinates the server runtime.",
      },
    ],
  },
  {
    slug: "learn-first-route",
    title: "Run your first route",
    minutes: 20,
    level: "Beginner",
    summary:
      "Create a small project, run it, and recognize a successful response.",
    objectives: [
      "Create a project manually",
      "Return JSON from a file route",
      "Check the running server without guessing",
    ],
    questions: [
      {
        id: "where",
        prompt: "Which file declares GET /api/hello in this course?",
        options: [
          "public/hello.txt",
          "app/api/hello/route.ts",
          "package-lock.json",
        ],
        answer: 1,
        explanation:
          "The app directory holds discovered routes; route.ts exports HTTP method handlers.",
      },
      {
        id: "verify",
        prompt: "What is useful evidence that the route works?",
        options: [
          "The code looks convincing",
          "The browser/HTTP client returns the expected JSON from the printed server URL",
          "There are no editor colors",
        ],
        answer: 1,
        explanation:
          "Run the application and inspect its actual response. A code suggestion alone is not runtime evidence.",
      },
    ],
  },
  {
    slug: "learn-config",
    title: "Make configuration predictable",
    minutes: 15,
    level: "Beginner",
    summary:
      "Understand scripts, zerux.config, TypeScript and secret boundaries.",
    objectives: [
      "Distinguish application config from package options",
      "Keep one active config file",
      "Keep secrets on the server",
    ],
    questions: [
      {
        id: "activation",
        prompt:
          "Does adding any custom key to zerux.config automatically start a service?",
        options: [
          "Yes, every key becomes a service",
          "Only if the key name starts with z",
          "No; some keys are consumed by runtime startup, others need your own integration",
        ],
        answer: 2,
        explanation:
          "An open config type permits custom keys; it does not implement their behavior. Follow the documented consumer.",
      },
      {
        id: "secrets",
        prompt: "Where should a database password come from?",
        options: [
          "A committed browser bundle",
          "The server process environment or your deployment secret store",
          "A public README screenshot",
        ],
        answer: 1,
        explanation:
          "Read server secrets from process.env and validate them at startup. Never expose them to the client.",
      },
    ],
  },
  {
    slug: "learn-input",
    title: "Accept input safely",
    minutes: 20,
    level: "Build",
    summary: "Turn unknown request data into a deliberately validated API.",
    objectives: [
      "Validate unknown request bodies",
      "Return deliberate errors",
      "Separate validation from authorization",
    ],
    questions: [
      {
        id: "types",
        prompt: "Does a TypeScript annotation validate incoming JSON?",
        options: [
          "No; runtime validation is still required",
          "Yes, in all browsers",
          "Only when the interface is exported",
        ],
        answer: 0,
        explanation:
          "Type annotations are removed. Validate the shape, size and allowed values of data at runtime.",
      },
      {
        id: "ownership",
        prompt:
          "A valid note ID was supplied. What else may a private route need?",
        options: [
          "A longer variable name",
          "Authentication and authorization for that note/tenant",
          "A public cache header",
        ],
        answer: 1,
        explanation:
          "Well-shaped input is not permission. Verify identity and ownership before reading or modifying private records.",
      },
    ],
  },
  {
    slug: "learn-data",
    title: "Add data with a clear owner",
    minutes: 18,
    level: "Build",
    summary:
      "Know when memory is enough and when a database or cache is needed.",
    objectives: [
      "Explain why the teaching store disappears",
      "Choose a documented adapter",
      "Partition cache entries correctly",
    ],
    questions: [
      {
        id: "memory",
        prompt: "What happens to the tutorial Map on process restart?",
        options: [
          "It becomes a SQL table",
          "Its records are lost",
          "It syncs to every replica",
        ],
        answer: 1,
        explanation:
          "An in-memory Map is process-local teaching data. Durable records require an explicitly configured persistence layer.",
      },
      {
        id: "cache",
        prompt: "Which cache key is safer for private localized data?",
        options: [
          "notes",
          "A key including the authorized tenant/user, locale and relevant revision",
          "The first query parameter only",
        ],
        answer: 1,
        explanation:
          "Cache ownership and variation must match the response. A cache hit is not an authorization check.",
      },
    ],
  },
  {
    slug: "learn-language",
    title: "Build a language-aware feature",
    minutes: 18,
    level: "Build",
    summary: "Use zlocale catalogs, domains and locale-fixed translators.",
    objectives: [
      "Create a typed catalog",
      "Keep request locales separate",
      "Load browser catalogs explicitly",
    ],
    questions: [
      {
        id: "request-locale",
        prompt:
          "How should concurrent server requests choose different languages?",
        options: [
          "Change a shared global locale for each request",
          "Use a locale-fixed translator or request-local context",
          "Reload the entire package for each message",
        ],
        answer: 1,
        explanation:
          "Locale-fixed views and AsyncLocalStorage prevent one request from changing another request’s language.",
      },
      {
        id: "loading",
        prompt: "When does __(text) load a catalog file?",
        options: [
          "On every call",
          "Only on weekends",
          "It never loads files; the host explicitly preloads/registers catalogs",
        ],
        answer: 2,
        explanation:
          "Translation reads are synchronous in-memory lookups. Loading is a separate explicit async boundary.",
      },
    ],
  },
  {
    slug: "learn-plugin",
    title: "Turn a feature into a plugin",
    minutes: 18,
    level: "Develop",
    summary:
      "Register routes and share a host-owned contract without global side effects.",
    objectives: [
      "Register with the generation-scoped plugin API",
      "Identify resource ownership",
      "Keep a reusable module independent of site settings",
    ],
    questions: [
      {
        id: "lifetime",
        prompt: "Who should own a long-lived timer started by a feature?",
        options: [
          "Nobody; timers clean themselves up",
          "A generation/worker owner with an explicit cleanup",
          "Every request handler independently",
        ],
        answer: 1,
        explanation:
          "Managed startup workers can return cleanup. Import-time timers can leak across reloads and application instances.",
      },
      {
        id: "domain",
        prompt: "Who chooses the site’s active language?",
        options: [
          "Whichever module imports last",
          "The host application using its validated policy",
          "The name of the npm package",
        ],
        answer: 1,
        explanation:
          "A module owns its domain/messages/catalogs; the host owns locale choice, persistence and request policy.",
      },
    ],
  },
  {
    slug: "learn-release",
    title: "Verify and ship deliberately",
    minutes: 20,
    level: "Develop",
    summary:
      "Build, typecheck, inspect a real response and diagnose common failures.",
    objectives: [
      "Separate build from typechecking",
      "Run the compiled Node application",
      "Collect useful evidence for an issue",
    ],
    questions: [
      {
        id: "static",
        prompt: "Is zerux build a general static export for GitHub Pages?",
        options: [
          "No; it compiles a Node server application",
          "Yes, every application becomes a static site",
          "Only if a database is connected",
        ],
        answer: 0,
        explanation:
          "These docs use their own static exporter. A normal compiled ZeruxJS application still needs its Node runtime/dependencies.",
      },
      {
        id: "evidence",
        prompt: "Which issue report helps someone reproduce a failure?",
        options: [
          "“It is broken” with a secret-filled log",
          "Version, command, sanitized error, expected/actual result and a small reproduction",
          "Only the AI chat history",
        ],
        answer: 1,
        explanation:
          "Small reproducible evidence makes diagnosis possible. Remove credentials, cookies and private records.",
      },
    ],
  },
];

/** Small contextual explanations keep advanced references approachable without hiding contracts. */
export const explainers = {
  routing: [
    "A route is an address your app knows how to answer.",
    "Start with one GET handler, open its URL, then add parameters or other methods.",
  ],
  "configuration-handbook": [
    "Configuration is the application’s startup plan.",
    "Choose a service, follow its setup chapter, and verify that its actual startup code consumes the option.",
  ],
  "configuration-reference": [
    "A type table is a contract, not a list of automatically enabled features.",
    "Find the setup guide for the service before copying an option into config.",
  ],
  middleware: [
    "Middleware wraps work that happens around a request handler.",
    "Await next() once to let the handler continue; keep user-specific values in request state.",
  ],
  plugins: [
    "A plugin adds a feature while the application runtime is being prepared.",
    "Register routes and owned workers through the supplied API. Avoid starting services just by importing a file.",
  ],
  "database-queries": [
    "A database keeps records beyond a single server process.",
    "Configure a supported connector and validate both the data and the user’s permission to access it.",
  ],
  "reference-zlocale": [
    "Internationalization prepares messages; localization chooses the language and display formats.",
    "Use the module authoring guide if you publish a feature, or the site language guide if you own the application.",
  ],
  typescript: [
    "TypeScript checks how code fits together before it runs.",
    "It does not validate a request body or prove the application starts; run those checks separately.",
  ],
  deployment: [
    "Deployment means running the built application in its intended environment.",
    "Verify the build, dependencies, server settings and response behavior before sending real traffic.",
  ],
};

/** Validate authored course references and question identities before exporting. @param {object[]} pages Versioned docs. @param {string[]} versions Published versions. @returns {void} Throws on stale course metadata. No I/O/globals. */
export function validateAcademy(pages, versions) {
  const slugs = new Set();
  for (const lesson of lessons) {
    if (slugs.has(lesson.slug)) throw new Error("Duplicate lesson");
    slugs.add(lesson.slug);
    if (!lesson.questions.length || !lesson.objectives.length)
      throw new Error("Incomplete lesson");
    const ids = new Set();
    for (const q of lesson.questions) {
      if (ids.has(q.id) || !Number.isInteger(q.answer) || !q.options[q.answer])
        throw new Error("Invalid quiz");
      ids.add(q.id);
    }
    for (const version of versions)
      if (!pages.some((p) => p.version === version && p.slug === lesson.slug))
        throw new Error(`Missing lesson ${version}/${lesson.slug}`);
  }
}
