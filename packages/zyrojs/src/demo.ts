import { h, render, signal, unmount } from './index.js';
/** Standalone browser example. Invoke mountCounter after the DOM is available. */
/**
 * Mount the public counter example into a host-provided browser container.
 * @param {HTMLElement} container - Dedicated host-owned element; no DOM lookup or app startup occurs automatically.
 * @returns {() => void} Explicit teardown removing the root’s listeners, effects and nodes.
 */
export function mountCounter(container: HTMLElement): () => void {
  /** Setup-local counter signal read by owned dynamic text; no global state is shared. */
  const count = signal(0);
  render(
    h(
      'div',
      { className: 'counter' },
      h('h1', null, 'ZyroJS Counter'),
      h('p', null, 'Count: ', () => count.value),
      h(
        'button',
        {
          onClick: () => {
            count.value++;
          },
        },
        'Increment'
      ),
      h(
        'button',
        {
          onClick: () => {
            count.value--;
          },
        },
        'Decrement'
      )
    ),
    container
  );
  return () => unmount(container);
}
