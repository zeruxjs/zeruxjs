import {
  checkAbort,
  HydrationError,
  hydrationLimits,
} from './hydration-protocol.js';
import { hydrationAttributes } from './html-policy.js';
export interface MismatchDiagnostic {
  /** Stable diagnostic code exposed to the host. */
  readonly code: 'HYDRATION_MISMATCH';
  /** Bounded node index where adoption diverged. */
  readonly node: number;
  /** Expected node description without private values or paths. */
  readonly expected: string;
  /** Actual node description without private values or paths. */
  readonly actual: string;
}
/** Describes a structural or value mismatch found during hydration adoption. */
export class HydrationMismatch extends HydrationError {
  /**
   * Create a mismatch error with a path-free diagnostic for the host.
   *
   * @param {MismatchDiagnostic} diagnostic - Redacted mismatch details.
   */
  constructor(readonly diagnostic: MismatchDiagnostic) {
    super(
      'HYDRATION_MISMATCH',
      'ZyroJS: hydration tree mismatch; use matching server/client trees or explicit replacement'
    );
  }
}
export interface HydrationSession {
  /** Identifier prefix used for deterministic component IDs. */
  prefix: string;
  /** Number of components initialized in this session. */
  components: number;
  /** Number of nodes claimed or created in this session. */
  nodes: number;
  /** Current hydration depth. */
  depth: number;
  /** Whether the session is still initializing its root. */
  initializing: boolean;
  /** Whether the session accepts additional claims. */
  active: boolean;
  /** Whether the root has completed its commit boundary. */
  committed: boolean;
  /** Signal used to cancel session-owned work. */
  signal?: AbortSignal;
  /** Bounded limits governing this session. */
  limits: ReturnType<typeof hydrationLimits>;
  /** Cleanup callbacks owned by the session. */
  bindings: (() => void)[];
  /** Cursor positions associated with hydrated parent nodes. */
  cursors: Map<Node, Node | null>;
  /** Text marker nodes used to locate dynamic ranges. */
  textMarkers: Node[];
  /** Nodes created during replacement or adoption. */
  created: Set<Node>;
}
let current: HydrationSession | undefined;
/**
 * Application function currentHydration.
 * @returns {unknown} Result produced by this operation.
 */
export const currentHydration = () => current;
/**
 * withHydration.
 * @param {HydrationSession | undefined} session - Input value for this operation.
 * @param {() => T} fn - Input value for this operation.
 * @returns {T} Result produced by this operation.
 */
export function withHydration<T>(
  session: HydrationSession | undefined,
  fn: () => T
): T {
  /** Stores the previous value used by this module. */
  const previous = current;
  current = session;
  try {
    return fn();
  } finally {
    current = previous;
  }
}
/**
 * mismatch.
 * @param {HydrationSession} session - Input value for this operation.
 * @param {string} expected - Input value for this operation.
 * @param {Node | null} node - Input value for this operation.
 * @returns {never} Result produced by this operation.
 */
export function mismatch(
  session: HydrationSession,
  expected: string,
  node: Node | null
): never {
  /** Stores the actual value used by this module. */
  let actual = 'other';
  if (!node) {
    actual = 'missing';
  } else if (node.nodeType === 1) {
    actual = 'element';
  } else if (node.nodeType === 3) {
    actual = 'text';
  } else if (node.nodeType === 8) {
    actual = 'comment';
  }
  throw new HydrationMismatch(
    Object.freeze({
      code: 'HYDRATION_MISMATCH',
      node: session.nodes,
      expected,
      actual,
    })
  );
}
/**
 * cursor.
 * @param {HydrationSession} session - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @returns {Node | null} Result produced by this operation.
 */
export function cursor(session: HydrationSession, parent: Node): Node | null {
  return session.cursors.has(parent)
    ? session.cursors.get(parent)!
    : (parent.childNodes[0] ?? null);
}
/**
 * claim.
 * @param {HydrationSession} session - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @param {number} type - Input value for this operation.
 * @param {string} expected - Input value for this operation.
 * @returns {Node} Result produced by this operation.
 */
