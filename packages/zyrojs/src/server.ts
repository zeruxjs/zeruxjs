import { hydrationAttributes, hydrationTag } from './dom/html-policy.js';
import { trustedHTMLValue } from './dom/trusted-html.js';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';
import { createEffectScope, untracked } from './reactivity/effect.js';
import { h, type VNodeChild, type VNode } from './dom/vnode.js';
import {
  getComponentDefinition,
  runComponentRender,
  type Component,
} from './dom/component.js';
import {
  checkAbort,
  hydrationLimits,
  publicProps,
  serializeHydrationData,
  validatePrefix,
  withComponentIds,
  HydrationError,
  type HydrationLimits,
  type HydrationPolicy,
} from './dom/hydration-protocol.js';
export * from './component.js';
export { HydrationError, HYDRATION_VERSION } from './dom/hydration-protocol.js';
export interface ServerRenderOptions<P>
  extends HydrationPolicy<P>, HydrationLimits {
  /** Stable identifier prefix embedded in server markers and hydration data. */
  idPrefix: string;
}
export interface HydratableOutput {
  /** Hydration protocol version used for this output. */
  readonly version: 1;
  /** Escaped HTML containing deterministic hydration markers. */
  readonly html: string;
  /** JSON script payload containing validated public props. */
  readonly data: string;
  /** Identifier prefix used while rendering the output. */
  readonly idPrefix: string;
}
/** Stores the voidTag value used by this module. */
const voidTag =
  /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
/** Synchronous whole-root SSR with versioned markers and separately encoded, validated public props. */
/**
 * renderToHydratable.
 * @param {Component<P>} component - Input value for this operation.
 * @param {unknown} input - Input value for this operation.
 * @param {ServerRenderOptions<P>} options - Input value for this operation.
 * @returns {HydratableOutput} Result produced by this operation.
 */
