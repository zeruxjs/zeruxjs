import { createEffectScope, effect, signal, untracked, type EffectScope } from '../reactivity/index.js';
import type { VNode, VNodeChild } from './vnode.js';
import { hydrationAttributes, hydrationTag } from './html-policy.js';
import { trustedHTMLValue } from './trusted-html.js';
import { getComponentDefinition, runComponentRender } from './component.js';
import { checkAbort, HydrationError, withComponentIds } from './hydration-protocol.js';
import { currentHydration, withHydration, claim, claimRange, finishRange, checkAttributes, cursor, mismatch, type HydrationSession } from './hydration-runtime.js';

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
const flat = (items: VNodeChild[], depth = 0): VNodeChild[] => {
  const session = currentHydration();
  if (session?.initializing && (depth > session.limits.maxDepth || items.length > session.limits.maxNodes)) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: hydration children exceed structural limits');
  const result: VNodeChild[] = [];
  for (const item of items) {
    if (Array.isArray(item)) result.push(...flat(item, depth + 1));
    else if (item != null && typeof item !== 'boolean') result.push(item);
    if (session?.initializing && result.length > session.limits.maxNodes) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: hydration child collection exceeds limit');
  }
  return result;
};
const isVNode = (value: VNodeChild): value is VNode => !!value && typeof value === 'object' && !Array.isArray(value) && 'type' in value;
// eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
const safeUrl = (value: string): boolean => !/^(?:javascript|vbscript|data|file):/i.test(value.replace(/[\u0000-\u0020\u007f]+/g, ''));
const dangerousAttr = (key: string): boolean => /^(?:innerhtml|outerhtml|srcdoc|srcset|formaction)$/i.test(key) || (/^on/i.test(key) && !/^on[A-Z]/.test(key));
const uriAttr = (key: string): boolean => /^(?:href|src|action|poster|cite|background|xlink:href)$/i.test(key);
const isEvent = (key: string): boolean => /^on[A-Z]/.test(key);
const validStyle = (value: unknown): value is Record<string, string | number> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeStyle = (value: unknown): boolean => typeof value === 'string' || typeof value === 'number' ? !/(?:expression\s*\(|url\s*\(|@import|[;{}])/i.test(String(value)) : false;

function setProp(el: Element, key: string, value: unknown): void {
  if (key === 'key' || key === 'trustedHTML' || key === 'ref' || dangerousAttr(key) || isEvent(key) || key.startsWith('bind:')) return;
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
      const hydration = currentHydration();
      if (hydration?.active) {
        const live = (el as unknown as Record<string, unknown>)[field];
        hydration.bindings.push(() => { source.value = live; });
      }
      const stop = scope.run(() => effect(() => { const next = source.value; if (!hydration?.active) setProp(el, field, next); }));
      const eventName = field === 'value' ? 'input' : 'change';
      const listener = () => { source.value = (el as unknown as Record<string, unknown>)[field]; };
      el.addEventListener(eventName, listener);
      disposers.push(() => { stop(); el.removeEventListener(eventName, listener); });
    } else if (key === 'ref') {
      if (value == null) return;
      if (typeof value === 'function') {
        disposers.push(() => (value as (node: Element | null) => void)(null));
        (value as (node: Element | null) => void)(el);
      } else if (typeof value === 'object' && 'current' in value) {
        const ref = value as { current: Element | null };
        ref.current = el;
        disposers.push(() => { if (ref.current === el) ref.current = null; });
      } else throw new TypeError('ZyroJS: ref must be a callback or current holder');
    } else if (isEvent(key)) {
      if (typeof value !== 'function') return;
      const listener = value as EventListener;
      el.addEventListener(key.slice(2).toLowerCase(), listener);
      disposers.push(() => el.removeEventListener(key.slice(2).toLowerCase(), listener));
    } else if (typeof value === 'function' && key !== 'ref') {
      disposers.push(scope.run(() => effect(() => { const next = (value as () => unknown)(); if (!(currentHydration()?.active && ['value', 'checked', 'selected'].includes(key))) setProp(el, key, next); })));
    } else if (!(currentHydration()?.active && ['value', 'checked', 'selected'].includes(key))) setProp(el, key, value);
  };
  const dispose = () => disposeAll(disposers.splice(0).reverse());
  try {
    for (const key of Object.keys(old)) if (!(key in next)) setProp(el, key, null);
    for (const [key, value] of Object.entries(next)) {
      if (key !== 'ref' && !key.startsWith('bind:') && typeof value !== 'function' && Object.is(value, old[key])) continue;
      apply(key, value);
    }
    return dispose;
  } catch (error) { dispose(); throw error; }
}
function between(start: Node, end: Node): void {
  let current: Node | null = start;
  while (current) {
    const next: Node | null = current === end ? null : current.nextSibling;
    current.parentNode?.removeChild(current);
    current = next;
  }
}
/** Move complete ranges; avoid touching already-positioned DOM (including focused inputs). */
function moveBefore(item: Mounted, parent: Node, anchor: Node | null): void {
  if (item.end.nextSibling === anchor) return;
  const doc = parent.ownerDocument;
  const focused = doc?.activeElement as HTMLElement | null;
  const input = focused as HTMLInputElement | null;
  const selection = input && typeof input.selectionStart === 'number'
    ? [input.selectionStart, input.selectionEnd, input.selectionDirection] as const : undefined;
  let node: Node | null = item.start;
  while (node) {
    const next: Node | null = node === item.end ? null : node.nextSibling;
    parent.insertBefore(node, anchor);
    node = next;
  }
  // insertBefore can clear focus in browsers; restore only an existing connected owner.
  if (focused?.isConnected && doc?.activeElement !== focused) {
    focused.focus({ preventScroll: true });
    if (selection) input?.setSelectionRange(selection[0], selection[1], selection[2] ?? undefined);
  }
}
function validateChildren(values: VNodeChild[]): void {
  const keys = new Set<unknown>();
  for (const child of values) {
    if (isVNode(child) && child.props.key !== undefined) {
      const key: unknown = child.props.key;
      if ((typeof key !== 'string' && (typeof key !== 'number' || !Number.isFinite(key))) || keys.has(key)) {
        throw new TypeError('ZyroJS: child keys must be unique finite numbers or strings');
      }
      keys.add(key);
    }
  }
}
function childrenOwner(parent: Node, anchor: Node | null, scope: EffectScope) {
  let children: Mounted[] = [];
  scope.add(() => { const old = children; children = []; disposeAll(old.map(child => () => child.destroy())); });
  const session = currentHydration();
  return (values: VNodeChild[]) => withHydration(session, () => {
    validateChildren(values);
    const available = new Set(children);
    const keyed = new Map(children.filter(child => child.key !== undefined).map(child => [child.key, child]));
    const updated: Mounted[] = [];
    try {
      for (let index = 0; index < values.length; index++) {
        const candidate = values[index];
        const key = isVNode(candidate) ? candidate.props.key : undefined;
        let old = key === undefined ? children[index] : keyed.get(key);
        if (old && (!available.has(old) || (key === undefined && old.key !== undefined))) old = undefined;
        if (old) { updated.push(reconcile(old, candidate, parent, anchor, scope)); available.delete(old); }
        else updated.push(construct(candidate, parent, anchor, scope));
      }
    } catch (error) {
      // Keep every acquired child owned even when a later sibling fails.
      children = [...new Set([...updated, ...available])];
      throw error;
    }
    children = updated;
    disposeAll([...available].map(child => () => child.destroy()));
    if (session?.active) return;
    let position = anchor;
    for (let i = updated.length - 1; i >= 0; i--) {
      moveBefore(updated[i], parent, position);
      position = updated[i].start;
    }
  });
}
function disposeAll(callbacks: (() => void)[]): void {
  const errors: unknown[] = [];
  for (const callback of callbacks) { try { callback(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, 'ZyroJS: subtree cleanup failed');
}
function releaseNode(session: HydrationSession | undefined, start: Node, end = start): void {
  if (!session || session.committed || session.created.has(start)) between(start, end);
}
/** Each node owns a scope; construction failure rolls back its partial subtree. */
function construct(value: VNodeChild, parent: Node, anchor: Node | null, owner: EffectScope): Mounted {
  const session = currentHydration();
  const counted = !!session?.initializing;
  if (counted && ++session!.depth > session!.limits.maxDepth + 1) {
    session!.depth--; throw new HydrationError('RENDER_LIMIT', 'ZyroJS: hydration component depth exceeds limit');
  }
  try { return constructNode(value, parent, anchor, owner); }
  finally { if (counted) session!.depth--; }
}
function constructNode(value: VNodeChild, parent: Node, anchor: Node | null, _owner: EffectScope): Mounted {
  if (value && typeof value === 'object' && 'then' in value) {
    throw new TypeError('ZyroJS: Promise children are unsupported; expose async state through a signal');
  }
  const session = currentHydration();
  checkAbort(session?.signal);
  if (session?.initializing && ++session.nodes > session.limits.maxNodes) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: hydration tree exceeds node limit');
  validateChildren([value]);
  const scope = createEffectScope();
  const doc = parent.ownerDocument ?? (parent as Document);
  try {
    if (Array.isArray(value) || typeof value === 'function' || (isVNode(value) && typeof value.type === 'function')) {
      const range = session?.active ? claimRange(session, parent) : undefined;
      const start = range?.start ?? doc.createComment('zyro-start');
      const marker = range?.end ?? doc.createComment('zyro');
      if (!range) { parent.insertBefore(start, anchor); parent.insertBefore(marker, anchor); }
      scope.add(() => releaseNode(session, marker));
      scope.add(() => releaseNode(session, start));
      const updateChildren = childrenOwner(parent, marker, scope);
      if (Array.isArray(value)) {
        updateChildren(flat(value));
        if (session?.active) finishRange(session, parent, marker);
        return { start, end: marker, type: Array, update(next) { updateChildren(flat(next as VNodeChild[])); }, destroy: () => scope.dispose() };
      }
      const componentVNode = isVNode(value) ? value : undefined;
      const component = componentVNode ? componentVNode.type as Function : value as Function;
      const definition = componentVNode ? getComponentDefinition(component) : undefined;
      let currentVNode = componentVNode;
      let renderComponent = component;
      const componentId = session ? ++session.components : 0;
      let setupFailed = false;
      let setupError: unknown;
      if (definition) {
        const setupScope = createEffectScope();
        scope.add(() => setupScope.dispose());
        try {
          renderComponent = setupScope.run(() => untracked(() => {
            const setup = () => definition.setup({ ...currentVNode!.props, children: currentVNode!.children });
            return session ? withComponentIds(session.prefix, componentId, setup) : setup();
          }));
          if (typeof renderComponent !== 'function') throw new TypeError('ZyroJS: setup must return a synchronous render function');
        } catch (error) {
          setupFailed = true; setupError = error;
          try { setupScope.dispose(); } catch (cleanup) { setupError = new AggregateError([error, cleanup], 'ZyroJS: setup and cleanup failed'); }
        }
      }
      const revision = signal(0);
      scope.run(() => effect(() => {
        void revision.value;
        checkAbort(session?.signal);
        try {
          if (setupFailed) throw setupError;
          const result = runComponentRender(() => currentVNode
            ? renderComponent({ ...currentVNode.props, children: currentVNode.children }) : renderComponent());
          checkAbort(session?.signal);
          updateChildren([result]);
        } catch (error) {
          if (error instanceof HydrationError || !definition?.onError) throw error;
          // Fall back outside the failed execution; fallback failures propagate normally.
          updateChildren([untracked(() => definition.onError!(error))]);
        }
      }));
      if (session?.active) finishRange(session, parent, marker);
      if (componentVNode) componentVNode.el = start;
      return { start, end: marker, type: component, key: componentVNode?.props.key,
        update(next) {
          if (isVNode(next)) { currentVNode = next; next.el = start; revision.value = revision.peek() + 1; }
        }, destroy: () => scope.dispose() };
    }
    if (isVNode(value)) {
      if (typeof value.type !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(value.type)) throw new TypeError('Invalid ZyroJS element name');
      if (session?.initializing) {
        if (!hydrationTag(value.type)) throw new HydrationError('UNSUPPORTED_TAG', 'ZyroJS: unsupported hydratable HTML tag');
        if (!session.active) untracked(() => hydrationAttributes(value.props));
      }
      let currentVNode = value;
      const el = session?.active ? claim(session, parent, 1, value.type) as Element : doc.createElement(value.type);
      if (session?.active) untracked(() => checkAttributes(session, el, value.props));
      else parent.insertBefore(el, anchor);
      scope.add(() => releaseNode(session, el));
      let propDispose: () => void = () => {};
      scope.add(() => propDispose());
      const updateChildren = childrenOwner(el, null, scope);
      let raw = trustedHTMLValue(value.props, flat(value.children).length > 0);
      propDispose = patchProperties(el, value.props, {}, scope);
      if (raw !== undefined) {
        if (session?.active) {
          if (el.innerHTML !== raw) mismatch(session, 'opaque-html', el);
          session.cursors.set(el, null);
        } else el.innerHTML = raw;
      } else updateChildren(flat(value.children));
      if (session?.active && cursor(session, el)) mismatch(session, 'end-of-element', cursor(session, el));
      value.el = el;
      return { start: el, end: el, key: value.props.key, type: value.type,
        update(next) {
          if (!isVNode(next)) return;
          validateChildren(flat(next.children));
          const nextRaw = trustedHTMLValue(next.props, flat(next.children).length > 0);
          propDispose();
          propDispose = () => {};
          propDispose = patchProperties(el, next.props, currentVNode.props, scope);
          if (nextRaw !== undefined) { updateChildren([]); if (raw !== nextRaw) el.innerHTML = nextRaw; }
          else { if (raw !== undefined) el.textContent = ''; updateChildren(flat(next.children)); }
          raw = nextRaw;
          next.el = el; currentVNode = next;
        }, destroy: () => scope.dispose() };
    }
    if (value !== null && typeof value === 'object') throw new TypeError('ZyroJS: invalid child value');
    const expectedText = value == null || typeof value === 'boolean' ? '' : String(value);
    let text: Node;
    if (session?.active) {
      session.textMarkers.push(claim(session, parent, 8, 'zyro-text'));
      if (expectedText === '' && cursor(session, parent)?.nodeType !== 3) {
        text = doc.createTextNode(''); parent.insertBefore(text, cursor(session, parent)); session.created.add(text);
      } else {
        text = claim(session, parent, 3, 'text');
        if (text.textContent !== expectedText) mismatch(session, 'text-content', text);
      }
    } else { text = doc.createTextNode(expectedText); parent.insertBefore(text, anchor); }
    scope.add(() => releaseNode(session, text));
    return { start: text, end: text, type: '#text', update(next) { text.textContent = next == null || typeof next === 'boolean' ? '' : String(next); }, destroy: () => scope.dispose() };
  } catch (error) {
    try { scope.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'ZyroJS: construction and cleanup failed'); }
    throw error;
  }
}
function kind(value: VNodeChild): unknown { return Array.isArray(value) ? Array : isVNode(value) ? value.type : typeof value === 'function' ? value : '#text'; }
function reconcile(current: Mounted, next: VNodeChild, parent: Node, anchor: Node | null, owner: EffectScope): Mounted {
  if (next && typeof next === 'object' && !isVNode(next) && !Array.isArray(next)) throw new TypeError('ZyroJS: invalid or Promise child; use a signal');
  if (current.type !== kind(next) || (isVNode(next) && next.props.key !== current.key) || (next && typeof next === 'object' && 'then' in next)) {
    const created = construct(next, parent, current.start, owner);
    try { current.destroy(); }
    catch (error) {
      try { created.destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'ZyroJS: replacement cleanup failed'); }
      throw error;
    }
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
  const root = roots.get(container);
  const manual = [...(manuallyMounted.get(container) ?? [])];
  roots.delete(container); manuallyMounted.delete(container);
  disposeAll([...(root ? [() => root.destroy()] : []), ...manual.map(item => () => item.destroy())]);
}
/** Escaped static HTML string for SSR. No implicit script, raw HTML, or hydration is supported. */
export function renderToString(value: VNodeChild): string {
  const scope = createEffectScope();
  try { return scope.run(() => untracked(() => renderStatic(value))); }
  finally { scope.dispose(); }
}
function renderStatic(value: VNodeChild): string {
  const escape = (text: unknown) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  if (value == null || typeof value === 'boolean') return '';
  if (value && typeof value === 'object' && 'then' in value) throw new TypeError('ZyroJS: Promise children are unsupported; use a signal');
  if (Array.isArray(value)) return value.map(renderStatic).join('');
  if (typeof value === 'function') return renderStatic(runComponentRender(value));
  if (!isVNode(value)) {
    if (typeof value === 'object') throw new TypeError('ZyroJS: invalid or asynchronous child; use a signal');
    return escape(value);
  }
  if (typeof value.type === 'function') {
    const definition = getComponentDefinition(value.type);
    const props = { ...value.props, children: value.children };
    try {
      const render = definition ? definition.setup(props) : value.type;
      if (typeof render !== 'function') throw new TypeError('ZyroJS: setup must return a synchronous render function');
      return renderStatic(runComponentRender(() => render(props)));
    } catch (error) {
      if (!definition?.onError) throw error;
      return renderStatic(untracked(() => definition.onError!(error)));
    }
  }
  if (!/^[a-z][a-z0-9-]*$/i.test(value.type)) throw new TypeError('Invalid element name');
  let attrs = '';
  for (const [name, raw] of Object.entries(value.props)) {
    if (name === 'key' || name === 'trustedHTML' || name === 'ref' || name === 'style' || name.startsWith('bind:') || dangerousAttr(name) || isEvent(name)) continue;
    const val: unknown = typeof raw === 'function' ? raw() : raw;
    if (val == null || val === false || (uriAttr(name) && !safeUrl(String(val)))) continue;
    const attr = name === 'className' ? 'class' : name;
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(attr)) continue;
    attrs += val === true ? ` ${attr}` : ` ${attr}="${escape(val)}"`;
  }
  const raw = trustedHTMLValue(value.props, flat(value.children).length > 0);
  const children = raw ?? flat(value.children).map(renderStatic).join('');
  if (/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(value.type)) return `<${value.type}${attrs}>`;
  return `<${value.type}${attrs}>${children}</${value.type}>`;
}

