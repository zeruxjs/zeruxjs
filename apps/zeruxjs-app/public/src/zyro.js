// src/reactivity/effect.ts
var subscriberStack = [];
function getCurrentSubscriber() {
  return subscriberStack[subscriberStack.length - 1];
}
function effect(subscriber) {
  const run = () => {
    subscriberStack.push(run);
    try {
      subscriber();
    } finally {
      subscriberStack.pop();
    }
  };
  run();
}

// src/reactivity/signal.ts
var isBatching = false;
var pendingEffects = /* @__PURE__ */ new Set();
function batch(fn) {
  isBatching = true;
  try {
    fn();
  } finally {
    isBatching = false;
    const effects = Array.from(pendingEffects);
    pendingEffects.clear();
    effects.forEach((effect2) => effect2());
  }
}
var SignalImpl = class {
  _value;
  _subscribers = /* @__PURE__ */ new Set();
  constructor(initialValue) {
    this._value = initialValue;
  }
  get value() {
    const sub = getCurrentSubscriber();
    if (sub) {
      this._subscribers.add(sub);
    }
    return this._value;
  }
  set value(newValue) {
    if (this._value !== newValue) {
      this._value = newValue;
      this.notify();
    }
  }
  peek() {
    return this._value;
  }
  notify() {
    this._subscribers.forEach((sub) => {
      if (isBatching) {
        pendingEffects.add(sub);
      } else {
        sub();
      }
    });
  }
};
function signal(initialValue) {
  return new SignalImpl(initialValue);
}
function reactive(target) {
  const signals = {};
  return new Proxy(target, {
    get(obj, prop) {
      if (!signals[prop]) {
        signals[prop] = signal(obj[prop]);
      }
      return signals[prop].value;
    },
    set(obj, prop, value) {
      if (!signals[prop]) {
        signals[prop] = signal(value);
      }
      signals[prop].value = value;
      obj[prop] = value;
      return true;
    }
  });
}

// src/reactivity/computed.ts
var ComputedImpl = class {
  _signal = signal(void 0);
  _dirty = true;
  _fn;
  constructor(fn) {
    this._fn = fn;
    effect(() => {
      this._dirty = true;
      this._signal.value = this.value;
    });
  }
  get value() {
    if (this._dirty) {
      this._signal.value = this._fn();
      this._dirty = false;
    }
    return this._signal.value;
  }
  peek() {
    return this._signal.peek();
  }
};
function computed(fn) {
  return new ComputedImpl(fn);
}

// src/dom/vnode.ts
function h(type, props, ...children) {
  return {
    type,
    props: props || {},
    children: children.flat().filter((child) => child !== null && child !== void 0 && child !== false)
  };
}

// src/dom/render.ts
function mount(vnode, container) {
  if (vnode == null || typeof vnode === "boolean") return;
  if (typeof vnode === "string" || typeof vnode === "number") {
    const el = document.createTextNode(String(vnode));
    container.appendChild(el);
    return el;
  }
  if (typeof vnode === "function") {
    const el = document.createTextNode("");
    effect(() => {
      el.textContent = String(vnode());
    });
    container.appendChild(el);
    return el;
  }
  const vn = vnode;
  if (typeof vn.type === "string") {
    const el = document.createElement(vn.type);
    vn.el = el;
    Object.entries(vn.props).forEach(([key, value]) => {
      patchProp(el, key, null, value);
    });
    vn.children.forEach((child) => mount(child, el));
    container.appendChild(el);
    return el;
  }
  if (typeof vn.type === "function") {
    const componentVNode = vn.type(vn.props);
    return mount(componentVNode, container);
  }
}
function patchProp(el, key, prevValue, nextValue) {
  if (key.startsWith("on")) {
    const eventName = key.slice(2).toLowerCase();
    if (prevValue) el.removeEventListener(eventName, prevValue);
    if (nextValue) el.addEventListener(eventName, nextValue);
  } else if (typeof nextValue === "function") {
    effect(() => {
      el[key] = nextValue();
    });
  } else {
    el[key] = nextValue;
  }
}
function patch(container, vnode, oldVNode) {
  if (!oldVNode) {
    mount(vnode, container);
  } else if (vnode.type !== oldVNode.type) {
    const newEl = mount(vnode, container);
    if (oldVNode.el && oldVNode.el.parentNode) {
      oldVNode.el.parentNode.replaceChild(newEl, oldVNode.el);
    }
  } else {
    const el = vnode.el = oldVNode.el;
    const oldProps = oldVNode.props;
    const newProps = vnode.props;
    for (const key in newProps) {
      if (newProps[key] !== oldProps[key]) {
        patchProp(el, key, oldProps[key], newProps[key]);
      }
    }
    for (const key in oldProps) {
      if (!(key in newProps)) {
        patchProp(el, key, oldProps[key], null);
      }
    }
  }
}
function render(vnode, container) {
  const oldVNode = container._zyro_vnode;
  patch(container, vnode, oldVNode);
  container._zyro_vnode = vnode;
}

// src/hook/index.ts
function useState(initialValue) {
  const s = signal(initialValue);
  const getter = () => s.value;
  const setter = (val) => {
    s.value = val;
  };
  return [getter, setter];
}
function useReactive(initialValue) {
  return reactive(initialValue);
}
function useEffect(fn) {
  effect(fn);
}
function useMemo(fn) {
  const c = computed(fn);
  return () => c.value;
}
function useRef(initialValue) {
  return { current: initialValue };
}
export {
  batch,
  computed,
  effect,
  getCurrentSubscriber,
  h,
  mount,
  patch,
  reactive,
  render,
  signal,
  useEffect,
  useMemo,
  useReactive,
  useRef,
  useState
};
