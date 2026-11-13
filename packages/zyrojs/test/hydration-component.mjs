import {
  defineComponent,
  h,
  signal,
  useId,
  onScopeDispose,
} from 'zyrojs/component';
export let state,
  disposed = 0;
/**
 * Test fixture Form.
 */
export const Form = defineComponent(() => {
  /**
   * Test fixture id.
   */
  const id = useId(),
    value = signal('initial'),
    checked = signal(false),
    items = signal([1, 2, 3]);
  state = { value, checked, items };
  onScopeDispose(() => disposed++);
  return (props) =>
    h(
      'section',
      {},
      h('label', { for: id }, props.label),
      h('input', { id, 'bind:value': value }),
      h('input', { type: 'checkbox', 'bind:checked': checked }),
      () => value.value,
      () =>
        items.value.map((key) =>
          h(
            'button',
            {
              key,
              'data-id': key,
              onClick: () => {
                items.value = items.value.filter((x) => x !== key);
              },
            },
            String(key)
          )
        )
    );
});
/**
 * Test helper validateProps.
 * @param {unknown} input - Test input for this helper.
 * @returns {unknown} Result produced by this test helper.
 */
export const validateProps = (input) => {
  if (
    !input ||
    typeof input.label !== 'string' ||
    Object.keys(input).some((key) => key !== 'label')
  ) {
    throw Error('Invalid public props');
  }
  return { label: input.label };
};
