import {
  createEffectScope,
  effect,
  signal,
  untracked,
  type EffectScope,
} from '../reactivity/index.js';
import type { VNode, VNodeChild } from './vnode.js';
import { hydrationAttributes, hydrationTag } from './html-policy.js';
import { trustedHTMLValue } from './trusted-html.js';
import { getComponentDefinition, runComponentRender } from './component.js';
import {
  checkAbort,
  HydrationError,
  withComponentIds,
} from './hydration-protocol.js';
import {
  currentHydration,
  withHydration,
  claim,
  claimRange,
  finishRange,
  checkAttributes,
  cursor,
  mismatch,
  type HydrationSession,
} from './hydration-runtime.js';

interface Mounted {
  /** First DOM node owned by the mounted range. */
  readonly start: Node;
  /** Last DOM node owned by the mounted range. */
  readonly end: Node;
  /** Optional keyed identity used during reconciliation. */
  readonly key?: unknown;
  /** Component or element type represented by the range. */
  readonly type: unknown;
  /** Apply a new child value to the mounted range. */
  update(next: VNodeChild): void;
  /** Dispose the mounted range and its owned effects/listeners. */
  destroy(): void;
}
/** Stores the roots value used by this module. */
const roots = new WeakMap<Node, Mounted>();
/** Stores the manuallyMounted value used by this module. */
const manuallyMounted = new WeakMap<Node, Set<Mounted>>();
/**
 * Application function flat.
 * @param {VNodeChild[]} items - Input value for this operation.
 * @param {unknown} depth - Input value for this operation.
 * @returns {VNodeChild[]} Result produced by this operation.
 */
const flat = (items: VNodeChild[], depth = 0): VNodeChild[] => {
  /** Stores the session value used by this module. */
  const session = currentHydration();
  if (
    session?.initializing &&
    (depth > session.limits.maxDepth || items.length > session.limits.maxNodes)
  ) {
    throw new HydrationError(
      'RENDER_LIMIT',
      'ZyroJS: hydration children exceed structural limits'
    );
  }
  /** Stores the result value used by this module. */
  const result: VNodeChild[] = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      result.push(...flat(item, depth + 1));
    } else if (
      item !== null &&
      item !== undefined &&
      typeof item !== 'boolean'
    ) {
      result.push(item);
    }
    if (session?.initializing && result.length > session.limits.maxNodes) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: hydration child collection exceeds limit'
      );
    }
  }
  return result;
};
/**
 * Application function isVNode.
 * @param {VNodeChild} value - Input value for this operation.
 * @returns {value is VNode} Result produced by this operation.
 */
const isVNode = (value: VNodeChild): value is VNode =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  'type' in value;
/**
 * Application function safeUrl.
 * @param {string} value - Input value for this operation.
 * @returns {boolean} Result produced by this operation.
 */
const safeUrl = (value: string): boolean =>
  !/^(?:javascript|vbscript|data|file):/i.test(
    value.replace(
      // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for URL validation.
      /[\u0000-\u0020\u007f]+/g,
      ''
    )
  );
/**
 * Application function dangerousAttr.
 * @param {string} key - Input value for this operation.
 * @returns {boolean} Result produced by this operation.
 */
const dangerousAttr = (key: string): boolean =>
  /^(?:innerhtml|outerhtml|srcdoc|srcset|formaction)$/i.test(key) ||
  (/^on/i.test(key) && !/^on[A-Z]/.test(key));
/**
 * Application function uriAttr.
 * @param {string} key - Input value for this operation.
 * @returns {boolean} Result produced by this operation.
 */
const uriAttr = (key: string): boolean =>
  /^(?:href|src|action|poster|cite|background|xlink:href)$/i.test(key);
/**
 * Application function isEvent.
 * @param {string} key - Input value for this operation.
 * @returns {boolean} Result produced by this operation.
 */
const isEvent = (key: string): boolean => /^on[A-Z]/.test(key);
/**
 * Application function validStyle.
 * @param {unknown} value - Input value for this operation.
 * @returns {value is Record<string, string | number>} Result produced by this operation.
 */
const validStyle = (value: unknown): value is Record<string, string | number> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/**
 * Application function safeStyle.
 * @param {unknown} value - Input value for this operation.
 * @returns {boolean} Result produced by this operation.
 */
