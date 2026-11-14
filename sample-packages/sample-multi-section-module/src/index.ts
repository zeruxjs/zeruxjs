import type { DevtoolsSectionDefinition } from 'zforge';
/** Sample package value or fixture named sections. */
export const sections: DevtoolsSectionDefinition[] = [
  {
    id: 'section-one',
    title: 'Section One',
    icon: '①',
    order: 10,
    render() {
      return `
        <article class="zdev-card">
          <h3>Welcome to Section One</h3>
          <p>This is the first test section of the multi-section module.</p>
        </article>
      `;
    },
  },
  {
    id: 'section-two',
    title: 'Section Two',
    icon: '②',
    order: 20,
    render() {
      return `
        <article class="zdev-card">
          <h3>Welcome to Section Two</h3>
          <p>This is the second test section of the multi-section module.</p>
        </article>
      `;
    },
  },
];
