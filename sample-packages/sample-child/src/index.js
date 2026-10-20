export const sections = [
  {
    id: "child-main",
    title: "Child Overview",
    icon: "C",
    render() {
      return `
        <article class="zdev-card">
          <h3>Child Module</h3>
          <p>I am a child of <strong>parent-module</strong>.</p>
          <div class="zdev-button-group">
            <button id="child-btn-ext" class="zdev-button">Call Child Extension API</button>
            <button id="child-btn-hijack" class="zdev-button">Call Parent API (via Child Hijack)</button>
          </div>
          <pre id="child-result" class="zdev-code-block" style="margin-top: 1rem; display:none"></pre>
        </article>
      `;
    }
  }
];
