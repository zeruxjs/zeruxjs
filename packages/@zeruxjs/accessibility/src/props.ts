import { attributeOwner } from './ownership.js';
/** Authored names, state and relationships; no text synthesis or server authorization. */
export interface ComponentA11yProps {
  /** Explicit nonblank authored accessible name; inserted as text/attribute data, not HTML. */
  label?: string;
  /** Authored whitespace-separated naming IDs; actual same-root targets must exist. */
  labelledBy?: string;
  /** Authored description IDs; text is not synthesized or copied into diagnostics. */
  describedBy?: string;
  /** Explicit controlled-root ID references; runtime relationships remain role-dependent. */
  controls?: string;
  /** Explicit owned-root ID references for structural active-descendant validation. */
  owns?: string;
  /** Exactly one related descendant/owned target ID; self references reject. */
  activeDescendant?: string;
  /** Explicit authored role; conflicting existing roles reject rather than being overwritten. */
  role?: string;
  /** Native/custom UI disabled state; never substitutes for server authorization. */
  disabled?: boolean;
  /** Explicit authored expansion state; no behavior or relationship is invented. */
  expanded?: boolean;
  /** Explicit authored selection state; no activation or authorization is inferred. */
  selected?: boolean;
}
/** Explicit component names; neither branch invents a name from arbitrary text. */
export type LabelledComponentProps = ComponentA11yProps &
  (
    | {
        /** Explicit nonblank authored accessible name; inserted as text/attribute data, not HTML. */
        label: string;
        /** Authored whitespace-separated naming IDs; actual same-root targets must exist. */
        labelledBy?: never;
      }
    | {
        /** Explicit nonblank authored accessible name; inserted as text/attribute data, not HTML. */
        label?: never;
        /** Authored whitespace-separated naming IDs; actual same-root targets must exist. */
        labelledBy: string;
      }
  );
/** Redacted validation category/property record; supplied text values are not copied. */
export interface AccessibilityIssue {
  /** Fixed validation issue category, without the supplied label/reference content. */
  readonly code:
    | 'INVALID_PROP'
    | 'MISSING_LABEL'
    | 'AMBIGUOUS_LABEL'
    | 'MISSING_ID'
    | 'DUPLICATE_ID'
    | 'INVALID_RELATIONSHIP'
    | 'CONFLICTING_ROLE'
    | 'POSITIVE_TABINDEX';
  /** Property name associated with the issue, not the private value or a DOM text dump. */
  readonly property: string;
}
/** Explicit reference-root and descendant-scan policy for mounted/detached validation. */
export interface ComponentValidationOptions {
  /** Explicit reference root, otherwise getRootNode(); unrelated/shadow roots are not inferred. */
  root?: Document | ShadowRoot | HTMLElement;
  /** Require an authored name/reference when true; native generic labeling remains a host responsibility. */
  requireLabel?: boolean;
  /** Positive scan/list budget, default 10,000 and maximum 50,000; root-query semantics are documented per API. */
  maxElements?: number;
}
/** Fixed-message validation failure with a frozen array of redacted issue records. */
export class AccessibilityValidationError extends TypeError {
  /** Frozen issue list; contains property names, never supplied label/reference text. */
  readonly issues: readonly AccessibilityIssue[];
  /** Construct a fixed-envelope error without interpolating supplied text.
   * @param {readonly AccessibilityIssue[]} issues - Caller-owned redacted records; the array is copied/frozen without deep-cloning records.
   */
  constructor(issues: readonly AccessibilityIssue[]) {
    super('Invalid accessibility component props');
    this.name = 'AccessibilityValidationError';
    this.issues = Object.freeze([...issues]);
  }
}
/** Known prop-to-attribute projection; unknown props are not spread onto the DOM. */
const attributes: Record<string, string> = {
  label: 'aria-label',
  labelledBy: 'aria-labelledby',
  describedBy: 'aria-describedby',
  controls: 'aria-controls',
  owns: 'aria-owns',
  activeDescendant: 'aria-activedescendant',
  role: 'role',
  expanded: 'aria-expanded',
  selected: 'aria-selected',
};
/** Supported reference-bearing props requiring bounded same-root ID lookup. */
const idProps = [
  'labelledBy',
  'describedBy',
  'controls',
  'owns',
  'activeDescendant',
];
/** Validate authored props and bounded same-root ID relationships without changing DOM or reading label text.
 * @param {HTMLElement} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @param {ComponentA11yProps} input - Candidate own data; no executable strings/getters are evaluated as preferences or content.
 * @param {ComponentValidationOptions} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @returns {readonly AccessibilityIssue[]} Frozen redacted issues; invalid scan budgets/roots throw rather than falsely passing.
 * @throws {RangeError} For invalid/exceeded ID scan budgets; budget exhaustion never returns a passing issue list.
 * @throws {TypeError} When requested references have no queryable DOM root.
 */
