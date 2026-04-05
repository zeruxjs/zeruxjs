const stats = [
  { label: "mode", value: "fix" },
  { label: "routing", value: "app-first" },
  { label: "runtime", value: ".zerux manifest" }
];

export default () => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZeruxJS App</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe7;
        --panel: rgba(255,255,255,0.82);
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
        background:
          radial-gradient(circle at top left, rgba(13,148,136,0.18), transparent 28%),
          radial-gradient(circle at bottom right, rgba(249,115,22,0.16), transparent 30%),
          linear-gradient(135deg, #f8f3ec 0%, #eef6f4 100%);
        color: var(--text);
      }

      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
      }

      .shell {
        width: min(920px, 100%);
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 28px;
        box-shadow: var(--shadow);
        overflow: hidden;
        backdrop-filter: blur(18px);
      }

      .hero {
        padding: 40px 40px 28px;
        border-bottom: 1px solid var(--border);
      }

      .eyebrow {
        display: inline-flex;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        background: rgba(13,148,136,0.12);
        color: var(--accent);
      }

      h1 {
        margin: 18px 0 14px;
        font-size: clamp(2.4rem, 6vw, 4.8rem);
        line-height: 0.95;
      }

      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
        font-size: 1.02rem;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
        padding: 28px 40px 40px;
      }

      .card {
        padding: 22px;
        border-radius: 20px;
        background: rgba(255,255,255,0.78);
        border: 1px solid rgba(29,36,51,0.06);
      }

      .card strong {
        display: block;
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--accent-2);
        margin-bottom: 10px;
      }

      .card span {
        font-size: 1.2rem;
        font-weight: 700;
      }

      .footer {
        padding: 0 40px 40px;
      }

      code {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(29,36,51,0.06);
        color: var(--text);
      }

      @media (max-width: 760px) {
        .hero, .grid, .footer {
          padding-left: 22px;
          padding-right: 22px;
        }

        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="shell">
        <div class="hero">
          <div class="eyebrow">ZeruxJS Runtime</div>
          <h1>Framework boot path is live.</h1>
          <p>
            This page is served from <code>app/page.ts</code> through the new core bootstrap.
            Middleware, controllers, composables, plugins, generated manifests, and app routing
            can now attach to the same runtime instead of relying on a single hard-coded entry file.
          </p>
        </div>
        <div class="grid">
          ${stats.map((item) => `
            <article class="card">
              <strong>${item.label}</strong>
              <span>${item.value + " : " + process.env.K}</span>
            </article>
          `).join("")}
        </div>
        <div class="footer">
          <p>
            Next step: add nested routes like <code>app/blog/[slug]/page.ts</code>, route handlers
            like <code>app/api/health/route.ts</code>, and middleware under <code>app/middleware</code>.
          </p>
        </div>
      </section>
    </main>
  </body>
</html>`;
