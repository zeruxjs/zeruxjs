import { h, render, useState, useEffect } from "./index.js";

/**
 * @title Demo Component
 * @description A simple counter component demonstrating ZyroJS.
 */
function Counter() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        console.log("Count changed to:", count());
    });

    return h("div", { class: "counter" },
        h("h1", null, "ZyroJS Counter"),
        h("p", null, "Count: ", count()),
        h("button", { onclick: () => setCount(count() + 1) }, "Increment"),
        h("button", { onclick: () => setCount(count() - 1) }, "Decrement")
    );
}

// In a real app, you would do:
// render(h(Counter, null), document.getElementById("app")!);
