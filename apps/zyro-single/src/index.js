import { h, render, useState, useEffect } from './zyro.js';

/**
 * @title ZyroSingle App
 * @description Main application component for the Zyro Single demonstrate.
 */
function App() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        console.log("Count updated:", count());
    });

    return h("div", { class: "counter" },
        h("h1", null, "ZyroJS"),
        h("p", { class: "dim" }, "Experience fine-grained reactivity"),
        h("div", { class: "count-display" }, count),
        h("div", { class: "controls" },
            h("button", { onclick: () => setCount(count() - 1) }, "-"),
            h("button", { onclick: () => setCount(count() + 1) }, "+")
        ),
        h("p", { class: "dim", style: "margin-top: 2rem;" }, "Built with ZyroJS Library")
    );
}

// Initial render
render(h(App, null), document.getElementById("app"));