const safeStyle = (value: unknown): boolean =>
  typeof value === 'string' || typeof value === 'number'
    ? !/(?:expression\s*\(|url\s*\(|@import|[;{}])/i.test(String(value))
    : false;

/**
 * setProp.
 * @param {Element} el - Input value for this operation.
 * @param {string} key - Input value for this operation.
 * @param {unknown} value - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
function setProp(el: Element, key: string, value: unknown): void {
  if (
    key === 'key' ||
    key === 'trustedHTML' ||
    key === 'ref' ||
    dangerousAttr(key) ||
    isEvent(key) ||
    key.startsWith('bind:')
  ) {
    return;
  }
  if (key === 'style') {
    /** Stores the style value used by this module. */
    const style = (el as HTMLElement).style;
    if (!style) {
      return;
    }
    style.cssText = '';
    if (validStyle(value)) {
      for (const [name, part] of Object.entries(value)) {
        if (!/^(?:--[\w-]+|[a-zA-Z][\w-]*)$/.test(name) || !safeStyle(part)) {
          continue;
        }
        if (name.startsWith('--') || name.includes('-')) {
          style.setProperty(name, String(part));
        } else {
          (style as unknown as Record<string, unknown>)[name] = part;
        }
      }
    }
    return;
  }
  if (key === 'textContent') {
    el.textContent = value === null || value === undefined ? '' : String(value);
    return;
  }
  if (key === 'value' || key === 'checked' || key === 'selected') {
    (el as unknown as Record<string, unknown>)[key] =
      value ?? (key === 'value' ? '' : false);
    return;
  }
  /** Stores the name value used by this module. */
  const name = key === 'className' ? 'class' : key;
  if (
    uriAttr(name) &&
    value !== null &&
    value !== undefined &&
    !safeUrl(String(value))
  ) {
    el.removeAttribute(name);
    return;
  }
  if (value === false || value === null || value === undefined) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, '');
  } else {
    el.setAttribute(name, String(value));
  }
}
/**
 * patchProperties.
 * @param {Element} el - Input value for this operation.
 * @param {Record<string, unknown>} next - Input value for this operation.
 * @param {Record<string, unknown>} old - Input value for this operation.
 * @param {EffectScope} scope - Input value for this operation.
 * @returns {() => void} Result produced by this operation.
 */
