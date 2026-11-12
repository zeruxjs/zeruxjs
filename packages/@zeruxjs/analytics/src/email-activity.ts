/** Email delivery telemetry is independent of marketing recipient consent.
 * No raw email addresses or destination URLs are stored in these summaries.
 */
export type EmailActivityKind =
  | 'sent'
  | 'open'
  | 'click'
  | 'download_click'
  | 'download';
export interface EmailActivityEvent {
  /** Observed delivery/tracking activity kind, not proof of human behavior. */
  kind: EmailActivityKind;
  /** Opaque message or hashed-link identifier; never a recipient address. */
  id: string;
  /** Sending-account label, not credentials. */
  account: string;
  /** Optional campaign label without recipient identity. */
  campaign: string;
  /** Server UTC millisecond observation time. */
  at: number;
  /** SHA-256 identifier of an HTTPS link; never its destination or recipient. */
  linkId?: string;
  /** Bytes actually served by the application after a successful download. */
  bytes?: number;
}
export interface EmailActivityLink {
  /** Opaque message or hashed-link identifier; never a recipient address. */
  id: string;
  /** Observed click-request count, including repeat requests. */
  clicks: number;
  /** Earliest observed click UTC millisecond timestamp. */
  firstClickedAt?: number;
  /** Latest observed click UTC millisecond timestamp. */
  lastClickedAt?: number;
  /** Observed download-link click count, distinct from completed byte delivery. */
  downloadClicks: number;
  /** Earliest observed download-link click UTC millisecond timestamp. */
  firstDownloadClickedAt?: number;
  /** Latest observed download-link click UTC millisecond timestamp. */
  lastDownloadClickedAt?: number;
  /** Application-reported successful download count. */
  downloads: number;
  /** Earliest observed application-reported download UTC millisecond timestamp. */
  firstDownloadedAt?: number;
  /** Latest observed application-reported download UTC millisecond timestamp. */
  lastDownloadedAt?: number;
  /** Total application-reported bytes successfully served. */
  downloadedBytes: number;
}
export interface EmailActivitySummary {
  /** Opaque message or hashed-link identifier; never a recipient address. */
  id: string;
  /** Sending-account label, not credentials. */
  account: string;
  /** Optional campaign label without recipient identity. */
  campaign: string;
  /** First recorded successful send time in UTC milliseconds. */
  sentAt?: number;
  /** Observed pixel requests, not certified human opens. */
  opens: number;
  /** Earliest observed open UTC millisecond timestamp. */
  firstOpenedAt?: number;
  /** Latest observed open UTC millisecond timestamp. */
  lastOpenedAt?: number;
  /** Observed click-request count, including repeat requests. */
  clicks: number;
  /** Earliest observed click UTC millisecond timestamp. */
  firstClickedAt?: number;
  /** Latest observed click UTC millisecond timestamp. */
  lastClickedAt?: number;
  /** Observed download-link click count, distinct from completed byte delivery. */
  downloadClicks: number;
  /** Earliest observed download-link click UTC millisecond timestamp. */
  firstDownloadClickedAt?: number;
  /** Latest observed download-link click UTC millisecond timestamp. */
  lastDownloadClickedAt?: number;
  /** Application-reported successful download count. */
  downloads: number;
  /** Earliest observed application-reported download UTC millisecond timestamp. */
  firstDownloadedAt?: number;
  /** Latest observed application-reported download UTC millisecond timestamp. */
  lastDownloadedAt?: number;
  /** Total application-reported bytes successfully served. */
  downloadedBytes: number;
  /** At most 100 observed hashed-link summaries per message. */
  links: EmailActivityLink[];
}
/** Implement with atomic record() and shared storage across servers/queue workers in production.
 * No consent check is invoked here. An exception or outage must never block delivery.
 */
export interface EmailActivityStore {
  /** Record an observed event atomically in this store implementation. Production stores must provide their own shared atomicity.
   * @param {Readonly<EmailActivityEvent>} event - Opaque identifiers and validated observation metadata.
   * @returns {Promise<void>} Settles after the update; malformed input/storage failures reject.
   */
  record(event: Readonly<EmailActivityEvent>): Promise<void>;
  /** Read one detached opaque-message activity summary.
   * @param {string} id - Opaque message identifier.
   * @returns {Promise<EmailActivitySummary|null>} Summary or absence; host authorization belongs outside the store.
   */
  get(id: string): Promise<EmailActivitySummary | null>;
}
/** Create bounded process-local email activity summaries without storage/network work. The host must separately enforce tracking opt-in.
 * @param {{ maxMessages?: number }} options - Optional retention bound; eviction removes the oldest inserted message summary.
 * @param {number|undefined} options.maxMessages - Maximum retained message summaries, default 10000.
 * @returns {EmailActivityStore} Non-durable reference store with detached reads; no timer or disposer.
 */
