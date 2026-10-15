import { createEffectScope, effect, type EffectScope } from '../reactivity/index.js';
import type { VNode, VNodeChild } from './vnode.js';

interface Mounted {
  readonly start: Node;
  readonly end: Node;
  readonly key?: unknown;
  readonly type: unknown;
  update(next: VNodeChild): void;
  destroy(): void;
}
const roots = new WeakMap<Node, Mounted>();
const manuallyMounted = new WeakMap<Node, Set<Mounted>>();
const flat = (items: VNodeChild[]): VNodeChild[] => {
  const result: VNodeChild[] = [];
  for (const item of items) {
    if (Array.isArray(item)) result.push(...flat(item));
    else if (item != null && typeof item !== 'boolean') result.push(item);
  }
  return result;
};
const isVNode = (value: VNodeChild): value is VNode => !!value && typeof value === 'object' && !Array.isArray(value) && 'type' in value;
const safeUrl = (value: string): boolean => !/^(?:javascript|vbscript|data|file):/i.test(value.replace(/[\u0000-\u0020\u007f]+/g, ''));
const dangerousAttr = (key: string): boolean => /^(?:innerhtml|outerhtml|srcdoc|srcset|formaction)$/i.test(key) || (/^on/i.test(key) && !/^on[A-Z]/.test(key));
const uriAttr = (key: string): boolean => /^(?:href|src|action|poster|cite|background|xlink:href)$/i.test(key);
const isEvent = (key: string): boolean => /^on[A-Z]/.test(key);
const validStyle = (value: unknown): value is Record<string, string | number> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeStyle = (value: unknown): boolean => typeof value === 'string' || typeof value === 'number' ? !/(?:expression\s*\(|url\s*\(|@import|[;{}])/i.test(String(value)) : false;

function setProp(el: Element, key: string, value: unknown): void {
  if (key === 'key' || key === 'ref' || dangerousAttr(key) || isEvent(key) || key.startsWith('bind:')) return;
  if (key === 'style') {
    const style = (el as HTMLElement).style;
    if (!style) return;
    style.cssText = '';
    if (validStyle(value)) for (const [name, part] of Object.entries(value)) {
      if (!/^(?:--[\w-]+|[a-zA-Z][\w-]*)$/.test(name) || !safeStyle(part)) continue;
      if (name.startsWith('--') || name.includes('-')) style.setProperty(name, String(part));
      else (style as unknown as Record<string, unknown>)[name] = part;
    }
    return;
  }
  if (key === 'textContent') { el.textContent = value == null ? '' : String(value); return; }
  if (key === 'value' || key === 'checked' || key === 'selected') {
    (el as unknown as Record<string, unknown>)[key] = value ?? (key === 'value' ? '' : false);
    return;
  }
  const name = key === 'className' ? 'class' : key;
  if (uriAttr(name) && value != null && !safeUrl(String(value))) { el.removeAttribute(name); return; }
  if (value === false || value == null) el.removeAttribute(name);
  else if (value === true) el.setAttribute(name, '');
  else el.setAttribute(name, String(value));
}
function patchProperties(el: Element, next: Record<string, unknown>, old: Record<string, unknown>, scope: EffectScope): () => void {
  const disposers: (() => void)[] = [];
  const apply = (key: string, value: unknown) => {
    if ((key === 'bind:value' || key === 'bind:checked') && value && typeof value === 'object' && 'value' in value) {
      const field = key === 'bind:value' ? 'value' : 'checked';
      const source = value as { value: unknown };
      const stop = scope.run(() => effect(() => setProp(el, field, source.value)));
      const eventName = field === 'value' ? 'input' : 'change';
      const listener = () => { source.value = (el as unknown as Record<string, unknown>)[field]; };
      el.addEventListener(eventName, listener);
      disposers.push(() => { stop(); el.removeEventListener(eventName, listener); });
    } else if (isEvent(key)) {
      if (typeof value !== 'function') return;
      const listener = value as EventListener;
      el.addEventListener(key.slice(2).toLowerCase(), listener);
      disposers.push(() => el.removeEventListener(key.slice(2).toLowerCase(), listener));
    } else if (typeof value === 'function' && key !== 'ref') {
      disposers.push(scope.run(() => effect(() => { setProp(el, key, (value as () => unknown)()); })));
    } else setProp(el, key, value);
  };
  for (const key of Object.keys(old)) if (!(key in next)) setProp(el, key, null);
  for (const [key, value] of Object.entries(next)) apply(key, value);
  return () => { for (const stop of disposers.reverse()) stop(); };
}
function between(start: Node, end: Node): void {
  let current: Node | null = start;
  while (current) {
    const next: Node | null = current === end ? null : current.nextSibling;
    current.parentNode?.removeChild(current);
    current = next;
  }
}
function moveBefore(item: Mounted, parent: Node, anchor: Node | null): void {
  let node: Node | null = item.start;
  while (node) {
    const next: Node | null = node === item.end ? null : node.nextSibling;
    parent.insertBefore(node, anchor);
    node = next;
  }
}
function construct(value: VNodeChild, parent: Node, anchor: Node | null, owner: EffectScope): Mounted {
  const doc = parent.ownerDocument ?? (parent as Document);
  if (typeof value === 'function') {
    const compute = value;
    const marker = doc.createComment('zyro');
    parent.insertBefore(marker, anchor);
    const scope = createEffectScope();
    let child: Mounted | undefined;
    scope.run(() => effect(() => {
      const next = compute();
      if (child) child = reconcile(child, next, parent, marker, scope);
      else child = construct(next, parent, marker, scope);
    }));
    return { get start() { return child?.start ?? marker; }, end: marker, type: compute, update() {}, destroy() { scope.dispose(); child?.destroy(); between(marker, marker); } };
  }
  if (isVNode(value)) {
    if (typeof value.type === 'function') {
      let currentVNode = value;
      const component = value.type;
      const scope = createEffectScope();
      const marker = doc.createComment('zyro-component');
      parent.insertBefore(marker, anchor);
      let child: Mounted | undefined;
      scope.run(() => effect(() => {
        const result = component({ ...currentVNode.props, children: currentVNode.children });
        child = child ? reconcile(child, result, parent, marker, scope) : construct(result, parent, marker, scope);
      }));
      value.el = child?.start ?? marker;
      return { get start() { return child?.start ?? marker; }, end: marker, type: component, key: currentVNode.props.key, update(next) {
        if (!isVNode(next)) return;
        // A component's passed props can change without changing the function identity.
        currentVNode = next;
        const result = component({ ...next.props, children: next.children });
        child = child ? reconcile(child, result, parent, marker, scope) : construct(result, parent, marker, scope);
      }, destroy() { scope.dispose(); child?.destroy(); between(marker, marker); } };
    }
    if (!/^[a-z][a-z0-9-]*$/i.test(value.type)) throw new TypeError('Invalid ZyroJS element name');
    let currentVNode = value;
    const el = doc.createElement(value.type);
    parent.insertBefore(el, anchor);
    const scope = createEffectScope();
    let children: Mounted[] = [];
    let propDispose = patchProperties(el, value.props, {}, scope);
    for (const child of flat(value.children)) children.push(construct(child, el, null, scope));
    value.el = el;
    return {
      start: el, end: el, key: value.props.key, type: value.type,
      update(next) {
        if (!isVNode(next)) return;
        propDispose();
        propDispose = patchProperties(el, next.props, currentVNode.props, scope);
        const values = flat(next.children);
        const available = new Set(children);
        const updated: Mounted[] = [];
        // Stable keys reuse DOM state and event ownership; unkeyed children reconcile by position.
        for (let index = 0; index < values.length; index++) {
          const candidate = values[index];
          const key = isVNode(candidate) ? candidate.props.key : undefined;
          let old = key === undefined ? children[index] : children.find(item => item.key === key);
          if (old && !available.has(old)) old = undefined;
          if (old) { available.delete(old); updated.push(reconcile(old, candidate, el, null, scope)); }
          else updated.push(construct(candidate, el, null, scope));
        }
        for (const child of available) child.destroy();
        let position: Node | null = null;
        for (let i = updated.length - 1; i >= 0; i--) {
          moveBefore(updated[i], el, position);
          position = updated[i].start;
        }
        children = updated;
        next.el = el;
        currentVNode = next;
      },
      destroy() { propDispose(); scope.dispose(); for (const child of children) child.destroy(); between(el, el); }
    };
  }
  const text = doc.createTextNode(value == null || typeof value === 'boolean' ? '' : String(value));
  parent.insertBefore(text, anchor);
  return { start: text, end: text, type: '#text', update(next) { text.textContent = next == null || typeof next === 'boolean' ? '' : String(next); }, destroy() { between(text, text); } };
}
function kind(value: VNodeChild): unknown { return isVNode(value) ? value.type : typeof value === 'function' ? value : '#text'; }
function reconcile(current: Mounted, next: VNodeChild, parent: Node, anchor: Node | null, owner: EffectScope): Mounted {
  if (current.type !== kind(next) || (isVNode(next) && next.props.key !== current.key)) {
    const created = construct(next, parent, current.start, owner);
    current.destroy();
    return created;
  }
  current.update(next);
  return current;
}
/** Mount an additional subtree. Call unmount(container) to clear both root and manually-mounted trees. */
export function mount(vnode: VNodeChild, container: Node): Node | undefined {
  const scope = createEffectScope();
  const item = construct(vnode, container, null, scope);
  let items = manuallyMounted.get(container);
  if (!items) { items = new Set(); manuallyMounted.set(container, items); }
  items.add(item);
  return item.start;
}
/** Reconcile a managed root; keyed child nodes retain their browser identity. */
export function render(vnode: VNodeChild, container: Node): void {
  const previous = roots.get(container);
  if (previous) roots.set(container, reconcile(previous, vnode, container, null, createEffectScope()));
  else roots.set(container, construct(vnode, container, null, createEffectScope()));
}
/** Compatibility wrapper for the prior patch(vnode, oldVNode) API. */
export function patch(container: Node, vnode: VNodeChild, _oldVNode?: VNode): void { render(vnode, container); }
export function unmount(container: Node): void {
  roots.get(container)?.destroy(); roots.delete(container);
  for (const item of manuallyMounted.get(container) ?? []) item.destroy();
  manuallyMounted.delete(container);
}
/** Escaped static HTML string for SSR. No implicit script, raw HTML, or hydration is supported. */
export function renderToString(value: VNodeChild): string {
  const escape = (text: unknown) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  if (value == null || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(renderToString).join('');
  if (typeof value === 'function') return renderToString(value());
  if (!isVNode(value)) return escape(value);
  if (typeof value.type === 'function') return renderToString(value.type({ ...value.props, children: value.children }));
  if (!/^[a-z][a-z0-9-]*$/i.test(value.type)) throw new TypeError('Invalid element name');
  let attrs = '';
  for (const [name, raw] of Object.entries(value.props)) {
    if (name === 'key' || name === 'ref' || name === 'style' || name.startsWith('bind:') || dangerousAttr(name) || isEvent(name)) continue;
    const val: unknown = typeof raw === 'function' ? raw() : raw;
    if (val == null || val === false || (uriAttr(name) && !safeUrl(String(val)))) continue;
    const attr = name === 'className' ? 'class' : name;
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(attr)) continue;
    attrs += val === true ? ` ${attr}` : ` ${attr}="${escape(val)}"`;
  }
  const children = flat(value.children).map(renderToString).join('');
  if (/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(value.type)) return `<${value.type}${attrs}>`;
  return `<${value.type}${attrs}>${children}</${value.type}>`;
}