function patchProperties(
  el: Element,
  next: Record<string, unknown>,
  old: Record<string, unknown>,
  scope: EffectScope
): () => void {
  /** Stores the disposers value used by this module. */
  const disposers: (() => void)[] = [];
  /**
   * Application function apply.
   * @param {string} key - Input value for this operation.
   * @param {unknown} value - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const apply = (key: string, value: unknown) => {
    if (
      (key === 'bind:value' || key === 'bind:checked') &&
      value &&
      typeof value === 'object' &&
      'value' in value
    ) {
      /** Stores the field value used by this module. */
      const field = key === 'bind:value' ? 'value' : 'checked';
      /** Stores the source value used by this module. */
      const source = value as { value: unknown };
      /** Stores the hydration value used by this module. */
      const hydration = currentHydration();
      if (hydration?.active) {
        /** Stores the live value used by this module. */
        const live = (el as unknown as Record<string, unknown>)[field];
        hydration.bindings.push(() => {
          source.value = live;
        });
      }
      /** Stores the stop value used by this module. */
      const stop = scope.run(() =>
        effect(() => {
          /** Stores the next value used by this module. */
          const next = source.value;
          if (!hydration?.active) {
            setProp(el, field, next);
          }
        })
      );
      /** Stores the eventName value used by this module. */
      const eventName = field === 'value' ? 'input' : 'change';
      /**
       * Application function listener.
       * @returns {unknown} Result produced by this operation.
       */
      const listener = () => {
        source.value = (el as unknown as Record<string, unknown>)[field];
      };
      el.addEventListener(eventName, listener);
      disposers.push(() => {
        stop();
        el.removeEventListener(eventName, listener);
      });
    } else if (key === 'ref') {
      if (value === null || value === undefined) {
        return;
      }
      if (typeof value === 'function') {
        disposers.push(() => (value as (node: Element | null) => void)(null));
        (value as (node: Element | null) => void)(el);
      } else if (typeof value === 'object' && 'current' in value) {
        /** Stores the ref value used by this module. */
        const ref = value as { current: Element | null };
        ref.current = el;
        disposers.push(() => {
          if (ref.current === el) {
            ref.current = null;
          }
        });
      } else {
        throw new TypeError('ZyroJS: ref must be a callback or current holder');
      }
    } else if (isEvent(key)) {
      if (typeof value !== 'function') {
        return;
      }
      /** Stores the listener value used by this module. */
      const listener = value as EventListener;
      el.addEventListener(key.slice(2).toLowerCase(), listener);
      disposers.push(() =>
        el.removeEventListener(key.slice(2).toLowerCase(), listener)
      );
    } else if (typeof value === 'function' && key !== 'ref') {
      disposers.push(
        scope.run(() =>
          effect(() => {
            /** Stores the next value used by this module. */
            const next = (value as () => unknown)();
            if (
              !(
                currentHydration()?.active &&
                ['value', 'checked', 'selected'].includes(key)
              )
            ) {
              setProp(el, key, next);
            }
          })
        )
      );
    } else if (
      !(
        currentHydration()?.active &&
        ['value', 'checked', 'selected'].includes(key)
      )
    ) {
      setProp(el, key, value);
    }
  };
  /**
   * Application function dispose.
   * @returns {unknown} Result produced by this operation.
   */
  const dispose = () => disposeAll(disposers.splice(0).reverse());
  try {
    for (const key of Object.keys(old)) {
      if (!(key in next)) {
        setProp(el, key, null);
      }
    }
    for (const [key, value] of Object.entries(next)) {
      if (
        key !== 'ref' &&
        !key.startsWith('bind:') &&
        typeof value !== 'function' &&
        Object.is(value, old[key])
      ) {
        continue;
      }
      apply(key, value);
    }
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
/**
 * between.
 * @param {Node} start - Input value for this operation.
 * @param {Node} end - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
function between(start: Node, end: Node): void {
  let current: Node | null = start;
  while (current) {
    /** Stores the next value used by this module. */
    const next: Node | null = current === end ? null : current.nextSibling;
    current.parentNode?.removeChild(current);
    current = next;
  }
}
/** Move complete ranges; avoid touching already-positioned DOM (including focused inputs). */
/**
 * moveBefore.
 * @param {Mounted} item - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @param {Node | null} anchor - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
function moveBefore(item: Mounted, parent: Node, anchor: Node | null): void {
  if (item.end.nextSibling === anchor) {
    return;
  }
  /** Stores the doc value used by this module. */
  const doc = parent.ownerDocument;
  /** Stores the focused value used by this module. */
  const focused = doc?.activeElement as HTMLElement | null;
  /** Stores the input value used by this module. */
  const input = focused as HTMLInputElement | null;
  /** Stores the selection value used by this module. */
  const selection =
    input && typeof input.selectionStart === 'number'
      ? ([
          input.selectionStart,
          input.selectionEnd,
          input.selectionDirection,
        ] as const)
      : undefined;
  let node: Node | null = item.start;
  while (node) {
    /** Stores the next value used by this module. */
    const next: Node | null = node === item.end ? null : node.nextSibling;
    parent.insertBefore(node, anchor);
    node = next;
  }
  // insertBefore can clear focus in browsers; restore only an existing connected owner.
  if (focused?.isConnected && doc?.activeElement !== focused) {
    focused.focus({ preventScroll: true });
    if (selection) {
      input?.setSelectionRange(
        selection[0],
        selection[1],
        selection[2] ?? undefined
      );
    }
  }
}
/**
 * validateChildren.
 * @param {VNodeChild[]} values - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
function validateChildren(values: VNodeChild[]): void {
  /** Stores the keys value used by this module. */
  const keys = new Set<unknown>();
  for (const child of values) {
    if (isVNode(child) && child.props.key !== undefined) {
      /** Stores the key value used by this module. */
      const key: unknown = child.props.key;
      if (
        (typeof key !== 'string' &&
          (typeof key !== 'number' || !Number.isFinite(key))) ||
        keys.has(key)
      ) {
        throw new TypeError(
          'ZyroJS: child keys must be unique finite numbers or strings'
        );
      }
      keys.add(key);
    }
  }
}
/**
 * childrenOwner.
 * @param {Node} parent - Input value for this operation.
 * @param {Node | null} anchor - Input value for this operation.
 * @param {EffectScope} scope - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
 */
