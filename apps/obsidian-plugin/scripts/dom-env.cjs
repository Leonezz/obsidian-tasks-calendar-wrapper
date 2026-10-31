/**
 * Installs jsdom's window and document on globalThis for the tests/*.dom.test.ts bundles, which load it before
 * anything else, React included. scripts/test.mjs runs every test file in a process of its own.
 */
const { JSDOM } = require("jsdom");

const { window } = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });

for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "KeyboardEvent"]) {
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: window[name] });
}
for (const name of ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
	globalThis[name] = window[name].bind(window);
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
