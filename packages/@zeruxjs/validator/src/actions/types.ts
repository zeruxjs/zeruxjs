import type { ValidationContext } from '../types/runtime.js';
import type { MaybePromise, MaybeReadonly } from '../types/index.js';

/**
 * Borrowed array input accepted by item refinements; readonly typing does not freeze runtime arrays.
 */
export type ArrayInput = MaybeReadonly<unknown[]>;

/** Trusted array-item predicate contract; the owning action determines ordering and cooperative execution limits.
 * @param {TInput[number]} item - Current borrowed item; nested data remains private and untrusted until validated.
 * @param {number} index - Current zero-based array position, not a stable identity or authorization key.
 * @param {TInput} array - Original borrowed array; callbacks must not assume an isolated deep copy.
 * @returns {boolean} Host predicate result; operational exceptions/rejections propagate instead of becoming ordinary false results.
 */
export type ArrayRequirement<TInput extends ArrayInput> = (
  item: TInput[number],
  index: number,
  array: TInput
) => boolean;

/** Trusted array-item predicate contract; the owning action determines ordering and cooperative execution limits.
 * @param {TInput[number]} item - Current borrowed item; nested data remains private and untrusted until validated.
 * @param {number} index - Current zero-based array position, not a stable identity or authorization key.
 * @param {TInput} array - Original borrowed array; callbacks must not assume an isolated deep copy.
 * @param {ValidationContext} context - Root cooperative signal; the callback owns additional asynchronous work it starts.
 * @returns {MaybePromise<boolean>} Host predicate result; operational exceptions/rejections propagate instead of becoming ordinary false results.
 */
export type ArrayRequirementAsync<TInput extends ArrayInput> = (
  item: TInput[number],
  index: number,
  array: TInput,
  context: ValidationContext
) => MaybePromise<boolean>;

/**
 * Native strings or borrowed readonly arrays used by content membership refinements.
 */
export type ContentInput = string | MaybeReadonly<unknown[]>;

/**
 * Content requirement type.
 */
export type ContentRequirement<TInput extends ContentInput> =
  TInput extends readonly unknown[] ? TInput[number] : TInput;

/**
 * Declared dictionary value type; runtime own-key and prototype policy remains action-specific.
 */
export type EntriesInput = Record<string | number, unknown>;

/**
 * String/code-unit or array-like length surface; not a byte or grapheme measurement.
 */
export type LengthInput = string | ArrayLike<unknown>;

/**
 * Native Blob byte size or Map/Set element count; units depend on the selected input kind.
 */
export type SizeInput = Blob | Map<unknown, unknown> | Set<unknown>;

/**
 * Primitive/Date values compared by native relational operators; mutable Date objects and coercion remain host behavior.
 */
export type ValueInput = string | number | bigint | boolean | Date;
