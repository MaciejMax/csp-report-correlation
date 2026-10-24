// Serialize configuration as data, never as executable source or a comment.
function renderRecaptchaScript(config) {
  return `(${runDemo.toString()})(${JSON.stringify(config)});`;
}

function runDemo({ clientKey, token, timestamp, googleOrigin }) {
  console.log("[reCAPTCHA demo] Script loaded. Client key:", clientKey);
  console.log("[reCAPTCHA demo] Creating an iframe. Correlation token:", token);

  const iframe = document.createElement("iframe");
  iframe.src = `${googleOrigin}/recaptcha/frame?nonce=${encodeURIComponent(token)}`;
  iframe.style.cssText = "width:1px;height:1px;position:absolute;top:-9999px;";
  iframe.setAttribute("data-recaptcha-demo", "true");
  iframe.setAttribute("data-serve-ts", timestamp);
  iframe.setAttribute("data-client-key", clientKey);
  document.body.appendChild(iframe);

  console.log("[reCAPTCHA demo] Iframe added. Time since script serving:", Date.now() - timestamp, "ms");
  console.log("[reCAPTCHA demo] The browser will check frame-ancestors and may send a CSP report.");
}

module.exports = { renderRecaptchaScript };
