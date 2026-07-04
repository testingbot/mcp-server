import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

// MCP Apps view for the getTestDetails tool. Rendering is idempotent — hosts
// re-deliver ui/notifications/tool-result when a conversation is reopened.
// All DOM is built with createElement/textContent: test names, status
// messages and step payloads are user-controlled strings.

const root = document.getElementById("root");

const app = new App({ name: "testingbot-test-details", version: "1.0.0" });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clearRoot() {
  while (root.firstChild) root.removeChild(root.firstChild);
}

function openExternal(url) {
  app.openLink({ url }).catch(() => {});
}

function syncTheme(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
}

function textOf(result) {
  return (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function renderError(message) {
  clearRoot();
  root.appendChild(el("div", "error", message || "Something went wrong."));
}

function renderLoading(message) {
  clearRoot();
  root.appendChild(el("p", "loading", message));
}

// Fallback for results without structuredContent (older server builds).
function renderFallback(text) {
  clearRoot();
  const pre = el("pre", null, text);
  pre.style.whiteSpace = "pre-wrap";
  pre.style.overflowWrap = "anywhere";
  root.appendChild(pre);
}

function showLightbox(url) {
  const overlay = el("div", "lightbox");
  const img = el("img");
  img.src = url;
  img.alt = "Screenshot (enlarged)";
  overlay.appendChild(img);
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}

function statusPill(status) {
  const kind = status === "Passed" ? "pass" : status === "Failed" ? "fail" : "unknown";
  return el("span", `pill ${kind}`, status || "Unknown");
}

function render(test) {
  clearRoot();

  const header = el("div", "header");
  header.appendChild(statusPill(test.status));
  header.appendChild(el("h1", null, test.name || test.sessionId || "Test"));
  root.appendChild(header);

  if (test.statusMessage) {
    root.appendChild(el("p", "status-message", test.statusMessage));
  }

  const chips = el("div", "chips");
  const chipValues = [
    test.browser,
    test.platform,
    test.deviceName,
    test.type,
    test.duration != null ? `${test.duration}s` : null,
    test.build ? `build: ${test.build}` : null,
    test.createdAt ? new Date(test.createdAt).toLocaleString() : null,
  ].filter(Boolean);
  chipValues.forEach((value) => chips.appendChild(el("span", "chip", value)));
  if (chipValues.length) root.appendChild(chips);

  if (test.video) {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = test.video;
    root.appendChild(video);
  }

  if (Array.isArray(test.thumbs) && test.thumbs.length) {
    root.appendChild(el("div", "section-title", `Screenshots (${test.thumbs.length})`));
    const strip = el("div", "thumbs");
    test.thumbs.forEach((thumbUrl, index) => {
      const img = el("img");
      img.src = thumbUrl;
      img.loading = "lazy";
      img.alt = `Screenshot ${index + 1}`;
      img.addEventListener("click", () => showLightbox(thumbUrl));
      strip.appendChild(img);
    });
    root.appendChild(strip);
  }

  const logEntries = Object.entries(test.logs || {}).filter(([, url]) => url);
  const buttons = el("div", "buttons");
  logEntries.forEach(([kind, url]) => {
    const button = el("button", "link", `${kind} log`);
    button.addEventListener("click", () => openExternal(url));
    buttons.appendChild(button);
  });
  if (test.testUrl) {
    const button = el("button", "link primary", "Open in TestingBot ↗");
    button.addEventListener("click", () => openExternal(test.testUrl));
    buttons.appendChild(button);
  }
  if (buttons.childNodes.length) {
    root.appendChild(el("div", "section-title", "Logs & links"));
    root.appendChild(buttons);
  }

  if (Array.isArray(test.steps) && test.steps.length) {
    const details = el("details");
    details.appendChild(el("summary", null, `Test steps (${test.steps.length})`));
    test.steps.forEach((step, index) => {
      const row = el("div", "step");
      row.appendChild(el("div", "cmd", `${index + 1}. ${step.command || ""}`));
      if (step.arguments) row.appendChild(el("div", "sub", `args: ${step.arguments}`));
      if (step.response) row.appendChild(el("div", "sub", `response: ${step.response}`));
      details.appendChild(row);
    });
    root.appendChild(details);
  }
}

app.ontoolinput = (params) => {
  const sessionId = params && params.arguments ? params.arguments.sessionId : null;
  renderLoading(sessionId ? `Loading test ${sessionId}…` : "Loading test details…");
};

app.ontoolresult = (result) => {
  if (result.isError) return renderError(textOf(result));
  if (result.structuredContent) return render(result.structuredContent);
  renderFallback(textOf(result));
};

app.onhostcontextchanged = () => syncTheme(app.getHostContext());

(async () => {
  try {
    await app.connect();
    syncTheme(app.getHostContext());
  } catch (error) {
    renderError(`Could not connect to the host: ${error && error.message ? error.message : error}`);
  }
})();
