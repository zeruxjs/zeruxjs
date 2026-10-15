export default () => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZeruxJS DB Demo</title>
    <style>
      :root {
        --bg: #f7f4ec;
        --bg-2: #d9efe7;
        --panel: rgba(255, 255, 255, 0.82);
        --text: #172033;
        --muted: #516078;
        --line: rgba(23, 32, 51, 0.1);
        --accent: #0f766e;
        --accent-2: #c2410c;
        --danger: #b91c1c;
        --shadow: 0 26px 70px rgba(23, 32, 51, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 24%),
          radial-gradient(circle at bottom right, rgba(194, 65, 12, 0.16), transparent 28%),
          linear-gradient(135deg, var(--bg) 0%, var(--bg-2) 100%);
      }
      main {
        width: min(1100px, calc(100vw - 28px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }
      .shell, .panel {
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--panel);
        backdrop-filter: blur(18px);
        box-shadow: var(--shadow);
      }
      .shell {
        padding: 28px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 18px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
        background: rgba(15, 118, 110, 0.12);
      }
      h1 {
        margin: 18px 0 12px;
        font-size: clamp(2.4rem, 6vw, 4.3rem);
        line-height: 0.95;
      }
      p {
        margin: 0;
        line-height: 1.7;
        color: var(--muted);
      }
      .lede {
        max-width: 700px;
      }
      .panel {
        padding: 22px;
      }
      form {
        display: grid;
        gap: 14px;
        margin-top: 18px;
      }
      label {
        display: grid;
        gap: 8px;
        font-weight: 700;
      }
      input, textarea, button {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 16px;
        font: inherit;
      }
      input, textarea {
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.72);
        color: var(--text);
      }
      textarea {
        min-height: 150px;
        resize: vertical;
      }
      button {
        min-height: 48px;
        border: 0;
        cursor: pointer;
        font-weight: 800;
        color: white;
        background: linear-gradient(135deg, var(--accent), #115e59);
      }
      .status {
        min-height: 24px;
        margin-top: 12px;
        font-weight: 700;
      }
      .status.error {
        color: var(--danger);
      }
      .status.ok {
        color: var(--accent);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      .chip {
        padding: 9px 12px;
        border-radius: 999px;
        color: var(--accent-2);
        background: rgba(194, 65, 12, 0.1);
        font-size: 13px;
      }
      .list {
        display: grid;
        gap: 12px;
        margin-top: 18px;
      }
      .item {
        padding: 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.66);
        border: 1px solid var(--line);
      }
      .item-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
        font-size: 14px;
      }
      .item-header strong {
        font-size: 1rem;
      }
      .empty {
        padding: 18px;
        border-radius: 18px;
        border: 1px dashed var(--line);
        color: var(--muted);
        background: rgba(255,255,255,0.46);
      }
      a.back {
        display: inline-flex;
        margin-top: 18px;
        color: var(--text);
        text-decoration: none;
        font-weight: 700;
      }
      @media (max-width: 900px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="shell">
        <div class="eyebrow">Database Demo</div>
        <h1>Write to your configured local DB through <code>@zeruxjs/db</code>.</h1>
        <p class="lede">
          This page uses the app runtime database manager, creates the demo table on demand,
          submits JSON to a Zerux API route, and reloads the latest rows from a slug-selected
          connection facade instead of only the default one.
        </p>
        <div class="meta">
          <div class="chip">Page: <code>/db-demo</code></div>
          <div class="chip">API: <code>/api/db-demo</code></div>
          <div class="chip">Init: <code>npm run db:init</code></div>
          <div class="chip" id="db-connection-chip">Connection: <code>loading...</code></div>
        </div>
        <a class="back" href="/">Back to sample home</a>
      </section>

      <section class="grid" style="margin-top: 18px;">
        <article class="panel">
          <h2>Submit a row</h2>
          <p>Use the form below to insert a record into the demo table through the configured slug-bound connection.</p>
          <form id="db-demo-form">
            <label>
              Name
              <input name="name" type="text" maxlength="120" required />
            </label>
            <label>
              Email
              <input name="email" type="email" maxlength="190" required />
            </label>
            <label>
              Message
              <textarea name="message" maxlength="2000" required></textarea>
            </label>
            <button type="submit">Insert Row</button>
          </form>
          <div class="status" id="status"></div>
        </article>

        <article class="panel">
          <h2>Latest rows</h2>
          <p>The list refreshes on page load and after each successful submission.</p>
          <div class="list" id="rows">
            <div class="empty">Loading rows from <code>/api/db-demo</code>...</div>
          </div>
        </article>
      </section>
    </main>

    <script>
      const form = document.getElementById("db-demo-form");
      const statusNode = document.getElementById("status");
      const rowsNode = document.getElementById("rows");
      const connectionChipNode = document.getElementById("db-connection-chip");

      const escapeHtml = (value) => String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

      const setStatus = (message, type) => {
        statusNode.textContent = message;
        statusNode.className = type ? "status " + type : "status";
      };

      const renderConnection = (connection) => {
        if (!connectionChipNode) return;

        if (!connection || !connection.slug) {
          connectionChipNode.innerHTML = 'Connection: <code>unknown</code>';
          return;
        }

        connectionChipNode.innerHTML = \`Connection: <code>\${escapeHtml(connection.slug)}</code>\`;
      };

      const renderRows = (rows) => {
        if (!Array.isArray(rows) || rows.length === 0) {
          rowsNode.innerHTML = '<div class="empty">No rows yet. Submit the form to create the first record.</div>';
          return;
        }

        rowsNode.innerHTML = rows.map((row) => \`
          <article class="item">
            <div class="item-header">
              <strong>#\${escapeHtml(row.id ?? "")} · \${escapeHtml(row.name ?? "")}</strong>
              <span>\${escapeHtml(row.created_at ?? "")}</span>
            </div>
            <div><strong>Email:</strong> \${escapeHtml(row.email ?? "")}</div>
            <p style="margin-top: 8px;">\${escapeHtml(row.message ?? "")}</p>
          </article>
        \`).join("");
      };

      const loadRows = async () => {
        const response = await fetch("/api/db-demo");
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Failed to load rows");
        }

        renderConnection(payload.connection);
        renderRows(payload.rows);
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus("Saving row...", "");

        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        try {
          const response = await fetch("/api/db-demo", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });
          const result = await response.json();

          if (!response.ok || !result.ok) {
            throw new Error(result.message || "Insert failed");
          }

          form.reset();
          renderConnection(result.connection);
          renderRows(result.rows);
          setStatus("Row inserted successfully.", "ok");
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), "error");
        }
      });

      loadRows()
        .then(() => setStatus("Connected to the demo API.", "ok"))
        .catch((error) => {
          renderRows([]);
          setStatus(error instanceof Error ? error.message : String(error), "error");
        });
    </script>
  </body>
</html>`;