export function renderToHydratable<P extends Record<string, any>>(
  component: Component<P>,
  input: unknown,
  options: ServerRenderOptions<P>
): HydratableOutput {
  if (typeof component !== 'function') {
    throw new TypeError('ZyroJS: a component is required');
  }
  validatePrefix(options?.idPrefix);
  /** Stores the { validateProps, signal, idPrefix, ...limitInput } value used by this module. */
  const { validateProps, signal, idPrefix, ...limitInput } = options;
  /** Stores the limits value used by this module. */
  const limits = hydrationLimits(limitInput);
  /** Stores the props value used by this module. */
  const props = publicProps(
    input,
    { validateProps, signal },
    limits.maxPropsBytes
  );
  /** Stores the data value used by this module. */
  const data = serializeHydrationData(
    { version: 1, idPrefix, props },
    limits.maxPropsBytes
  );
  /** Stores the scope value used by this module. */
  const scope = createEffectScope();
  let nodes = 0,
    components = 0,
    bytes = 0;
  /**
   * Application function emit.
   * @param {string} text - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const emit = (text: string) => {
    bytes += new TextEncoder().encode(text).length;
    if (bytes > limits.maxBytes) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: server HTML exceeds byte limit'
      );
    }
    return text;
  };
  /**
   * Application function flatten.
   * @param {VNodeChild[]} values - Input value for this operation.
   * @param {number} depth - Input value for this operation.
   * @returns {VNodeChild[]} Result produced by this operation.
   */
  const flatten = (values: VNodeChild[], depth: number): VNodeChild[] => {
    if (depth > limits.maxDepth || values.length > limits.maxNodes) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: child collection exceeds limit'
      );
    }
    /** Stores the result value used by this module. */
    const result: VNodeChild[] = [];
    /** Stores the keys value used by this module. */
    const keys = new Set<unknown>();
    for (const value of values) {
      if (Array.isArray(value)) {
        result.push(...flatten(value, depth + 1));
      } else if (
        value !== null &&
        value !== undefined &&
        typeof value !== 'boolean'
      ) {
        result.push(value);
      }
      if (result.length > limits.maxNodes) {
        throw new HydrationError(
          'RENDER_LIMIT',
          'ZyroJS: child collection exceeds limit'
        );
      }
    }
    for (const value of result) {
      /** Stores the key value used by this module. */
      const key: unknown =
        value && typeof value === 'object' && 'props' in value
          ? value.props.key
          : undefined;
      if (key !== undefined) {
        if (
          (typeof key !== 'string' &&
            (typeof key !== 'number' || !Number.isFinite(key))) ||
          keys.has(key)
        ) {
          throw new HydrationError(
            'INVALID_KEY',
            'ZyroJS: invalid or duplicate hydration key'
          );
        }
        keys.add(key);
      }
    }
    return result;
  };
  /**
   * Application function render.
   * @param {VNodeChild} value - Input value for this operation.
   * @param {number} depth - Input value for this operation.
   * @returns {string} Result produced by this operation.
   */
  const render = (value: VNodeChild, depth: number): string => {
    checkAbort(signal);
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: server tree exceeds limit'
      );
    }
    if (value && typeof value === 'object' && 'then' in value) {
      throw new HydrationError(
        'ASYNC_CHILD',
        'ZyroJS: asynchronous hydration children are unsupported'
      );
    }
    if (Array.isArray(value)) {
      return (
        emit('<!--zyro-start-->') +
        flatten(value, depth)
          .map((child) => render(child, depth + 1))
          .join('') +
        emit('<!--zyro-->')
      );
    }
    /** Stores the vnode value used by this module. */
    const vnode =
      value && typeof value === 'object' ? (value as VNode) : undefined;
    if (typeof value === 'function' || typeof vnode?.type === 'function') {
      /** Stores the fn value used by this module. */
      const fn =
        typeof value === 'function'
          ? value
          : (vnode!.type as (...args: any[]) => any);
      /** Stores the definition value used by this module. */
      const definition = getComponentDefinition(fn);
      /** Stores the props value used by this module. */
      const props = vnode
        ? { ...vnode.props, children: vnode.children }
        : undefined;
      let content: string;
      /** Stores the setupScope value used by this module. */
      const setupScope = createEffectScope();
      scope.add(() => setupScope.dispose());
      try {
        /** Stores the componentId value used by this module. */
        const componentId = ++components;
        let run: (...args: any[]) => any;
        try {
          run = definition
            ? setupScope.run(() =>
                withComponentIds(idPrefix, componentId, () =>
                  definition.setup(props)
                )
              )
            : fn;
        } catch (error) {
          setupScope.dispose();
          throw error;
        }
        if (typeof run !== 'function') {
          throw new HydrationError(
            'INVALID_SETUP',
            'ZyroJS: setup must return a render function'
          );
        }
        /** Stores the result value used by this module. */
        const result = runComponentRender(() => run(props));
        checkAbort(signal);
        content = render(result, depth + 1);
      } catch (error) {
        checkAbort(signal);
        if (error instanceof HydrationError || !definition?.onError) {
          throw error;
        }
        content = render(
          untracked(() => definition.onError!(error)),
          depth + 1
        );
      }
      checkAbort(signal);
      return emit('<!--zyro-start-->') + content + emit('<!--zyro-->');
    }
    if (vnode) {
      if (!hydrationTag(vnode.type)) {
        throw new HydrationError(
          'UNSUPPORTED_TAG',
          'ZyroJS: unsupported hydratable HTML tag'
        );
      }
      /** Stores the attrs value used by this module. */
      const attrs = hydrationAttributes(vnode.props);
      /** Stores the children value used by this module. */
      const children = flatten(vnode.children, depth);
      /** Stores the raw value used by this module. */
      const raw = trustedHTMLValue(vnode.props, children.length > 0);
      if (raw !== undefined && voidTag.test(vnode.type)) {
        throw new HydrationError(
          'INVALID_TRUSTED_HTML',
          'ZyroJS: void elements cannot own opaque HTML'
        );
      }
      if (voidTag.test(vnode.type) && children.length) {
        throw new HydrationError(
          'INVALID_CHILDREN',
          'ZyroJS: void elements cannot have children'
        );
      }
      /** Stores the attributes value used by this module. */
      const attributes = Object.entries(attrs)
        .map(([name, value]) => ` ${name}="${escapeHtmlAttribute(value)}"`)
        .join('');
      /** Stores the open value used by this module. */
      const open = emit(`<${vnode.type}${attributes}>`);
      return voidTag.test(vnode.type)
        ? open
        : open +
            (raw === undefined
              ? children.map((child) => render(child, depth + 1)).join('')
              : emit(raw)) +
            emit(`</${vnode.type}>`);
    }
    if (value !== null && typeof value === 'object') {
      throw new HydrationError(
        'INVALID_CHILD',
        'ZyroJS: invalid hydration child'
      );
    }
    /** Stores the text value used by this module. */
    const text =
      value === null || value === undefined || typeof value === 'boolean'
        ? ''
        : String(value);
    if (
      text.includes('\0') ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        text
      )
    ) {
      throw new HydrationError(
        'INVALID_TEXT',
        'ZyroJS: invalid Unicode hydration text'
      );
    }
    return (
      emit('<!--zyro-text-->') +
      emit(escapeHtmlText(text).replace(/\r/g, '&#13;'))
    );
  };
  try {
    /** Stores the html value used by this module. */
    const html = scope.run(() =>
      untracked(
        () =>
          emit(`<!--zyro-h1:${idPrefix}-->`) +
          render(h(component, props), 0) +
          emit('<!--/zyro-h1-->')
      )
    );
    checkAbort(signal);
    return Object.freeze({ version: 1, html, data, idPrefix });
  } finally {
    scope.dispose();
  }
}