export function claim(
  session: HydrationSession,
  parent: Node,
  type: number,
  expected: string
): Node {
  checkAbort(session.signal);
  /** Stores the node value used by this module. */
  const node = cursor(session, parent);
  if (
    !node ||
    node.nodeType !== type ||
    (type === 8 && node.textContent !== expected) ||
    (type === 1 && node.nodeName.toLowerCase() !== expected)
  ) {
    let mismatchType = 'text';
    if (type === 1) {
      mismatchType = `element:${expected}`;
    } else if (type === 8) {
      mismatchType = 'marker';
    }
    mismatch(session, mismatchType, node);
  }
  session.cursors.set(parent, node.nextSibling);
  return node;
}
/**
 * claimRange.
 * @param {HydrationSession} session - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @returns {{ start: Node; end: Node }} Result produced by this operation.
 */
export function claimRange(
  session: HydrationSession,
  parent: Node
): { start: Node; end: Node } {
  /** Stores the start value used by this module. */
  const start = claim(session, parent, 8, 'zyro-start');
  let depth = 0,
    count = 0,
    node = start.nextSibling;
  while (node) {
    if (++count > session.limits.maxNodes * 4) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: hydration marker scan exceeds limit'
      );
    }
    if (node.nodeType === 8 && node.textContent === 'zyro-start') {
      depth++;
    }
    if (node.nodeType === 8 && node.textContent === 'zyro') {
      if (!depth) {
        return { start, end: node };
      }
      depth--;
    }
    node = node.nextSibling;
  }
  return mismatch(session, 'range-end', node);
}
/**
 * finishRange.
 * @param {HydrationSession} session - Input value for this operation.
 * @param {Node} parent - Input value for this operation.
 * @param {Node} end - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function finishRange(
  session: HydrationSession,
  parent: Node,
  end: Node
): void {
  if (cursor(session, parent) !== end) {
    mismatch(session, 'range-end', cursor(session, parent));
  }
  session.cursors.set(parent, end.nextSibling);
}
/**
 * checkAttributes.
 * @param {HydrationSession} session - Input value for this operation.
 * @param {Element} el - Input value for this operation.
 * @param {Record<string, unknown>} props - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function checkAttributes(
  session: HydrationSession,
  el: Element,
  props: Record<string, unknown>
): void {
  /** Stores the expected value used by this module. */
  const expected = hydrationAttributes(props);
  /** Stores the actual value used by this module. */
  const actual: Record<string, string> = Object.create(null);
  for (const attribute of Array.from(el.attributes)) {
    actual[attribute.name] = attribute.value;
  }
  /** Stores the names value used by this module. */
  const names = Object.keys(expected).sort();
  if (
    JSON.stringify(names) !== JSON.stringify(Object.keys(actual).sort()) ||
    names.some((name) => expected[name] !== actual[name])
  ) {
    mismatch(session, 'attributes', el);
  }
}
/** Preflight bounds actual server DOM before invoking application setup. No DOM values enter diagnostics. */
/**
 * validateHydrationTree.
 * @param {Node} container - Input value for this operation.
 * @param {ReturnType<typeof hydrationLimits>} limits - Input value for this operation.
 * @param {AbortSignal} signal - Input value for this operation.
 * @returns {void} Result produced by this operation.
 */
export function validateHydrationTree(
  container: Node,
  limits: ReturnType<typeof hydrationLimits>,
  signal?: AbortSignal
): void {
  let nodes = 0,
    bytes = 0;
  /**
   * Application function visit.
   * @param {Node} node - Input value for this operation.
   * @param {number} depth - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const visit = (node: Node, depth: number) => {
    checkAbort(signal);
    if (++nodes > limits.maxNodes * 4 || depth > limits.maxDepth + 2) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: hydration DOM exceeds structural limit'
      );
    }
    if (node.nodeType === 3 || node.nodeType === 8) {
      bytes += new TextEncoder().encode(node.textContent ?? '').length;
    }
    if (node.nodeType === 1) {
      for (const attr of Array.from((node as Element).attributes)) {
        bytes += attr.name.length + new TextEncoder().encode(attr.value).length;
      }
    }
    if (bytes > limits.maxBytes) {
      throw new HydrationError(
        'RENDER_LIMIT',
        'ZyroJS: hydration DOM exceeds byte limit'
      );
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child, depth + 1);
    }
  };
  for (const child of Array.from(container.childNodes)) {
    visit(child, 0);
  }
}