function childrenOwner(parent: Node, anchor: Node | null, scope: EffectScope) {
  let children: Mounted[] = [];
  scope.add(() => {
    /** Stores the old value used by this module. */
    const old = children;
    children = [];
    disposeAll(old.map((child) => () => child.destroy()));
  });
  /** Stores the session value used by this module. */
  const session = currentHydration();
  return (values: VNodeChild[]) =>
    withHydration(session, () => {
      validateChildren(values);
      /** Stores the available value used by this module. */
      const available = new Set(children);
      /** Stores the keyed value used by this module. */
      const keyed = new Map(
        children
          .filter((child) => child.key !== undefined)
          .map((child) => [child.key, child])
      );
      /** Stores the updated value used by this module. */
      const updated: Mounted[] = [];
      try {
        for (let index = 0; index < values.length; index++) {
          /** Stores the candidate value used by this module. */
          const candidate = values[index];
          /** Stores the key value used by this module. */
          const key = isVNode(candidate) ? candidate.props.key : undefined;
          let old = key === undefined ? children[index] : keyed.get(key);
          if (
            old &&
            (!available.has(old) ||
              (key === undefined && old.key !== undefined))
          ) {
            old = undefined;
          }
          if (old) {
            updated.push(reconcile(old, candidate, parent, anchor, scope));
            available.delete(old);
          } else {
            updated.push(construct(candidate, parent, anchor, scope));
          }
        }
      } catch (error) {
        // Keep every acquired child owned even when a later sibling fails.
        children = [...new Set([...updated, ...available])];
        throw error;
      }
      children = updated;
      disposeAll([...available].map((child) => () => child.destroy()));
      if (session?.active) {
        return;
      }
      let position = anchor;
      for (let i = updated.length - 1; i >= 0; i--) {
        // Move each retained child backward so its final order matches the VNode list.
        /** Stores the child value used by this module. */
        const child = updated[i];
        if (!child) {
          continue;
        }
        moveBefore(child, parent, position);
        position = child.start;
      }
    });
}
/**
 * disposeAll.
 * @param {(() => void)[]} callbacks - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
function disposeAll(callbacks: (() => void)[]): void {
  /** Stores the errors value used by this module. */
  const errors: unknown[] = [];
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(errors, 'ZyroJS: subtree cleanup failed');
  }
}
/**
 * releaseNode.
 * @param {HydrationSession | undefined} session - Input value for this operation.
 * @param {Node} start - Input value for this operation.
 * @param {unknown} end - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
function releaseNode(
  session: HydrationSession | undefined,
  start: Node,
  end = start
): void {
  if (!session || session.committed || session.created.has(start)) {
    between(start, end);
  }
}
/** Each node owns a scope; construction failure rolls back its partial subtree. */
/**
 * construct.
 * @param {VNodeChild} value - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @param {Node | null} anchor - Input value for this operation.
 * @param {EffectScope} owner - Input value for this operation.
 * @returns {Mounted} Result produced by this operation.
 */
function construct(
  value: VNodeChild,
  parent: Node,
  anchor: Node | null,
  owner: EffectScope
): Mounted {
  /** Stores the session value used by this module. */
  const session = currentHydration();
  /** Stores the counted value used by this module. */
  const counted = !!session?.initializing;
  if (counted && ++session!.depth > session!.limits.maxDepth + 1) {
    session!.depth--;
    throw new HydrationError(
      'RENDER_LIMIT',
      'ZyroJS: hydration component depth exceeds limit'
    );
  }
  try {
    return constructNode(value, parent, anchor, owner);
  } finally {
    if (counted) {
      session!.depth--;
    }
  }
}
/**
 * constructNode.
 * @param {VNodeChild} value - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @param {Node | null} anchor - Input value for this operation.
 * @param {EffectScope} _owner - Input value for this operation.
 * @returns {Mounted} Result produced by this operation.
 */
