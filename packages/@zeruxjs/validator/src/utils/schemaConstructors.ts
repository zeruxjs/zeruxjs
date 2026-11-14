import type { GenericSchema, GenericPipeItem } from '../types/index.js';
import type { SchemaWithPipe } from '../methods/pipe.js';
import { pipe } from '../methods/pipe.js';
import { pipeAsync } from '../methods/pipeAsync.js';
import {
  array as _array,
  arrayAsync as _arrayAsync,
  bigint as _bigint,
  blob as _blob,
  boolean as _boolean,
  custom as _custom,
  customAsync as _customAsync,
  date as _date,
  enum_ as _enum,
  file as _file,
  function_ as _function,
  instance as _instance,
  intersect as _intersect,
  intersectAsync as _intersectAsync,
  literal as _literal,
  looseObject as _looseObject,
  looseObjectAsync as _looseObjectAsync,
  looseTuple as _looseTuple,
  looseTupleAsync as _looseTupleAsync,
  map as _map,
  mapAsync as _mapAsync,
  nan as _nan,
  never as _never,
  nonNullable as _nonNullable,
  nonNullableAsync as _nonNullableAsync,
  nonNullish as _nonNullish,
  nonNullishAsync as _nonNullishAsync,
  nonOptional as _nonOptional,
  nonOptionalAsync as _nonOptionalAsync,
  null_ as _null,
  number as _number,
  object as _object,
  objectAsync as _objectAsync,
  objectWithRest as _objectWithRest,
  objectWithRestAsync as _objectWithRestAsync,
  picklist as _picklist,
  promise as _promise,
  record as _record,
  recordAsync as _recordAsync,
  set as _set,
  setAsync as _setAsync,
  strictObject as _strictObject,
  strictObjectAsync as _strictObjectAsync,
  strictTuple as _strictTuple,
  strictTupleAsync as _strictTupleAsync,
  string as _string,
  symbol as _symbol,
  tuple as _tuple,
  tupleAsync as _tupleAsync,
  tupleWithRest as _tupleWithRest,
  tupleWithRestAsync as _tupleWithRestAsync,
  undefined_ as _undefined,
  union as _union,
  unionAsync as _unionAsync,
  variant as _variant,
  variantAsync as _variantAsync,
  void_ as _void,
} from '../schemas/index.js';

type CompatActions = readonly unknown[];
type WithActions0<T extends (...args: any[]) => GenericSchema> = T &
  (<const A extends readonly GenericPipeItem<any, any>[]>(
    actions: A
  ) => SchemaWithPipe<readonly [ReturnType<T>, ...A]>);
type WithActions1<T> = T & ((arg0: any, actions: CompatActions) => any);
type WithActions2<T> = T &
  ((arg0: any, arg1: any, actions: CompatActions) => any);

/** Bridge a zero-required-argument/message constructor to explicit synchronous action-array shorthand. Keep its existing precise zero-argument action inference; this never parses on import.
 * @param {TFactory} factory - Borrowed authored schema constructor selected by static public imports, never a user-supplied module name.
 * @returns {WithActions0<TFactory>} Inert compatibility constructor closure; schema creation happens only on its explicit call and validation remains root-owned.
 */
function wrap0<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions0<TFactory> {
  return ((arg?: unknown) =>
    Array.isArray(arg)
      ? pipe(factory(), ...arg)
      : factory(arg as never)) as WithActions0<TFactory>;
}

/** Bridge a one-required-argument constructor to explicit synchronous actions in its second position. Legacy argument-taking shorthand retains broad typing; use functional pipe for precise inference.
 * @param {TFactory} factory - Borrowed authored schema constructor selected by static public imports, never a user-supplied module name.
 * @returns {WithActions1<TFactory>} Inert compatibility constructor closure; schema creation happens only on its explicit call and validation remains root-owned.
 */
function wrap1<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions1<TFactory> {
  return ((arg0: unknown, arg1?: unknown) =>
    Array.isArray(arg1)
      ? pipe(factory(arg0), ...arg1)
      : factory(arg0, arg1 as never)) as WithActions1<TFactory>;
}

/** Bridge a two-required-argument constructor to explicit synchronous actions in its third position. Earlier array-valued schema arguments retain their original meaning.
 * @param {TFactory} factory - Borrowed authored schema constructor selected by static public imports, never a user-supplied module name.
 * @returns {WithActions2<TFactory>} Inert compatibility constructor closure; schema creation happens only on its explicit call and validation remains root-owned.
 */
function wrap2<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions2<TFactory> {
  return ((arg0: unknown, arg1: unknown, arg2?: unknown) =>
    Array.isArray(arg2)
      ? pipe(factory(arg0, arg1), ...arg2)
      : factory(arg0, arg1, arg2 as never)) as WithActions2<TFactory>;
}

/** Bridge an explicitly asynchronous one-argument schema factory to pipeAsync when its second argument is an action array. This does not silently make synchronous constructors async.
 * @param {TFactory} factory - Borrowed authored schema constructor selected by static public imports, never a user-supplied module name.
 * @returns {WithActions1<TFactory>} Inert compatibility constructor closure; schema creation happens only on its explicit call and validation remains root-owned.
 */
function wrapAsync1<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions1<TFactory> {
  return ((arg0: unknown, arg1?: unknown) =>
    Array.isArray(arg1)
      ? pipeAsync(factory(arg0), ...arg1)
      : factory(arg0, arg1 as never)) as WithActions1<TFactory>;
}

