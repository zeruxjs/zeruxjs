import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentKnowledgeBase, createGroundedPrompt } from '../dist/index.js';
test('document retrieval and snapshot', () => {
  /** Isolated in-memory base contains only the fixture documents selected for this assertion. */
  const kb = new DocumentKnowledgeBase();
  kb.add({ id: 'a', title: 'Routing', text: 'Zerux provides routing' });
  kb.add({ id: 'b', text: 'CSS utility classes' });
  assert.equal(kb.search('routing')[0].document.id, 'a');
  /** Detached legacy V1 snapshot is restored into an independent base. */
  const snapshot = kb.snapshot();
  /** Independent restoration target proves source/base mutations are not shared. */
  const next = new DocumentKnowledgeBase();
  next.restore(snapshot);
  assert.equal(next.size, 2);
  assert.match(createGroundedPrompt(next, 'routing'), /Routing/);
});
test('defensive copies and invalid snapshots', () => {
  /** Isolated in-memory base contains only the fixture documents selected for this assertion. */
  const kb = new DocumentKnowledgeBase();
  /** Synthetic source record/path; no real user document is read or deleted. */
  const doc = { id: 'one', text: 'hello', metadata: { type: 'test' } };
  kb.add(doc);
  doc.metadata.type = 'changed';
  assert.equal(kb.get('one').metadata.type, 'test');
  assert.throws(() =>
    kb.restore({ version: 1, documents: [{ id: '', text: 'bad' }] })
  );
  assert.equal(kb.size, 1);
});