function constructNode(
  value: VNodeChild,
  parent: Node,
  anchor: Node | null,
  _owner: EffectScope
): Mounted {
  if (value && typeof value === 'object' && 'then' in value) {
    throw new TypeError(
      'ZyroJS: Promise children are unsupported; expose async state through a signal'
    );
  }
  /** Stores the session value used by this module. */
  const session = currentHydration();
  checkAbort(session?.signal);
  if (session?.initializing && ++session.nodes > session.limits.maxNodes) {
    throw new HydrationError(
      'RENDER_LIMIT',
      'ZyroJS: hydration tree exceeds node limit'
    );
  }
  validateChildren([value]);
  /** Stores the scope value used by this module. */
  const scope = createEffectScope();
  /** Stores the doc value used by this module. */
  const doc = parent.ownerDocument ?? (parent as Document);
  try {
    if (
      Array.isArray(value) ||
      typeof value === 'function' ||
      (isVNode(value) && typeof value.type === 'function')
    ) {
      /** Stores the range value used by this module. */
      const range = session?.active ? claimRange(session, parent) : undefined;
      /** Stores the start value used by this module. */
      const start = range?.start ?? doc.createComment('zyro-start');
      /** Stores the marker value used by this module. */
      const marker = range?.end ?? doc.createComment('zyro');
      if (!range) {
        parent.insertBefore(start, anchor);
        parent.insertBefore(marker, anchor);
      }
      scope.add(() => releaseNode(session, marker));
      scope.add(() => releaseNode(session, start));
      /** Stores the updateChildren value used by this module. */
      const updateChildren = childrenOwner(parent, marker, scope);
      if (Array.isArray(value)) {
        updateChildren(flat(value));
        if (session?.active) {
          finishRange(session, parent, marker);
        }
        return {
          start,
          end: marker,
          type: Array,
          /**
           * update.
           * @param {unknown} next - Input value for this operation.
           * @returns {unknown} Result produced by this operation.
           */
          update(next) {
            updateChildren(flat(next as VNodeChild[]));
          },
          destroy: () => scope.dispose(),
        };
      }
      /** Stores the componentVNode value used by this module. */
      const componentVNode = isVNode(value) ? value : undefined;
      /** Stores the component value used by this module. */
      const component = componentVNode
        ? (componentVNode.type as (...args: any[]) => any)
        : (value as (...args: any[]) => any);
      /** Stores the definition value used by this module. */
      const definition = componentVNode
        ? getComponentDefinition(component)
        : undefined;
      let currentVNode = componentVNode;
      let renderComponent = component;
      /** Stores the componentId value used by this module. */
      const componentId = session ? ++session.components : 0;
      let setupFailed = false;
      let setupError: unknown;
      if (definition) {
        /** Stores the setupScope value used by this module. */
        const setupScope = createEffectScope();
        scope.add(() => setupScope.dispose());
        try {
          renderComponent = setupScope.run(() =>
            untracked(() => {
              /**
               * Application function setup.
               * @returns {unknown} Result produced by this operation.
               */
              const setup = () =>
                definition.setup({
                  ...currentVNode!.props,
                  children: currentVNode!.children,
                });
              return session
                ? withComponentIds(session.prefix, componentId, setup)
                : setup();
            })
          );
          if (typeof renderComponent !== 'function') {
            throw new TypeError(
              'ZyroJS: setup must return a synchronous render function'
            );
          }
        } catch (error) {
          setupFailed = true;
          setupError = error;
          try {
            setupScope.dispose();
          } catch (cleanup) {
            setupError = new AggregateError(
              [error, cleanup],
              'ZyroJS: setup and cleanup failed'
            );
          }
        }
      }
      /** Stores the revision value used by this module. */
      const revision = signal(0);
      scope.run(() =>
        effect(() => {
          void revision.value;
          checkAbort(session?.signal);
          try {
            if (setupFailed) {
              throw setupError;
            }
            /** Stores the result value used by this module. */
            const result = runComponentRender(() =>
              currentVNode
                ? renderComponent({
                    ...currentVNode.props,
                    children: currentVNode.children,
                  })
                : renderComponent()
            );
            checkAbort(session?.signal);
            updateChildren([result]);
          } catch (error) {
            if (error instanceof HydrationError || !definition?.onError) {
              throw error;
            }
            // Fall back outside the failed execution; fallback failures propagate normally.
            updateChildren([untracked(() => definition.onError!(error))]);
          }
        })
      );
      if (session?.active) {
        finishRange(session, parent, marker);
      }
      if (componentVNode) {
        componentVNode.el = start;
      }
      return {
        start,
        end: marker,
        type: component,
        key: componentVNode?.props.key,
        /**
         * update.
         * @param {unknown} next - Input value for this operation.
         * @returns {unknown} Result produced by this operation.
         */
        update(next) {
          if (isVNode(next)) {
            currentVNode = next;
            next.el = start;
            revision.value = revision.peek() + 1;
          }
        },
        destroy: () => scope.dispose(),
      };
    }
    if (isVNode(value)) {
      if (
        typeof value.type !== 'string' ||
        !/^[a-z][a-z0-9-]*$/i.test(value.type)
      ) {
        throw new TypeError('Invalid ZyroJS element name');
      }
      if (session?.initializing) {
        if (!hydrationTag(value.type)) {
          throw new HydrationError(
            'UNSUPPORTED_TAG',
            'ZyroJS: unsupported hydratable HTML tag'
          );
        }
        if (!session.active) {
          untracked(() => hydrationAttributes(value.props));
        }
      }
      let currentVNode = value;
      /** Stores the el value used by this module. */
      const el = session?.active
        ? (claim(session, parent, 1, value.type) as Element)
        : doc.createElement(value.type);
      if (session?.active) {
        untracked(() => checkAttributes(session, el, value.props));
      } else {
        parent.insertBefore(el, anchor);
      }
      scope.add(() => releaseNode(session, el));
      let propDispose: () => void = () => {};
      scope.add(() => propDispose());
      /** Stores the updateChildren value used by this module. */
      const updateChildren = childrenOwner(el, null, scope);
      let raw = trustedHTMLValue(value.props, flat(value.children).length > 0);
      propDispose = patchProperties(el, value.props, {}, scope);
      if (raw !== undefined) {
        if (session?.active) {
          if (el.innerHTML !== raw) {
            mismatch(session, 'opaque-html', el);
          }
          session.cursors.set(el, null);
        } else {
          el.innerHTML = raw;
        }
      } else {
        updateChildren(flat(value.children));
      }
      if (session?.active && cursor(session, el)) {
        mismatch(session, 'end-of-element', cursor(session, el));
      }
      value.el = el;
      return {
        start: el,
        end: el,
        key: value.props.key,
        type: value.type,
        /**
         * update.
         * @param {unknown} next - Input value for this operation.
         * @returns {unknown} Result produced by this operation.
         */
        update(next) {
          if (!isVNode(next)) {
            return;
          }
          validateChildren(flat(next.children));
          /** Stores the nextRaw value used by this module. */
          const nextRaw = trustedHTMLValue(
            next.props,
            flat(next.children).length > 0
          );
          propDispose();
          propDispose = () => {};
          propDispose = patchProperties(
            el,
            next.props,
            currentVNode.props,
            scope
          );
          if (nextRaw !== undefined) {
            updateChildren([]);
            if (raw !== nextRaw) {
              el.innerHTML = nextRaw;
            }
          } else {
            if (raw !== undefined) {
              el.textContent = '';
            }
            updateChildren(flat(next.children));
          }
          raw = nextRaw;
          next.el = el;
          currentVNode = next;
        },
        destroy: () => scope.dispose(),
      };
    }
    if (value !== null && typeof value === 'object') {
      throw new TypeError('ZyroJS: invalid child value');
    }
    /** Stores the expectedText value used by this module. */
    const expectedText =
      value === null || value === undefined || typeof value === 'boolean'
        ? ''
        : String(value);
    let text: Node;
    if (session?.active) {
      session.textMarkers.push(claim(session, parent, 8, 'zyro-text'));
      if (expectedText === '' && cursor(session, parent)?.nodeType !== 3) {
        text = doc.createTextNode('');
        parent.insertBefore(text, cursor(session, parent));
        session.created.add(text);
      } else {
        text = claim(session, parent, 3, 'text');
        if (text.textContent !== expectedText) {
          mismatch(session, 'text-content', text);
        }
      }
    } else {
      text = doc.createTextNode(expectedText);
      parent.insertBefore(text, anchor);
    }
    scope.add(() => releaseNode(session, text));
    return {
      start: text,
      end: text,
      type: '#text',
      /**
       * update.
       * @param {unknown} next - Input value for this operation.
       * @returns {unknown} Result produced by this operation.
       */
      update(next) {
        text.textContent =
          next === null || next === undefined || typeof next === 'boolean'
            ? ''
            : String(next);
      },
      destroy: () => scope.dispose(),
    };
  } catch (error) {
    try {
      scope.dispose();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'ZyroJS: construction and cleanup failed'
      );
    }
    throw error;
  }
}
/**
 * kind.
 * @param {VNodeChild} value - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
 */