export function validateComponentProps(
  element: HTMLElement,
  input: ComponentA11yProps,
  options: ComponentValidationOptions = {}
): readonly AccessibilityIssue[] {
  /** Per-validation issue records; label text/reference content is never copied into errors. */
  const issues: AccessibilityIssue[] = [];
  /** Append a fixed code/property issue without mutating the inspected DOM.
   * @param {AccessibilityIssue['code']} code - Fixed diagnostic code; never include persisted values or approved speech text.
   * @param {string} property - Issue field identifier, not label/reference text or an error payload.
   * @returns {number} New issue count after appending a redacted code/property record.
   */
  const report = (code: AccessibilityIssue['code'], property: string) =>
    issues.push(Object.freeze({ code, property }));
  if (
    !element ||
    typeof element.getAttribute !== 'function' ||
    !input ||
    typeof input !== 'object' ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input))
  ) {
    report('INVALID_PROP', 'props');
    return Object.freeze(issues);
  }
  /** Own input descriptors checked before any value access or attribute writes. */
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(descriptors).length > 16 ||
    Object.getOwnPropertySymbols(input).length
  ) {
    report('INVALID_PROP', 'props');
    return Object.freeze(issues);
  }
  /** Validated own data props; inherited/accessor/unknown values are excluded. */
  const props: Record<string, unknown> = Object.create(null);
  // Inspect own data descriptors before reading values so getters cannot supply component content.
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (
      !Object.hasOwn(descriptor, 'value') ||
      (!Object.hasOwn(attributes, name) && name !== 'disabled')
    ) {
      report('INVALID_PROP', name);
      continue;
    }
    /** Literal prop/reference value; validated before it enters relationships or attributes. */
    const value = descriptor.value;
    if (value === undefined) {
      continue;
    }

    if (
      ['disabled', 'expanded', 'selected'].includes(name)
        ? typeof value !== 'boolean'
        : typeof value !== 'string' ||
          !value.trim() ||
          value.length > 1024 ||
          // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
          /[\u0000-\u001f\u007f]/.test(value)
    ) {
      report('INVALID_PROP', name);
      continue;
    }
    props[name] = value;
  }
  /** Explicit or retained authored aria-label; the helper does not synthesize names. */
  const label = props.label ?? element.getAttribute('aria-label');
  /** Explicit or retained aria-labelledby reference; referenced text is not read here. */
  const labelledBy =
    props.labelledBy ?? element.getAttribute('aria-labelledby');
  if (
    options.requireLabel &&
    !String(label ?? '').trim() &&
    !String(labelledBy ?? '').trim()
  ) {
    report('MISSING_LABEL', 'label');
  }
  if (props.label !== undefined && props.labelledBy !== undefined) {
    report('AMBIGUOUS_LABEL', 'label');
  }
  if (
    props.role !== undefined &&
    element.hasAttribute('role') &&
    element.getAttribute('role') !== props.role
  ) {
    report('CONFLICTING_ROLE', 'role');
  }
  if (element.tabIndex > 0) {
    report('POSITIVE_TABINDEX', 'tabindex');
  }
  /** Validated descendant-ID scan bound, defaulting to 10,000 and capped at 50,000. */
  const max = options.maxElements ?? 10000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 50000) {
    throw new RangeError('Invalid accessibility DOM budget');
  }
  /** Explicit/root-tree lookup boundary; unrelated shadow/DOM roots are never inferred. */
  const root =
    options.root ??
    (element.getRootNode() as Document | ShadowRoot | HTMLElement);
  /** ID lookup map for this validation invocation only; duplicates remain visible. */
  const references = new Map<string, HTMLElement[]>();
  /** Only explicitly supplied or existing supported reference properties are resolved. */
  const requested = idProps.filter(
    (name) =>
      props[name] !== undefined ||
      (attributes[name] !== undefined && element.hasAttribute(attributes[name]))
  );
  if (requested.length) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      throw new TypeError('A DOM reference root is required');
    }
    /** Descendant ID-bearing elements checked against the scan budget before map construction. */
    const found = root.querySelectorAll<HTMLElement>('[id]');
    if (found.length > max) {
      throw new RangeError('Accessibility DOM budget exceeded');
    }
    /** Descendant IDs plus an explicit element root ID when present. */
    const nodes = [...found];
    if ('getAttribute' in root && (root as HTMLElement).hasAttribute('id')) {
      nodes.unshift(root as HTMLElement);
    }
    // node is inside the explicit reference tree; retain duplicate IDs instead of choosing silently.
    for (const node of nodes) {
      /** Authored ID string compared directly rather than embedded in a CSS selector. */
      const id = node.getAttribute('id')!;
      /** All matching nodes retained so duplicate IDs cannot silently resolve to one target. */
      const list = references.get(id) ?? [];
      list.push(node);
      references.set(id, list);
    }
  }
  /** Validated reference targets used to check active-descendant ownership relationships. */
  const resolved = new Map<string, HTMLElement[]>();
  // name selects a supported authored ID relationship; unknown attributes are not inferred.
  for (const name of requested) {
    /** Known native attribute corresponding to this validated relationship name. */
    const attribute = attributes[name];
    /** Literal prop/reference value; validated before it enters relationships or attributes. */
    const value = String(
      props[name] ??
        (attribute === undefined ? undefined : element.getAttribute(attribute)) ??
        ''
    );
    /** Whitespace-separated reference tokens with bounded count, length and uniqueness. */
    const ids = value.trim().split(/\s+/);
    if (
      !value.trim() ||
      value.length > 1024 ||
      ids.length > 32 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => id.length > 128) ||
      (name === 'activeDescendant' && ids.length !== 1)
    ) {
      report('INVALID_PROP', name);
      continue;
    }
    /** Unique existing targets for the current property; invalid matches produce issues. */
    const targets: HTMLElement[] = [];
    // id is a bounded exact token compared against the same-root lookup, not interpolated into selectors.
    for (const id of ids) {
      /** Exact same-root ID matches; missing/duplicates remain explicit errors. */
      const matches = references.get(id) ?? [];
      if (matches.length === 0) {
        report('MISSING_ID', name);
      } else if (matches.length > 1) {
        report('DUPLICATE_ID', name);
      } else {
        /** Sole same-root target retained after duplicate and missing-ID checks. */
        const target = matches[0];
        if (target) {
          targets.push(target);
        }
      }
    }
    resolved.set(name, targets);
  }
  /** Single resolved active descendant whose structural ownership must be proven. */
  const active = resolved.get('activeDescendant')?.[0];
  if (active) {
    /** Explicitly owned or combobox-controlled branches allowed to contain the active descendant. */
    const owned = [
      ...(resolved.get('owns') ?? []),
      ...(element.getAttribute('role') === 'combobox' ||
      props.role === 'combobox'
        ? (resolved.get('controls') ?? [])
        : []),
    ];
    if (
      active === element ||
      (!element.contains(active) &&
        !owned.some((node) => node === active || node.contains(active)))
    ) {
      report('INVALID_RELATIONSHIP', 'activeDescendant');
    }
  }
  return Object.freeze(issues);
}
/** Validate all props before acquiring attribute leases or disabled capture listeners.
 * @param {HTMLElement} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @param {ComponentA11yProps} props - Explicit authored accessibility props validated before any owned write.
 * @param {ComponentValidationOptions} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @returns {{destroy:()=>void}} Owned disposer restoring only still-owned attributes/listeners; never grants server permission.
 * @throws {AccessibilityValidationError} For invalid authored props/relationships, before acquiring any attribute/listener ownership.
 */
