(function () {
  const SAVED_API_URL = "/apps/checkout/saved-products";

  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeStorageGet(key, fallbackRaw) {
    try {
      return localStorage.getItem(key) || fallbackRaw;
    } catch {
      return fallbackRaw;
    }
  }

  function normalizeId(value) {
    if (value == null) return "";
    const raw = String(value).trim();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return raw;
    const match = raw.match(/(\d+)(?!.*\d)/);
    return match ? match[1] : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function uniqIds(ids) {
    const seen = new Set();
    const out = [];
    ids.forEach((id) => {
      const n = Number(id);
      if (!Number.isFinite(n) || n <= 0 || seen.has(n)) return;
      seen.add(n);
      out.push(n);
    });
    return out;
  }

  function filterCardsByIds(container, ids, emptyNode, keepFallbackWhenEmpty) {
    if (!container) return;
    const cards = Array.from(container.querySelectorAll("[data-product-id]"));
    if (!cards.length) return;

    if (!ids.length && keepFallbackWhenEmpty) {
      cards.forEach((card) => {
        card.hidden = false;
      });
      if (emptyNode) emptyNode.hidden = true;
      return;
    }

    const byId = new Map();
    cards.forEach((card) => {
      const id = Number(card.getAttribute("data-product-id"));
      if (Number.isFinite(id)) byId.set(id, card);
      card.hidden = true;
    });

    let shown = 0;
    ids.forEach((id) => {
      const card = byId.get(Number(id));
      if (!card) return;
      card.hidden = false;
      container.appendChild(card);
      shown += 1;
    });

    if (emptyNode) emptyNode.hidden = shown > 0;
  }

  function normalizeSavedItems(raw) {
    return asArray(raw)
      .map((item) => {
        const id = normalizeId(item && item.id);
        if (!id) return null;

        return {
          id,
          url: typeof item.url === "string" ? item.url : "",
          title: typeof item.title === "string" ? item.title : "",
          image: typeof item.image === "string" ? item.image : "",
          price: typeof item.price === "string" ? item.price : "",
        };
      })
      .filter(Boolean);
  }

  function renderSavedCards(container, items) {
    if (!container) return 0;
    if (!items.length) {
      container.innerHTML = "";
      return 0;
    }

    const html = items
      .map((item) => {
        const id = escapeHtml(item.id || "");
        const url = escapeHtml(item.url || "#");
        const title = escapeHtml(item.title || "Product");
        const price = escapeHtml(item.price || "");
        const image = String(item.image || "").trim();

        const media = image
          ? `<a href="${url}"><img class="mk-account__card-media" loading="lazy" src="${escapeHtml(image)}" alt="${title}"></a>`
          : `<a href="${url}"><span class="mk-account__card-media"></span></a>`;

        const priceLine = price ? `<p class="mk-account__card-meta">${price}</p>` : "";

        return `<article class="mk-account__card" data-product-id="${id}">${media}<div class="mk-account__card-body"><h3 class="mk-account__card-title"><a href="${url}">${title}</a></h3>${priceLine}</div></article>`;
      })
      .join("");

    container.innerHTML = html;
    return items.length;
  }

  function bindTabs(root) {
    const buttons = Array.from(root.querySelectorAll("[data-account-tab-target]"));
    const panels = Array.from(root.querySelectorAll("[data-account-tab-panel]"));
    if (!buttons.length || !panels.length) return;

    const activate = (tab) => {
      buttons.forEach((btn) => {
        const active = btn.getAttribute("data-account-tab-target") === tab;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((panel) => {
        const active = panel.getAttribute("data-account-tab-panel") === tab;
        panel.classList.toggle("is-active", active);
      });
      if (history.replaceState) history.replaceState(null, "", `#${tab}`);
    };

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        activate(btn.getAttribute("data-account-tab-target"));
      });
    });

    const requestedTab = String(location.hash || "").replace("#", "").trim();
    const hasRequested = buttons.some((btn) => btn.getAttribute("data-account-tab-target") === requestedTab);
    activate(hasRequested ? requestedTab : buttons[0].getAttribute("data-account-tab-target"));
  }

  function bindOrderSearch(root) {
    const input = root.querySelector("[data-account-search]");
    const rows = Array.from(root.querySelectorAll("[data-order-row]"));
    if (!input || !rows.length) return;

    const run = () => {
      const q = String(input.value || "").trim().toLowerCase();
      rows.forEach((row) => {
        const hay = String(row.getAttribute("data-order-row") || "").toLowerCase();
        row.hidden = q ? !hay.includes(q) : false;
      });
    };

    input.addEventListener("input", run);
  }

  function hydrateSaved(root, items) {
    const savedContainer = root.querySelector("[data-saved-cards]");
    const savedEmpty = root.querySelector("[data-saved-empty]");
    if (!savedContainer) return;

    const renderedCount = renderSavedCards(savedContainer, normalizeSavedItems(items));
    if (savedEmpty) savedEmpty.hidden = renderedCount > 0;
  }

  async function fetchSavedFromServer() {
    try {
      const response = await fetch(SAVED_API_URL, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) return [];
      const data = await response.json().catch(() => ({}));
      return normalizeSavedItems(data && data.items);
    } catch {
      return [];
    }
  }

  function hydrateLists(root) {
    const historyContainer = root.querySelector("[data-history-cards]");
    const historyEmpty = root.querySelector("[data-history-empty]");

    const viewedIds = uniqIds(asArray(safeJsonParse(safeStorageGet("hypertheme:recently-viewed", "[]"), [])));

    filterCardsByIds(historyContainer, viewedIds, historyEmpty, true);
    hydrateSaved(root, []);

    fetchSavedFromServer().then((items) => {
      hydrateSaved(root, items);
    });
  }

  function initAccountPro(root) {
    bindTabs(root);
    bindOrderSearch(root);
    hydrateLists(root);

    document.addEventListener("mk:saved-products:changed", (event) => {
      const detail = event && event.detail ? event.detail : null;
      hydrateSaved(root, detail && detail.items ? detail.items : []);
    });
  }

  function boot() {
    document.querySelectorAll("[data-mk-account-root='1']").forEach((root) => {
      if (root.dataset.mkAccountReady === "1") return;
      root.dataset.mkAccountReady = "1";
      initAccountPro(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
