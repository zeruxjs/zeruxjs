import type { EmailAddress, EmailRecipients, RecipientRule } from './types.js';
import { addressString, recipientList } from './validation.js';
/** Normalize a mailbox/pattern for this filter policy without exposing recipient identity.
 * @param {string} address - Literal mailbox to normalize.
 * @returns {string} Trimmed lowercase filter value.
 */
function canonical(address: string) {
  return address.trim().toLowerCase();
}
/** Match only exact mailboxes or bounded whole-domain masks, never caller regex.
 * @param {string} pattern - Bounded exact/whole-domain mask; arbitrary regex is rejected.
 * @param {string} email - Literal private recipient mailbox.
 * @returns {boolean} Whether the normalized literal satisfies this supported mask.
 */
function matches(pattern: string, email: string): boolean {
  /** Canonical private mailbox used only for local policy matching. */
  const value = canonical(email);
  /** Canonical supported literal mask; arbitrary regex/wildcard syntax rejects. */
  const mask = canonical(pattern);
  if (!mask || mask.length > 320 || !/^[@a-z0-9._+*%-]+$/.test(mask)) {
    throw new TypeError('Invalid email filter pattern');
  }
  // Restrict wildcards to whole domain or prefix: no regex injection.
  if (mask.startsWith('*@')) {
    return value.endsWith(mask.slice(1));
  }
  if (mask.startsWith('@')) {
    return value.endsWith(mask);
  }
  if (mask.includes('*')) {
    throw new TypeError('Wildcard must be *@domain');
  }
  return value === mask;
}
/** Create a process-local mutable rule/suppression registry without opening transports.
 * @param {RecipientRule[]} initial - Initial rules in insertion order; default empty.
 * @param {string[]} blocked - Initial local suppressed mailbox list; default empty.
 * @returns {RecipientFilter} Host-owned local policy object; persistence and authorization stay external.
 */
export function createRecipientFilter(
  initial: RecipientRule[] = [],
  blocked: string[] = []
) {
  let rules: RecipientRule[] = [];
  /** Instance-local canonical suppressed mailbox set; durability remains host-owned. */
  const suppressed = new Set<string>();
  /** Mutable policy registry; creates no network resources or background work. */
  const api = {
    /** Validate a rule before appending a detached copy; later matching rules take precedence.
     * @param {RecipientRule} rule - Host-controlled explicit allow/block rule.
     * @returns {void} Rule added to this registry only.
     */
    addRule(rule: RecipientRule) {
      if (!['allow', 'block'].includes(rule.action) || !rule.pattern) {
        throw new TypeError('Invalid recipient rule');
      }
      matches(rule.pattern, 'test@example.com');
      if (rule.account && !/^[a-z][a-z0-9_-]{0,63}$/.test(rule.account)) {
        throw new TypeError('Invalid account selector');
      }
      rules.push({ ...rule });
    },
    /** Replace rules using sequential existing validation; this legacy operation is not an atomic staged import.
     * @param {RecipientRule[]} next - Replacement rule list; existing sequential validation semantics are retained.
     * @returns {void} Rules added up to any failing input; callers needing atomicity must validate separately.
     */
    setRules(next: RecipientRule[]) {
      rules = [];
      next.forEach(api.addRule);
    },
    /** Return detached rule copies rather than exposing mutable stored rules.
     * @returns {RecipientRule[]} Rules in insertion order.
     */
    listRules() {
      return rules.map((r) => ({ ...r }));
    },
    /** Add a validated canonical recipient to this process-local suppression set.
     * @param {string} email - Literal private recipient mailbox.
     * @returns {void} Subsequent evaluations reject this mailbox.
     */
    suppress(email: string) {
      /** Canonical private mailbox used only for local policy matching. */
      const value = canonical(addressString(email));
      matches(value, value);
      suppressed.add(value);
    },
    /** Remove a canonical mailbox from this local set only.
     * @param {string} email - Literal private recipient mailbox.
     * @returns {boolean} True when an existing local suppression was removed.
     */
    unsuppress(email: string) {
      return suppressed.delete(canonical(email));
    },
    /** Return sorted mailbox values for trusted private persistence.
     * @returns {string[]} Private recipient list; never telemetry/public config.
     */
    listSuppressions() {
      return [...suppressed].sort();
    },
    /** Apply explicit suppressions before the last matching account-scoped rule.
     * @param {EmailRecipients} recipients - Single/list recipients validated before policy evaluation.
     * @param {string} account - Optional exact account selector; not a principal credential.
     * @returns {{accepted: EmailAddress[], rejected: {address: EmailAddress, reason: string}[]}} Private per-recipient policy outcomes; no send occurs.
     */
    evaluate(recipients: EmailRecipients, account?: string) {
      /** Validated private recipients admitted by this evaluation. */
      const accepted: EmailAddress[] = [];
      /** Private recipient/reason pairs denied by suppression or the last matching rule. */
      const rejected: { address: EmailAddress; reason: string }[] = [];
      // Apply suppression independently to every validated envelope recipient.
      for (const address of recipientList(recipients)) {
        /** Canonical private mailbox used only for local policy matching. */
        const value = addressString(address);
        /** Last matching account-scoped rule; explicit suppression still takes precedence. */
        const rule = [...rules]
          .reverse()
          .find(
            (r) =>
              (!r.account || r.account === account) && matches(r.pattern, value)
          );
        if (suppressed.has(canonical(value))) {
          rejected.push({ address, reason: 'suppressed' });
        } else if (rule?.action === 'block') {
          rejected.push({ address, reason: rule.reason ?? 'blocked' });
        } else {
          accepted.push(address);
        }
      }
      return { accepted, rejected };
    },
  };
  initial.forEach(api.addRule);
  blocked.forEach(api.suppress);
  return api;
}
export type RecipientFilter = ReturnType<typeof createRecipientFilter>;