/** Bridge an explicitly asynchronous two-argument factory to pipeAsync for its third-position action array. Preserve legacy argument interpretation and broad shorthand typing.
 * @param {TFactory} factory - Borrowed authored schema constructor selected by static public imports, never a user-supplied module name.
 * @returns {WithActions2<TFactory>} Inert compatibility constructor closure; schema creation happens only on its explicit call and validation remains root-owned.
 */
function wrapAsync2<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions2<TFactory> {
  return ((arg0: unknown, arg1: unknown, arg2?: unknown) =>
    Array.isArray(arg2)
      ? pipeAsync(factory(arg0, arg1), ...arg2)
      : factory(arg0, arg1, arg2 as never)) as WithActions2<TFactory>;
}

/** Public string compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const string = wrap0(_string);
/** Public number compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const number = wrap0(_number);
/** Public boolean compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const boolean = wrap0(_boolean);
/** Public bigint compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const bigint = wrap0(_bigint);
/** Public blob compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const blob = wrap0(_blob);
/** Public date compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const date = wrap0(_date);
/** Public file compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const file = wrap0(_file);
/** Public function_ compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const function_ = wrap0(_function);
/** Public nan compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const nan = wrap0(_nan);
/** Public never compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const never = wrap0(_never);
/** Public null_ compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const null_ = wrap0(_null);
/** Public promise compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const promise = wrap0(_promise);
/** Public symbol compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const symbol = wrap0(_symbol);
/** Public undefined_ compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const undefined_ = wrap0(_undefined);
/** Public void_ compatibility alias for zero required arguments/message; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const void_ = wrap0(_void);

/** Public array compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const array = wrap1(_array);
/** Public custom compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const custom = wrap1(_custom);
/** Public enum_ compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const enum_ = wrap1(_enum);
/** Public instance compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const instance = wrap1(_instance);
/** Public intersect compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const intersect = wrap1(_intersect);
/** Public literal compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const literal = wrap1(_literal);
/** Public looseObject compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const looseObject = wrap1(_looseObject);
/** Public looseTuple compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const looseTuple = wrap1(_looseTuple);
/** Public nonNullable compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const nonNullable = wrap1(_nonNullable);
/** Public nonNullish compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const nonNullish = wrap1(_nonNullish);
/** Public nonOptional compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const nonOptional = wrap1(_nonOptional);
/** Public object compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const object = wrap1(_object);
/** Public picklist compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const picklist = wrap1(_picklist);
/** Public set compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const set = wrap1(_set);
/** Public strictObject compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const strictObject = wrap1(_strictObject);
/** Public strictTuple compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const strictTuple = wrap1(_strictTuple);
/** Public tuple compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const tuple = wrap1(_tuple);
/** Public union compatibility alias for one required schema argument; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const union = wrap1(_union);

/** Public map compatibility alias for two required schema arguments; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const map = wrap2(_map);
/** Public objectWithRest compatibility alias for two required schema arguments; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const objectWithRest = wrap2(_objectWithRest);
/** Public record compatibility alias for two required schema arguments; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const record = wrap2(_record);
/** Public tupleWithRest compatibility alias for two required schema arguments; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const tupleWithRest = wrap2(_tupleWithRest);
/** Public variant compatibility alias for two required schema arguments; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const variant = wrap2(_variant);

/** Public arrayAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const arrayAsync = wrapAsync1(_arrayAsync);
/** Public customAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const customAsync = wrapAsync1(_customAsync);
/** Public intersectAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const intersectAsync = wrapAsync1(_intersectAsync);
/** Public looseObjectAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const looseObjectAsync = wrapAsync1(_looseObjectAsync);
/** Public looseTupleAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const looseTupleAsync = wrapAsync1(_looseTupleAsync);
/** Public nonNullableAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const nonNullableAsync = wrapAsync1(_nonNullableAsync);
/** Public nonNullishAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const nonNullishAsync = wrapAsync1(_nonNullishAsync);
/** Public nonOptionalAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const nonOptionalAsync = wrapAsync1(_nonOptionalAsync);
/** Public objectAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const objectAsync = wrapAsync1(_objectAsync);
/** Public setAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const setAsync = wrapAsync1(_setAsync);
/** Public strictObjectAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const strictObjectAsync = wrapAsync1(_strictObjectAsync);
/** Public strictTupleAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const strictTupleAsync = wrapAsync1(_strictTupleAsync);
/** Public tupleAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const tupleAsync = wrapAsync1(_tupleAsync);
/** Public unionAsync compatibility alias for one required argument with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const unionAsync = wrapAsync1(_unionAsync);

/** Public mapAsync compatibility alias for two required arguments with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const mapAsync = wrapAsync2(_mapAsync);
/** Public objectWithRestAsync compatibility alias for two required arguments with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const objectWithRestAsync = wrapAsync2(_objectWithRestAsync);
/** Public recordAsync compatibility alias for two required arguments with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const recordAsync = wrapAsync2(_recordAsync);
/** Public tupleWithRestAsync compatibility alias for two required arguments with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const tupleWithRestAsync = wrapAsync2(_tupleWithRestAsync);
/** Public variantAsync compatibility alias for two required arguments with explicit async action composition; captures an authored factory without parsing, loading packages or allocating a cleanup owner. */
export const variantAsync = wrapAsync2(_variantAsync);
