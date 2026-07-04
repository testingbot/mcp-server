import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

// MCP Apps view for the retrieveScreenshots tool. Rendering is idempotent —
// hosts re-deliver ui/notifications/tool-result when a conversation is
// reopened. All DOM is built with createElement/textContent.

const root = document.getElementById("root");

const app = new App({ name: "testingbot-screenshot-gallery", version: "1.0.0" });

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

function showLightbox(shot) {
  const overlay = el("div", "lightbox");
  const img = el("img");
  img.src = shot.imageUrl || shot.thumbUrl;
  img.alt = label(shot);
  overlay.appendChild(img);
  if (shot.imageUrl) {
    const open = el("button", null, "Open full size ↗");
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      openExternal(shot.imageUrl);
    });
    overlay.appendChild(open);
  }
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

function label(shot) {
  const browser = [shot.browser, shot.version].filter(Boolean).join(" ");
  return [browser, shot.os, shot.resolution].filter(Boolean).join(" · ") || "screenshot";
}

function render(data) {
  clearRoot();

  const header = el("div", "header");
  header.appendChild(el("h1", null, data.url || "Screenshots"));
  if (data.screenshots.length) {
    header.appendChild(el("span", "count", `${data.screenshots.length} screenshots`));
  }
  root.appendChild(header);

  if (!data.screenshots.length) {
    const processing = el("div", "processing");
    processing.appendChild(el("div", "spinner"));
    processing.appendChild(
      el(
        "span",
        null,
        data.state === "processing" || !data.state
          ? "Screenshots are still processing — run retrieveScreenshots again in a moment."
          : `No screenshots available (state: ${data.state}).`
      )
    );
    root.appendChild(processing);
    return;
  }

  const grid = el("div", "grid");
  data.screenshots.forEach((shot) => {
    const card = el("div", "card");
    const img = el("img");
    img.src = shot.thumbUrl || shot.imageUrl || "";
    img.loading = "lazy";
    img.alt = label(shot);
    img.addEventListener("click", () => showLightbox(shot));
    card.appendChild(img);
    card.appendChild(el("div", "label", label(shot)));
    grid.appendChild(card);
  });
  root.appendChild(grid);
}

app.ontoolinput = (params) => {
  const id = params && params.arguments ? params.arguments.screenshotId : null;
  renderLoading(id ? `Loading screenshots for job ${id}…` : "Loading screenshots…");
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
