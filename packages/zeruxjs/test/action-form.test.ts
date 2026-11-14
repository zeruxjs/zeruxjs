import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { enhanceActionForm } from 'zeruxjs/action-form';
/** Create an isolated DOM-emulated action form with explicit field labels.
 * @returns {object} Form, submitter and owned DOM window; callers close both enhancement and window.
 */
const fixture = () => {
  /** Owned DOM emulator; its script execution is disabled and no external page is loaded. */
  const dom = new JSDOM(
    '<form method="post" action="/_zerux/actions/opaque"><input name="_action_key" value="stable"><input name="_action_csrf" value="csrf"><label>Note<input id="note" name="note" value="PRIVATE"></label><span id="note-error"></span><button>Save</button></form>',
    { url: 'https://app.test/form' }
  );
  /** Authored POST form with explicit action, idempotency key and CSRF fixture fields. */
  const form = dom.window.document.querySelector('form');
  /** Native submitter whose pending/disabled state is checked before teardown. */
  const button = form.querySelector('button');
  return {
    dom,
    form,
    button,
    /** Dispatch a cancelable native-shaped submit event using the authored button.
     * @returns {void} Delivers the synthetic event to the current enhancement owner.
     */
    submit() {
      form.dispatchEvent(
        new dom.window.SubmitEvent('submit', {
          bubbles: true,
          cancelable: true,
          submitter: button,
        })
      );
    },
  };
};
test('pending state prevents duplicate fetches; invalid fields focus safely and optimistic updates roll back', async () => {
  /** Isolated action-form fixture; browser behavior here is DOM emulation only. */
  const f = fixture();
  let count = 0,
    optimistic = 0,
    resolve;
  /** Enhancement owner closed after requests settle and before its DOM window closes. */
  const helper = enhanceActionForm(f.form, {
    fetch: () => {
      count++;
      return new Promise((r) => (resolve = r));
    },
    resolveField: (path) =>
      path === 'note'
        ? {
            control: f.form.querySelector('#note'),
            description: f.form.querySelector('#note-error'),
          }
        : undefined,
    optimistic: { apply: () => optimistic++, rollback: () => optimistic-- },
  });
  try {
    f.submit();
    f.submit();
    assert.equal(count, 1);
    assert.equal(helper.pending, true);
    assert.equal(f.button.disabled, true);
    assert.equal(f.form.getAttribute('aria-busy'), 'true');
    resolve(
      Response.json(
        {
          ok: false,
          issues: [
            {
              path: 'note',
              code: 'schema.string',
              message: 'PRIVATE BAD VALUE',
            },
          ],
        },
        { status: 422 }
      )
    );
    await helper.settled;
    assert.equal(optimistic, 0);
    assert.equal(f.button.disabled, false);
    assert.equal(f.dom.window.document.activeElement.id, 'note');
    assert.equal(
      f.form.querySelector('#note-error').textContent,
      'Invalid input'
    );
    assert.equal(
      f.form.querySelector('#note').getAttribute('aria-invalid'),
      'true'
    );
    assert.doesNotMatch(
      f.form.querySelector('[role=alert]').textContent,
      /PRIVATE/
    );
    assert.equal(f.form.querySelector('[name=_action_key]').value, 'stable');
  } finally {
    await helper.close();
    assert.equal(
      f.form.querySelector('#note').getAttribute('aria-invalid'),
      null
    );
    f.dom.window.close();
  }
});
test('confirmed commits survive UI/revalidation failure while uncertain outcomes roll back without retry', async () => {
  for (const kind of ['success', 'committed', 'unknown', 'network']) {
    /** Isolated action-form fixture; browser behavior here is DOM emulation only. */
    const f = fixture();
    let value = 0,
      calls = 0,
      commits = 0,
      navigation;
    /** Enhancement owner closed after requests settle and before its DOM window closes. */
    const helper = enhanceActionForm(f.form, {
      fetch: async () => {
        calls++;
        if (kind === 'network') {
          throw Error('PRIVATE network');
        }
        return kind === 'success'
          ? Response.json({ ok: true, redirect: '/notes' })
          : Response.json(
              {
                ok: false,
                outcome: kind === 'committed' ? 'committed' : 'uncertain',
              },
              { status: 503 }
            );
      },
      navigate: (url) => (navigation = url),
      optimistic: {
        apply: () => value++,
        rollback: () => value--,
        commit: () => commits++,
      },
    });
    try {
      f.submit();
      await helper.settled;
      assert.equal(calls, 1);
      assert.equal(value, ['success', 'committed'].includes(kind) ? 1 : 0);
      assert.equal(commits, ['success', 'committed'].includes(kind) ? 1 : 0);
      if (kind === 'success') {
        assert.equal(navigation, 'https://app.test/notes');
      } else {
        assert.equal(navigation, undefined);
      }
      assert.equal(helper.pending, false);
    } finally {
      await helper.close();
      f.dom.window.close();
    }
  }
});
test('close during an ignored cancellation waits, rolls back once and permits a new owner', async () => {
  /** Isolated action-form fixture; browser behavior here is DOM emulation only. */
  const f = fixture();
  let resolve,
    signal,
    value = 0;
  /** Enhancement owner closed after requests settle and before its DOM window closes. */
  const helper = enhanceActionForm(f.form, {
    fetch: (_url, options) => {
      signal = options.signal;
      return new Promise((r) => (resolve = r));
    },
    optimistic: { apply: () => value++, rollback: () => value-- },
  });
  f.submit();
  let closed = false;
  /** Close promise held until the deliberately noncooperating transport settles. */
  const closing = helper.close().then(() => (closed = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(signal.aborted, true);
  assert.equal(closed, false);
  resolve(Response.json({ ok: true, redirect: '/notes' }));
  await closing;
  assert.equal(value, 0);
  assert.equal(f.button.disabled, false);
  assert.equal(f.form.querySelector('[role=alert]'), null);
  /** Replacement enhancement proving the original form ownership was released. */
  const second = enhanceActionForm(f.form, {
    fetch: async () => Response.json({ ok: false }, { status: 403 }),
  });
  await second.close();
  f.dom.window.close();
});
test('native submitter overrides stay native and file inputs never enter enhanced requests', async () => {
  /** Isolated action-form fixture; browser behavior here is DOM emulation only. */
  const f = fixture();
  let calls = 0;
  /** Enhancement owner closed after requests settle and before its DOM window closes. */
  const helper = enhanceActionForm(f.form, {
    fetch: async () => {
      calls++;
      return Response.json({ ok: true });
    },
  });
  try {
    f.button.setAttribute('formaction', '/another');
    /** Synthetic native submission carrying a submitter-level destination override. */
    const event = new f.dom.window.SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: f.button,
    });
    f.form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    f.button.removeAttribute('formaction');
    /** File input that must keep submission on the native form path. */
    const file = f.dom.window.document.createElement('input');
    file.type = 'file';
    file.name = 'upload';
    f.form.append(file);
    f.submit();
    await helper.settled;
    assert.equal(calls, 0);
    assert.equal(helper.pending, false);
  } finally {
    await helper.close();
    f.dom.window.close();
  }
});
test('navigation handoff can dispose its form owner without a promise cycle', async () => {
  /** Isolated action-form fixture; browser behavior here is DOM emulation only. */
  const f = fixture();
  // Navigation records the disposal promise after form submission.
  let handoff;
  /** Enhancement owner closed after requests settle and before its DOM window closes. */
  const helper = enhanceActionForm(f.form, {
    fetch: async () => Response.json({ ok: true, redirect: '/notes' }),
    navigate: () => (handoff = helper.close()),
  });
  f.submit();
  await helper.settled;
  await handoff;
  assert.equal(f.form.querySelector('[role=alert]'), null);
  assert.equal(f.button.disabled, false);
  f.dom.window.close();
});
test('browser form entry bundles without server registries or Node modules', async () => {
  /** Explicit bundler used only to check the public browser import boundary. */
  const { build } = await import('esbuild');
  /** In-memory browser bundle metadata checked for accidental server-module inclusion. */
  const result = await build({
    stdin: {
      contents: "export {enhanceActionForm} from 'zeruxjs/action-form';",
      resolveDir: process.cwd(),
      sourcefile: 'form-browser.js',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
  });
  assert.equal(
    Object.keys(result.metafile.inputs).some((name) =>
      /actions\.js|action-stores|node:|bootstrap\//.test(name)
    ),
    false
  );
});