function kind(value: VNodeChild): unknown {
  if (Array.isArray(value)) {
    return Array;
  }
  if (isVNode(value)) {
    return value.type;
  }
  if (typeof value === 'function') {
    return value;
  }
  return '#text';
}
/**
 * reconcile.
 * @param {Mounted} current - Input value for this operation.
 * @param {VNodeChild} next - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @param {Node | null} anchor - Input value for this operation.
 * @param {EffectScope} owner - Input value for this operation.
 * @returns {Mounted} Result produced by this operation.
 */
function reconcile(
  current: Mounted,
  next: VNodeChild,
  parent: Node,
  anchor: Node | null,
  owner: EffectScope
): Mounted {
  if (
    next &&
    typeof next === 'object' &&
    !isVNode(next) &&
    !Array.isArray(next)
  ) {
    throw new TypeError('ZyroJS: invalid or Promise child; use a signal');
  }
  if (
    current.type !== kind(next) ||
    (isVNode(next) && next.props.key !== current.key) ||
    (next && typeof next === 'object' && 'then' in next)
  ) {
    /** Stores the created value used by this module. */
    const created = construct(next, parent, current.start, owner);
    try {
      current.destroy();
    } catch (error) {
      try {
        created.destroy();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          'ZyroJS: replacement cleanup failed'
        );
      }
      throw error;
    }
    return created;
  }
  current.update(next);
  return current;
}
/** Mount an additional subtree. Call unmount(container) to clear both root and manually-mounted trees. */
/**
 * mount.
 * @param {VNodeChild} vnode - Input value for this operation.
 * @param {Node} container - Input value for this operation.
 * @returns {Node | undefined} Result produced by this operation.
 */