export function createMemoryEmailActivityStore(
  options: { maxMessages?: number } = {}
): EmailActivityStore {
  /** Process-local retained message limit, default 10000 and maximum 100000. */
  const max = options.maxMessages ?? 10_000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 100_000) {
    throw new RangeError('Invalid email activity memory limit');
  }
  /** Bounded insertion-ordered summaries; this map is neither durable nor shared across workers. */
  const messages = new Map<string, EmailActivitySummary>();
  return {
    /** Record an observed event atomically in this store implementation. Production stores must provide their own shared atomicity.
     * @param {Readonly<EmailActivityEvent>} event - Opaque identifiers and validated observation metadata.
     * @returns {Promise<void>} Settles after the update; malformed input/storage failures reject.
     */
    async record(event) {
      if (
        !/^[A-Za-z0-9._:-]{1,128}$/.test(event.id) ||
        !Number.isSafeInteger(event.at) ||
        event.at < 0
      ) {
        throw new TypeError('Invalid email activity event');
      }
      let item = messages.get(event.id);
      if (!item) {
        if (messages.size >= max) {
          messages.delete(messages.keys().next().value!);
        }
        item = {
          id: event.id,
          account: event.account,
          campaign: event.campaign,
          opens: 0,
          clicks: 0,
          downloadClicks: 0,
          downloads: 0,
          downloadedBytes: 0,
          links: [],
        };
        messages.set(event.id, item);
      }
      if (event.kind === 'sent') {
        item.sentAt ??= event.at;
        return;
      }
      if (event.kind === 'open') {
        item.opens++;
        item.firstOpenedAt = Math.min(item.firstOpenedAt ?? event.at, event.at);
        item.lastOpenedAt = Math.max(item.lastOpenedAt ?? event.at, event.at);
        return;
      }
      let link: EmailActivityLink | undefined;
      if (event.linkId) {
        link = item.links.find((link) => link.id === event.linkId);
        if (!link) {
          if (item.links.length >= 100) {
            return;
          }
          link = {
            id: event.linkId,
            clicks: 0,
            downloadClicks: 0,
            downloads: 0,
            downloadedBytes: 0,
          };
          item.links.push(link);
        }
      }
      if (event.kind === 'click' || event.kind === 'download_click') {
        item.clicks++;
        item.firstClickedAt = Math.min(
          item.firstClickedAt ?? event.at,
          event.at
        );
        item.lastClickedAt = Math.max(item.lastClickedAt ?? event.at, event.at);
        if (link) {
          link.clicks++;
          link.firstClickedAt = Math.min(
            link.firstClickedAt ?? event.at,
            event.at
          );
          link.lastClickedAt = Math.max(
            link.lastClickedAt ?? event.at,
            event.at
          );
        }
        if (event.kind === 'download_click') {
          item.downloadClicks++;
          item.firstDownloadClickedAt = Math.min(
            item.firstDownloadClickedAt ?? event.at,
            event.at
          );
          item.lastDownloadClickedAt = Math.max(
            item.lastDownloadClickedAt ?? event.at,
            event.at
          );
          if (link) {
            link.downloadClicks++;
            link.firstDownloadClickedAt = Math.min(
              link.firstDownloadClickedAt ?? event.at,
              event.at
            );
            link.lastDownloadClickedAt = Math.max(
              link.lastDownloadClickedAt ?? event.at,
              event.at
            );
          }
        }
      } else if (event.kind === 'download') {
        item.downloads++;
        item.firstDownloadedAt = Math.min(
          item.firstDownloadedAt ?? event.at,
          event.at
        );
        item.lastDownloadedAt = Math.max(
          item.lastDownloadedAt ?? event.at,
          event.at
        );
        /** Only nonnegative safe byte counts contribute to observed downloads; invalid values contribute zero. */
        const bytes =
          typeof event.bytes === 'number' &&
          Number.isSafeInteger(event.bytes) &&
          event.bytes >= 0
            ? event.bytes
            : 0;
        item.downloadedBytes += bytes;
        if (link) {
          link.downloads++;
          link.firstDownloadedAt = Math.min(
            link.firstDownloadedAt ?? event.at,
            event.at
          );
          link.lastDownloadedAt = Math.max(
            link.lastDownloadedAt ?? event.at,
            event.at
          );
          link.downloadedBytes += bytes;
        }
      }
    },
    /** Read one detached opaque-message activity summary.
     * @param {string} id - Opaque message identifier.
     * @returns {Promise<EmailActivitySummary|null>} Summary or absence; host authorization belongs outside the store.
     */
    async get(id) {
      /** Stored process-local summary; returned reads clone its public link records. */
      const item = messages.get(id);
      return item
        ? { ...item, links: item.links.map((link) => ({ ...link })) }
        : null;
    },
  };
}
