// Small deterministic DOM harness for lifecycle tests. Not a replacement for a real browser.
/** Deterministic DOM node fixture used by Node-based renderer tests. */
export class NodeFake {
  /**
   * Initialize a fake DOM node with mutable child, attribute and listener state.
   *
   * @param {DocumentFake|null} doc - Owning fixture document.
   * @param {number} type - DOM node type.
   * @param {string} name - Fixture node name.
   */
  constructor(doc, type, name = '') {
    this.ownerDocument = doc;
    this.nodeType = type;
    this.nodeName = name;
    this.parentNode = null;
    this.childNodes = [];
    this.data = '';
    this.attributeMap = new Map();
    this.listeners = new Map();
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.style = {
      cssText: '',
      setProperty: (key, v) => {
        this.style[key] = v;
      },
    };
  }
  /**
   * Return the fixture's current attribute records.
   * @returns {Array<{name: string, value: string}>} Current attribute records.
   */
  get attributes() {
    return [...this.attributeMap].map(([name, value]) => ({ name, value }));
  }
  /**
   * Return the next sibling in the fixture tree, if present.
   * @returns {NodeFake|null} Next sibling in the fixture tree, if present.
   */
  get nextSibling() {
    if (!this.parentNode) {
      return null;
    }
    /**
     * Snapshot the parent's children so the sibling lookup uses fixture order.
     */
    const all = this.parentNode.childNodes;
    return all[all.indexOf(this) + 1] ?? null;
  }
  /**
   * Read text content while ignoring comment nodes.
   * @returns {string} Text content while ignoring comment nodes.
   */
  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) {
      return this.data;
    }
    return this.childNodes
      .filter((child) => child.nodeType !== 8)
      .map((child) => child.textContent)
      .join('');
  }
  /**
   * Replace the node's text content and detach previous children.
   * @param {string} value - Replacement text content.
   */
  set textContent(value) {
    if (this.nodeType === 3 || this.nodeType === 8) {
      this.data = String(value);
    } else {
      for (const node of this.childNodes) {
        node.parentNode = null;
      }
      this.childNodes = [];
      if (value) {
        this.appendChild(this.ownerDocument.createTextNode(value));
      }
    }
  }
  /**
   * Insert a node before an optional anchor.
   *
   * @param {NodeFake} node - Node to insert.
   * @param {NodeFake|null} anchor - Existing node to insert before.
   * @returns {NodeFake} The inserted node.
   */
  insertBefore(node, anchor) {
    if (node === anchor) {
      return node;
    }
    if (anchor && !this.childNodes.includes(anchor)) {
      throw new Error('wrong anchor');
    }
    node.parentNode?.removeChild(node);
    this.childNodes.splice(
      anchor ? this.childNodes.indexOf(anchor) : this.childNodes.length,
      0,
      node
    );
    node.parentNode = this;
    return node;
  }
  /**
   * Append a node to this fixture.
   * @param {NodeFake} node - Node to append.
   * @returns {NodeFake} The appended node.
   */
  appendChild(node) {
    return this.insertBefore(node, null);
  }
  /**
   * Remove a node from this fixture.
   * @param {NodeFake} node - Node to remove.
   * @returns {NodeFake} The removed node.
   */
  removeChild(node) {
    /**
     * Locate the child before removing it and clearing its parent reference.
     */
    const index = this.childNodes.indexOf(node);
    if (index < 0) {
      throw new Error('missing child');
    }
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  /**
   * Set a string-valued fixture attribute.
   * @param {string} key - Attribute name.
   * @param {unknown} value - Attribute value.
   * @returns {void} No value.
   */
  setAttribute(key, value) {
    this.attributeMap.set(key, String(value));
  }
  /**
   * Remove a fixture attribute by name.
   * @param {string} key - Attribute name.
   * @returns {void} No value.
   */
  removeAttribute(key) {
    this.attributeMap.delete(key);
  }
  /**
   * Read a fixture attribute.
   * @param {string} key - Attribute name.
   * @returns {string|null} Stored value.
   */
  getAttribute(key) {
    return this.attributeMap.get(key) ?? null;
  }
  /**
   * Register a fixture event listener.
   * @param {string} event - Event name.
   * @param {Function} handler - Listener callback.
   * @returns {void} No value.
   */
  addEventListener(event, handler) {
    /**
     * Reuse the event's listener set so repeated registrations remain isolated
     * from listeners registered for other event names.
     */
    const current = this.listeners.get(event) ?? new Set();
    current.add(handler);
    this.listeners.set(event, current);
  }
  /**
   * Remove a fixture event listener.
   * @param {string} event - Event name.
   * @param {Function} handler - Listener callback.
   * @returns {void} No value.
   */
  removeEventListener(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }
  /**
   * Dispatch an event to the current listeners.
   * @param {string} type - Event name to dispatch.
   * @returns {void} No value.
   */
  dispatch(type) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) {
      handler({ type, target: this });
    }
  }
}
/** Deterministic document fixture that creates NodeFake instances. */
export class DocumentFake extends NodeFake {
  /** Initialize the document root fixture. */
  constructor() {
    super(null, 9, '#document');
    this.ownerDocument = this;
  }
  /**
   * Create an element fixture.
   * @param {string} name - Element tag name.
   * @returns {NodeFake} Created element.
   */
  createElement(name) {
    return new NodeFake(this, 1, name.toUpperCase());
  }
  /**
   * Create a text node fixture.
   * @param {string} text - Text content.
   * @returns {NodeFake} Created text node.
   */
  createTextNode(text) {
    /**
     * Create the text node with the DOM node type used by renderer checks.
     */
    const node = new NodeFake(this, 3, '#text');
    node.data = String(text);
    return node;
  }
  /**
   * Create a comment node fixture.
   * @param {string} text - Comment content.
   * @returns {NodeFake} Created comment node.
   */
  createComment(text) {
    /**
     * Create the comment node with the DOM node type used by renderer checks.
     */
    const node = new NodeFake(this, 8, '#comment');
    node.data = String(text);
    return node;
  }
}
/**
 * Create the root element used by renderer fixture tests.
 * @returns {NodeFake} A detached fixture element.
 */
export const root = () => {
  /**
   * Keep each root backed by its own document so tests do not share state.
   */
  const doc = new DocumentFake();
  return doc.createElement('div');
};
