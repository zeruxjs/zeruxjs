/** Explicit owner teardown contract; implementation documents whether reuse is allowed. */
export interface Disposable {
  /** Release this owner resources; borrowed dependencies remain caller-owned.
   * @returns {void} No value; release semantics belong to the implementing owner (FocusTrap permits reactivation).
   */
  destroy(): void;
}
/** Reusable document-local focus ownership; destroy deactivates the current acquisition. */
export interface FocusTrap {
  /** Acquire top-layer listeners and initial focus; activation failure rolls back this owner.
   * @returns {void} No value; activation acquires listeners/focus only for an inactive trap.
   */
  activate(): void;
  /** Release this active trap and restore available focus only when it owned the top layer.
   * @returns {void} No value; releases active acquisition and conditionally restores available focus.
   */
  deactivate(): void;
  /** Release this owner resources; borrowed dependencies remain caller-owned.
   * @returns {void} No value; release semantics belong to the implementing owner (FocusTrap permits reactivation).
   */
  destroy(): void;
  /** Whether this owner currently has an active trap/utterance; not a permission grant. */
  readonly active: boolean;
  /** Whether this active trap alone owns focus interception in its document. */
  readonly topmost: boolean;
}
