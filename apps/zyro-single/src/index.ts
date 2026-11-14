import { h, render, useState, useEffect, type LegacyNode } from './zyro.js';

/** Describe the historical standalone counter using its bundled compatibility runtime.
 * The bundled helper runs setup once during this initial mount; it has no modern unmount contract.
 * @returns {object} Authored node description; user values remain scalar text and fixed callbacks.
 */
function App(): LegacyNode {
  /** Mount-local count and setter; the bundled runtime retains reactive subscriptions for the page lifetime. */
  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log('Count updated:', count());
  });

  return h(
    'div',
    { className: 'counter' },
    h('h1', null, 'ZyroJS'),
    h('p', { className: 'dim' }, 'Experience fine-grained reactivity'),
    h('div', { className: 'count-display' }, count),
    h(
      'div',
      { className: 'controls' },
      h('button', { onclick: () => setCount(count() - 1) }, '-'),
      h('button', { onclick: () => setCount(count() + 1) }, '+')
    ),
    h(
      'p',
      { className: 'dim', style: 'margin-top: 2rem;' },
      'Built with ZyroJS Library'
    )
  );
}

// Initial render
/** The authored HTML owns this mount; fail explicitly if the template and entry disagree. */
const container = document.getElementById('app');
if (!container) {
  throw new Error('Counter mount is missing');
}
render(h(App, null), container);
