import type { Rule } from 'eslint';
import { literal, key, imported, type Node } from './rule-ast.js';
/** Find an explicitly authored JSX attribute without inferring spread values.
 * @param {Node} node - Borrowed parser node; inspected without mutation or execution.
 * @param {string} name - Static property or diagnostic name, never evaluated as code.
 * @returns {Node} Explicit matching JSX attribute, or undefined when it is not authored.
 */
const attr = (node: Node, name: string) =>
  node.attributes.find(
    (item: Node) => item.type === 'JSXAttribute' && item.name.name === name
  );
/** Extract a literal JSX attribute value while preserving unknown dynamic expressions.
 * @param {Node} attribute - Borrowed JSX attribute; absent or dynamic values are not invented.
 * @returns {string | undefined} Literal attribute text, or undefined for dynamic/nonstring values.
 */
const value = (attribute: Node) =>
  attribute?.value?.type === 'JSXExpressionContainer'
    ? literal(attribute.value.expression)
    : literal(attribute?.value);
/** Distinguish a dynamic attribute from a statically known literal value.
 * @param {Node} attribute - Borrowed JSX attribute; absent or dynamic values are not invented.
 * @returns {boolean | undefined} Whether the present attribute value is dynamic; absent attributes remain undefined.
 */
const unknown = (attribute: Node) =>
  attribute && value(attribute) === undefined;
