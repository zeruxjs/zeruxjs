import { defineComponent, h, signal } from 'zyrojs/component';
import { mount, unmount } from 'zyrojs/dom';

/** The static example uses the installed runtime and owns one disposable root. */
const App = defineComponent(() => {
  /** Setup-local counter state; repeated renders reuse this signal until root teardown. */
  const count = signal(0);
  return () =>
    h(
      'div',
      { class: 'counter' },
      h('h1', null, 'ZyroJS'),
      h(
        'p',
        { class: 'dim' },
        'Fine-grained reactivity from the workspace package'
      ),
      h(
        'div',
        { class: 'count-display', role: 'status', 'aria-live': 'polite' },
        count.value
      ),
      h(
        'div',
        { class: 'controls' },
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'Decrease',
            onClick: () => {
              count.value--;
            },
          },
          '−'
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'Increase',
            onClick: () => {
              count.value++;
            },
          },
          '+'
        )
      ),
      h(
        'p',
        { class: 'dim' },
        h('a', { href: '/' }, 'Back to package examples')
      )
    );
});
/** Dedicated static-example root; do not share it with another renderer. */
const host = document.getElementById('app');
if (host) {
  /** Mount one fresh owned counter after initial load or persisted page restoration.
   * @returns {Node | undefined} First mounted native node; pagehide releases the exact container through unmount.
   */
  const install = () => mount(h(App, null), host);
  host.replaceChildren();
  install();
  window.addEventListener('pagehide', () => unmount(host));
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      install();
    }
  });
}
