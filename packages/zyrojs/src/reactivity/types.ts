/** Core types for the ZyroJS reactivity system. */

export type Subscriber = () => void;

export interface Signal<T> {
  /** Current mutable signal value. */
  value: T;
  /** Read the value without tracking a dependency. */
  peek(): T;
}

export interface ReadonlySignal<T> {
  /** Current read-only signal value. */
  readonly value: T;
  /** Read the value without tracking a dependency. */
  peek(): T;
}