/** Native roles requiring an authored accessible name in this narrow static rule. */
const namedRoles = new Set(['dialog', 'alertdialog']);
/** Static checks intentionally avoid cross-component DOM assumptions and accessible-name synthesis. */
export const accessibilityRules: Record<string, Rule.RuleModule> = {
  'a11y-required-label': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        label:
          'This explicitly labelled component/dialog requires a non-empty label or labelled-by reference. Supply its authored name; do not derive one from arbitrary text.',
      },
    },
    create(context) {
      return {
        CallExpression(node: Node) {
          /** Lexically proven helper import; similarly named local functions remain untouched. */
          const binding = imported(context, node.callee);
          if (
            binding?.source !== '@zeruxjs/accessibility' ||
            binding.name !== 'applyLabelledComponentProps'
          ) {
            return;
          }
          /** Literal helper props; spreads and computed fields prevent a reliable static conclusion. */
          const props = node.arguments[1];
          if (
            props?.type !== 'ObjectExpression' ||
            props.properties.some(
              (item: Node) => item.type === 'SpreadElement' || item.computed
            )
          ) {
            return;
          }
          /** Candidate authored naming properties; dynamic values defer to runtime validation. */
          const names = props.properties.filter((item: Node) =>
            ['label', 'labelledBy'].includes(key(item) ?? '')
          );
          if (names.some((item: Node) => literal(item.value) === undefined)) {
            return;
          }
          if (!names.some((item: Node) => literal(item.value)?.trim())) {
            context.report({ node: props, messageId: 'label' });
          }
        },
        JSXOpeningElement(node: Node) {
          if (
            node.name.type !== 'JSXIdentifier' ||
            !/^[a-z]/.test(node.name.name) ||
            node.attributes.some(
              (item: Node) => item.type === 'JSXSpreadAttribute'
            )
          ) {
            return;
          }
          /** Literal native JSX role used to select the naming contract. */
          const role = value(attr(node, 'role'));
          if (!namedRoles.has(role ?? '')) {
            return;
          }
          /** Candidate authored naming properties; dynamic values defer to runtime validation. */
          const names = ['aria-label', 'aria-labelledby', 'title'].map((name) =>
            attr(node, name)
          );
          if (names.some(unknown)) {
            return;
          }
          if (!names.some((item) => value(item)?.trim())) {
            context.report({ node, messageId: 'label' });
          }
        },
      };
    },
  },
  'a11y-relationships': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        reference:
          'Use a non-empty, whitespace-separated ARIA ID reference (one ID for aria-activedescendant). Validate actual target existence at mount time.',
        self: 'aria-activedescendant must identify a related active descendant, not the owner itself.',
        duplicate:
          'Duplicate literal IDs in the same unconditional JSX subtree make ID relationships ambiguous.',
        tab: 'Use native order or zero/-1 tabindex; positive tabindex must not manufacture a component tab order.',
      },
    },
    create(context) {
      /** Per-rule invocation ID groups, bounded by the current source AST lifetime. */
      const groups = new Map<Node, Map<string, Node[]>>();
      return {
        JSXOpeningElement(node: Node) {
          if (
            node.name.type !== 'JSXIdentifier' ||
            !/^[a-z]/.test(node.name.name) ||
            node.attributes.some(
              (item: Node) => item.type === 'JSXSpreadAttribute'
            )
          ) {
            return;
          }
          /** Literal owner ID used for self-reference and duplicate-ID checks. */
          const own = value(attr(node, 'id'));
          // name selects a known ARIA relationship; validate authored literal references only.
          for (const name of [
            'aria-labelledby',
            'aria-describedby',
            'aria-controls',
            'aria-owns',
            'aria-activedescendant',
          ]) {
            /** Current ARIA relationship attribute, when statically present. Literal ARIA reference value; unknown dynamic expressions are left to runtime checks. */
            const attribute = attr(node, name),
              text = value(attribute);
            if (!attribute || text === undefined) {
              continue;
            }

            if (
              !text.trim() ||
              // eslint-disable-next-line no-control-regex -- Rejecting ASCII controls is intentional input validation.
              /[\u0000-\u001f\u007f]/.test(text) ||
              (name === 'aria-activedescendant' &&
                text.trim().split(/\s+/).length !== 1)
            ) {
              context.report({ node: attribute, messageId: 'reference' });
            } else if (
              name === 'aria-activedescendant' &&
              own &&
              own === text.trim()
            ) {
              context.report({ node: attribute, messageId: 'self' });
            }
          }
          /** Explicit tabindex attribute; zero and minus one preserve native ordering. Literal tabindex candidate after unwrapping a JSX expression container. */
          const tab = attr(node, 'tabIndex') ?? attr(node, 'tabindex'),
            tabNode =
              tab?.value?.type === 'JSXExpressionContainer'
                ? tab.value.expression
                : tab?.value;
          /** Numeric static tabindex value; only finite positive values are rejected. */
          const number =
            tabNode?.type === 'Literal' ? Number(tabNode.value) : undefined;
          if (number !== undefined && Number.isFinite(number) && number > 0) {
            context.report({ node: tab, messageId: 'tab' });
          }
          if (!own) {
            return;
          }
          let root = node.parent;
          // Stop at expressions/components; conditional/repeated render branches cannot prove uniqueness.
          while (
            root?.parent &&
            ['JSXElement', 'JSXFragment'].includes(root.parent.type)
          ) {
            /** Nearest containing JSX node considered for unconditional ID ownership. */
            const parent = root.parent;
            if (
              parent.type === 'JSXElement' &&
              (parent.openingElement.name.type !== 'JSXIdentifier' ||
                !/^[a-z]/.test(parent.openingElement.name.name))
            ) {
              break;
            }
            root = parent;
          }
          let ids = groups.get(root);
          if (!ids) {
            ids = new Map();
            groups.set(root, ids);
          }
          /** Elements sharing a literal ID within the same proven unconditional JSX root. */
          const entries = ids.get(own) ?? [];
          entries.push(node);
          ids.set(own, entries);
        },
        'Program:exit'() {
          // ids belongs to one proven unconditional JSX root; separate roots may reuse an ID.
          for (const ids of groups.values()) {
            // entries groups only identical literal IDs under that root.
            for (const entries of ids.values()) {
              if (entries.length > 1) {
                // node is one element in the proven duplicate set; report each affected authored location.
                for (const node of entries) {
                  context.report({ node, messageId: 'duplicate' });
                }
              }
            }
          }
        },
      };
    },
  },
};
