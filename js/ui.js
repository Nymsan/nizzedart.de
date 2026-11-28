// Small helpers for building the page.

export const $ = (selector, root = document) => root.querySelector(selector);

/** Create an element: `h("button", { className: "pill", textContent: "gem" }, ...children)`. */
export function h(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const dateFormat = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric" });
export const formatDate = (time) => dateFormat.format(time);

let toastTimer = 0;

/** Show a short message at the bottom of the page, optionally with one thing to do about it. */
export function toast(message, action = null) {
  const node = $("#toast");
  const hide = () => node.classList.remove("is-visible");
  node.replaceChildren(message);
  if (action) {
    const run = () => {
      hide();
      action.run();
    };
    node.append(h("button", { type: "button", className: "toast-action", textContent: action.label, onclick: run }));
  }
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 8000 : 3500);
}
