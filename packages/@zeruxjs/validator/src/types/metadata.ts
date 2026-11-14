/**
 * Base metadata interface.
 */
export interface BaseMetadata<TInput> {
  /**
   * The object kind.
   */
  readonly kind: 'metadata';
  /**
   * The metadata type.
   */
  readonly type: string;
  /**
   * The metadata reference.
   */
  readonly reference: (...args: any[]) => BaseMetadata<any>;
  /**
   * The input, output and issue type.
   *
   * @internal
   */
  readonly '~types'?:
    | {
        /** Original pipeline input type; metadata leaves validation unchanged. */
        readonly input: TInput;
        /** Same type as input; attaching metadata never transforms values. */
        readonly output: TInput;
        /** Metadata cannot emit validation issues itself. */
        readonly issue: never;
      }
    | undefined;
}

/**
 * Generic metadata type.
 */

export type GenericMetadata<TInput = any> = BaseMetadata<TInput>;
