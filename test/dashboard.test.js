const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Minimal DOM for exercising grouping and text rendering without a browser.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.open = false;
    this.textContent = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(fragment) { this.children = fragment.children; }
  querySelectorAll() {
    return this.children.flatMap(node => [
      ...(node.tag === "details" ? [node] : []), ...node.querySelectorAll(),
    ]);
  }
  addEventListener() {}
}

test("dashboard groups interleaved reports by nonce and expands both event types", () => {
  const nodes = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new Element("div"));
      return nodes.get(id);
    },
    createElement(tag) { return new Element(tag); },
    createDocumentFragment() { return new Element("fragment"); },
  };
  const a = "tracking_correlation_nonce_A", b = "tracking_correlation_nonce_B";
  const entries = [
    { type: "csp-frame-ancestors", timestamp: 1300, token: a },
    { type: "csp-frame-ancestors", timestamp: 1250, token: b },
    { type: "script-served", timestamp: 1100, token: b, clientKey: "B" },
    { type: "script-served", timestamp: 1000, token: a, clientKey: "<img src=x onerror=alert(1)>" },
  ];
  const source = fs.readFileSync(path.join(__dirname, "../public/dashboard.js"), "utf8");
  const context = vm.createContext({ document, entries, Intl });
  new vm.Script(source);
  vm.runInContext(source.slice(0, source.indexOf("async function loadReports")), context);
  vm.runInContext("render(entries)", context);
  const cards = nodes.get("events").children;
  assert.equal(cards.length, 2);
  assert.match(cards[0].children[0].children[1].textContent, /300 ms/);
  assert.match(cards[1].children[0].children[1].textContent, /150 ms/);
  assert.match(cards[0].children[1].children.at(-1).textContent, /script-served/);
  assert.match(cards[0].children[0].children[0].textContent, /<img/);
  assert(nodes.get("events").querySelectorAll().every(row => row.open));
  cards[0].children[1].open = false;
  vm.runInContext("render(entries)", context);
  assert.equal(nodes.get("events").children[0].children[1].open, false);

  context.entries = [{ type: "csp-frame-ancestors", token: "legacy", timestamp: 9999 }];
  vm.runInContext("render(entries)", context);
  assert.match(nodes.get("events").children[0].children[0].children[1].textContent, /No script/);
  context.entries = [];
  vm.runInContext("render(entries)", context);
  assert.equal(nodes.get("events").children[0].className, "empty");
});
