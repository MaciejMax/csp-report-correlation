const express = require("express");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createReportStore } = require("./lib/report-store");
const { renderRecaptchaScript } = require("./lib/recaptcha-script");

const PORT_LINKEDIN = 4000;
const PORT_GOOGLE = 5000;
const GOOGLE_ORIGIN = `http://localhost:${PORT_GOOGLE}`;
const CORRELATION_PREFIX = "tracking_correlation_nonce_";
const TOKEN_PATTERN = /^tracking_correlation_nonce_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const publicDir = path.join(__dirname, "public");

function createApps({ reportsFile = path.join(__dirname, "reports", "collected.json") } = {}) {
  const store = createReportStore(reportsFile);
  const linkedinApp = express();
  const googleApp = express();

  function record(type, req, data) {
    const timestamp = Date.now();
    const entry = {
      type,
      ...data,
      ip: req.ip,
      referrer: req.get("referer") || "",
      userAgent: req.get("user-agent") || "",
      timestamp,
      isoTime: new Date(timestamp).toISOString(),
    };
    store.save(entry);
    return entry;
  }

  linkedinApp.get("/", (req, res) => res.sendFile(path.join(publicDir, "linkedin.html")));
  googleApp.use(express.json({ type: ["application/json", "application/csp-report", "application/reports+json"] }));

  googleApp.get("/recaptcha/enterprise.js", (req, res) => {
    const clientKey = typeof req.query.render === "string" && req.query.render ? req.query.render : "unknown";
    const token = CORRELATION_PREFIX + randomUUID();
    const entry = record("script-served", req, { token, clientKey });
    res.set("Cache-Control", "no-store").type("js").send(renderRecaptchaScript({
      clientKey, token, timestamp: entry.timestamp, googleOrigin: GOOGLE_ORIGIN,
    }));
    console.log(`[Script served] enterprise.js: ${token}`);
  });

  googleApp.get("/recaptcha/frame", (req, res) => {
    const token = req.query.nonce;
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      return res.status(400).send("Missing or invalid correlation nonce.");
    }
    // The policy belongs to the framed document, not to the script response.
    res.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": `frame-ancestors 'self' localhost:${PORT_GOOGLE}; report-uri ${GOOGLE_ORIGIN}/csp/frame-ancestors/${token}`,
    }).type("html").send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>reCAPTCHA frame (demo)</title></head><body>reCAPTCHA frame (demo)</body></html>');
  });

  function collect(type) {
    return (req, res) => {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Expected a JSON report body." });
      }
      record(type, req, { token: req.params.token, report: req.body });
      console.log(`[CSP report] ${type}: ${req.params.token}`);
      res.status(204).end();
    };
  }

  googleApp.post("/csp/frame-ancestors/:token", collect("csp-frame-ancestors"));
  // Optional collector for Reporting API clients; the demo itself uses report-uri.
  googleApp.post("/csp/report-to/:token", collect("reporting-api"));

  googleApp.get(["/", "/dashboard"], (req, res) => res.sendFile(path.join(publicDir, "dashboard.html")));
  googleApp.use("/assets", express.static(publicDir, { index: false }));
  googleApp.get("/api/reports", (req, res) => {
    res.set("Cache-Control", "no-store").json(store.load());
  });
  googleApp.delete("/api/reports", (req, res) => {
    store.clear();
    res.json({ ok: true });
  });

  return { linkedinApp, googleApp };
}

if (require.main === module) {
  const { linkedinApp, googleApp } = createApps();
  linkedinApp.listen(PORT_LINKEDIN);
  googleApp.listen(PORT_GOOGLE, () => {
    console.log(`Open the dashboard: ${GOOGLE_ORIGIN}/dashboard`);
  });
}

module.exports = { createApps };
