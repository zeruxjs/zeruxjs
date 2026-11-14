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
/** HTML void elements have no closing tag and cannot own child or opaque fragment content. */
const voidTag =
  /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
/** Synchronous whole-root SSR with versioned markers and separately encoded, validated public props. */
/**
 * Render a bounded synchronous V1 root with deterministic markers and separately encoded public data.
 * @param {Component<P>} component - Trusted authored component matching the client tree; never loaded from public input.
 * @param {unknown} input - Candidate root props projected by the required host public-props validator.
 * @param {ServerRenderOptions<P>} options - Unique stable root prefix, public validation, cooperative signal and rendering budgets.
 * @returns {HydratableOutput} Frozen complete HTML/data candidate; all render scopes are disposed before return.
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
  /** Separate host validation/identity from traversal budgets before any component code runs. */
  const { validateProps, signal, idPrefix, ...limitInput } = options;
  /** Validated byte, depth and node caps for this single synchronous render. */
  const limits = hydrationLimits(limitInput);
  /** Detached inert public props; the host validator remains responsible for excluding private facts. */
  const props = publicProps(
    input,
    { validateProps, signal },
    limits.maxPropsBytes
  );
  /** Script-context encoded public data, separate from HTML text/attribute encoders. */
  const data = serializeHydrationData(
    { version: 1, idPrefix, props },
    limits.maxPropsBytes
  );
  /** Request-local effect owner, always disposed before returning output or propagating failure. */
  const scope = createEffectScope();
  let nodes = 0,
    components = 0,
    bytes = 0;
  /**
   * Count UTF-8 bytes before accepting each fragment into the output.
   * @param {string} text - Already encoded fragment to include exactly once.
   * @returns {string} Accepted fragment, or throws before exceeding the byte budget.
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
   * Flatten child arrays while bounding depth/length and rejecting duplicate sibling keys.
   * @param {VNodeChild[]} values - Authored child collection; arrays are flattened, null/boolean placeholders omitted.
   * @param {number} depth - Current traversal depth checked against the configured maximum.
   * @returns {VNodeChild[]} Validated child order without mounting subscriptions.
   */
  const flatten = (values: VNodeChild[], depth: number): VNodeChild[] => {
    if (depth > limits.maxDepth || values.length > limits.maxNodes) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: child collection exceeds limit'
      );
    }
    /** Attempt-local result; errors propagate before successful output can be returned. */
    const result: VNodeChild[] = [];
    /** Sibling-key uniqueness guard after nested child arrays are flattened. */
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
      /** Optional sibling identity; only unique finite numbers or strings are accepted. */
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
   * Serialize one child while retaining protocol markers and request-local setup ownership.
   * @param {VNodeChild} value - Trusted authored node or scalar; promises and unsupported objects reject.
   * @param {number} depth - Current traversal depth checked against the configured maximum.
   * @returns {string} Encoded subtree with every emitted byte included in the request budget.
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
    /** Structural node candidate; invalid object children are rejected below. */
    const vnode =
      value && typeof value === 'object' ? (value as VNode) : undefined;
    if (typeof value === 'function' || typeof vnode?.type === 'function') {
      /** Trusted authored component/dynamic child, never code read from the serialized payload. */
      const fn =
        typeof value === 'function'
          ? value
          : (vnode!.type as (...args: any[]) => any);
      /** Explicit setup registration; ordinary function children have no setup definition. */
      const definition = getComponentDefinition(fn);
      /** Detached inert public props; the host validator remains responsible for excluding private facts. */
      const props = vnode
        ? { ...vnode.props, children: vnode.children }
        : undefined;
      let content: string;
      /** Child setup owner registered under the request scope; failed setup disposes immediately. */
      const setupScope = createEffectScope();
      scope.add(() => setupScope.dispose());
      try {
        /** Preorder component counter shared with matching client traversal for deterministic setup IDs. */
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
        /** Attempt-local result; errors propagate before successful output can be returned. */
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
      /** Validated scalar attributes in deterministic name order; callbacks never become HTML. */
      const attrs = hydrationAttributes(vnode.props);
      /** Flattened, key-checked managed children with structural limits applied. */
      const children = flatten(vnode.children, depth);
      /** Only an approved opaque sanitizer token can supply raw fragment content. */
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
      /** Quoted attribute values encoded independently from text and script data. */
      const attributes = Object.entries(attrs)
        .map(([name, value]) => ` ${name}="${escapeHtmlAttribute(value)}"`)
        .join('');
      /** Count opening-tag bytes exactly once before accumulating child/closing output. */
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
    /** Scalar text representation; NUL and unpaired surrogates cannot round-trip through the protocol. */
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
    /** Complete candidate output; no partially rendered HTML is returned after failure. */
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