export function mount(vnode: VNodeChild, container: Node): Node | undefined {
  /** Stores the scope value used by this module. */
  const scope = createEffectScope();
  /** Stores the item value used by this module. */
  const item = construct(vnode, container, null, scope);
  let items = manuallyMounted.get(container);
  if (!items) {
    items = new Set();
    manuallyMounted.set(container, items);
  }
  items.add(item);
  return item.start;
}
/** Reconcile a managed root; keyed child nodes retain their browser identity. */
/**
 * render.
 * @param {VNodeChild} vnode - Input value for this operation.
 * @param {Node} container - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function render(vnode: VNodeChild, container: Node): void {
  /** Stores the previous value used by this module. */
  const previous = roots.get(container);
  if (previous) {
    roots.set(
      container,
      reconcile(previous, vnode, container, null, createEffectScope())
    );
  } else {
    roots.set(
      container,
      construct(vnode, container, null, createEffectScope())
    );
  }
}
/** Compatibility wrapper for the prior patch(vnode, oldVNode) API. */
/**
 * patch.
 * @param {Node} container - Input value for this operation.
 * @param {VNodeChild} vnode - Input value for this operation.
 * @param {VNode} _oldVNode - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function patch(
  container: Node,
  vnode: VNodeChild,
  _oldVNode?: VNode
): void {
  render(vnode, container);
}
/**
 * unmount.
 * @param {Node} container - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function unmount(container: Node): void {
  /** Stores the root value used by this module. */
  const root = roots.get(container);
  /** Stores the manual value used by this module. */
  const manual = [...(manuallyMounted.get(container) ?? [])];
  roots.delete(container);
  manuallyMounted.delete(container);
  disposeAll([
    ...(root ? [() => root.destroy()] : []),
    ...manual.map((item) => () => item.destroy()),
  ]);
}
/** Escaped static HTML string for SSR. No implicit script, raw HTML, or hydration is supported. */
/**
 * renderToString.
 * @param {VNodeChild} value - Input value for this operation.
 * @returns {string} Result produced by this operation.
 */
export function renderToString(value: VNodeChild): string {
  /** Stores the scope value used by this module. */
  const scope = createEffectScope();
  try {
    return scope.run(() => untracked(() => renderStatic(value)));
  } finally {
    scope.dispose();
  }
}
/**
 * renderStatic.
 * @param {VNodeChild} value - Input value for this operation.
 * @returns {string} Result produced by this operation.
 */
function renderStatic(value: VNodeChild): string {
  /**
   * Application function escape.
   * @param {unknown} text - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const escape = (text: unknown) =>
    String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  if (value === null || value === undefined || typeof value === 'boolean') {
    return '';
  }
  if (value && typeof value === 'object' && 'then' in value) {
    throw new TypeError(
      'ZyroJS: Promise children are unsupported; use a signal'
    );
  }
  if (Array.isArray(value)) {
    return value.map(renderStatic).join('');
  }
  if (typeof value === 'function') {
    return renderStatic(runComponentRender(value));
  }
  if (!isVNode(value)) {
    if (typeof value === 'object') {
      throw new TypeError(
        'ZyroJS: invalid or asynchronous child; use a signal'
      );
    }
    return escape(value);
  }
  if (typeof value.type === 'function') {
    /** Stores the definition value used by this module. */
    const definition = getComponentDefinition(value.type);
    /** Stores the props value used by this module. */
    const props = { ...value.props, children: value.children };
    try {
      /** Stores the render value used by this module. */
      const render = definition ? definition.setup(props) : value.type;
      if (typeof render !== 'function') {
        throw new TypeError(
          'ZyroJS: setup must return a synchronous render function'
        );
      }
      return renderStatic(runComponentRender(() => render(props)));
    } catch (error) {
      if (!definition?.onError) {
        throw error;
      }
      return renderStatic(untracked(() => definition.onError!(error)));
    }
  }
  if (!/^[a-z][a-z0-9-]*$/i.test(value.type)) {
    throw new TypeError('Invalid element name');
  }
  let attrs = '';
  for (const [name, raw] of Object.entries(value.props)) {
    if (
      name === 'key' ||
      name === 'trustedHTML' ||
      name === 'ref' ||
      name === 'style' ||
      name.startsWith('bind:') ||
      dangerousAttr(name) ||
      isEvent(name)
    ) {
      continue;
    }
    /** Stores the val value used by this module. */
    const val: unknown = typeof raw === 'function' ? raw() : raw;
    if (
      val === null ||
      val === undefined ||
      val === false ||
      (uriAttr(name) && !safeUrl(String(val)))
    ) {
      continue;
    }
    /** Stores the attr value used by this module. */
    const attr = name === 'className' ? 'class' : name;
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(attr)) {
      continue;
    }
    attrs += val === true ? ` ${attr}` : ` ${attr}="${escape(val)}"`;
  }
  /** Stores the raw value used by this module. */
  const raw = trustedHTMLValue(value.props, flat(value.children).length > 0);
  /** Stores the children value used by this module. */
  const children = raw ?? flat(value.children).map(renderStatic).join('');
  if (
    /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(
      value.type
    )
  ) {
    return `<${value.type}${attrs}>`;
  }
  return `<${value.type}${attrs}>${children}</${value.type}>`;
}

