import { hydrationAttributes, hydrationTag } from './dom/html-policy.js';
import { trustedHTMLValue } from './dom/trusted-html.js';
import { escapeHtmlText, escapeHtmlAttribute } from '@zeruxjs/security/encoding';
import { createEffectScope, untracked } from './reactivity/effect.js';
import { h, type VNodeChild, type VNode } from './dom/vnode.js';
import { getComponentDefinition, runComponentRender, type Component } from './dom/component.js';
import { checkAbort, hydrationLimits, publicProps, serializeHydrationData, validatePrefix, withComponentIds, HydrationError, type HydrationLimits, type HydrationPolicy } from './dom/hydration-protocol.js';
export * from './component.js';
export { HydrationError, HYDRATION_VERSION } from './dom/hydration-protocol.js';
export interface ServerRenderOptions<P> extends HydrationPolicy<P>, HydrationLimits { idPrefix: string }
export interface HydratableOutput { readonly version: 1; readonly html: string; readonly data: string; readonly idPrefix: string }
const voidTag = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
/** Synchronous whole-root SSR with versioned markers and separately encoded, validated public props. */
export function renderToHydratable<P extends Record<string, any>>(component: Component<P>, input: unknown, options: ServerRenderOptions<P>): HydratableOutput {
  if (typeof component !== 'function') throw new TypeError('ZyroJS: a component is required');
  validatePrefix(options?.idPrefix);
  const {validateProps, signal, idPrefix, ...limitInput} = options;
  const limits = hydrationLimits(limitInput);
  const props = publicProps(input, {validateProps, signal}, limits.maxPropsBytes);
  const data = serializeHydrationData({version: 1, idPrefix, props}, limits.maxPropsBytes);
  const scope = createEffectScope(); let nodes = 0, components = 0, bytes = 0;
  const emit = (text: string) => {
    bytes += new TextEncoder().encode(text).length;
    if (bytes > limits.maxBytes) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: server HTML exceeds byte limit');
    return text;
  };
  const flatten = (values: VNodeChild[], depth: number): VNodeChild[] => {
    if (depth > limits.maxDepth || values.length > limits.maxNodes) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: child collection exceeds limit');
    const result: VNodeChild[] = [];
    const keys = new Set<unknown>();
    for (const value of values) {
      if (Array.isArray(value)) result.push(...flatten(value, depth + 1));
      else if (value != null && typeof value !== 'boolean') result.push(value);
      if (result.length > limits.maxNodes) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: child collection exceeds limit');
    }
    for (const value of result) {
      const key: unknown = value && typeof value === 'object' && 'props' in value ? value.props.key : undefined;
      if (key !== undefined) {
        if ((typeof key !== 'string' && (typeof key !== 'number' || !Number.isFinite(key))) || keys.has(key)) throw new HydrationError('INVALID_KEY', 'ZyroJS: invalid or duplicate hydration key');
        keys.add(key);
      }
    }
    return result;
  };
  const render = (value: VNodeChild, depth: number): string => {
    checkAbort(signal);
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: server tree exceeds limit');
    if (value && typeof value === 'object' && 'then' in value) throw new HydrationError('ASYNC_CHILD', 'ZyroJS: asynchronous hydration children are unsupported');
    if (Array.isArray(value)) return emit('<!--zyro-start-->') + flatten(value, depth).map(child => render(child, depth + 1)).join('') + emit('<!--zyro-->');
    const vnode = value && typeof value === 'object' ? value as VNode : undefined;
    if (typeof value === 'function' || typeof vnode?.type === 'function') {
      const fn = typeof value === 'function' ? value : vnode!.type as ((...args: any[]) => any);
      const definition = getComponentDefinition(fn);
      const props = vnode ? {...vnode.props, children: vnode.children} : undefined;
      let content: string;
      const setupScope = createEffectScope();
      scope.add(() => setupScope.dispose());
      try {
        const componentId = ++components;
        let run: ((...args: any[]) => any);
        try { run = definition ? setupScope.run(() => withComponentIds(idPrefix, componentId, () => definition.setup(props))) : fn; }
        catch (error) { setupScope.dispose(); throw error; }
        if (typeof run !== 'function') throw new HydrationError('INVALID_SETUP', 'ZyroJS: setup must return a render function');
        const result = runComponentRender(() => run(props));
        checkAbort(signal);
        content = render(result, depth + 1);
      } catch (error) {
        checkAbort(signal);
        if (error instanceof HydrationError || !definition?.onError) throw error;
        content = render(untracked(() => definition.onError!(error)), depth + 1);
      }
      checkAbort(signal);
      return emit('<!--zyro-start-->') + content + emit('<!--zyro-->');
    }
    if (vnode) {
      if (!hydrationTag(vnode.type)) throw new HydrationError('UNSUPPORTED_TAG', 'ZyroJS: unsupported hydratable HTML tag');
      const attrs = hydrationAttributes(vnode.props);
      const children = flatten(vnode.children, depth);
      const raw = trustedHTMLValue(vnode.props, children.length > 0);
      if (raw !== undefined && voidTag.test(vnode.type)) throw new HydrationError('INVALID_TRUSTED_HTML', 'ZyroJS: void elements cannot own opaque HTML');
      if (voidTag.test(vnode.type) && children.length) throw new HydrationError('INVALID_CHILDREN', 'ZyroJS: void elements cannot have children');
      const attributes = Object.entries(attrs).map(([name, value]) => ` ${name}="${escapeHtmlAttribute(value)}"`).join('');
      const open = emit(`<${vnode.type}${attributes}>`);
      return voidTag.test(vnode.type) ? open : open + (raw === undefined ? children.map(child => render(child, depth + 1)).join('') : emit(raw)) + emit(`</${vnode.type}>`);
    }
    if (value !== null && typeof value === 'object') throw new HydrationError('INVALID_CHILD', 'ZyroJS: invalid hydration child');
    const text = value == null || typeof value === 'boolean' ? '' : String(value);
    if (text.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) throw new HydrationError('INVALID_TEXT', 'ZyroJS: invalid Unicode hydration text');
    return emit('<!--zyro-text-->') + emit(escapeHtmlText(text).replace(/\r/g, '&#13;'));
  };
  try {
    const html = scope.run(() => untracked(() => emit(`<!--zyro-h1:${idPrefix}-->`) + render(h(component, props), 0) + emit('<!--/zyro-h1-->')));
    checkAbort(signal);
    return Object.freeze({version: 1, html, data, idPrefix});
  } finally { scope.dispose(); }
}
