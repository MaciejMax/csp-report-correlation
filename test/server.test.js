const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const { createApps } = require("../server");

test("script, iframe, collector, and dashboard share the correlation token", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "csp-demo-test-"));
  const reportsFile = path.join(directory, "reports", "collected.json");
  const { linkedinApp, googleApp } = createApps({ reportsFile });
  const servers = [linkedinApp.listen(0, "127.0.0.1"), googleApp.listen(0, "127.0.0.1")];
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    })));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await Promise.all(servers.map(server => once(server, "listening")));
  const [linkedin, google] = servers.map(server => `http://127.0.0.1:${server.address().port}`);

  const page = await (await fetch(linkedin)).text();
  assert.match(page, /lang="en"/);
  assert.match(page, /localhost:5000\/recaptcha\/enterprise.js\?render=recaptcha_key_for_linkedin/);
  assert.match(page, /localhost:5000\/dashboard/);

  // A hostile value must remain a string in the generated script.
  const clientKey = '"; globalThis.injected = true; // */\n<img>';
  const firstResponse = await fetch(`${google}/recaptcha/enterprise.js?render=${encodeURIComponent(clientKey)}`, {
    headers: { Referer: "http://localhost:4000/" },
  });
  assert.equal(firstResponse.headers.get("cache-control"), "no-store");
  assert.equal(firstResponse.headers.get("content-security-policy"), null);
  const script = await firstResponse.text();
  const first = JSON.parse(fs.readFileSync(reportsFile, "utf8"))[0];
  assert.match(first.token, /^tracking_correlation_nonce_[0-9a-f-]{36}$/);
  assert.equal(first.referrer, "http://localhost:4000/");

  let iframe;
  const sandbox = {
    console: { log() {} },
    document: {
      createElement() { iframe = { style: {}, setAttribute() {} }; return iframe; },
      body: { appendChild() {} },
    },
  };
  vm.runInNewContext(script, sandbox);
  assert.equal(sandbox.injected, undefined);
  const frameURL = new URL(iframe.src);
  assert.equal(frameURL.searchParams.get("nonce"), first.token);

  await fetch(`${google}/recaptcha/enterprise.js?render=another_client`);
  const second = JSON.parse(fs.readFileSync(reportsFile, "utf8"))[0];
  assert.notEqual(second.token, first.token);

  assert.equal((await fetch(`${google}/recaptcha/frame`)).status, 400);
  const frame = await fetch(`${google}${frameURL.pathname}${frameURL.search}`);
  assert.equal(frame.headers.get("cache-control"), "no-store");
  assert.equal(frame.headers.get("content-security-policy"),
    `frame-ancestors 'self' localhost:5000; report-uri http://localhost:5000/csp/frame-ancestors/${first.token}`);

  // The first script's report arrives after a second script request.
  const report = { "csp-report": { "effective-directive": "frame-ancestors", disposition: "enforce" } };
  const posted = await fetch(`${google}/csp/frame-ancestors/${first.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/csp-report", Referer: "http://localhost:4000/" },
    body: JSON.stringify(report),
  });
  assert.equal(posted.status, 204);
  const events = await (await fetch(`${google}/api/reports`)).json();
  assert.equal(events[0].token, first.token);
  assert.deepEqual(events[0].report, report);
  assert.equal(events[0].referrer, "http://localhost:4000/");
  assert.equal(events[1].token, second.token);

  const modern = await fetch(`${google}/csp/report-to/${second.token}`, {
    method: "POST", headers: { "Content-Type": "application/reports+json" },
    body: JSON.stringify([{ type: "csp-violation", body: {} }]),
  });
  assert.equal(modern.status, 204);
  assert(Array.isArray((await (await fetch(`${google}/api/reports`)).json())[0].report));

  for (const route of ["/", "/dashboard", "/assets/dashboard.css", "/assets/dashboard.js"]) {
    assert.equal((await fetch(google + route)).status, 200, route);
  }
  assert.equal((await fetch(`${google}/api/reports`, { method: "DELETE" })).status, 200);
  assert.deepEqual(await (await fetch(`${google}/api/reports`)).json(), []);
});

test("report storage creates its directory and retains only the newest events", (t) => {
  const { createReportStore } = require("../lib/report-store");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "csp-store-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createReportStore(path.join(directory, "nested", "reports.json"), 2);
  assert.deepEqual(store.load(), []);
  for (const id of [1, 2, 3]) store.save({ id });
  assert.deepEqual(store.load(), [{ id: 3 }, { id: 2 }]);
  store.clear();
  assert.deepEqual(store.load(), []);
});
