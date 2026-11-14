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
  /** Deferred live-form-to-signal commits, applied only after successful root adoption. */
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
 * Read the active synchronous adoption session without acquiring a resource.
 * @returns {HydrationSession | undefined} Active synchronous session, if any.
 */
export const currentHydration = () => current;
/**
 * Install a session for one synchronous traversal and restore the caller’s session.
 * @param {HydrationSession | undefined} session - Attempt-local cursors, limits and commit state; never shared across roots.
 * @param {() => T} fn - Trusted synchronous traversal; no asynchronous session propagation is provided.
 * @returns {T} Callback result after restoring the enclosing session.
 */
export function withHydration<T>(
  session: HydrationSession | undefined,
  fn: () => T
): T {
  /** Enclosing synchronous adoption context restored even if component traversal throws. */
  const previous = current;
  current = session;
  try {
    return fn();
  } finally {
    current = previous;
  }
}
/**
 * Throw a structural mismatch with value-free node-category diagnostics.
 * @param {HydrationSession} session - Attempt-local cursors, limits and commit state; never shared across roots.
 * @param {string} expected - Fixed structural expectation; callers must not insert private values.
 * @param {Node | null} node - Actual candidate DOM node, inspected only for its category.
 * @returns {never} Always throws a value-free structural mismatch.
 */
export function mismatch(
  session: HydrationSession,
  expected: string,
  node: Node | null
): never {
  /** Path/value-free observation; diagnostics never include DOM text or attribute contents. */
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
 * Read this parent’s next unclaimed child without advancing ownership.
 * @param {HydrationSession} session - Attempt-local cursors, limits and commit state; never shared across roots.
 * @param {Node} parent - Host DOM parent whose children this session is adopting.
 * @returns {Node | null} Next unclaimed child, or null when the parent is exhausted.
 */
export function cursor(session: HydrationSession, parent: Node): Node | null {
  return session.cursors.has(parent)
    ? session.cursors.get(parent)!
    : (parent.childNodes[0] ?? null);
}
/**
 * Validate the next node’s category/tag/marker before advancing the parent cursor.
 * @param {HydrationSession} session - Attempt-local cursors, limits and commit state; never shared across roots.
 * @param {Node} parent - Host DOM parent whose children this session is adopting.
 * @param {number} type - Expected native DOM nodeType.
 * @param {string} expected - Fixed structural expectation; callers must not insert private values.
 * @returns {Node} Validated node with the parent cursor advanced to its next sibling.
 */
export function claim(
  session: HydrationSession,
  parent: Node,
  type: number,
  expected: string
): Node {
  checkAbort(session.signal);
  /** Next unclaimed node in this parent; successful claims advance exactly one cursor. */
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
 * Find the matching range end with nested-marker accounting and a finite scan cap.
 * @param {HydrationSession} session - Attempt-local cursors, limits and commit state; never shared across roots.
 * @param {Node} parent - Host DOM parent whose children this session is adopting.
 * @returns {{ start: Node; end: Node }} Claimed balanced marker boundaries.
 */
export function claimRange(
  session: HydrationSession,
  parent: Node
): { start: Node; end: Node } {
  /** Claimed opening marker; scan nested ranges without stealing a sibling’s closing marker. */
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
 * Require exact range consumption before advancing beyond its closing marker.
 * @param {HydrationSession} session - Attempt-local cursors, limits and commit state; never shared across roots.
 * @param {Node} parent - Host DOM parent whose children this session is adopting.
 * @param {Node} end - Expected closing marker for this owned range.
 * @returns {void} Advances past an exactly consumed closing marker or throws.
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
 * Require exact names and values from the shared hydratable attribute projection.
 * @param {HydrationSession} session - Attempt-local cursors, limits and commit state; never shared across roots.
 * @param {Element} el - Borrowed server element being validated before props/listeners attach.
 * @param {Record<string, unknown>} props - Trusted authored props matching server-rendered attributes.
 * @returns {void} Returns only when actual and projected attribute names/values match exactly.
 */
export function checkAttributes(
  session: HydrationSession,
  el: Element,
  props: Record<string, unknown>
): void {
  /** Same scalar projection used by server serialization; callback props remain trusted code. */
  const expected = hydrationAttributes(props);
  /** Path/value-free observation; diagnostics never include DOM text or attribute contents. */
  const actual: Record<string, string> = Object.create(null);
  for (const attribute of Array.from(el.attributes)) {
    actual[attribute.name] = attribute.value;
  }
  /** Sorted exact attribute names, including detection of unexpected server attributes. */
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
 * Bound existing DOM before invoking component setup; do not expose DOM values in errors.
 * @param {Node} container - Unowned host root whose descendants are preflighted.
 * @param {ReturnType<typeof hydrationLimits>} limits - Validated node, depth and byte ceilings.
 * @param {AbortSignal} signal - Optional cooperative cancellation checked for each visited node.
 * @returns {void} Returns after bounded preflight; throws before application setup on failure.
 */
export function validateHydrationTree(
  container: Node,
  limits: ReturnType<typeof hydrationLimits>,
  signal?: AbortSignal
): void {
  let nodes = 0,
    bytes = 0;
  /**
   * Accumulate bounded native DOM shape/text/attribute sizes without executing application code.
   * @param {Node} node - Actual candidate DOM node, inspected only for its category.
   * @param {number} depth - Native subtree depth relative to the root children.
   * @returns {void} Accumulates native tree budgets, rejecting overflow or cancellation.
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