/**
 * Internal helper: adopt a validated protocol tree into the existing reconciler.
 *
 * adoptHydrationRoot.
 * @param {VNodeChild} value - Input value for this operation.
 * @param {Node} container - Input value for this operation.
 * @param {HydrationSession} session - Input value for this operation.
 * @param {Node} start - Input value for this operation.
 * @param {Node} end - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function adoptHydrationRoot(
  value: VNodeChild,
  container: Node,
  session: HydrationSession,
  start: Node,
  end: Node
): void {
  if (roots.has(container) || manuallyMounted.get(container)?.size) {
    throw new HydrationError(
      'ROOT_OWNED',
      'ZyroJS: hydration requires an unowned container'
    );
  }
  let item: Mounted | undefined;
  try {
    item = withHydration(session, () =>
      construct(value, container, end, createEffectScope())
    );
    if (cursor(session, container) !== end) {
      mismatch(session, 'root-end', cursor(session, container));
    }
    checkAbort(session.signal);
    session.active = false;
    session.initializing = false;
    session.committed = true;
    for (const marker of session.textMarkers) {
      marker.parentNode?.removeChild(marker);
    }
    roots.set(container, {
      start,
      end,
      type: item.type,
      key: item.key,
      /**
       * update.
       * @param {unknown} next - Input value for this operation.
       * @returns {unknown} Result produced by this operation.
       */
      update(next) {
        withHydration(session, () => item!.update(next));
      },
      /**
       * destroy.
       * @returns {unknown} Result produced by this operation.
       */
      destroy() {
        disposeAll([
          () => item!.destroy(),
          () => between(start, start),
          () => between(end, end),
        ]);
      },
    });
  } catch (error) {
    try {
      item?.destroy();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'ZyroJS: hydration and cleanup failed'
      );
    }
    throw error;
  }
}
/**
 * Internal helper: explicit mismatch recovery uses normal mounting with the same deterministic ID scope.
 *
 * replaceHydrationRoot.
 * @param {VNodeChild} value - Input value for this operation.
 * @param {Node} container - Input value for this operation.
 * @param {HydrationSession} session - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function replaceHydrationRoot(
  value: VNodeChild,
  container: Node,
  session: HydrationSession
): void {
  if (roots.has(container) || manuallyMounted.get(container)?.size) {
    throw new HydrationError(
      'ROOT_OWNED',
      'ZyroJS: replacement requires an unowned container'
    );
  }
  session.active = false;
  session.initializing = true;
  session.committed = true;
  session.components = 0;
  session.nodes = 0;
  session.depth = 0;
  while (container.childNodes.length) {
    container.removeChild(container.childNodes[0]!);
  }
  try {
    roots.set(
      container,
      withHydration(session, () =>
        construct(value, container, null, createEffectScope())
      )
    );
  } finally {
    session.initializing = false;
  }
}
/**
 * hydrationRootOwned.
 * @param {Node} container - Input value for this operation.
 * @returns {boolean} Result produced by this operation.
 */
export function hydrationRootOwned(container: Node): boolean {
  return roots.has(container) || !!manuallyMounted.get(container)?.size;
}

/**
 * Internal helper: tie abort listeners to the exact mounted owner, not to a process-global registry.
 *
 * attachHydrationCleanup.
 * @param {Node} container - Input value for this operation.
 * @param {() => void} cleanup - Input value for this operation.
 * @returns {() => void} Result produced by this operation.
 */
export function attachHydrationCleanup(
  container: Node,
  cleanup: () => void
): () => void {
  /** Stores the item value used by this module. */
  const item = roots.get(container);
  if (!item) {
    throw new HydrationError(
      'ROOT_MISSING',
      'ZyroJS: hydration root unavailable'
    );
  }
  /** Stores the owner value used by this module. */
  const owner: Mounted = {
    ...item,
    /**
     * destroy.
     * @returns {unknown} Result produced by this operation.
     */
    destroy() {
      try {
        item.destroy();
      } finally {
        cleanup();
      }
    },
  };
  roots.set(container, owner);
  return () => {
    if (roots.get(container) === owner) {
      unmount(container);
    }
  };
}
