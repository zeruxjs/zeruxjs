import type { QueueService } from '@zeruxjs/queue-bullmq';
import type { createQueueBackend } from '../neutral.js';
import {
  fail,
  id,
  type WebhookReference,
  type WebhookQueuePublisher,
} from './contracts.js';
/** Borrow an explicitly confirmed/manual-ack neutral service and reject destructive or unknown acknowledged capabilities. Starts no worker or scheduler.
 * @param {Awaited<ReturnType<typeof createQueueBackend>>} queue - Borrowed selected neutral backend; caller retains its close ownership.
 * @param {string} name - Explicit host-selected allowed queue for opaque webhook references.
 * @returns {WebhookQueuePublisher} Inert publish adapter; durable workflow CAS and receiver idempotency remain authoritative.
 */
export function createAcknowledgedWebhookPublisher(
  queue: Awaited<ReturnType<typeof createQueueBackend>>,
  name: string
): WebhookQueuePublisher {
  queue.require('acknowledgement');
  queue.require('publisherConfirms');
  if (queue.capabilities.destructiveRead) {
    throw fail('ACKNOWLEDGED_QUEUE_REQUIRED');
  }
  return {
    acknowledged: true,
    destructiveRead: false,
    /** Publish only tenant and delivery ID references after syntax validation; stored bodies and credentials never enter broker data.
     * @param {WebhookReference} ref - Server-verified durable record reference, independently authorized by the workflow.
     * @returns {Promise<unknown>} Native enqueue/confirmation receipt, not exactly-once receiver processing.
     */
    publish(ref) {
      id(ref.tenant);
      id(ref.deliveryId);
      return queue.publish(name, 'webhook.deliver', {
        tenant: ref.tenant,
        deliveryId: ref.deliveryId,
      });
    },
  };
}
/** Borrow one native BullMQ queue with processor-completion acknowledgement, distinct from neutral manual settlement.
 * @param {QueueService} service - Borrowed native service; caller closes it after worker/workflow dependencies drain.
 * @param {string} name - Explicit host-configured registered queue.
 * @returns {WebhookQueuePublisher} Opaque-reference publisher with one native attempt; never duplicates workflow retries.
 */
export function createBullMQWebhookPublisher(
  service: QueueService,
  name: string
): WebhookQueuePublisher {
  /** Borrowed native registered queue; this adapter never closes the service separately. */
  const queue = service.queue(name);
  return {
    acknowledged: true,
    destructiveRead: false,
    /** Publish only tenant and delivery ID references after syntax validation; stored bodies and credentials never enter broker data.
     * @param {WebhookReference} ref - Server-verified durable record reference, independently authorized by the workflow.
     * @returns {Promise<unknown>} Native enqueue/confirmation receipt, not exactly-once receiver processing.
     */
    publish(ref) {
      id(ref.tenant);
      id(ref.deliveryId);
      return queue.add(
        'webhook.deliver',
        { tenant: ref.tenant, deliveryId: ref.deliveryId },
        { attempts: 1 }
      );
    },
  };
}
/** Bind an explicit verified worker principal to the workflow and reject jobs with extra payload fields. Starts no worker or external connection.
 * @param {object} workflow - Borrowed durable delivery workflow; owner controls lifecycle.
 * @param {function} workflow.deliver - Authorized durable reference execution; completion records the outcome before acknowledgement.
 * @param {unknown} principal - Authenticated initiating worker identity, never arbitrary browser role strings.
 * @returns {function} Explicit processor; resolve/ack only after the workflow durably records its outcome.
 */
export function createWebhookProcessor(
  workflow: {
    /** Deliver one verified durable reference through fresh tenant/destination/signing policy checks.
     * @param {WebhookReference} ref - Opaque tenant-plus-delivery reference.
     * @param {unknown} principal - Host-verified worker identity reauthorized for this invocation.
     * @returns {Promise<unknown>} Durable outcome; unknown remote effects remain uncertain rather than auto-replayed.
     */
    deliver(ref: WebhookReference, principal: unknown): Promise<unknown>;
  },
  principal: unknown
) {
  return async (job: {
    /** Fixed webhook job name, never executable source. */
    name: string; /** Exactly the opaque tenant/delivery reference fields; no body or credentials. */
    data: Record<string, unknown>;
  }) => {
    if (
      job?.name !== 'webhook.deliver' ||
      !job.data ||
      Object.keys(job.data).sort().join(',') !== 'deliveryId,tenant'
    ) {
      throw fail('INVALID_JOB_REFERENCE');
    }
    id(job.data.tenant);
    id(job.data.deliveryId);
    return workflow.deliver(
      { tenant: job.data.tenant, deliveryId: job.data.deliveryId },
      principal
    );
  };
}
