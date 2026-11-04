import type {QueueService} from '@zeruxjs/queue-bullmq';
import type {createQueueBackend} from '../neutral.js';
import {fail,id,type WebhookReference,type WebhookQueuePublisher} from './contracts.js';
export function createAcknowledgedWebhookPublisher(queue:Awaited<ReturnType<typeof createQueueBackend>>,name:string):WebhookQueuePublisher{
 queue.require('acknowledgement');queue.require('publisherConfirms');if(queue.capabilities.destructiveRead)throw fail('ACKNOWLEDGED_QUEUE_REQUIRED');
 return {acknowledged:true,destructiveRead:false,publish(ref){id(ref.tenant);id(ref.deliveryId);return queue.publish(name,'webhook.deliver',{tenant:ref.tenant,deliveryId:ref.deliveryId});}};
}
/** BullMQ uses native worker completion acknowledgement, not neutral manual settlement. */
export function createBullMQWebhookPublisher(service:QueueService,name:string):WebhookQueuePublisher{
 const queue=service.queue(name);return {acknowledged:true,destructiveRead:false,publish(ref){id(ref.tenant);id(ref.deliveryId);return queue.add('webhook.deliver',{tenant:ref.tenant,deliveryId:ref.deliveryId},{attempts:1});}};
}
export function createWebhookProcessor(workflow:{deliver(ref:WebhookReference,principal:unknown):Promise<unknown>},principal:unknown){
 return async(job:{name:string;data:Record<string,unknown>})=>{if(job?.name!=='webhook.deliver'||!job.data||Object.keys(job.data).sort().join(',')!=='deliveryId,tenant')throw fail('INVALID_JOB_REFERENCE');id(job.data.tenant);id(job.data.deliveryId);return workflow.deliver({tenant:job.data.tenant,deliveryId:job.data.deliveryId},principal);};
}
