import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDurableEmailDeliveryProcessor,
  createMemoryEmailDeliveryStore,
} from '../dist/index.js';
/** Synthetic durable record or record factory; authoritative state remains in the fixture store.
 * @param {string} id - Opaque synthetic job/record ID.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const record = (id) => ({
  id,
  version: 1,
  purpose: 'transactional',
  state: 'pending',
  lease: null,
  updatedAt: 0,
});
/** One explicit synthetic task with bounded opaque record-reference data.
 * @param {string} id - Opaque synthetic job/record ID.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const job = (id) => ({ name: 'email.deliver', data: { messageId: id } });
test('a resolved SMTP call with unknown outcome never becomes sent or gets resent', async () => {
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([record('unknown')]);
  let sends = 0,
    uncertain = 0;
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => true,
    send: async () => {
      sends++;
      return { submissionStatus: 'unknown' };
    },
    onUncertain: () => uncertain++,
  });
  assert.equal((await process(job('unknown'))).status, 'uncertain');
  assert.equal((await process(job('unknown'))).status, 'uncertain');
  assert.equal(sends, 1);
  assert.equal(uncertain, 1);
});
test('fully rejected SMTP envelopes are durable terminal rejected, partial accepts require review', async () => {
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([
    record('rejected'),
    record('partial'),
    record('accepted'),
  ]);
  /** Injected SMTP outcome callback; no real transport is used.
   * @param {string} id - Opaque synthetic job/record ID.
   * @returns {Promise<unknown>} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
   */
  const send = async (id) => ({
    submissionStatus: (() => {
      if (id === 'rejected') {
        return 'rejected';
      } else {
        if (id === 'partial') {
          return 'partial';
        } else {
          return 'accepted';
        }
      }
    })(),
  });
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => true,
    send,
  });
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const id of ['rejected', 'partial', 'accepted']) {
    await process(job(id));
  }
  assert.equal((await store.load('rejected')).state, 'rejected');
  assert.equal((await store.load('partial')).state, 'uncertain');
  assert.equal((await store.load('accepted')).state, 'sent');
});
