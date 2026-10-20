export const sections = [
  {
    id: "parent-main",
    title: "Parent Overview",
    icon: "P",
    render() {
      return `
        <article class="zdev-card">
          <h3>Parent Module</h3>
          <p>I am the parent module.</p>
          <div class="zdev-button-group">
            <button id="parent-btn-data" class="zdev-button">Call Parent API</button>
            <button id="parent-btn-secret" class="zdev-button">Call Secret API</button>
          </div>
          <pre id="parent-result" class="zdev-code-block" style="margin-top: 1rem; display:none"></pre>
        </article>
      `;
    }
  }
];
