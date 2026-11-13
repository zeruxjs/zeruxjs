import { h, render, signal, unmount } from './index.js';
/** Standalone browser example. Invoke mountCounter after the DOM is available. */
/**
 * mountCounter.
 * @param {HTMLElement} container - Input value for this operation.
 * @returns {() => void} Result produced by this operation.
 */
export function mountCounter(container: HTMLElement): () => void {
  /** Stores the count value used by this module. */
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
