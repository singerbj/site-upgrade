// Tamper-proof "site upgrade" comparison overlay.
//
// Injected into the deployed site via a single <script src> tag in the
// built index.html. Renders inside a Shadow DOM so no host CSS can
// reach it, fetches /comparison.json for its data, sits at bottom-right
// (so it doesn't conflict with a bottom-anchored cookie banner), and
// degrades silently if the JSON is missing.
//
// This file is shipped verbatim; it is NOT processed by Vite.
(() => {
  if (window.__SITE_UPGRADE_OVERLAY_LOADED__) return;
  window.__SITE_UPGRADE_OVERLAY_LOADED__ = true;

  const STORAGE_KEY = "site-upgrade-overlay:dismissed";
  if (sessionStorage.getItem(STORAGE_KEY) === "permanent") return;

  fetch("/comparison.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      mount(data);
    })
    .catch(() => {});

  function mount(data) {
    const host = document.createElement("div");
    host.id = "site-upgrade-overlay";
    host.style.cssText =
      "position:fixed;bottom:1rem;right:1rem;z-index:2147483646;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "closed" });

    const css = `
      :host { all: initial; }
      .card {
        background: #0b0b10;
        color: #f3f4f6;
        border-radius: 14px;
        box-shadow: 0 18px 40px rgba(0,0,0,0.35);
        width: 320px;
        padding: 14px 16px;
        font: 13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .title { font-weight:600; font-size:13px; letter-spacing:0.01em; }
      .badge {
        display:inline-block;
        font-size:10px; font-weight:600; letter-spacing:0.04em;
        text-transform:uppercase;
        background: linear-gradient(135deg,#22d3ee,#a78bfa);
        color:#0b0b10; padding:2px 6px; border-radius:6px;
      }
      .row { display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-top:1px solid rgba(255,255,255,0.06); }
      .row:first-of-type { border-top:none; }
      .label { color:#cbd5e1; font-size:12px; }
      .nums { display:flex; align-items:baseline; gap:8px; font-variant-numeric: tabular-nums; }
      .old { color:#94a3b8; text-decoration: line-through; font-size:12px; }
      .new { color:#f3f4f6; font-weight:600; font-size:14px; }
      .delta { font-size:11px; font-weight:600; padding:1px 5px; border-radius:4px; }
      .up { background: rgba(34,197,94,0.15); color:#4ade80; }
      .flat { background: rgba(148,163,184,0.15); color:#cbd5e1; }
      .down { background: rgba(244,63,94,0.15); color:#fb7185; }
      .footer { display:flex; gap:8px; margin-top:10px; }
      button {
        all: unset; cursor:pointer;
        font:600 11px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        letter-spacing:0.04em; text-transform:uppercase;
        padding:7px 10px; border-radius:8px;
      }
      button.primary { background:#f3f4f6; color:#0b0b10; }
      button.primary:hover { background:#fff; }
      button.ghost { background:rgba(255,255,255,0.06); color:#cbd5e1; }
      button.ghost:hover { background:rgba(255,255,255,0.10); color:#f3f4f6; }
      .meta { font-size:11px; color:#94a3b8; margin-top:6px; }
      .collapsed { padding:10px 14px; cursor:pointer; }
      .collapsed:hover { background: #14141c; }
      .collapsed .pill { display:inline-flex; align-items:center; gap:6px; }
      .pulse { width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 0 rgba(74,222,128,.6); animation:pulse 2.4s infinite; }
      @keyframes pulse { 0% {box-shadow:0 0 0 0 rgba(74,222,128,.6);} 70% {box-shadow:0 0 0 6px rgba(74,222,128,0);} 100% {box-shadow:0 0 0 0 rgba(74,222,128,0);} }
      @media (prefers-reduced-motion: reduce) { .pulse { animation:none; } }
    `;

    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    root.appendChild(styleEl);

    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "complementary");
    card.setAttribute("aria-label", "Site upgrade comparison");

    let expanded = localStorage.getItem(STORAGE_KEY + ":collapsed") !== "1";
    render();

    function render() {
      card.innerHTML = "";
      if (!expanded) {
        const c = document.createElement("div");
        c.className = "collapsed";
        c.tabIndex = 0;
        c.setAttribute("role", "button");
        c.setAttribute("aria-expanded", "false");
        c.setAttribute("aria-label", "Show site upgrade comparison");
        c.innerHTML = `<span class="pill"><span class="pulse"></span> <span class="title">Upgraded site</span> <span class="badge">demo</span></span>`;
        const expand = () => {
          expanded = true;
          localStorage.removeItem(STORAGE_KEY + ":collapsed");
          render();
        };
        c.addEventListener("click", expand);
        c.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") expand();
        });
        card.appendChild(c);
        return;
      }

      const head = document.createElement("div");
      head.className = "head";
      head.innerHTML = `<span class="title">Upgraded site <span class="badge">demo</span></span>`;
      card.appendChild(head);

      const rows = data.metrics || [];
      for (const m of rows) {
        const hasOld = m.old != null && m.old !== "";
        const hasNew = m.new != null && m.new !== "";
        // Skip rows with no data on either side — keeps the card focused
        // on metrics that actually demonstrate a delta.
        if (!hasOld && !hasNew) continue;
        const r = document.createElement("div");
        r.className = "row";
        const oldStr = formatVal(m.old, m.scale);
        const newStr = formatVal(m.new, m.scale);
        // Only render the delta chip when both sides have a number;
        // otherwise we'd show a misleading "+0" against an empty old.
        let deltaHtml = "";
        if (hasOld && hasNew) {
          const cls = m.delta > 0 ? "up" : m.delta < 0 ? "down" : "flat";
          const sign = m.delta > 0 ? "+" : "";
          deltaHtml = `<span class="delta ${cls}">${sign}${m.delta}</span>`;
        }
        r.innerHTML = `
          <span class="label">${escape(m.label)}</span>
          <span class="nums">
            <span class="old">${oldStr}</span>
            <span class="new">${newStr}</span>
            ${deltaHtml}
          </span>
        `;
        card.appendChild(r);
      }

      if (data.business?.name) {
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `Comparison generated by site-upgrade for ${data.business.name}.`;
        card.appendChild(meta);
      }

      const foot = document.createElement("div");
      foot.className = "footer";
      const learn = document.createElement("button");
      learn.className = "primary";
      learn.textContent = "How we did it";
      learn.addEventListener("click", () => alert(buildExplain(data)));
      const minimize = document.createElement("button");
      minimize.className = "ghost";
      minimize.textContent = "Minimize";
      minimize.addEventListener("click", () => {
        expanded = false;
        localStorage.setItem(STORAGE_KEY + ":collapsed", "1");
        render();
      });
      const dismiss = document.createElement("button");
      dismiss.className = "ghost";
      dismiss.textContent = "Hide";
      dismiss.title = "Hide for this session";
      dismiss.addEventListener("click", () => {
        sessionStorage.setItem(STORAGE_KEY, "permanent");
        host.remove();
      });
      foot.append(learn, minimize, dismiss);
      card.appendChild(foot);
    }

    root.appendChild(card);
  }

  function formatVal(v, scale) {
    if (v == null || v === "") return "—";
    if (scale === "10") return `${v}/10`;
    return String(v);
  }

  function buildExplain(data) {
    const old = data.old_summary || "";
    const nu = data.new_summary || "";
    return [
      "Site upgrade — how the comparison was scored",
      "",
      "Lighthouse: ran the official Lighthouse audit against both sites in a fresh headless Chrome.",
      "Design + quality: scored from a homepage screenshot by a vision model.",
      "SEO: scored from head metadata, headings, structured data, and page content.",
      "AEO (Answer Engine Optimization): scored on how well an LLM-driven search could extract a citable answer from the page.",
      "",
      old ? `Existing site: ${old}` : "",
      nu ? `Upgraded site: ${nu}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function escape(s) {
    return String(s ?? "").replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
    );
  }
})();