export function applyComponentProps(
  element: HTMLElement,
  props: ComponentA11yProps,
  options: ComponentValidationOptions = {}
) {
  /** Per-validation issue records; label text/reference content is never copied into errors. */
  const issues = validateComponentProps(element, props, options);
  if (issues.length) {
    throw new AccessibilityValidationError(issues);
  }
  /** Applied attribute leases released only when host changes have not superseded them. */
  const owner = attributeOwner();
  // Apply only validated known props, with owned disabled semantics handled separately.
  for (const [name, value] of Object.entries(props)) {
    if (name !== 'disabled' && value !== undefined) {
      /** Native attribute name for this supported property, if one is defined. */
      const attribute = attributes[name];
      if (attribute !== undefined) {
        owner.set(element, attribute, String(value));
      }
    }
  }
  /** Whether disabled semantics belong to the native HTML disabled attribute. */
  const native =
    /^(BUTTON|INPUT|SELECT|TEXTAREA|OPTION|OPTGROUP|FIELDSET)$/.test(
      element.tagName
    );
  if (props.disabled !== undefined) {
    owner.set(element, 'aria-disabled', String(props.disabled));
    if (native) {
      owner.set(element, 'disabled', props.disabled ? '' : null);
    }
  }
  /** Captured explicit disabled policy; UI activation blocking never authorizes server work. */
  const disabled = props.disabled;
  /** Owned capture handler blocking click/Enter/Space only while this custom control is disabled.
   * @param {Event} event - Borrowed native event; no fabricated trusted user action is created here.
   * @returns {void} Prevents disabled custom click/Enter/Space activation; server authorization is unrelated.
   */
  const block = (event: Event) => {
    if (
      disabled &&
      (event.type === 'click' ||
        ['Enter', ' '].includes((event as KeyboardEvent).key))
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  if (props.disabled && !native) {
    element.addEventListener('click', block, true);
    element.addEventListener('keydown', block, true);
    element.addEventListener('keyup', block, true);
  }
  let disposed = false;
  return {
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} Method outcome; only resources/state owned by this handle are affected.
     */
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      element.removeEventListener('click', block, true);
      element.removeEventListener('keydown', block, true);
      element.removeEventListener('keyup', block, true);
      owner.release();
    },
  };
}
/** Require exactly one explicit authored naming prop, then apply the validated owned contract.
 * @param {HTMLElement} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @param {LabelledComponentProps} props - Explicit authored accessibility props validated before any owned write.
 * @param {ComponentValidationOptions} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @returns {{destroy:()=>void}} Owned prop binding; native labels/text remain the generic/native component responsibility.
 * @throws {AccessibilityValidationError} For absent/ambiguous explicit naming or invalid component relationships before writes.
 */
export function applyLabelledComponentProps(
  element: HTMLElement,
  props: LabelledComponentProps,
  options: ComponentValidationOptions = {}
) {
  if (
    !props ||
    (Object.getOwnPropertyDescriptor(props, 'label')?.value === undefined &&
      Object.getOwnPropertyDescriptor(props, 'labelledBy')?.value === undefined)
  ) {
    throw new AccessibilityValidationError([
      Object.freeze({ code: 'MISSING_LABEL', property: 'label' }),
    ]);
  }
  return applyComponentProps(element, props, {
    ...options,
    requireLabel: true,
  });
}
