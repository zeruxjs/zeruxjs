const sections = [
  { href: "/playground", title: "Playground", body: "HTML page route with middleware state and controller data." },
  { href: "/blog/zerux-runtime", title: "Dynamic Blog Route", body: "Checks `[slug]` route params and composable formatting." },
  { href: "/api/health", title: "API Health", body: "JSON route handler using middleware and controller references." },
  { href: "/api/echo", title: "API Echo", body: "POST endpoint for request body and query parsing." },
  { href: "/plugin/runtime", title: "Plugin Route", body: "Route added at runtime by a Zerux plugin." },
  { href: "/boom", title: "Intentional Error", body: "Throws an `HttpError` so error handling and logs are visible." }
];

const stats = [
  { label: "pages", value: "nested app routes" },
  { label: "middleware", value: "request context + headers" },
  { label: "controllers", value: "string references" },
  { label: "plugins", value: "runtime route injection" }
];

export default () => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZeruxJS Playground</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe7;
        --bg-2: #edf5f3;
        --panel: rgba(255,255,255,0.84);
        --panel-2: rgba(255,255,255,0.66);
        --text: #1d2433;
        --muted: #5c667a;
        --accent: #0d9488;
        --accent-2: #f97316;
        --border: rgba(29,36,51,0.08);
        --shadow: 0 24px 70px rgba(29,36,51,0.14);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(13,148,136,0.18), transparent 24%),
          radial-gradient(circle at bottom right, rgba(249,115,22,0.18), transparent 26%),
          linear-gradient(135deg, var(--bg) 0%, var(--bg-2) 100%);
      }
      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }
      .hero, .card, .route-card, .footer {
        border: 1px solid var(--border);
        border-radius: 22px;
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }
      .hero {
        padding: 34px;
      }
      .eyebrow, .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .eyebrow {
        background: rgba(13,148,136,0.12);
        color: var(--accent);
      }
      .pill {
        background: rgba(249,115,22,0.1);
        color: var(--accent-2);
      }
      h1 {
        margin: 18px 0 14px;
        font-size: clamp(2.8rem, 7vw, 5rem);
        line-height: 0.93;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
      }
      .hero-grid {
        display: grid;
        grid-template-columns: 1.6fr 1fr;
        gap: 20px;
        align-items: end;
      }
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }
      .hero-actions a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 0 16px;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 700;
      }
      .hero-actions a.primary {
        background: linear-gradient(135deg, var(--accent), #0f766e);
        color: white;
      }
      .hero-actions a.secondary {
        border: 1px solid var(--border);
        color: var(--text);
        background: var(--panel-2);
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        margin-top: 22px;
      }
      .card {
        padding: 18px;
      }
      .card strong {
        display: block;
        margin-top: 10px;
        font-size: 1.15rem;
      }
      .routes {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-top: 20px;
      }
      .route-card {
        padding: 20px;
        text-decoration: none;
        color: inherit;
      }
      .route-card h2 {
        margin: 14px 0 10px;
        font-size: 1.35rem;
      }
      .route-card:hover {
        transform: translateY(-1px);
      }
      .footer {
        margin-top: 20px;
        padding: 22px;
      }
      code {
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(29,36,51,0.06);
      }
      @media (max-width: 900px) {
        .hero-grid,
        .routes,
        .stats {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-grid">
          <div>
            <div class="eyebrow">ZeruxJS Sample Runtime</div>
            <h1>Framework's pieces are wired together now.</h1>
            <p>
              This sample app is no longer a single static page. It exercises app routes,
              dynamic params, JSON handlers, middleware, controllers, composables, plugins,
              public assets, logging, and framework error responses.
            </p>
            <div class="hero-actions">
              <a class="primary" href="/playground">Open Playground</a>
              <a class="secondary" href="/plugin/runtime">See Plugin Route</a>
              <a class="secondary" href="/public-note.txt">Public Asset</a>
            </div>
          </div>
          <div class="card">
            <div class="pill">Sample Module Enabled</div>
            <strong>Devtools route extension is active.</strong>
            <p>
              Open Zerux devtools and check the external module section, API route output,
              page warnings, and runtime snapshots together.
            </p>
          </div>
        </div>

        <div class="stats">
          ${stats.map((item) => `
            <article class="card">
              <div class="pill">${item.label}</div>
              <strong>${item.value}</strong>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="routes">
        ${sections.map((item) => `
          <a class="route-card" href="${item.href}">
            <div class="pill">${item.href}</div>
            <h2>${item.title}</h2>
            <p>${item.body}</p>
          </a>
        `).join("")}
      </section>

      <section class="footer">
        <p>
          Suggested checks: visit <code>/api/health</code>, post JSON to <code>/api/echo?debug=1</code>,
          open <code>/blog/zerux-runtime</code>, and hit <code>/boom</code> to confirm logs and error handling.
        </p>
      </section>
    </main>
  </body>
</html>`;
