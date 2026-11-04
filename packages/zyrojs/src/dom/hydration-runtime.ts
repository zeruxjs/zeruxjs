import { checkAbort, HydrationError, hydrationLimits } from './hydration-protocol.js';
import { hydrationAttributes } from './html-policy.js';
export interface MismatchDiagnostic { readonly code: 'HYDRATION_MISMATCH'; readonly node: number; readonly expected: string; readonly actual: string }
export class HydrationMismatch extends HydrationError {
  constructor(readonly diagnostic: MismatchDiagnostic) { super('HYDRATION_MISMATCH', 'ZyroJS: hydration tree mismatch; use matching server/client trees or explicit replacement'); }
}
export interface HydrationSession {
  prefix: string; components: number; nodes: number; depth: number; initializing: boolean; active: boolean; committed: boolean;
  signal?: AbortSignal; limits: ReturnType<typeof hydrationLimits>;
  bindings: (() => void)[]; cursors: Map<Node, Node | null>; textMarkers: Node[]; created: Set<Node>;
}
let current: HydrationSession | undefined;
export const currentHydration = () => current;
export function withHydration<T>(session: HydrationSession | undefined, fn: () => T): T {
  const previous = current; current = session;
  try { return fn(); } finally { current = previous; }
}
export function mismatch(session: HydrationSession, expected: string, node: Node | null): never {
  const actual = !node ? 'missing' : node.nodeType === 1 ? 'element' : node.nodeType === 3 ? 'text' : node.nodeType === 8 ? 'comment' : 'other';
  throw new HydrationMismatch(Object.freeze({code: 'HYDRATION_MISMATCH', node: session.nodes, expected, actual}));
}
export function cursor(session: HydrationSession, parent: Node): Node | null {
  return session.cursors.has(parent) ? session.cursors.get(parent)! : parent.childNodes[0] ?? null;
}
export function claim(session: HydrationSession, parent: Node, type: number, expected: string): Node {
  checkAbort(session.signal);
  const node = cursor(session, parent);
  if (!node || node.nodeType !== type || (type === 8 && node.textContent !== expected) || (type === 1 && node.nodeName.toLowerCase() !== expected)) mismatch(session, type === 1 ? `element:${expected}` : type === 8 ? 'marker' : 'text', node);
  session.cursors.set(parent, node.nextSibling);
  return node;
}
export function claimRange(session: HydrationSession, parent: Node): {start: Node; end: Node} {
  const start = claim(session, parent, 8, 'zyro-start');
  let depth = 0, count = 0, node = start.nextSibling;
  while (node) {
    if (++count > session.limits.maxNodes * 4) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: hydration marker scan exceeds limit');
    if (node.nodeType === 8 && node.textContent === 'zyro-start') depth++;
    if (node.nodeType === 8 && node.textContent === 'zyro') {
      if (!depth) return {start, end: node};
      depth--;
    }
    node = node.nextSibling;
  }
  return mismatch(session, 'range-end', node);
}
export function finishRange(session: HydrationSession, parent: Node, end: Node): void {
  if (cursor(session, parent) !== end) mismatch(session, 'range-end', cursor(session, parent));
  session.cursors.set(parent, end.nextSibling);
}
export function checkAttributes(session: HydrationSession, el: Element, props: Record<string, unknown>): void {
  const expected = hydrationAttributes(props);
  const actual: Record<string, string> = Object.create(null);
  for (const attribute of Array.from(el.attributes)) actual[attribute.name] = attribute.value;
  const names = Object.keys(expected).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(actual).sort()) || names.some(name => expected[name] !== actual[name])) mismatch(session, 'attributes', el);
}
/** Preflight bounds actual server DOM before invoking application setup. No DOM values enter diagnostics. */
export function validateHydrationTree(container: Node, limits: ReturnType<typeof hydrationLimits>, signal?: AbortSignal): void {
  let nodes = 0, bytes = 0;
  const visit = (node: Node, depth: number) => {
    checkAbort(signal);
    if (++nodes > limits.maxNodes * 4 || depth > limits.maxDepth + 2) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: hydration DOM exceeds structural limit');
    if (node.nodeType === 3 || node.nodeType === 8) bytes += new TextEncoder().encode(node.textContent ?? '').length;
    if (node.nodeType === 1) for (const attr of Array.from((node as Element).attributes)) bytes += attr.name.length + new TextEncoder().encode(attr.value).length;
    if (bytes > limits.maxBytes) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: hydration DOM exceeds byte limit');
    for (const child of Array.from(node.childNodes)) visit(child, depth + 1);
  };
  for (const child of Array.from(container.childNodes)) visit(child, 0);
}
