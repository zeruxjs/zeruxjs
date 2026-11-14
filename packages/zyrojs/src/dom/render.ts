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
/** Weak exact-container ownership map; replacing a root changes which cleanup handle is authoritative. */
const roots = new WeakMap<Node, Mounted>();
/** Additional mounted subtrees tracked independently and drained together by unmount. */
const manuallyMounted = new WeakMap<Node, Set<Mounted>>();
/**
 * Flatten managed child arrays; apply additional structural caps during protocol initialization.
 * @param {VNodeChild[]} items - Authored child list; nested arrays flatten and null/boolean placeholders are omitted.
 * @param {unknown} depth - Current flattening depth, bounded during protocol initialization.
 * @returns {VNodeChild[]} Normalized child order with initial-hydration structural checks.
 */
const flat = (items: VNodeChild[], depth = 0): VNodeChild[] => {
  /** Captured adoption session; later updates retain its identity but skip initial-adoption-only work. */
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
  /** Attempt-local output; ownership is retained until reconciliation or rendering succeeds. */
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
 * Recognize the structural node shape; this predicate is not a public-data validator.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {value is VNode} Whether the value has a structural VNode shape.
 */
const isVNode = (value: VNodeChild): value is VNode =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  'type' in value;
/**
 * Apply legacy DOM scheme checks; stricter hydration URL policy is owned separately.
 * @param {string} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {boolean} Whether the legacy scheme denylist accepts this value.
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
 * Recognize raw HTML and unsafe inline-handler attribute spellings.
 * @param {string} key - Authored prop/attribute name; events and bindings have separate ownership paths.
 * @returns {boolean} Whether this spelling is excluded from direct native writes.
 */
const dangerousAttr = (key: string): boolean =>
  /^(?:innerhtml|outerhtml|srcdoc|srcset|formaction)$/i.test(key) ||
  (/^on/i.test(key) && !/^on[A-Z]/.test(key));
/**
 * Identify URL attributes handled by this legacy DOM/static path.
 * @param {string} key - Authored prop/attribute name; events and bindings have separate ownership paths.
 * @returns {boolean} Whether the legacy path treats this name as URL-bearing.
 */
const uriAttr = (key: string): boolean =>
  /^(?:href|src|action|poster|cite|background|xlink:href)$/i.test(key);
/**
 * Recognize authored camel-case native event props.
 * @param {string} key - Authored prop/attribute name; events and bindings have separate ownership paths.
 * @returns {boolean} Whether the prop has the authored camel-case event spelling.
 */
const isEvent = (key: string): boolean => /^on[A-Z]/.test(key);
/**
 * Accept only an object-shaped style map; each property/value is checked separately.
 * @param {unknown} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {value is Record<string, string | number>} Whether a nonarray object can be inspected as a style map.
 */
const validStyle = (value: unknown): value is Record<string, string | number> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/**
 * Reject rule delimiters and active URL/expression constructs in an individual style value.
 * @param {unknown} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {boolean} Whether an individual scalar style value passes the legacy checks.
 */
const safeStyle = (value: unknown): boolean =>
  typeof value === 'string' || typeof value === 'number'
    ? !/(?:expression\s*\(|url\s*\(|@import|[;{}])/i.test(String(value))
    : false;

/**
 * Apply one native scalar property/attribute under the legacy DOM safety rules.
 * @param {Element} el - Native element owned by the current mounted subtree.
 * @param {string} key - Authored prop/attribute name; events and bindings have separate ownership paths.
 * @param {unknown} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {void} Applies or removes the supported native value.
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
    /** Native style declaration; raw CSS strings never enter this path. */
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
  /** Normalize className only; native attribute APIs perform escaping, not URL authorization. */
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
 * Attach current props and retain exact cleanup for each ref, event and reactive binding.
 * @param {Element} el - Native element owned by the current mounted subtree.
 * @param {Record<string, unknown>} next - Next authored description; retained type/key determines whether state can be reused.
 * @param {Record<string, unknown>} old - Previous authored props used to remove obsolete native attributes.
 * @param {EffectScope} scope - Explicit synchronous owner for acquired effects/listeners and descendant cleanup.
 * @returns {() => void} Disposer for exact property-owned listeners, refs and effects.
 */
function patchProperties(
  el: Element,
  next: Record<string, unknown>,
  old: Record<string, unknown>,
  scope: EffectScope
): () => void {
  /** Property-owned subscriptions/listeners/refs, released on replacement or partial failure. */
  const disposers: (() => void)[] = [];
  /**
   * Attach one supported prop, rolling back its resources if a later prop fails.
   * @param {string} key - Authored prop/attribute name; events and bindings have separate ownership paths.
   * @param {unknown} value - Authored child/property value; executable functions must be trusted application code.
   * @returns {void} Attaches supported prop resources or rejects invalid ref ownership.
   */
  const apply = (key: string, value: unknown) => {
    if (
      (key === 'bind:value' || key === 'bind:checked') &&
      value &&
      typeof value === 'object' &&
      'value' in value
    ) {
      /** Native two-way form property selected from the supported binding names. */
      const field = key === 'bind:value' ? 'value' : 'checked';
      /** Borrowed mutable signal; replacing/disposal removes listeners but does not destroy the source. */
      const source = value as { value: unknown };
      /** During initial adoption live form state wins; writes are deferred until root commit. */
      const hydration = currentHydration();
      if (hydration?.active) {
        /** Preserve edits made before hydration rather than overwriting them with server defaults. */
        const live = (el as unknown as Record<string, unknown>)[field];
        hydration.bindings.push(() => {
          source.value = live;
        });
      }
      /** Owned binding effect disposer; removed together with its matching native listener. */
      const stop = scope.run(() =>
        effect(() => {
          /** Capture the next value/node before mutating the current DOM or publishing an update. */
          const next = source.value;
          if (!hydration?.active) {
            setProp(el, field, next);
          }
        })
      );
      /** Native value/checked change event paired with this specific binding. */
      const eventName = field === 'value' ? 'input' : 'change';
      /**
       * Copy current native form state into the borrowed mutable binding signal.
       * @returns {void} Publishes the current native form value to its borrowed binding.
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
        /** Borrowed current holder; cleanup clears it only if it still points to this element. */
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
      /** Exact function identity retained for matching removeEventListener. */
      const listener = value as EventListener;
      el.addEventListener(key.slice(2).toLowerCase(), listener);
      disposers.push(() =>
        el.removeEventListener(key.slice(2).toLowerCase(), listener)
      );
    } else if (typeof value === 'function' && key !== 'ref') {
      disposers.push(
        scope.run(() =>
          effect(() => {
            /** Capture the next value/node before mutating the current DOM or publishing an update. */
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
   * Drain property resources once in reverse acquisition order.
   * @returns {void} Attempts all captured property disposers.
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
 * Remove the inclusive owned DOM range while preserving traversal before each removal.
 * @param {Node} start - First owned node or root marker.
 * @param {Node} end - Inclusive closing node or marker.
 * @returns {void} Removes the inclusive native range.
 */
function between(start: Node, end: Node): void {
  let current: Node | null = start;
  while (current) {
    /** Capture the next value/node before mutating the current DOM or publishing an update. */
    const next: Node | null = current === end ? null : current.nextSibling;
    current.parentNode?.removeChild(current);
    current = next;
  }
}
/** Move complete ranges; avoid touching already-positioned DOM (including focused inputs). */
/**
 * Move a complete owned range, preserving already-positioned nodes and best-effort native focus.
 * @param {Mounted} item - Mounted range whose native identity must be retained.
 * @param {Node} parent - Native parent receiving this owned subtree/range.
 * @param {Node | null} anchor - Insertion boundary, or null to append.
 * @returns {void} Moves the range with best-effort focus/selection restoration.
 */
function moveBefore(item: Mounted, parent: Node, anchor: Node | null): void {
  if (item.end.nextSibling === anchor) {
    return;
  }
  /** Owner document supplies native nodes and best-effort focus restoration. */
  const doc = parent.ownerDocument;
  /** Existing focused element; only a still-connected element can be restored after range moves. */
  const focused = doc?.activeElement as HTMLElement | null;
  /** Potential text control used only for supported selection-range restoration. */
  const input = focused as HTMLInputElement | null;
  /** Snapshot supported selection positions/direction before moving the owned range. */
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
    /** Capture the next value/node before mutating the current DOM or publishing an update. */
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
 * Reject invalid/duplicate sibling keys before changing the child inventory.
 * @param {VNodeChild[]} values - Normalized sibling descriptions for this child owner.
 * @returns {void} Returns only for valid unique sibling keys.
 */
function validateChildren(values: VNodeChild[]): void {
  /** Sibling identity set; duplicate or nonfinite identities reject before reconciliation. */
  const keys = new Set<unknown>();
  for (const child of values) {
    if (isVNode(child) && child.props.key !== undefined) {
      /** Optional authored sibling identity, separate from application authorization or data identity. */
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
 * Retain sibling reconciliation state and register descendant disposal with the parent scope.
 * @param {Node} parent - Native parent receiving this owned subtree/range.
 * @param {Node | null} anchor - Insertion boundary, or null to append.
 * @param {EffectScope} scope - Explicit synchronous owner for acquired effects/listeners and descendant cleanup.
 * @returns {(values: VNodeChild[]) => void} Stateful child updater whose descendants are disposed by the supplied scope.
 */
function childrenOwner(parent: Node, anchor: Node | null, scope: EffectScope) {
  let children: Mounted[] = [];
  scope.add(() => {
    /** Detach the previous child inventory before invoking any reentrant disposer. */
    const old = children;
    children = [];
    disposeAll(old.map((child) => () => child.destroy()));
  });
  /** Captured adoption session; later updates retain its identity but skip initial-adoption-only work. */
  const session = currentHydration();
  return (values: VNodeChild[]) =>
    withHydration(session, () => {
      validateChildren(values);
      /** Prior children not yet reused; leftovers are disposed after successful reconciliation. */
      const available = new Set(children);
      /** Exact keyed lookup; unkeyed positions cannot steal keyed component state. */
      const keyed = new Map(
        children
          .filter((child) => child.key !== undefined)
          .map((child) => [child.key, child])
      );
      /** New child inventory retains every acquired child even if a later sibling fails. */
      const updated: Mounted[] = [];
      try {
        for (let index = 0; index < values.length; index++) {
          /** Current authored child to match by type/key or construct with its own scope. */
          const candidate = values[index];
          /** Optional authored sibling identity, separate from application authorization or data identity. */
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
        /** Retained range moved backward relative to the next already-positioned sibling. */
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
 * Attempt every supplied cleanup and aggregate failures after resource release attempts.
 * @param {(() => void)[]} callbacks - Explicit cleanup order chosen by the caller.
 * @returns {void} Attempts every callback and throws AggregateError after failures.
 */
function disposeAll(callbacks: (() => void)[]): void {
  /** Attempt all cleanup callbacks, then report their failures together. */
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
 * Preserve adopted server nodes during failed precommit work; remove created/committed nodes.
 * @param {HydrationSession | undefined} session - Optional protocol session determining precommit versus committed node ownership.
 * @param {Node} start - First owned node or root marker.
 * @param {unknown} end - Inclusive closing node or marker.
 * @returns {void} Removes owned nodes while preserving uncommitted adopted server nodes.
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
 * Account protocol depth and construct one independently disposable subtree.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @param {Node} parent - Native parent receiving this owned subtree/range.
 * @param {Node | null} anchor - Insertion boundary, or null to append.
 * @param {EffectScope} owner - Parent ownership context for constructing or reconciling this subtree.
 * @returns {Mounted} Independently disposable subtree with depth accounting restored.
 */
function construct(
  value: VNodeChild,
  parent: Node,
  anchor: Node | null,
  owner: EffectScope
): Mounted {
  /** Captured adoption session; later updates retain its identity but skip initial-adoption-only work. */
  const session = currentHydration();
  /** Only initial protocol traversal contributes to the session structural-depth budget. */
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
 * Acquire one subtree with local rollback; async children and unsupported objects reject.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @param {Node} parent - Native parent receiving this owned subtree/range.
 * @param {Node | null} anchor - Insertion boundary, or null to append.
 * @param {EffectScope} _owner - Parent ownership context for constructing or reconciling this subtree.
 * @returns {Mounted} Mounted node/range; failure rolls back acquired scope resources.
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
  /** Captured adoption session; later updates retain its identity but skip initial-adoption-only work. */
  const session = currentHydration();
  checkAbort(session?.signal);
  if (session?.initializing && ++session.nodes > session.limits.maxNodes) {
    throw new HydrationError(
      'RENDER_LIMIT',
      'ZyroJS: hydration tree exceeds node limit'
    );
  }
  validateChildren([value]);
  /** Node-local owner for descendants, effects, listeners and native range cleanup. */
  const scope = createEffectScope();
  /** Owner document supplies native nodes and best-effort focus restoration. */
  const doc = parent.ownerDocument ?? (parent as Document);
  try {
    if (
      Array.isArray(value) ||
      typeof value === 'function' ||
      (isVNode(value) && typeof value.type === 'function')
    ) {
      /** Existing marker range during adoption; fresh mounting creates its own markers. */
      const range = session?.active ? claimRange(session, parent) : undefined;
      /** First owned marker/node; retained identity anchors keyed moves and subtree teardown. */
      const start = range?.start ?? doc.createComment('zyro-start');
      /** Closing owned range boundary; children are inserted before it. */
      const marker = range?.end ?? doc.createComment('zyro');
      if (!range) {
        parent.insertBefore(start, anchor);
        parent.insertBefore(marker, anchor);
      }
      scope.add(() => releaseNode(session, marker));
      scope.add(() => releaseNode(session, start));
      /** Child-list owner retaining reconciliation state and all acquired descendant ranges. */
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
           * Update this retained range without reallocating compatible component setup.
           * @param {unknown} next - Next authored description; retained type/key determines whether state can be reused.
           * @returns {void} Updates this retained owner or rejects unsupported next content.
           */
          update(next) {
            updateChildren(flat(next as VNodeChild[]));
          },
          destroy: () => scope.dispose(),
        };
      }
      /** Optional component node supplies current props/key; standalone function children have none. */
      const componentVNode = isVNode(value) ? value : undefined;
      /** Trusted authored function identity; never loaded from serialized public data. */
      const component = componentVNode
        ? (componentVNode.type as (...args: any[]) => any)
        : (value as (...args: any[]) => any);
      /** Explicit setup registration distinguishes stateful setup from ordinary function children. */
      const definition = componentVNode
        ? getComponentDefinition(component)
        : undefined;
      let currentVNode = componentVNode;
      let renderComponent = component;
      /** Preorder protocol identity shared with server setup; ordinary mounts do not allocate IDs. */
      const componentId = session ? ++session.components : 0;
      let setupFailed = false;
      let setupError: unknown;
      if (definition) {
        /** One-time setup resources, registered under the node owner and cleaned on setup failure. */
        const setupScope = createEffectScope();
        scope.add(() => setupScope.dispose());
        try {
          renderComponent = setupScope.run(() =>
            untracked(() => {
              /**
               * Run registered setup once with the initial authored props and deterministic ID context.
               * @returns {unknown} Trusted registered setup result, checked to be a synchronous render function.
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
      /** Internal props-update signal; setup remains stable while current render receives fresh props. */
      const revision = signal(0);
      scope.run(() =>
        effect(() => {
          void revision.value;
          checkAbort(session?.signal);
          try {
            if (setupFailed) {
              throw setupError;
            }
            /** Attempt-local output; ownership is retained until reconciliation or rendering succeeds. */
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
         * Update this retained range without reallocating compatible component setup.
         * @param {unknown} next - Next authored description; retained type/key determines whether state can be reused.
         * @returns {void} Updates this retained owner or rejects unsupported next content.
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
      /** Adopted or newly created native element; property/listener ownership stays with its scope. */
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
      /** Child-list owner retaining reconciliation state and all acquired descendant ranges. */
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
         * Update this retained range without reallocating compatible component setup.
         * @param {unknown} next - Next authored description; retained type/key determines whether state can be reused.
         * @returns {void} Updates this retained owner or rejects unsupported next content.
         */
        update(next) {
          if (!isVNode(next)) {
            return;
          }
          validateChildren(flat(next.children));
          /** New approved opaque leaf; managed children must be disposed before replacing its HTML. */
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
    /** Exact scalar text expected from the matching server tree. */
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
       * Update this retained range without reallocating compatible component setup.
       * @param {unknown} next - Next authored description; retained type/key determines whether state can be reused.
       * @returns {void} Updates this retained owner or rejects unsupported next content.
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
 * Classify reconciliation identity by array, component/element type or scalar text.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {unknown} Reconciliation type identity, not a validated public schema.
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
 * Retain compatible type/key ownership; otherwise construct a candidate and dispose the old subtree.
 * @param {Mounted} current - Existing mounted range and its resource ownership.
 * @param {VNodeChild} next - Next authored description; retained type/key determines whether state can be reused.
 * @param {Node} parent - Native parent receiving this owned subtree/range.
 * @param {Node | null} anchor - Insertion boundary, or null to append.
 * @param {EffectScope} owner - Parent ownership context for constructing or reconciling this subtree.
 * @returns {Mounted} Retained or newly acquired owner; failed replacement releases its candidate.
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
    /** Construct replacement before releasing prior ownership; failed cleanup also releases the candidate. */
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
 * Append an independently tracked subtree; unmount(container) also releases manual mounts.
 * @param {VNodeChild} vnode - Trusted authored description; no module/source text is evaluated.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @returns {Node | undefined} First mounted node; unmount(container) owns teardown of this additional subtree.
 */
export function mount(vnode: VNodeChild, container: Node): Node | undefined {
  /** Node-local owner for descendants, effects, listeners and native range cleanup. */
  const scope = createEffectScope();
  /** Exact acquired subtree/root identity, retained for owner-specific release. */
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
 * Reconcile the managed root while preserving compatible keyed component state.
 * @param {VNodeChild} vnode - Trusted authored description; no module/source text is evaluated.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @returns {void} Reconciles the exact-container managed root.
 */
export function render(vnode: VNodeChild, container: Node): void {
  /** Existing root for this exact container; compatible type/key retains node identity. */
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
 * Preserve the legacy patch signature by delegating to exact-container root reconciliation.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @param {VNodeChild} vnode - Trusted authored description; no module/source text is evaluated.
 * @param {VNode} _oldVNode - Legacy compatibility argument; live ownership is read from the container registry.
 * @returns {void} Delegates to managed-root render; legacy oldVNode is ignored.
 */
export function patch(
  container: Node,
  vnode: VNodeChild,
  _oldVNode?: VNode
): void {
  render(vnode, container);
}
/**
 * Clear root registrations before attempting every root/manual-subtree disposer.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @returns {void} Clears registrations and attempts all root/manual subtree cleanups.
 */
export function unmount(container: Node): void {
  /** Managed render root removed from the ownership map before running user cleanup. */
  const root = roots.get(container);
  /** Snapshot additional mounts so reentrant cleanup cannot hide resources from this drain. */
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
 * Render static marker-free HTML in a temporary effect scope that always disposes.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {string} Escaped marker-free static HTML after temporary scope cleanup.
 */
export function renderToString(value: VNodeChild): string {
  /** Node-local owner for descendants, effects, listeners and native range cleanup. */
  const scope = createEffectScope();
  try {
    return scope.run(() => untracked(() => renderStatic(value)));
  } finally {
    scope.dispose();
  }
}
/**
 * Serialize the legacy static subset without hydration markers or attached listeners.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @returns {string} Legacy static subtree serialization without hydration data.
 */
function renderStatic(value: VNodeChild): string {
  /**
   * Encode legacy static text/quoted attribute delimiters; never use this for script data.
   * @param {unknown} text - Scalar authored value converted to text before HTML escaping.
   * @returns {string} HTML-escaped scalar text, unsuitable for script/URL policy contexts.
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
    /** Explicit setup registration distinguishes stateful setup from ordinary function children. */
    const definition = getComponentDefinition(value.type);
    /** Current authored component props and children; these callbacks are trusted application code. */
    const props = { ...value.props, children: value.children };
    try {
      /** One-time setup result or ordinary component function; asynchronous returns remain unsupported. */
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
    /** Evaluate only trusted authored reactive attribute callbacks; public JSON cannot carry functions. */
    const val: unknown = typeof raw === 'function' ? raw() : raw;
    if (
      val === null ||
      val === undefined ||
      val === false ||
      (uriAttr(name) && !safeUrl(String(val)))
    ) {
      continue;
    }
    /** Static attribute name normalized and checked before quoted-value encoding. */
    const attr = name === 'className' ? 'class' : name;
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(attr)) {
      continue;
    }
    attrs += val === true ? ` ${attr}` : ` ${attr}="${escape(val)}"`;
  }
  /** Opaque HTML is accepted only through the exact sanitizer-token registry. */
  const raw = trustedHTMLValue(value.props, flat(value.children).length > 0);
  /** Either approved opaque content or recursively encoded managed children, never both. */
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
 * Commit an exactly consumed protocol tree; failed adoption disposes acquired resources.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @param {HydrationSession} session - Optional protocol session determining precommit versus committed node ownership.
 * @param {Node} start - First owned node or root marker.
 * @param {Node} end - Inclusive closing node or marker.
 * @returns {void} Registers the fully consumed committed protocol owner.
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
       * Update this retained range without reallocating compatible component setup.
       * @param {unknown} next - Next authored description; retained type/key determines whether state can be reused.
       * @returns {void} Updates this retained owner or rejects unsupported next content.
       */
      update(next) {
        withHydration(session, () => item!.update(next));
      },
      /**
       * Release this exact subtree and its owned native markers/resources.
       * @returns {void} Attempts this owner’s subtree, marker and attached cleanup.
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
 * Explicitly discard server children and mount a bounded replacement with matching ID context.
 * @param {VNodeChild} value - Authored child/property value; executable functions must be trusted application code.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @param {HydrationSession} session - Optional protocol session determining precommit versus committed node ownership.
 * @returns {void} Registers an explicit replacement root; initial server edits are discarded.
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
 * Report existing root/manual ownership before protocol acquisition begins.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @returns {boolean} Whether any managed or manual subtree already owns this container.
 */
export function hydrationRootOwned(container: Node): boolean {
  return roots.has(container) || !!manuallyMounted.get(container)?.size;
}

/**
 * Internal helper: tie abort listeners to the exact mounted owner, not to a process-global registry.
 *
 * Bind cleanup to an exact mounted identity so stale handles cannot unmount newer roots.
 * @param {Node} container - Host-owned native root; do not share its ownership with another renderer.
 * @param {() => void} cleanup - Host abort/session release callback, attempted even when subtree destruction fails.
 * @returns {() => void} Owner-specific release handle; stale handles cannot release a newer root.
 */
export function attachHydrationCleanup(
  container: Node,
  cleanup: () => void
): () => void {
  /** Exact acquired subtree/root identity, retained for owner-specific release. */
  const item = roots.get(container);
  if (!item) {
    throw new HydrationError(
      'ROOT_MISSING',
      'ZyroJS: hydration root unavailable'
    );
  }
  /** Wrapper identity binds abort cleanup to this mounted root, fencing stale handles. */
  const owner: Mounted = {
    ...item,
    /**
     * Release this exact subtree and its owned native markers/resources.
     * @returns {void} Attempts this owner’s subtree, marker and attached cleanup.
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