/** @internal Adopt a validated protocol tree into the existing reconciler. */
export function adoptHydrationRoot(value: VNodeChild, container: Node, session: HydrationSession, start: Node, end: Node): void {
  if (roots.has(container) || manuallyMounted.get(container)?.size) throw new HydrationError('ROOT_OWNED', 'ZyroJS: hydration requires an unowned container');
  let item: Mounted | undefined;
  try {
    item = withHydration(session, () => construct(value, container, end, createEffectScope()));
    if (cursor(session, container) !== end) mismatch(session, 'root-end', cursor(session, container));
    checkAbort(session.signal);
    session.active = false; session.initializing = false; session.committed = true;
    for (const marker of session.textMarkers) marker.parentNode?.removeChild(marker);
    roots.set(container, {start, end, type: item.type, key: item.key, update(next) { withHydration(session, () => item!.update(next)); }, destroy() {
      disposeAll([() => item!.destroy(), () => between(start, start), () => between(end, end)]);
    }});
  } catch (error) {
    try { item?.destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'ZyroJS: hydration and cleanup failed'); }
    throw error;
  }
}
/** @internal Explicit mismatch recovery uses normal mounting with the same deterministic ID scope. */
export function replaceHydrationRoot(value: VNodeChild, container: Node, session: HydrationSession): void {
  if (roots.has(container) || manuallyMounted.get(container)?.size) throw new HydrationError('ROOT_OWNED', 'ZyroJS: replacement requires an unowned container');
  session.active = false; session.initializing = true; session.committed = true; session.components = 0; session.nodes = 0; session.depth = 0;
  while (container.childNodes.length) container.removeChild(container.childNodes[0]);
  try { roots.set(container, withHydration(session, () => construct(value, container, null, createEffectScope()))); }
  finally { session.initializing = false; }
}
export function hydrationRootOwned(container: Node): boolean { return roots.has(container) || !!manuallyMounted.get(container)?.size; }

/** @internal Tie abort listeners to the exact mounted owner, not to a process-global registry. */
export function attachHydrationCleanup(container: Node, cleanup: () => void): () => void {
  const item = roots.get(container);
  if (!item) throw new HydrationError('ROOT_MISSING', 'ZyroJS: hydration root unavailable');
  const owner: Mounted = {...item, destroy() { try { item.destroy(); } finally { cleanup(); } }};
  roots.set(container, owner);
  return () => { if (roots.get(container) === owner) unmount(container); };
}
