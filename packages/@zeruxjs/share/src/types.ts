export interface ShareData {
  /** Required authored absolute credential-free HTTP(S) location; private-query policy remains host-owned. */
  url: string;
  /** Optional authored share title. */
  title?: string;
  /** Optional authored share message; never evaluated as markup/code. */
  text?: string;
}
export interface ShareCapabilities {
  /** Whether a callable native share capability currently exists, not a permission grant. */
  native: boolean;
  /** Whether a callable clipboard write capability currently exists, not proof of successful copying. */
  clipboard: boolean;
}
