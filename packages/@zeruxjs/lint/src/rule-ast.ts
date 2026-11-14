import type { Rule } from 'eslint';
// ESLint and TypeScript-ESTree share these visited node shapes. Parser-owned nodes are never mutated.
export type Node = any;
/** Read only static string literals and interpolation-free templates.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @returns {string | undefined} Static string value, or undefined for computed/nonstring expressions.
 */
export const literal = (node: Node): string | undefined => {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
};
/** Read a noncomputed property name or literal key without evaluating expressions.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @returns {string | undefined} Static property name, or undefined when a name cannot be proven.
 */
export const key = (node: Node): string | undefined =>
  !node.computed && node.key?.type === 'Identifier'
    ? node.key.name
    : literal(node.key);
/** Remove transparent parser wrappers without mutating the source AST.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @returns {Node} Underlying parser node, preserving its identity and every unrecognized wrapper.
 */
export function unwrap(node: Node): Node {
  while (
    node &&
    [
      'AwaitExpression',
      'ChainExpression',
      'TSAsExpression',
      'TSNonNullExpression',
      'TSSatisfiesExpression',
    ].includes(node.type)
  ) {
    node = node.argument ?? node.expression;
  }
  return node;
}
/** Find the nearest lexical binding, preserving local shadowing of package/global names.
 * @param {Rule.RuleContext} context - Borrowed ESLint rule context providing lexical scope and report ownership.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @returns {any} Nearest lexical binding, or undefined when the identifier is not locally defined.
 */
export function variable(context: Rule.RuleContext, node: Node): any {
  let scope: any = context.sourceCode.getScope(node);
  while (scope) {
    /** Resolved lexical binding at the current scope; an inner declaration shadows outer imports. */
    const found = scope.set.get(node.name);
    if (found) {
      return found;
    }
    scope = scope.upper;
  }
}
/** Resolve direct and static namespace imports without evaluating or loading modules.
 * @param {Rule.RuleContext} context - Borrowed ESLint rule context providing lexical scope and report ownership.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @returns {{ source: string; name: string } | undefined} Proven module source and imported name, or undefined for dynamic/unproven bindings.
 */
export function imported(
  context: Rule.RuleContext,
  node: Node
): { source: string; name: string } | undefined {
  if (node?.type === 'Identifier') {
    /** Nearest lexical definition used to prove an import origin without evaluating code. */
    const definition = variable(context, node)?.defs[0];
    if (definition?.type === 'ImportBinding') {
      return {
        source: String(definition.parent.source.value),
        name:
          definition.node.type === 'ImportNamespaceSpecifier'
            ? '*'
            : (definition.node.imported?.name ?? 'default'),
      };
    }
  }
  if (node?.type === 'MemberExpression' && !node.computed) {
    /** Resolved namespace import owner for a static member access. */
    const owner = imported(context, node.object);
    if (owner?.name === '*') {
      return { source: owner.source, name: node.property.name };
    }
  }
}
