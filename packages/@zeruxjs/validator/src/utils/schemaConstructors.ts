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
type WithActions0<T> = T & ((actions: CompatActions) => any);
type WithActions1<T> = T & ((arg0: any, actions: CompatActions) => any);
type WithActions2<T> = T & ((arg0: any, arg1: any, actions: CompatActions) => any);

function wrap0<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions0<TFactory> {
  return ((arg?: unknown) =>
    Array.isArray(arg) ? pipe(factory(), ...arg) : factory(arg as never)) as WithActions0<TFactory>;
}

function wrap1<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions1<TFactory> {
  return ((arg0: unknown, arg1?: unknown) =>
    Array.isArray(arg1)
      ? pipe(factory(arg0), ...arg1)
      : factory(arg0, arg1 as never)) as WithActions1<TFactory>;
}

function wrap2<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions2<TFactory> {
  return ((arg0: unknown, arg1: unknown, arg2?: unknown) =>
    Array.isArray(arg2)
      ? pipe(factory(arg0, arg1), ...arg2)
      : factory(arg0, arg1, arg2 as never)) as WithActions2<TFactory>;
}

function wrapAsync1<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions1<TFactory> {
  return ((arg0: unknown, arg1?: unknown) =>
    Array.isArray(arg1)
      ? pipeAsync(factory(arg0), ...arg1)
      : factory(arg0, arg1 as never)) as WithActions1<TFactory>;
}

function wrapAsync2<TFactory extends (...args: any[]) => any>(
  factory: TFactory
): WithActions2<TFactory> {
  return ((arg0: unknown, arg1: unknown, arg2?: unknown) =>
    Array.isArray(arg2)
      ? pipeAsync(factory(arg0, arg1), ...arg2)
      : factory(arg0, arg1, arg2 as never)) as WithActions2<TFactory>;
}

export const string = wrap0(_string);
export const number = wrap0(_number);
export const boolean = wrap0(_boolean);
export const bigint = wrap0(_bigint);
export const blob = wrap0(_blob);
export const date = wrap0(_date);
export const file = wrap0(_file);
export const function_ = wrap0(_function);
export const nan = wrap0(_nan);
export const never = wrap0(_never);
export const null_ = wrap0(_null);
export const promise = wrap0(_promise);
export const symbol = wrap0(_symbol);
export const undefined_ = wrap0(_undefined);
export const void_ = wrap0(_void);

export const array = wrap1(_array);
export const custom = wrap1(_custom);
export const enum_ = wrap1(_enum);
export const instance = wrap1(_instance);
export const intersect = wrap1(_intersect);
export const literal = wrap1(_literal);
export const looseObject = wrap1(_looseObject);
export const looseTuple = wrap1(_looseTuple);
export const nonNullable = wrap1(_nonNullable);
export const nonNullish = wrap1(_nonNullish);
export const nonOptional = wrap1(_nonOptional);
export const object = wrap1(_object);
export const picklist = wrap1(_picklist);
export const set = wrap1(_set);
export const strictObject = wrap1(_strictObject);
export const strictTuple = wrap1(_strictTuple);
export const tuple = wrap1(_tuple);
export const union = wrap1(_union);

export const map = wrap2(_map);
export const objectWithRest = wrap2(_objectWithRest);
export const record = wrap2(_record);
export const tupleWithRest = wrap2(_tupleWithRest);
export const variant = wrap2(_variant);

export const arrayAsync = wrapAsync1(_arrayAsync);
export const customAsync = wrapAsync1(_customAsync);
export const intersectAsync = wrapAsync1(_intersectAsync);
export const looseObjectAsync = wrapAsync1(_looseObjectAsync);
export const looseTupleAsync = wrapAsync1(_looseTupleAsync);
export const nonNullableAsync = wrapAsync1(_nonNullableAsync);
export const nonNullishAsync = wrapAsync1(_nonNullishAsync);
export const nonOptionalAsync = wrapAsync1(_nonOptionalAsync);
export const objectAsync = wrapAsync1(_objectAsync);
export const setAsync = wrapAsync1(_setAsync);
export const strictObjectAsync = wrapAsync1(_strictObjectAsync);
export const strictTupleAsync = wrapAsync1(_strictTupleAsync);
export const tupleAsync = wrapAsync1(_tupleAsync);
export const unionAsync = wrapAsync1(_unionAsync);

export const mapAsync = wrapAsync2(_mapAsync);
export const objectWithRestAsync = wrapAsync2(_objectWithRestAsync);
export const recordAsync = wrapAsync2(_recordAsync);
export const tupleWithRestAsync = wrapAsync2(_tupleWithRestAsync);
export const variantAsync = wrapAsync2(_variantAsync);
