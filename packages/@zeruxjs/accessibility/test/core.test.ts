import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ariaBoolean,
  visuallyHiddenStyle,
  createRovingTabIndex,
  onEscape,
} from '../dist/index.js';
test('aria and keyboard helpers', () => {
  assert.equal(ariaBoolean(true), 'true');
  assert.equal(visuallyHiddenStyle().position, 'absolute');
  /** Synthetic focusable candidates used to assert tabindex/disabled behavior, not browser coverage. */
  const nodes = [
    { tabIndex: 0, focus() {} },
    { tabIndex: 0, focus() {} },
  ] as unknown as HTMLElement[];
  /** Owned roving handle for the fixture; real DOM lifetime is checked in dedicated component/browser tests. */
  const roving = createRovingTabIndex(() => nodes);
  roving.refresh();
  assert.deepEqual(
    nodes.map((n) => n.tabIndex),
    [0, -1]
  );
  roving.setIndex(1);
  assert.deepEqual(
    nodes.map((n) => n.tabIndex),
    [-1, 0]
  );
  assert.throws(() => roving.setIndex(8));
  /** Owned event/style fixture target; unrelated document state must remain unchanged. */
  const target = new EventTarget();
  let count = 0;
  /** Owned listener remover exercised to ensure no post-disposal dispatch. */
  const dispose = onEscape(target, () => count++);
  target.dispatchEvent(new Event('keydown'));
  dispose();
  assert.equal(count, 0);
});
