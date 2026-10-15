/**
 * @title Reactivity Types
 * @description Core types for the ZyroJS reactivity system.
 */

export type Subscriber = () => void;

export interface Signal<T> {
    value: T;
    peek(): T;
}

export interface ReadonlySignal<T> {
    readonly value: T;
    peek(): T;
}
