/**
 * Detect any at compile time for inference branches; performs no runtime validation.
 */
export type IsAny<Type> = 0 extends 1 & Type ? true : false;

/**
 * Detect never without distributing over a union; performs no runtime validation.
 */
export type IsNever<Type> = [Type] extends [never] ? true : false;

/**
 * Remove null only. This package-owned NonNullable differs from TypeScript’s built-in alias that also excludes undefined.
 */
export type NonNullable<TValue> = TValue extends null ? never : TValue;

/**
 * Remove both null and undefined at compile time; a type annotation never filters runtime data.
 */
export type NonNullish<TValue> = TValue extends null | undefined
  ? never
  : TValue;

/**
 * Remove undefined only, preserving null when present in the original type.
 */
export type NonOptional<TValue> = TValue extends undefined ? never : TValue;

/**
 * Accept mutable or shallow-readonly typing without copying or freezing runtime values.
 */
export type MaybeReadonly<TValue> = TValue | Readonly<TValue>;

/**
 * Map record/array branches to readonly properties at compile time; this does not freeze objects or create an immutable runtime snapshot.
 */
export type DeepReadonly<TValue> = TValue extends
  | Record<string, unknown>
  | readonly unknown[]
  ? { readonly [TKey in keyof TValue]: DeepReadonly<TValue[TKey]> }
  : TValue;

/**
 * Accept original or recursively readonly record/array typing; runtime values still retain identity.
 */
export type MaybeDeepReadonly<TValue> = TValue | DeepReadonly<TValue>;

/**
 * Accept a direct value or native Promise type; this does not schedule, await or cancel work.
 */
export type MaybePromise<TValue> = TValue | Promise<TValue>;

/**
 * Materialize an object-shaped mapped type for editor readability, with no emitted runtime code.
 *
 * Hint: This type has no effect and is only used so that TypeScript displays
 * the final type in the preview instead of the utility types used.
 */
export type Prettify<TObject> = { [TKey in keyof TObject]: TObject[TKey] } & {};

/**
 * Mark only selected declared keys optional in the type; no runtime fields, defaults or absence checks are created.
 */
export type MarkOptional<TObject, TKeys extends keyof TObject> =
  // Mapping any entry to unknown preserves key order in final output
  { [TKey in keyof TObject]?: unknown } & Omit<TObject, TKeys> &
    Partial<Pick<TObject, TKeys>>;

/**
 * Compute a second-definition-wins object type. This does not merge, clone or authorize any runtime objects.
 */
export type Merge<TFirstObject, TSecondObject> = Omit<
  TFirstObject,
  keyof TFirstObject & keyof TSecondObject
> &
  TSecondObject;

/**
 * Select the first type from a declared nonempty readonly/mutable tuple, without a runtime read.
 */
export type FirstTupleItem<TTuple extends readonly [unknown, ...unknown[]]> =
  TTuple[0];

/**
 * Select the final type from a declared nonempty tuple using its rest length; no runtime index validation occurs.
 */
export type LastTupleItem<TTuple extends readonly [unknown, ...unknown[]]> =
  TTuple[TTuple extends readonly [unknown, ...infer TRest]
    ? TRest['length']
    : never];

/**
 * Infer an intersection through distributive function-parameter typing; no runtime function is invoked.
 */
export type UnionToIntersect<TUnion> = (
  TUnion extends any ? (arg: TUnion) => void : never
) extends (arg: infer Intersect) => void
  ? Intersect
  : never;

/**
 * Recursively accumulate a type-level tuple; this is not runtime enumeration or sorting.
 *
 * For more information: {@link https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html#tail-recursion-elimination-on-conditional-types}
 */
type UnionToTupleHelper<TUnion, TResult extends unknown[]> =
  UnionToIntersect<
    TUnion extends never ? never : () => TUnion
  > extends () => infer TLast
    ? UnionToTupleHelper<Exclude<TUnion, TLast>, [TLast, ...TResult]>
    : TResult;

/**
 * Compute a type-only tuple from union members; no runtime array, ordering policy or serialization is created.
 */
export type UnionToTuple<TUnion> = UnionToTupleHelper<TUnion, []>;
