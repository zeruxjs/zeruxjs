/** Browser-safe schemas and opt-in DOM feedback; no request parsing imports. */
export * from './core.js';
export { createFormFeedback } from './integrations/feedback.js';
export type {
  FormFeedbackOptions,
  FeedbackTarget,
} from './integrations/feedback.js';
export type { ClientIssue } from './integrations/client.js';
