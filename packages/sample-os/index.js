import { defineDevtoolsModule } from "z-dev";

const bar = () => `
  <div class="bar">
    <div class="bar-fill"></div>
  </div>
`;

export default defineDevtoolsModule({
  id: "sample-os",
  title: "System Monitor",
  badge: "system",

  sections: [
    {
      id: "sample-os",
      title: "System Monitor",
      icon: "🖥️",
      order: 50,

      render() {
        return `
        <section class="sample-module">

          <header class="sample-hero">
            <div>
              <h2>System Dashboard</h2>
              <p data-os>Loading...</p>
            </div>
            <div class="sample-chip" data-host>...</div>
          </header>

          <article class="sample-panel">
            <h3>CPU</h3>
            <div class="kv">
              <span data-cpu-model>...</span>
              <b data-cpu-stats>...</b>
            </div>
            ${bar()}
          </article>

          <article class="sample-panel">
            <h3>Memory</h3>
            <div class="kv">
              <span data-mem-text>...</span>
              <b data-mem-percent>...</b>
            </div>
            ${bar()}
          </article>

          <article class="sample-panel">
            <h3>Disk</h3>
            <div data-disk></div>
          </article>

          <article class="sample-panel">
            <h3>GPU</h3>
            <div data-gpu></div>
          </article>

          <article class="sample-panel">
            <h3>Network</h3>
            <div data-network></div>
          </article>

          <article class="sample-panel">
            <h3>Battery</h3>
            <div data-battery></div>
          </article>

          <article class="sample-panel">
            <h3>Top Processes</h3>
            <table class="proc">
              <tbody data-proc></tbody>
            </table>
          </article>

        </section>
        `;
      }
    }
  ]
});