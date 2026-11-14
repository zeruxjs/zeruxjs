/** Create per-owner compare-and-restore leases for explicitly written attributes.
 * @returns {{set:(element:Element,name:string,value:string|null)=>void,release:(element?:Element)=>void}} Local attribute owner; identical-value concurrent writes cannot be distinguished.
 */
export function attributeOwner() {
  /** Per-owner element/attribute history; different concurrent host writes must survive release. */
  const records = new Map<
    Element,
    Map<
      string,
      {
        /** Original/last observed host value restored only while helper ownership remains valid. */
        /** Original/last observed host value restored only while helper ownership remains valid. */
        before: string | null;
        /** Regions whose inert attribute is currently helper-owned. */
        /** Last helper-written scalar value; a different host value must survive release. */
        applied: string | null;
      }
    >
  >();
  /** Restore an original value only if the element still holds the last helper-written value.
   * @param {Element} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
   * @param {string} name - Fixed attribute/control/protocol name selected by the owning implementation.
   * @param {{ before: string | null; applied: string | null }} record - Captured original/last-applied values; preserve a different concurrent host update.
   * @param {| string | null} record.before - Original/last observed host value preserved for compare-and-restore.
   * @param {string | null} record.applied - Last helper-written value; a different current host value must survive release.
   * @returns {void} Restores the original value only while the last helper-applied value is still present.
   */
  const restore = (
    element: Element,
    name: string,
    record: {
      /** Original/last observed host value restored only while helper ownership remains valid. */
      /** Original/last observed host value restored only while helper ownership remains valid. */
      before: string | null;
      /** Regions whose inert attribute is currently helper-owned. */
      /** Last helper-written scalar value; a different host value must survive release. */
      applied: string | null;
    }
  ) => {
    if (element.getAttribute(name) !== record.applied) {
      return;
    }
    if (record.before === null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, record.before);
    }
  };
  return {
    /** Apply explicit validated values/attributes; no arbitrary executable content is evaluated.
     * @param {Element} element - Explicit element whose attribute lease belongs to this owner.
     * @param {string} name - Fixed native attribute/key name selected by the owner.
     * @param {string | null} value - Explicit authored value; validation/ownership depends on the declared method.
     * @returns {void} No value; records the observed host baseline and applies only this owned attribute write.
     */
    set(element: Element, name: string, value: string | null) {
      let attributes = records.get(element);
      if (!attributes) {
        attributes = new Map();
        records.set(element, attributes);
      }
      /** Actual current attribute value, inspected before acquiring/reusing a lease. */
      const current = element.getAttribute(name);
      /** Existing lease; a different host update becomes the new restoration baseline. */
      const old = attributes.get(name);
      /** Validate bounded own data descriptors without reading getters. */
      const record =
        old && current === old.applied
          ? old
          : { before: current, applied: current };
      record.applied = value;
      attributes.set(name, record);
      if (value === null) {
        element.removeAttribute(name);
      } else {
        element.setAttribute(name, value);
      }
    },
    /** Restore still-owned attributes and remove their captured history.
     * @param {Element} element - Explicit element whose attribute lease belongs to this owner.
     * @returns {void} No value; restores still-owned values for the selected element or all current leases.
     */
    release(element?: Element) {
      // Each target/attribute map belongs to this owner; selective release must leave other targets intact.
      for (const [target, attributes] of records) {
        if (element && target !== element) {
          continue;
        }
        // Each name/record retains an original and last-applied value; restore only a matching owned write.
        for (const [name, record] of attributes) {
          restore(target, name, record);
        }
        records.delete(target);
      }
    },
  };
}
