// extensions/delivery-extension/assets/cart.js
// Pricing preview + auto add/remove campaign gift items via /apps/checkout/prepare
// - Items source of truth: /cart.js (NOT DOM)
// - DOM is used only for badges rendering (best effort)
// - Debounced + guarded against parallel calls
// - Robust against non-JSON (e.g., HTML error pages)

(function () {
  if (window.__mk_cart_preview_loaded) return;
  window.__mk_cart_preview_loaded = true;
  const PREVIEW_ENDPOINT = "/apps/checkout/prepare";
  const MK_DEBUG =
    (typeof window !== "undefined" && window.__MK_DEBUG_CART === true) ||
    (typeof location !== "undefined" && /(?:\?|&)mk_debug_cart=1(?:&|$)/.test(String(location.search || "")));
  const MK_STATS = (window.__mkCartStats =
    window.__mkCartStats || {
      cartRead: 0,
      prepare: 0,
      cartAdd: 0,
      cartChange: 0,
    });

  if (!window.__mkCartUpdatedPayloadGuardBound) {
    window.__mkCartUpdatedPayloadGuardBound = true;
    document.addEventListener(
      "cart:updated",
      (event) => {
        try {
          const detail = event?.detail;
          if (!detail || typeof detail !== "object") return;
          if (detail.cart && typeof detail.cart === "object") return;

          const cachedCart =
            (window.__itellaPickupRuntime && window.__itellaPickupRuntime.cartCache) ||
            null;
          const subtotal =
            Number(detail.items_subtotal_price) ||
            Number(cachedCart?.items_subtotal_price) ||
            Number(cachedCart?.total_price) ||
            0;

          detail.cart = {
            ...(cachedCart || {}),
            items_subtotal_price: subtotal,
          };
        } catch {}
      },
      true,
    );
  }
  // MK: simplest + most stable UX: show gifts as real cart lines (FREE), no campaign blocks in cart UI
    const MK_USE_CAMPAIGN_BLOCKS = false;

  function mkDebug(...args) {
    if (!MK_DEBUG) return;
    console.debug("[mk cart]", ...args);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  window.__mkCartGetStats = function () {
    return { ...MK_STATS };
  };
  window.__mkCartResetStats = function () {
    Object.keys(MK_STATS).forEach((k) => {
      MK_STATS[k] = 0;
    });
    mkDebug("stats reset");
  };

  (function ensureGiftLineCss() {
    if (document.getElementById("mk-gift-line-css")) return;
    const style = document.createElement("style");
    style.id = "mk-gift-line-css";
    style.textContent = `
      [data-mk-gift-line="true"] {
        background: linear-gradient(90deg, rgba(22,163,74,.08), rgba(250,204,21,.10));
        border: 1px solid rgba(22,163,74,.22);
        border-radius: 10px;
      }
      [data-mk-gift-line="true"] .mk-gift-price {
        display: inline-flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 6px;
      }
      [data-mk-gift-line="true"] .mk-gift-price-old {
        text-decoration: line-through;
        opacity: .7;
      }
      [data-mk-gift-line="true"] .mk-gift-price-free {
        color: #166534;
        font-weight: 700;
      }
      [data-mk-gift-line="true"] .mk-gift-price-campaign {
        display: block;
        margin-top: 2px;
        font-size: 11px;
        opacity: .85;
      }
    `;
    document.head.appendChild(style);
  })();

  (function ensureMemberPriceCss() {
    if (document.getElementById("mk-member-price-css")) return;
    const style = document.createElement("style");
    style.id = "mk-member-price-css";
    style.textContent = `
      .mk-member-price {
        display: inline-flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 6px;
      }
      .mk-member-price-old {
        text-decoration: line-through;
        opacity: .65;
      }
      .mk-member-price-new {
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
  })();

  (function ensureFreeChoiceCss() {
    if (document.getElementById("mk-free-choice-css")) return;
    const style = document.createElement("style");
    style.id = "mk-free-choice-css";
    style.textContent = `
      .mk-free-choice-panel {
        margin: 0 0 12px 0;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid rgba(14,116,144,.25);
        background: linear-gradient(135deg, rgba(6,182,212,.08), rgba(34,197,94,.08));
      }
      .mk-free-choice-title {
        font-weight: 700;
        margin-bottom: 6px;
      }
      .mk-free-choice-subtitle {
        font-size: 12px;
        opacity: .78;
        margin-bottom: 8px;
      }
      .mk-free-choice-select {
        width: 100%;
        border: 1px solid rgba(0,0,0,.18);
        border-radius: 10px;
        background: #fff;
        padding: 10px 12px;
        font-size: 14px;
      }
      .mk-free-choice-row + .mk-free-choice-row {
        margin-top: 8px;
      }
      .mk-free-choice-row-label {
        display: block;
        font-size: 12px;
        opacity: .78;
        margin: 0 0 4px 0;
      }
      [data-mk-gift-choice="1"] {
        display: grid;
        gap: 6px;
        margin-top: 4px;
      }
      .mk-gift-inline-row {
        display: grid;
        gap: 4px;
      }
      .mk-gift-inline-label {
        font-size: 12px;
        opacity: .78;
        margin: 0;
      }
      .mk-gift-inline-select {
        width: 100%;
        border: 1px solid rgba(0,0,0,.18);
        border-radius: 10px;
        background: #fff;
        padding: 7px 10px;
        font-size: 13px;
      }
    `;
    document.head.appendChild(style);
  })();

  (function ensureHideNativeTotalCss() {
    if (document.getElementById("mk-hide-native-total-css")) return;
    const style = document.createElement("style");
    style.id = "mk-hide-native-total-css";
    style.textContent = `
      [data-mk-hide-native-total="1"] { display: none !important; }
    `;
    document.head.appendChild(style);
  })();

// --- MK: split helpers (campaign allocated vs remaining) ---
function mkSum(obj) {
  if (!obj || typeof obj !== "object") return 0;
  let s = 0;
  for (const k of Object.keys(obj)) s += Number(obj[k] || 0);
  return s;
}

// Builds per-variant allocation map for ONE campaign block (we take min needed)
// For BuyXGetZFree and BuyXGetZChoice, UI needs to allocate exactly buyQuantity to block.
function mkPickAllocationForCampaign(pricingLines, campaignId, buyQtyNeeded) {
  const out = new Map(); // variantGid -> allocatedQty
  let need = Math.max(0, Number(buyQtyNeeded || 0));
  if (!campaignId || need <= 0) return out;

  for (const ln of pricingLines || []) {
    if (need <= 0) break;
    if (!ln || ln.isGiftLine) continue;

    const cq = ln.campaignQuantities || {};
    const declared = Number(cq[campaignId] || 0);
    if (declared <= 0) continue;

    // allocate only what we still need (fixes the "+1 becomes part of campaign" UI bug)
    const take = Math.min(declared, need);
    if (take > 0) {
      out.set(ln.variantId, take);
      need -= take;
    }
  }
  return out;
}

function mkGetBuyQtyFromMeta(meta) {
  if (!meta || typeof meta !== "object") return 0;

  // максимально терпимый парсер — под разные структуры backend'а
  const candidates = [
    meta.buyQuantity,
    meta.buyQty,
    meta.x,
    meta?.buy?.quantity,
    meta?.requirements?.buyQuantity,
    meta?.requirements?.buyQty,
    meta?.config?.buyQuantity,
    meta?.config?.buyQty,
    meta?.params?.buyQuantity,
    meta?.params?.buyQty,
    meta?.rule?.buyQuantity,
    meta?.rule?.buyQty,
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return 0;
}

// строим allocationMaps ТОЛЬКО для кампаний, которые реально дают gift lines
function mkBuildAllocMaps(pricing) {
  const maps = new Map(); // campaignId -> Map(variantGid -> allocatedQty)
  const lines = Array.isArray(pricing?.lines) ? pricing.lines : [];
  const applied = Array.isArray(pricing?.appliedCampaigns) ? pricing.appliedCampaigns : [];

  const giftLines = lines.filter((l) => l && l.isGiftLine && l.giftCampaignId);
  const idSet = new Set(giftLines.map((l) => String(l.giftCampaignId)));

idSet.forEach((campaignId) => {
  const meta = applied.find((c) => String(c?.id) === String(campaignId));
  const buyQtyNeeded = mkGetBuyQtyFromMeta(meta);
  console.log("[mk alloc] campaign", campaignId, "buyQtyNeeded=", buyQtyNeeded, "meta=", meta);

  maps.set(String(campaignId), mkPickAllocationForCampaign(lines, String(campaignId), buyQtyNeeded || 999999));
});


  return maps;
}

function mkAllocForLine(allocMaps, campaignId, variantGid) {
  const m = allocMaps?.get?.(String(campaignId));
  if (!m) return 0;
  return Number(m.get(variantGid) || 0);
}

function mkAllocSumForLine(allocMaps, campaignIds, variantGid) {
  let s = 0;
  (campaignIds || []).forEach((cid) => {
    s += mkAllocForLine(allocMaps, cid, variantGid);
  });
  return s;
}


  function toGid(variantId) {
    const raw = String(variantId || "").trim();
    if (!raw) return "";
    if (raw.startsWith("gid://")) return raw;
    return `gid://shopify/ProductVariant/${raw.replace(/[^\d]/g, "")}`;
  }

  function resolveCustomerIdForPricing() {
    const pickupRoot = document.querySelector("[data-itella-pickup-root='1']");
    const datasetCustomerId = String(pickupRoot?.getAttribute?.("data-customer-id") || "").trim();
    if (datasetCustomerId) return datasetCustomerId;

    const datasetLoggedIn = String(pickupRoot?.getAttribute?.("data-customer-logged-in") || "") === "true";
    if (datasetLoggedIn) return "logged-in";

    const globalCustomerId = String(window.__MK_CUSTOMER_ID || "").trim();
    if (globalCustomerId) return globalCustomerId;

    if (window.__MK_CUSTOMER_LOGGED_IN === true) return "logged-in";

    const shopifyCustomerId = String(window?.Shopify?.customer_id || window?.Shopify?.customerId || "").trim();
    if (shopifyCustomerId) return shopifyCustomerId;

    const analyticsCustomerId = String(window?.ShopifyAnalytics?.meta?.page?.customerId || "").trim();
    if (analyticsCustomerId) return analyticsCustomerId;

    return null;
  }

  function gidToNumericVariantId(gid) {
    const m = String(gid || "").match(/ProductVariant\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  async function readCart() {
    MK_STATS.cartRead += 1;
    const res = await fetch("/cart.js", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to read /cart.js");
    return await res.json();
  }

  let knownCartAttributes = null;
  let cartAttributesWriteInFlight = false;

  async function writeCartAttributesPatch(patch, currentAttributes) {
    const normalizedPatch = {};
    Object.keys(patch || {}).forEach((key) => {
      normalizedPatch[key] = patch[key] == null ? "" : String(patch[key]);
    });

    if (!Object.keys(normalizedPatch).length) return false;
    if (cartAttributesWriteInFlight) return false;

    cartAttributesWriteInFlight = true;
    try {
      const current =
        (currentAttributes && typeof currentAttributes === "object" && currentAttributes) ||
        (knownCartAttributes && typeof knownCartAttributes === "object" && knownCartAttributes) ||
        ((await readCart())?.attributes || {});

      const next = { ...current };
      let changed = false;

      for (const [key, value] of Object.entries(normalizedPatch)) {
        if (String(current?.[key] ?? "") !== String(value ?? "")) {
          changed = true;
        }
        next[key] = value;
      }

      if (!changed) return false;

      const res = await fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ attributes: next }),
      });
      if (!res.ok) {
        throw new Error(`cart/update.js failed: ${res.status}`);
      }

      knownCartAttributes = next;
      return true;
    } finally {
      cartAttributesWriteInFlight = false;
    }
  }

  async function refreshMainCartMarkup() {
    const cartRoot = getMainCartRoot();
    if (!cartRoot || !cartRoot.id) return false;

    const sectionId = cartRoot.id.replace(/^MainCart-/, "");
    if (!sectionId || sectionId === cartRoot.id) return false;

    try {
      const html = await fetch(`/cart?section_id=${encodeURIComponent(sectionId)}`, { cache: "no-store" }).then((r) =>
        r.text(),
      );
      const doc = new DOMParser().parseFromString(html, "text/html");
      const next = doc.querySelector("main-cart");
      if (!next) return false;

      suppressMutationsUntil = Date.now() + 1200;
      cartRoot.innerHTML = next.innerHTML;
      mkDebug("main cart markup refreshed after gifts sync");
      return true;
    } catch (e) {
      console.warn("[cart.js] refreshMainCartMarkup failed", e);
      return false;
    }
  }

  function requestDrawerRefreshAfterGiftSync() {
    try {
      document.dispatchEvent(
        new CustomEvent("cart:refresh", {
          detail: {
            open: false,
            source: "mk-cart",
            reason: "gifts-changed",
          },
        }),
      );
      mkDebug("cart:refresh dispatched after gifts sync");
    } catch (e) {
      console.warn("[cart.js] failed to dispatch cart:refresh", e);
    }
  }

  function formatMoney(value, currency) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0.00";
    if (typeof Intl !== "undefined" && currency) {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
      } catch {}
    }
    return n.toFixed(2);
  }

  function parseDeliveryAmount(rawPrice) {
    const raw = String(rawPrice || "").trim();
    if (!raw) return 0;
    const normalized = raw.replace(",", ".").replace(/[^\d.-]/g, "");
    const value = Number.parseFloat(normalized);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
  }

  function getMainCartRoot() {
    return document.querySelector("main-cart[id^='MainCart-']") || document.querySelector("main-cart") || null;
  }

  function getChoicePanelHostRoot() {
    return (
      document.querySelector("[data-mk-applied-campaigns]") ||
      getMainCartRoot() ||
      document.getElementById("CartDrawer") ||
      document.querySelector("cart-drawer")
    );
  }

  function normalizeChoiceOptions(choiceContext, currencyCode) {
    const direct = Array.isArray(choiceContext?.choiceOptions) ? choiceContext.choiceOptions : [];
    const fallbackIds = Array.isArray(choiceContext?.choices) ? choiceContext.choices : [];
    const source = direct.length ? direct : fallbackIds.map((variantId) => ({ variantId, label: variantId }));

    const out = [];
    const seen = new Set();

    source.forEach((item) => {
      const variantId = toGid(item?.variantId || item?.id || "");
      if (!variantId || seen.has(variantId)) return;
      seen.add(variantId);

      const label = String(item?.label || variantId);
      const price = Number(item?.price);
      const hasPrice = Number.isFinite(price) && price > 0;

      out.push({
        variantId,
        label,
        priceText: hasPrice ? formatMoney(price, String(item?.currencyCode || currencyCode || "EUR")) : "",
      });
    });

    return out;
  }

  function parseFreeChoiceSelectionsAttr(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((id) => toGid(id))
          .filter(Boolean);
      }
    } catch {}

    if (text.includes("|")) {
      return text
        .split("|")
        .map((id) => toGid(id))
        .filter(Boolean);
    }

    const one = toGid(text);
    return one ? [one] : [];
  }

  function removeFreeChoicePanel() {
    document.querySelectorAll("[data-mk-free-choice-panel]").forEach((node) => {
      try {
        node.remove();
      } catch {}
    });
  }

  function renderFreeChoicePanel(pricing, attrs) {
    removeFreeChoicePanel();
  }

  function buildGiftChoiceModel(pricing, attrs) {
    const choiceContext = pricing?.choiceContext;
    if (!choiceContext?.campaignId) return null;

    const options = normalizeChoiceOptions(choiceContext, pricing?.currencyCode || "EUR");
    if (!options.length) return null;

    const validIds = new Set(options.map((opt) => opt.variantId));
    const selectedFromContext = Array.isArray(choiceContext?.selectedChoices)
      ? choiceContext.selectedChoices
          .map((id) => toGid(id))
          .filter((id) => validIds.has(id))
      : [];
    const selectedFromAttrs = parseFreeChoiceSelectionsAttr(attrs?.itella_free_choice_selections).filter((id) =>
      validIds.has(id),
    );
    const selectedSingle = toGid((attrs?.itella_free_choice_variant_id || "").trim());

    const baseSelected = selectedFromContext.length
      ? selectedFromContext
      : selectedFromAttrs.length
        ? selectedFromAttrs
        : selectedSingle && validIds.has(selectedSingle)
          ? [selectedSingle]
          : [options[0].variantId];

    const giftQty = Math.max(1, Number(choiceContext?.giftQty || 1));
    const selectedChoices = baseSelected.slice(0, giftQty);
    while (selectedChoices.length < giftQty) {
      selectedChoices.push(selectedChoices[0] || options[0].variantId);
    }

    return {
      campaignId: String(choiceContext.campaignId),
      giftQty,
      options,
      selectedChoices,
    };
  }

  function buildGiftChoiceSlotsByPricingLine(pricing, choiceModel) {
    const map = new Map();
    if (!choiceModel) return map;

    const lines = Array.isArray(pricing?.lines) ? pricing.lines : [];
    let cursor = 0;

    lines.forEach((line, lineIndex) => {
      if (!line?.isGiftLine) return;
      if (String(line.giftCampaignId || "") !== String(choiceModel.campaignId)) return;

      const qty = Math.max(1, Number(line.quantity || 1));
      const slots = [];

      for (let i = 0; i < qty; i += 1) {
        const slotIndex = cursor + i + 1;
        const selected =
          choiceModel.selectedChoices[cursor + i] ||
          choiceModel.selectedChoices[0] ||
          choiceModel.options[0]?.variantId ||
          "";
        slots.push({ slotIndex, variantId: selected });
      }

      map.set(lineIndex, slots);
      cursor += qty;
    });

    return map;
  }

  function clearGiftChoiceControls(lineRoot) {
    if (!lineRoot) return;

    lineRoot.querySelectorAll("[data-mk-gift-choice='1']").forEach((node) => {
      try {
        node.remove();
      } catch {}
    });

    lineRoot.querySelectorAll("[data-mk-title-hidden-by-choice='1']").forEach((node) => {
      node.style.display = "";
      node.removeAttribute("data-mk-title-hidden-by-choice");
    });
  }

  function renderGiftChoiceControls(lineRoot, choiceModel, campaignId, slotChoices) {
    if (!lineRoot) return;
    if (!choiceModel || String(choiceModel.campaignId) !== String(campaignId || "")) {
      clearGiftChoiceControls(lineRoot);
      return;
    }

    const titleNode =
      lineRoot.querySelector(".cart-item__title") ||
      lineRoot.querySelector("[class*='cart-item__title']") ||
      lineRoot.querySelector("[class*='CartItem__Title']");
    if (!titleNode || !titleNode.parentElement) return;

    titleNode.style.display = "none";
    titleNode.setAttribute("data-mk-title-hidden-by-choice", "1");

    let wrapper = lineRoot.querySelector("[data-mk-gift-choice='1']");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.setAttribute("data-mk-gift-choice", "1");
      titleNode.parentElement.insertBefore(wrapper, titleNode);
    }

    const slots = Array.isArray(slotChoices) && slotChoices.length
      ? slotChoices
      : [{ slotIndex: 1, variantId: choiceModel.selectedChoices[0] || choiceModel.options[0]?.variantId || "" }];

    const buildOptionsHtml = (selected) =>
      choiceModel.options
        .map(
          (opt) =>
            `<option value="${escapeHtml(opt.variantId)}"${opt.variantId === selected ? " selected" : ""}>${escapeHtml(
              opt.label,
            )}${opt.priceText ? ` (${escapeHtml(opt.priceText)})` : ""}</option>`,
        )
        .join("");

    wrapper.innerHTML = slots
      .map((slot, idx) => {
        const selected = slot.variantId || slots[0]?.variantId || choiceModel.options[0]?.variantId || "";
        return `
          <div class="mk-gift-inline-row">
            ${
              slots.length > 1
                ? `<label class="mk-gift-inline-label">Подарок ${idx + 1}</label>`
                : ""
            }
            <select
              class="mk-gift-inline-select"
              data-mk-free-choice-select
              data-campaign-id="${escapeHtml(String(choiceModel.campaignId))}"
              data-slot-index="${Number(slot.slotIndex || idx + 1)}"
            >
              ${buildOptionsHtml(selected)}
            </select>
          </div>
        `;
      })
      .join("");
  }

  function ensureMkOverlay(cartRoot) {
    if (!cartRoot) return null;
    let overlay = cartRoot.querySelector(".mk-cart-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "mk-cart-overlay";
      overlay.style.cssText = `
        position:absolute;inset:0;display:grid;place-items:center;
        background:rgba(255,255,255,.65);backdrop-filter:blur(2px);
        opacity:0;pointer-events:none;transition:opacity .12s ease;z-index:50;
      `;
      overlay.innerHTML = `
        <div style="display:grid;gap:10px;justify-items:center;">
          <div class="loading-spinner"></div>
          <div style="font-size:12px;opacity:.75;">Updating…</div>
        </div>
      `;
      const cs = getComputedStyle(cartRoot);
      if (cs.position === "static") cartRoot.style.position = "relative";
      cartRoot.appendChild(overlay);
    }
    return overlay;
  }

  function mkBeginLoading(cartRoot) {
    if (!cartRoot) return;

    ensureMkOverlay(cartRoot);

    const h = cartRoot.getBoundingClientRect().height;
    cartRoot.style.minHeight = Math.max(200, Math.round(h)) + "px";

    cartRoot.setAttribute("data-mk-loading", "1");
    const overlay = cartRoot.querySelector(".mk-cart-overlay");
    if (overlay) {
      overlay.style.opacity = "1";
      overlay.style.pointerEvents = "auto";
    }
  }

  function mkEndLoading(cartRoot) {
    if (!cartRoot) return;

    cartRoot.removeAttribute("data-mk-loading");
    const overlay = cartRoot.querySelector(".mk-cart-overlay");
    if (overlay) {
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
    }

    requestAnimationFrame(() => {
      cartRoot.style.minHeight = "";
    });
  }

  // ---------- DOM helpers (best effort) ----------
  function extractVariantIdFromHref(href) {
    try {
      const u = new URL(href, window.location.origin);
      const v = u.searchParams.get("variant");
      const numeric = String(v || "").replace(/[^\d]/g, "");
      return numeric || null;
    } catch {
      return null;
    }
  }

  function findLineNodesMap() {
    // returns Map<variantGid, node>
    const map = new Map();

    // A) direct data-variant-id (if theme has it)
    document.querySelectorAll("[data-variant-id]").forEach((node) => {
      const numeric = String(node.getAttribute("data-variant-id") || "").replace(/[^\d]/g, "");
      if (!numeric) return;
      const gid = toGid(numeric);
      if (!map.has(gid)) map.set(gid, node);
    });

    // B) product links that contain ?variant=XXXX
    document.querySelectorAll("a[href*='variant=']").forEach((a) => {
        if (a.closest && a.closest("[data-mk-campaign-block],[data-mk-virtual-gift]")) return;
      const numeric = extractVariantIdFromHref(a.getAttribute("href") || "");
      if (!numeric) return;

      const gid = toGid(numeric);

      const root =
        a.closest("li") ||
        a.closest("[data-cart-item]") ||
        a.closest("[class*='cart-item']") ||
        a.closest("[class*='CartItem']") ||
        a.closest("tr") ||
        a.parentElement;

      if (root && !map.has(gid)) map.set(gid, root);
    });

    // C) quantity inputs updates[]
    document.querySelectorAll("input[name='updates[]'], input.quantity__input").forEach((inp) => {
      const root =
        inp.closest("li") ||
        inp.closest("[data-cart-item]") ||
        inp.closest("[class*='cart-item']") ||
        inp.closest("tr") ||
        inp.parentElement;

      if (!root) return;

      const inputVariantId = String(inp.getAttribute("data-quantity-variant-id") || "").replace(/[^\d]/g, "");
      let numeric = inputVariantId || "";
      if (!numeric) {
        const a = root.querySelector("a[href*='variant=']");
        numeric = a ? extractVariantIdFromHref(a.getAttribute("href") || "") : "";
      }
      if (!numeric) return;

      const gid = toGid(numeric);
      if (!map.has(gid)) map.set(gid, root);
    });

    return map;
  }

  function ensureBadgeContainer(lineNode) {
    if (!lineNode) return null;

    let c = lineNode.querySelector("[data-discount-badges='1']");
    if (c) return c;

    c = document.createElement("div");
    c.setAttribute("data-discount-badges", "1");
    c.style.marginTop = "6px";

    const target =
      lineNode.querySelector("[class*='cart-item__details']") ||
      lineNode.querySelector("[class*='CartItem__Details']") ||
      lineNode;

    target.appendChild(c);
    return c;
  }

  function cleanupOldBadges() {
    document.querySelectorAll("[data-discount-badges='1']").forEach((n) => {
      try {
        n.remove();
      } catch {}
    });
  }

  function renderBadges(container, line) {
    if (!container) return;
    container.innerHTML = "";

    const badges = [];

    if (line.isGiftLine) badges.push("Подарок");

    const freeUnits = Number(line?.freeUnits || 0);
    if (!line.isGiftLine && Number(line.memberUnitPrice) < Number(line.baseUnitPrice)) badges.push("Member discount");
    if (line.isGiftLine && line.giftCampaignLabel) badges.push(`Кампания: ${line.giftCampaignLabel}`);
    if (!line.isGiftLine && freeUnits > 0) badges.push(`${freeUnits} FREE`);
    if (!line.isGiftLine && freeUnits <= 0 && line.isFree) badges.push("FREE");
    if (Array.isArray(line.appliedCampaignLabels) && line.appliedCampaignLabels.length) {
      badges.push(...line.appliedCampaignLabels);
    }
    if (line.appliedPromoCode) badges.push(`Promo: ${line.appliedPromoCode}`);

    badges.forEach((label) => {
      const badge = document.createElement("span");
      badge.textContent = label;
      badge.style.cssText =
        "display:inline-flex;margin-right:6px;margin-top:4px;padding:2px 6px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px;font-weight:600;";
      container.appendChild(badge);
    });
  }

  function findPriceNodes(lineNode) {
    if (!lineNode) return [];
    const selectors = [
      "[data-cart-item-regular-price]",
      "[data-cart-item-final-price]",
      "[data-cart-item-price]",
      ".cart-item__total span",
      ".cart-item__prices .price",
      ".cart-item__prices .price__regular",
      ".cart-item__prices .price__sale",
      ".cart-item__prices .price-item",
      "[class*='price__regular']",
      "[class*='price__sale']",
      "[class*='price-item']",
      "[class*='cart-item__price']",
      "[class*='CartItem__Price']",
    ];
    const nodes = [];
    selectors.forEach((sel) => {
      lineNode.querySelectorAll(sel).forEach((el) => nodes.push(el));
    });
    return nodes.filter((node) => !node.closest(".unit-price") && !node.classList.contains("unit-price"));
  }

  function updateLinePriceDisplay(lineNode, isFree) {
    if (!lineNode) return;
    const nodes = findPriceNodes(lineNode);
    if (!nodes.length) return;

    nodes.forEach((node) => {
      const original = node.getAttribute("data-mk-original-html");
      if (isFree) {
        if (!original) node.setAttribute("data-mk-original-html", node.innerHTML || "");
        node.textContent = "FREE";
      } else if (original !== null) {
        node.innerHTML = original;
        node.removeAttribute("data-mk-original-html");
      }
    });
  }

  function updateGiftLinePriceDisplay(lineNode, options) {
    if (!lineNode) return;
    const nodes = findPriceNodes(lineNode);
    if (!nodes.length) return;

    const campaignLabel = String(options?.campaignLabel || "").trim();
    const campaignText = campaignLabel ? `по кампании: ${campaignLabel}` : "по кампании";

    nodes.forEach((node) => {
      const original = node.getAttribute("data-mk-original-html");
      if (!original) node.setAttribute("data-mk-original-html", node.innerHTML || "");
      node.innerHTML = `
        <span class="mk-gift-price">
          <span class="mk-gift-price-free">Бесплатно</span>
        </span>
        <span class="mk-gift-price-campaign">${escapeHtml(campaignText)}</span>
      `;
    });
  }

  function setLinePriceOverride(lineNode, html) {
    if (!lineNode) return;
    const nodes = findPriceNodes(lineNode);
    if (!nodes.length) return;

    nodes.forEach((node) => {
      const original = node.getAttribute("data-mk-original-html");
      if (!original) node.setAttribute("data-mk-original-html", node.innerHTML || "");
      node.innerHTML = html;
    });
  }

  function lineHasMemberDiscount(line) {
    const base = Number(line?.baseUnitPrice || 0);
    const member = Number(line?.memberUnitPrice || 0);
    return member > 0 && base > 0 && member < base;
  }

  function buildMemberDualPriceHtml(baseTotal, memberTotal, currencyCode) {
    const baseText = formatMoney(baseTotal, currencyCode);
    const memberText = formatMoney(memberTotal, currencyCode);
    return `
      <span class="mk-member-price">
        <span class="mk-member-price-old">${escapeHtml(baseText)}</span>
        <span class="mk-member-price-new">${escapeHtml(memberText)}</span>
      </span>
    `;
  }

  function restoreLinePrice(lineNode) {
    if (!lineNode) return;
    const nodes = findPriceNodes(lineNode);
    if (!nodes.length) return;

    nodes.forEach((node) => {
      const original = node.getAttribute("data-mk-original-html");
      if (original !== null) {
        node.innerHTML = original;
        node.removeAttribute("data-mk-original-html");
      }
    });
  }

  function setLineQuantityDisplay(lineRoot, remainingQty) {
    if (!lineRoot) return;
    lineRoot.setAttribute("data-mk-campaign-line", "true");
    lineRoot.setAttribute("data-mk-remaining-qty", String(remainingQty));

    lineRoot.querySelectorAll("input.quantity__input, input[name='updates[]']").forEach((input) => {
      if (!input.getAttribute("data-mk-original-qty")) {
        input.setAttribute("data-mk-original-qty", input.value || "");
      }
      input.value = String(remainingQty);
      input.setAttribute("readonly", "true");
      input.setAttribute("aria-readonly", "true");
    });

    lineRoot.querySelectorAll("button.quantity__button").forEach((button) => {
      button.setAttribute("disabled", "true");
      button.setAttribute("aria-disabled", "true");
    });
  }

  function syncLineInputQuantity(lineRoot, qty) {
    if (!lineRoot) return;
    const normalizedQty = Math.max(0, Number(qty || 0));
    lineRoot.querySelectorAll("input.quantity__input, input[name='updates[]']").forEach((input) => {
      input.value = String(normalizedQty);
      input.setAttribute("value", String(normalizedQty));
    });
  }

  function restoreLineQuantityDisplay(lineRoot) {
    if (!lineRoot) return;
    lineRoot.removeAttribute("data-mk-campaign-line");
    lineRoot.removeAttribute("data-mk-remaining-qty");

    lineRoot.querySelectorAll("input.quantity__input, input[name='updates[]']").forEach((input) => {
      const original = input.getAttribute("data-mk-original-qty");
      if (original !== null) {
        input.value = original;
        input.removeAttribute("data-mk-original-qty");
      }
      input.removeAttribute("readonly");
      input.removeAttribute("aria-readonly");
    });

    lineRoot.querySelectorAll("button.quantity__button").forEach((button) => {
      button.removeAttribute("disabled");
      button.removeAttribute("aria-disabled");
    });
  }

  function lockGiftLineControls(lineRoot) {
    if (!lineRoot) return;
    lineRoot.setAttribute("data-mk-gift-line", "true");

    lineRoot.querySelectorAll("input.quantity__input, input[name='updates[]']").forEach((input) => {
      input.setAttribute("disabled", "true");
      input.setAttribute("aria-disabled", "true");
      input.readOnly = true;
    });

    lineRoot.querySelectorAll("button.quantity__button").forEach((button) => {
      button.setAttribute("disabled", "true");
      button.setAttribute("aria-disabled", "true");
    });

    lineRoot.querySelectorAll(".cart-item__remove, .btn-remove, [is='cart-remove-item']").forEach((button) => {
      button.setAttribute("aria-disabled", "true");
      button.style.pointerEvents = "none";
      button.style.opacity = "0.5";
    });
  }

  function unlockGiftLineDecoration(lineRoot) {
    if (!lineRoot) return;
    lineRoot.removeAttribute("data-mk-gift-line");
    lineRoot.removeAttribute("data-mk-gift-campaign");
  }

  function hideGiftLine(lineRoot) {
    if (!lineRoot) return;
    lineRoot.setAttribute("data-mk-gift-hidden", "true");
    lineRoot.style.display = "none";
  }

  function findLineRootByLineIndex(lineIndex1Based) {
    const byId = document.getElementById(`CartItem-${lineIndex1Based}`);
    if (byId) return byId;

    const byDataIndex =
      document.querySelector(`[data-index="${lineIndex1Based}"]`) || document.querySelector(`[data-line="${lineIndex1Based}"]`);

    if (byDataIndex) {
      return byDataIndex.closest(".cart-item") || byDataIndex.closest("tr") || byDataIndex.closest("li") || byDataIndex;
    }

    return null;
  }

  function hideGiftLinesInDomByCart(cart) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isGift = it?.properties && String(it.properties._mk_gift) === "1";
      if (!isGift) continue;

      const lineIndex = i + 1; // Shopify cart line is 1-based
      const lineRoot = findLineRootByLineIndex(lineIndex);

      if (!lineRoot) continue;

      lockGiftLineControls(lineRoot);
hideGiftLine(lineRoot);


    }
  }

  function hasGiftLinesInDomByCart(cart) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isGift = it?.properties && String(it.properties._mk_gift) === "1";
      if (!isGift) continue;

      const lineIndex = i + 1; // Shopify cart line is 1-based
      const lineRoot = findLineRootByLineIndex(lineIndex);
      if (lineRoot) return true;
    }
    return false;
  }

  // ✅ NEW: hide duplicated "real" lines that are shown inside campaign blocks
  function restoreCampaignHiddenLines() {
    document.querySelectorAll("[data-mk-hidden-by-campaign='1']").forEach((el) => {
      try {
        el.style.display = "";
        el.removeAttribute("data-mk-hidden-by-campaign");
      } catch {}
    });
  }

function applyCampaignLineVisibility(pricing, cart, allocMaps) {

  // Сначала восстановим всё, что раньше прятали
  restoreCampaignHiddenLines();

  if (!pricing || !cart || !Array.isArray(cart.items)) return;

  // Определяем какие варианты "полностью заняты" кампанией:
  // remaining = line.quantity - sum(campaignQuantities[*])
  // hide only if allocated>0 AND remaining<=0
  const fullyAllocatedNumericIds = new Set();

  (pricing.lines || []).forEach((line) => {
    if (!line || line.isGiftLine) return;

const campaignIds = Array.isArray(line.appliedCampaignIds) ? line.appliedCampaignIds : [];
const allocated = mkAllocSumForLine(allocMaps, campaignIds, line.variantId);
const qty = Number(line.quantity || 0);
const remaining = qty - allocated;


    if (allocated > 0 && remaining <= 0) {
      const numeric = gidToNumericVariantId(line.variantId);
      if (numeric) fullyAllocatedNumericIds.add(Number(numeric));
    }
  });

  if (!fullyAllocatedNumericIds.size) return;

  // Теперь прячем ТОЛЬКО реальные строки Shopify по line index из cart.items
  // (не трогаем campaign-block DOM вообще)
  for (let i = 0; i < cart.items.length; i++) {
    const it = cart.items[i];
    if (!it) continue;

    const isGift = it?.properties && String(it.properties._mk_gift) === "1";
    if (isGift) continue; // подарки отдельно уже прячем другим кодом

    const numericId = Number(it.variant_id);
    if (!fullyAllocatedNumericIds.has(numericId)) continue;

    const lineIndex = i + 1; // Shopify line index (1-based)
    const lineRoot = findLineRootByLineIndex(lineIndex);
    if (!lineRoot) continue;

    // Защита: никогда не прячем ничего внутри campaign-block
    if (lineRoot.closest && lineRoot.closest("[data-mk-campaign-block]")) continue;

    lineRoot.setAttribute("data-mk-hidden-by-campaign", "1");
    lineRoot.style.display = "none";
  }
}

  function renderBreakdown(pricing) {
    const root = document.getElementById("CartDrawer-PricingBreakdown") || document.getElementById("Cart-PricingBreakdown");
    if (!root) return;
    // Old green totals block is intentionally disabled.
    root.innerHTML = "";
    root.style.display = "none";
  }

  function restoreEstimatedTotalDisplay() {
    document.querySelectorAll("[data-mk-estimated-total-value]").forEach((node) => {
      const defaultValue = node.getAttribute("data-mk-estimated-total-default");
      if (defaultValue !== null) node.textContent = defaultValue;
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-subtotal-value]").forEach((node) => {
      const defaultValue = node.getAttribute("data-mk-estimated-total-subtotal-default");
      if (defaultValue !== null) node.textContent = defaultValue;
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-shipping-value]").forEach((node) => {
      node.textContent = "";
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-shipping-row]").forEach((node) => {
      node.setAttribute("hidden", "hidden");
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-campaign-discount-value]").forEach((node) => {
      node.textContent = "";
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-campaign-row]").forEach((node) => {
      node.setAttribute("hidden", "hidden");
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-promo-discount-value]").forEach((node) => {
      node.textContent = "";
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-promo-label]").forEach((node) => {
      const defaultLabel = node.getAttribute("data-mk-estimated-total-promo-label-default");
      if (defaultLabel !== null) node.textContent = defaultLabel;
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-promo-row]").forEach((node) => {
      node.setAttribute("hidden", "hidden");
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-promo-note]").forEach((node) => {
      node.textContent = "";
      node.setAttribute("hidden", "hidden");
      node.removeAttribute("data-mk-estimated-total-block-updated");
    });

    document.querySelectorAll("[data-mk-estimated-total-overridden='1']").forEach((node) => {
      const original = node.getAttribute("data-mk-estimated-total-original-html");
      if (original !== null) node.innerHTML = original;
      node.removeAttribute("data-mk-estimated-total-original-html");
      node.removeAttribute("data-mk-estimated-total-overridden");
    });
  }

  function isLikelyEstimatedTotalNode(node) {
    if (!node || !node.matches) return false;
    if (node.closest(".cart-item, [data-cart-item], tr[data-mk-virtual-gift], li[data-mk-virtual-gift]")) return false;

    const labelHost = node.closest(".totals, .cart__footer, .cart-footer, .drawer__footer, .cart-drawer__footer, .Cart__Footer");
    if (!labelHost) return false;

    const labelText = String(labelHost.textContent || "").toLowerCase();
    if (labelText.includes("estimated total") || labelText.includes("estimated subtotal")) return true;

    return node.matches("[data-cart-total], [data-cart-total-value], .totals__total-value, .cart__total-value");
  }

  function hideNativeEstimatedTotalDisplay() {
    const candidates = Array.from(
      document.querySelectorAll(
        [
          "[data-cart-total]",
          "[data-cart-total-value]",
          ".totals__total-value",
          ".cart__total-value",
          ".cart__footer .price",
          ".cart-drawer__footer .price",
          ".drawer__footer .price",
          ".Cart__Footer .price",
        ].join(", "),
      ),
    );

    const unique = Array.from(new Set(candidates)).filter((node) => isLikelyEstimatedTotalNode(node));
    unique.forEach((node) => {
      const totalRow = node.closest(
        ".totals__total, .cart__total, .cart-drawer__total, .drawer__total, .Cart__total, .Cart__Total",
      );
      (totalRow || node).setAttribute("data-mk-hide-native-total", "1");
    });
  }

  function renderEstimatedTotal(pricing, cartLike) {
    if (!pricing?.breakdown) {
      restoreEstimatedTotalDisplay();
      hideNativeEstimatedTotalDisplay();
      return;
    }

    const finalSubtotal = Number(pricing.breakdown?.finalSubtotal);
    if (!Number.isFinite(finalSubtotal)) return;
    const attrs =
      (cartLike && typeof cartLike === "object" && cartLike.attributes) ||
      knownCartAttributes ||
      {};
    const deliveryAmount = parseDeliveryAmount(attrs?.itella_delivery_price);
    const deliveryCurrency = String(attrs?.itella_delivery_currency || "").trim();
    const currency = deliveryCurrency || pricing.currencyCode || "EUR";
    const finalTotal = Math.max(0, finalSubtotal + deliveryAmount);
    const finalText = formatMoney(finalTotal, currency);
    const baseSubtotal = Number(pricing.breakdown?.baseSubtotal);
    const memberDiscount = Math.max(0, Number(pricing.breakdown?.memberDiscount || 0));
    const subtotalWithMemberDiscount = Number.isFinite(baseSubtotal)
      ? Math.max(0, baseSubtotal - memberDiscount)
      : finalSubtotal;
    const subtotalText = formatMoney(subtotalWithMemberDiscount, currency);
    const campaignDiscount = Math.max(0, Number(pricing.breakdown?.campaignDiscount || 0));
    const promoDiscount = Math.max(0, Number(pricing.breakdown?.promoDiscount || 0));
    const requestedPromoCode = String(pricing?.promo?.requestedCode || "").trim();
    const promoReason = String(pricing?.promo?.reason || "").trim();
    const appliedPromoCode =
      String(pricing?.promo?.appliedCode || "")
        .trim() ||
      String((pricing?.lines || []).find((line) => line && line.appliedPromoCode)?.appliedPromoCode || "").trim();

    const customValueNodes = Array.from(document.querySelectorAll("[data-mk-estimated-total-value]"));
    customValueNodes.forEach((node) => {
      node.textContent = finalText;
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const subtotalNodes = Array.from(document.querySelectorAll("[data-mk-estimated-total-subtotal-value]"));
    subtotalNodes.forEach((node) => {
      node.textContent = subtotalText;
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const shippingNodes = Array.from(document.querySelectorAll("[data-mk-estimated-total-shipping-value]"));
    const shippingRows = Array.from(document.querySelectorAll("[data-mk-estimated-total-shipping-row]"));
    const showShipping = deliveryAmount > 0;
    shippingNodes.forEach((node) => {
      node.textContent = showShipping ? formatMoney(deliveryAmount, currency) : "";
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });
    shippingRows.forEach((node) => {
      if (showShipping) node.removeAttribute("hidden");
      else node.setAttribute("hidden", "hidden");
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const showCampaignDiscount = campaignDiscount > 0;
    const campaignText = `- ${formatMoney(campaignDiscount, currency)}`;

    const campaignRows = Array.from(document.querySelectorAll("[data-mk-estimated-total-campaign-row]"));
    campaignRows.forEach((node) => {
      if (showCampaignDiscount) {
        node.removeAttribute("hidden");
      } else {
        node.setAttribute("hidden", "hidden");
      }
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const campaignValueNodes = Array.from(document.querySelectorAll("[data-mk-estimated-total-campaign-discount-value]"));
    campaignValueNodes.forEach((node) => {
      node.textContent = showCampaignDiscount ? campaignText : "";
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const showPromoDiscount = promoDiscount > 0 && !!appliedPromoCode;
    const showPromoAttempt = !!requestedPromoCode && !showPromoDiscount;
    const showPromoRow = showPromoDiscount || showPromoAttempt;
    const promoText = `- ${formatMoney(promoDiscount, currency)}`;
    const promoLabelText = appliedPromoCode
      ? `Promo (${appliedPromoCode})`
      : requestedPromoCode
        ? `Promo (${requestedPromoCode})`
        : "Promo";

    const promoRows = Array.from(document.querySelectorAll("[data-mk-estimated-total-promo-row]"));
    promoRows.forEach((node) => {
      if (showPromoRow) node.removeAttribute("hidden");
      else node.setAttribute("hidden", "hidden");
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const promoValueNodes = Array.from(document.querySelectorAll("[data-mk-estimated-total-promo-discount-value]"));
    promoValueNodes.forEach((node) => {
      if (showPromoDiscount) node.textContent = promoText;
      else if (showPromoAttempt) node.textContent = "Not applied";
      else node.textContent = "";
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const promoLabelNodes = Array.from(document.querySelectorAll("[data-mk-estimated-total-promo-label]"));
    promoLabelNodes.forEach((node) => {
      const fallback = node.getAttribute("data-mk-estimated-total-promo-label-default") || "Promo";
      node.textContent = showPromoRow ? promoLabelText : fallback;
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    const promoNoteNodes = Array.from(document.querySelectorAll("[data-mk-estimated-total-promo-note]"));
    promoNoteNodes.forEach((node) => {
      if (showPromoAttempt) {
        node.textContent = promoReason || "Promo code is not applicable to the current cart.";
        node.removeAttribute("hidden");
      } else {
        node.textContent = "";
        node.setAttribute("hidden", "hidden");
      }
      node.setAttribute("data-mk-estimated-total-block-updated", "1");
    });

    hideNativeEstimatedTotalDisplay();
  }

function buildCampaignPayload(pricing, cart, allocMaps) {

    const cartItems = Array.isArray(cart?.items) ? cart.items : [];

    // map variant_id -> cart item (first match)
    const cartItemByVariantId = new Map();
    cartItems.forEach((it) => {
      const key = Number(it.variant_id);
      if (!Number.isFinite(key)) return;
      if (!cartItemByVariantId.has(key)) cartItemByVariantId.set(key, it);
    });

	    const appliedCampaigns = Array.isArray(pricing?.appliedCampaigns) ? pricing.appliedCampaigns : [];
    const appliedCampaignById = new Map(
      appliedCampaigns.map((campaign) => [String(campaign?.id || ""), campaign || null]),
    );

    // ✅ IMPORTANT: build blocks only for campaigns that actually produce gift lines
    const giftLines = (pricing?.lines || []).filter((l) => l && l.isGiftLine && l.giftCampaignId);
    const idSet = new Set(giftLines.map((l) => String(l.giftCampaignId)));

    // build blocks meta
    const blocks = Array.from(idSet).map((id) => {
      const meta = appliedCampaigns.find((c) => String(c?.id) === String(id));
      return {
        id: String(id),
        label: meta?.label || meta?.id || `Campaign ${id}`,
        type: meta?.type || "",
        items: [],
      };
    });

    const blocksById = new Map();
    blocks.forEach((b) => blocksById.set(String(b.id), b));

    // fill items from pricing.lines
    (pricing?.lines || []).forEach((line) => {
      if (!line) return;

      const numericId = gidToNumericVariantId(line.variantId);
      const cartItem = numericId ? cartItemByVariantId.get(Number(numericId)) : null;

      const title = cartItem?.product_title || cartItem?.title || "Campaign item";
      const image = cartItem?.image || cartItem?.featured_image?.url || "";
      const url = cartItem?.url || cartItem?.product_url || "";

      const quantity = Number(line.quantity || 0);
      if (quantity <= 0) return;

      // Gift lines => show ONLY inside its campaign block
      if (line.isGiftLine) {
        const block = blocksById.get(String(line.giftCampaignId || ""));
        if (!block) return;

        block.items.push({
          title,
          quantity,
          image,
          url,
          note: "FREE",
          isGift: true,
          variantId: numericId ? String(numericId) : undefined,
          totalQuantity: quantity,
        });
        return;
      }

      // Base lines: include only campaigns that are in idSet (gift-producing)
      const campaignIds = Array.isArray(line.appliedCampaignIds) ? line.appliedCampaignIds : [];
      const filteredIds = campaignIds.filter((cid) => idSet.has(String(cid)));
      if (!filteredIds.length) return;

      const freeUnits = Number(line.freeUnits || 0);
      const campaignQuantities =
        line.campaignQuantities && typeof line.campaignQuantities === "object" ? line.campaignQuantities : null;

      filteredIds.forEach((campaignId) => {
        const block = blocksById.get(String(campaignId || ""));
        if (!block) return;

// ✅ ВАЖНО: используем allocationMaps (ограничено buyQty),
// а не "сырой" campaignQuantities, который может стать 3 при qty=3
const campaignQuantity = mkAllocForLine(allocMaps, campaignId, line.variantId);

if (campaignQuantity <= 0) return;




        const noteParts = [];
        if (freeUnits > 0) noteParts.push(`Free units: ${freeUnits}`);
        if (quantity > campaignQuantity) noteParts.push(`Total in cart: ${quantity}`);

        block.items.push({
          title,
          quantity: campaignQuantity,
          image,
          url,
          note: noteParts.join(" · ") || undefined,
          isGift: false,
          variantId: numericId ? String(numericId) : undefined,
          totalQuantity: quantity,
        });
      });
    });

    const campaignBlocks = blocks.filter((b) => Array.isArray(b.items) && b.items.length > 0);

    const giftsFromRegularFreeUnits = (pricing?.lines || [])
      .filter((line) => line && !line.isGiftLine && Number(line.freeUnits || 0) > 0)
      .map((line) => {
        const numericId = gidToNumericVariantId(line.variantId);
        const source = numericId ? cartItemByVariantId.get(Number(numericId)) : null;
        const freeQty = Math.max(0, Number(line.freeUnits || 0));
        if (!freeQty) return null;

        return {
          title: source?.product_title || source?.title || "Free product",
          quantity: freeQty,
          image: source?.image || source?.featured_image?.url || "",
          url: source?.url || source?.product_url || "",
          note: "FREE",
        };
      })
      .filter((gift) => gift && gift.title);

    const giftsFromGiftLines = (pricing?.lines || [])
	      .filter((line) => {
        if (!line || !line.isGiftLine) return false;
        const type = String(appliedCampaignById.get(String(line.giftCampaignId || ""))?.type || "");
        return type !== "BuyXGetOneFree";
      })
	      .map((line) => {
        const numericId = gidToNumericVariantId(line.variantId);
        const giftKey = numericId ? `${numericId}::${String(line.giftCampaignId || "")}` : "";
        const cartGift = giftKey
          ? cartItems.find(
              (it) =>
                it &&
                it.properties &&
                String(it.properties._mk_gift) === "1" &&
                giftKeyFromCartItem(it) === giftKey,
            )
          : null;

        const fallback = numericId ? cartItemByVariantId.get(Number(numericId)) : null;
        const source = cartGift || fallback;

        return {
          title: source?.product_title || source?.title || "Free product",
          quantity: Number(line.quantity || source?.quantity || 1),
          image: source?.image || source?.featured_image?.url || "",
          url: source?.url || source?.product_url || "",
          note: "FREE",
        };
	      })
	      .filter((gift) => gift && gift.title);

    const gifts = [...giftsFromRegularFreeUnits, ...giftsFromGiftLines];

    if (!MK_USE_CAMPAIGN_BLOCKS) {
      const hasRealGiftLinesInDom = hasGiftLinesInDomByCart(cart);
      const showVirtualGifts =
        giftsFromRegularFreeUnits.length > 0 ||
        (giftsFromGiftLines.length > 0 && !hasRealGiftLinesInDom);
      return {
        gifts,
        campaignBlocks: [],
        showVirtualGifts,
        breakdownHtml: "",
        campaignsHtml: "",
      };
    }

    return {
      gifts: [],
      campaignBlocks,
      showVirtualGifts: false,
      breakdownHtml: "",
      campaignsHtml: "",
    };
  }

  function dispatchCampaignPayload(payload) {
    try {
      if (window.MKCartCampaignUI?.render) {
        window.MKCartCampaignUI.render(payload);
      } else {
        window.dispatchEvent(new CustomEvent("mk:cart-pricing", { detail: payload }));
      }
    } catch (e) {
      console.warn("[cart.js] campaign UI dispatch error", e);
    }
  }

  function logCampaignSummary(pricing) {
    if (!pricing) return;

    const applied = Array.isArray(pricing.appliedCampaigns) ? pricing.appliedCampaigns : [];
    const needsChoice = Boolean(pricing.needsFreeChoice);
    const choiceContext = pricing.choiceContext || null;

    const lineSummaries = (pricing.lines || []).map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      isGiftLine: Boolean(line.isGiftLine),
      freeUnits: Number(line.freeUnits || 0),
      appliedCampaignLabels: Array.isArray(line.appliedCampaignLabels) ? line.appliedCampaignLabels : [],
      appliedCampaignIds: Array.isArray(line.appliedCampaignIds) ? line.appliedCampaignIds : [],
      campaignQuantities: line.campaignQuantities || null,
      appliedPromoCode: line.appliedPromoCode || null,
    }));

    console.groupCollapsed("[cart.js] campaign summary");
    console.log("Applied campaigns:", applied.length ? applied : "none");
    console.log(
      "Campaign benefits (lines):",
      lineSummaries.filter(
        (l) =>
          l.isGiftLine ||
          l.freeUnits > 0 ||
          l.appliedCampaignLabels.length > 0 ||
          l.appliedCampaignIds.length > 0,
      ),
    );
    if (needsChoice) {
      console.warn("[cart.js] needs free choice for campaign:", choiceContext || "unknown");
    }
    console.groupEnd();
  }

  function logApplicableCampaigns(pricing, cart) {
    if (!pricing) return;

    const applied = Array.isArray(pricing.appliedCampaigns) ? pricing.appliedCampaigns : [];
    const baseItems = (cart?.items || []).map((item) => ({
      variantId: toGid(item.variant_id),
      title: item.product_title || item.title || "",
      quantity: Number(item.quantity || 0),
    }));

    const campaignItems = (pricing.lines || [])
      .filter((line) => line && line.isGiftLine)
      .map((line) => ({
        variantId: line.variantId,
        quantity: Number(line.quantity || 0),
        labels: Array.isArray(line.appliedCampaignLabels) ? line.appliedCampaignLabels : [],
        campaignIds: Array.isArray(line.appliedCampaignIds) ? line.appliedCampaignIds : [],
      }));

    console.groupCollapsed("[cart.js] applicable campaigns");
    console.log("Applied campaigns:", applied.length ? applied : "none");
    console.log("Base cart items:", baseItems);
    console.log("Campaign gift items:", campaignItems.length ? campaignItems : "none");
    if (pricing.needsFreeChoice) {
      console.warn("[cart.js] needs free choice:", pricing.choiceContext || "unknown");
    }
    console.groupEnd();
  }

  async function safeReadJsonResponse(res) {
    const ct = String(res.headers.get("content-type") || "");
    if (!ct.includes("application/json")) {
      const text = await res.text().catch(() => "");
      console.warn("[cart.js] prepare returned non-JSON", res.status, ct, text.slice(0, 160));
      return null;
    }
    return await res.json();
  }

  // ---------- Gift sync helpers ----------
  function giftKeyFromCartItem(it) {
    const camp = it?.properties?._mk_campaign_id ? String(it.properties._mk_campaign_id) : "";
    return `${Number(it.variant_id)}::${camp}`;
  }

  function giftKeyFromPricingLine(line) {
    const numeric = gidToNumericVariantId(line.variantId);
    const camp = line.giftCampaignId || "";
    if (!numeric) return null;
    return `${numeric}::${camp}`;
  }

  async function cartAddGift(numericVariantId, qty, campaignId) {
    MK_STATS.cartAdd += 1;
    const res = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        items: [
          {
            id: Number(numericVariantId),
            quantity: Number(qty),
            properties: {
              _mk_gift: "1",
              _mk_campaign_id: campaignId || "unknown",
            },
          },
        ],
      }),
    });
    if (!res.ok) throw new Error("cart/add.js failed");
    return res.json();
  }

  async function cartChangeLine(lineIndex1Based, qty) {
    MK_STATS.cartChange += 1;
    const res = await fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ line: Number(lineIndex1Based), quantity: Number(qty) }),
    });
    if (!res.ok) throw new Error("cart/change.js failed");
    return res.json();
  }

  function findGiftLineIndexes(cart, numericVariantId, campaignId) {
    const items = cart?.items || [];
    const indexes = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) continue;
      if (Number(it.variant_id) !== Number(numericVariantId)) continue;

      const isGift = it.properties && String(it.properties._mk_gift) === "1";
      if (!isGift) continue;

      const camp = it.properties?._mk_campaign_id ? String(it.properties._mk_campaign_id) : "";
      if (camp !== String(campaignId || "")) continue;

      indexes.push(i + 1);
    }
    return indexes;
  }

  let giftSyncInFlight = false;

  async function syncGifts(cart, pricing) {
    if (giftSyncInFlight) {
      return { cart, changed: false };
    }
    giftSyncInFlight = true;
    let latestCart = cart;
    let changed = false;

    try {
      const desiredLines = (pricing?.lines || []).filter((l) => l && l.isGiftLine);

      // desired map: key -> qty
      const desired = new Map();
      for (const l of desiredLines) {
        const k = giftKeyFromPricingLine(l);
        if (!k) continue;
        const prev = desired.get(k) || 0;
        desired.set(k, prev + Number(l.quantity || 0));
      }
      mkDebug("syncGifts desired", Array.from(desired.entries()));

      // current gifts map: key -> qty
      const current = new Map();
      for (const it of cart.items || []) {
        const isGift = it.properties && String(it.properties._mk_gift) === "1";
        if (!isGift) continue;
        const k = giftKeyFromCartItem(it);
        current.set(k, (current.get(k) || 0) + Number(it.quantity || 0));
      }
      mkDebug("syncGifts current", Array.from(current.entries()));

      // 1) add or update required gifts
      for (const [k, desiredQty] of desired.entries()) {
        const [numericIdStr, campaignId] = k.split("::");
        const numericId = Number(numericIdStr);
        const curQty = current.get(k) || 0;

        if (desiredQty <= 0) continue;

        const indexes = findGiftLineIndexes(latestCart, numericId, campaignId);

        if (indexes.length === 0) {
          mkDebug("syncGifts add gift", { numericId, desiredQty, campaignId });
          await cartAddGift(numericId, desiredQty, campaignId);
          latestCart = await readCart();
          changed = true;
          continue;
        }

        if (curQty !== desiredQty) {
          const lineIndex = indexes[0];
          mkDebug("syncGifts update gift qty", { lineIndex, curQty, desiredQty, campaignId, numericId });
          await cartChangeLine(lineIndex, desiredQty);
          latestCart = await readCart();
          changed = true;
        }

        let latestIndexes = findGiftLineIndexes(latestCart, numericId, campaignId);
        if (latestIndexes.length > 1) {
          const extras = latestIndexes.slice(1).sort((a, b) => b - a);
          for (const extraIndex of extras) {
            mkDebug("syncGifts remove duplicate gift line", { extraIndex, campaignId, numericId });
            await cartChangeLine(extraIndex, 0);
            latestCart = await readCart();
            changed = true;
          }
        }
      }

      // 2) remove gifts that are no longer desired
      for (const [k] of current.entries()) {
        if (desired.has(k)) continue;

        const [numericIdStr, campaignId] = k.split("::");
        const numericId = Number(numericIdStr);

        let indexes = findGiftLineIndexes(latestCart, numericId, campaignId);
        while (indexes.length > 0) {
          const toRemove = indexes.sort((a, b) => b - a);
          for (const index of toRemove) {
            mkDebug("syncGifts remove obsolete gift", { index, campaignId, numericId });
            await cartChangeLine(index, 0);
            latestCart = await readCart();
            changed = true;
          }
          indexes = findGiftLineIndexes(latestCart, numericId, campaignId);
        }
      }
    } catch (e) {
      console.warn("[cart.js] syncGifts error:", e);
    } finally {
      giftSyncInFlight = false;
    }
    return { cart: latestCart, changed };
  }

  // ---------- core ----------
  let inFlight = false;
  let pendingRefresh = false;
  let pendingCartHint = null;
  let pendingReason = "";
  let debounceTimer = null;
  let suppressMutationsUntil = 0;

  async function refreshPricing(reason = "unknown", cartHint = null) {
    if (inFlight) {
      pendingRefresh = true;
      if (cartHint && Array.isArray(cartHint.items)) {
        pendingCartHint = cartHint;
      }
      pendingReason = reason || pendingReason || "queued";
      mkDebug("refreshPricing queued while inFlight", { reason });
      return;
    }

    const mainCart = getMainCartRoot();
    cleanupOldBadges();
    mkBeginLoading(mainCart);

    inFlight = true;
    try {
      const cart =
        cartHint && Array.isArray(cartHint.items)
          ? cartHint
          : await readCart();
      const attrs = cart.attributes || {};
      knownCartAttributes = attrs;

      if (!cart?.items?.length) {
        console.info("[cart.js] no items in cart, skipping prepare preview");
        renderFreeChoicePanel(null, attrs);
        restoreEstimatedTotalDisplay();
        return;
      }

      const payloadItems = cart.items
        .filter((it) => !(it?.properties && String(it.properties._mk_gift) === "1"))
        .map((it) => ({
          variantId: toGid(it.variant_id),
          quantity: Number(it.quantity || 0),
        }))
        .filter((x) => x.variantId && x.quantity > 0);

      if (!payloadItems.length) {
        console.info("[cart.js] no non-gift items, skipping prepare preview");
        renderFreeChoicePanel(null, attrs);
        restoreEstimatedTotalDisplay();
        return;
      }

      const payload = {
        mode: "preview",
        customerId: resolveCustomerIdForPricing(),
        items: payloadItems,
        shipping: null,
        promoCode: attrs.itella_promo_code || null,
        freeChoiceVariantId: attrs.itella_free_choice_variant_id || null,
        freeChoiceSelections: parseFreeChoiceSelectionsAttr(attrs.itella_free_choice_selections),
      };

      console.log("[cart.js] preview payload -> /apps/checkout/prepare", payload);

      const res = await fetch(PREVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      MK_STATS.prepare += 1;

      if (!res.ok) {
        console.warn("[cart.js] prepare preview failed", res.status);
      }

      const data = await safeReadJsonResponse(res);
      if (!data) return;

      if (data.ok === false || data.error) {
        console.warn("[cart.js] prepare returned error", data.error || data);
        return;
      }

      const pricing = data?.pricing;
      console.log("[cart.js] preview response pricing:", pricing);
      logCampaignSummary(pricing);
      logApplicableCampaigns(pricing, cart);

      if (!pricing?.lines?.length) {
        renderFreeChoicePanel(pricing, attrs);
        return;
      }

      // ✅ auto add/remove gift products in Shopify cart
const hadGiftLines = (pricing?.lines || []).some(l => l && l.isGiftLine);
mkDebug("refreshPricing: pricing summary", {
  hadGiftLines,
  lines: Array.isArray(pricing?.lines) ? pricing.lines.length : 0,
});

const syncResult = await syncGifts(cart, pricing);
const syncedCart = syncResult?.cart || cart;
const giftsChanged = Boolean(syncResult?.changed);
if (giftsChanged) {
  suppressMutationsUntil = Date.now() + 900;
}
mkDebug("refreshPricing: syncGifts done", {
  cartItems: Array.isArray(syncedCart?.items) ? syncedCart.items.length : 0,
  giftsChanged,
});

// Campaign/gift sync is intentionally decoupled from delivery block rendering.
// We avoid forcing cart section refresh here to keep pickup state stable.
if (giftsChanged) {
  mkDebug("gifts changed; skip forced cart refresh to preserve delivery block state");
  const refreshedMainCart = await refreshMainCartMarkup();
  if (!refreshedMainCart) {
    requestDrawerRefreshAfterGiftSync();
  }
  if (reason !== "post-gift-sync") {
    pendingRefresh = true;
    pendingReason = "post-gift-sync";
    pendingCartHint = null;
    mkDebug("queued post-gift-sync refresh");
  }
}



let allocMaps = null;

renderBreakdown(pricing);
renderEstimatedTotal(pricing, syncedCart);

if (MK_USE_CAMPAIGN_BLOCKS) {
  allocMaps = mkBuildAllocMaps(pricing);
}

const campaignPayload = buildCampaignPayload(pricing, syncedCart, allocMaps);
dispatchCampaignPayload(campaignPayload);

if (MK_USE_CAMPAIGN_BLOCKS) {
  applyCampaignLineVisibility(pricing, syncedCart, allocMaps);
} else {
  restoreCampaignHiddenLines();
}

renderFreeChoicePanel(pricing, attrs);




	      // try render badges per line (best effort)
	      const nodeMap = findLineNodesMap();
	      const giftChoiceModel = buildGiftChoiceModel(pricing, attrs);
	      const giftChoiceSlotsByLine = buildGiftChoiceSlotsByPricingLine(pricing, giftChoiceModel);
const campaignLabelById = new Map(
  (Array.isArray(pricing?.appliedCampaigns) ? pricing.appliedCampaigns : [])
    .map(c => [String(c?.id), String(c?.label || c?.id || "")])
);

	      pricing.lines.forEach((line, pricingLineIndex) => {
	        const variantGid = line.variantId;
	        let node = nodeMap.get(variantGid);
	        if (!node) {
	          const numericId = gidToNumericVariantId(variantGid);
	          if (numericId) {
	            const inputMatch = document.querySelector(
              `input[data-quantity-variant-id='${numericId}'], input[data-quantity-variant-id='${String(numericId)}']`,
            );
            if (inputMatch) {
              node =
                inputMatch.closest(".cart-item") ||
                inputMatch.closest("[data-cart-item]") ||
                inputMatch.closest("tr") ||
                inputMatch.parentElement;
            }
          }
        }
        if (!node) return;

        const lineRoot = node.closest(".cart-item") || node.closest("[data-cart-item]") || node.closest("tr") || node;

        const isFreeLine = Boolean(line.isGiftLine) || Boolean(line.isFree);
        if (isFreeLine) {
          lineRoot.setAttribute("data-line-free", "true");
        } else {
          lineRoot.removeAttribute("data-line-free");
        }

	        updateLinePriceDisplay(node, isFreeLine);

	          const badgeContainer = ensureBadgeContainer(node);

// --- GIFT LINE ---
if (line.isGiftLine) {
  syncLineInputQuantity(lineRoot, line.quantity);
  lockGiftLineControls(lineRoot);

  const campId = String(line.giftCampaignId || "");
  const campLabel = campaignLabelById.get(campId) || campId || "Campaign";
  lineRoot.setAttribute("data-mk-gift-campaign", campLabel);
  renderGiftChoiceControls(lineRoot, giftChoiceModel, campId, giftChoiceSlotsByLine.get(pricingLineIndex));
  updateGiftLinePriceDisplay(node, {
    currencyCode: pricing.currencyCode || "EUR",
    baseUnitPrice: line.baseUnitPrice,
    quantity: line.quantity,
    campaignLabel: campLabel,
  });

  renderBadges(badgeContainer, {
    ...line,
    isGiftLine: true,
    isFree: true,
    freeUnits: 1,
    giftCampaignLabel: campLabel,
    appliedCampaignLabels: [],
  });

  return;
}

// --- NORMAL LINE ---
clearGiftChoiceControls(lineRoot);
unlockGiftLineDecoration(lineRoot);
updateLinePriceDisplay(node, isFreeLine);

// показываем обычные бейджи
renderBadges(badgeContainer, line);

// remaining/allocated режим включаем ТОЛЬКО если campaign blocks включены
if (MK_USE_CAMPAIGN_BLOCKS && allocMaps) {
  const campaignIds = Array.isArray(line.appliedCampaignIds) ? line.appliedCampaignIds : [];
  const allocated = mkAllocSumForLine(allocMaps, campaignIds, line.variantId);
  const remainingQty = Math.max(0, Number(line.quantity || 0) - allocated);

  if (allocated > 0 && remainingQty < Number(line.quantity || 0)) {
    setLineQuantityDisplay(lineRoot, remainingQty);
    if (!isFreeLine && Number.isFinite(Number(line.finalUnitPrice))) {
      const currency = pricing.currencyCode || "EUR";
      if (lineHasMemberDiscount(line)) {
        const baseTotal = Number(line.baseUnitPrice || 0) * remainingQty;
        const memberTotal = Number(line.memberUnitPrice || 0) * remainingQty;
        setLinePriceOverride(lineRoot, buildMemberDualPriceHtml(baseTotal, memberTotal, currency));
      } else {
        const remainingTotal = Number(line.finalUnitPrice) * remainingQty;
        setLinePriceOverride(lineRoot, formatMoney(remainingTotal, currency));
      }
    }
  } else {
    restoreLineQuantityDisplay(lineRoot);
    if (!isFreeLine) {
      const currency = pricing.currencyCode || "EUR";
      if (lineHasMemberDiscount(line)) {
        const qty = Math.max(0, Number(line.quantity || 0));
        const baseTotal = Number(line.baseUnitPrice || 0) * qty;
        const memberTotal = Number(line.memberUnitPrice || 0) * qty;
        setLinePriceOverride(lineRoot, buildMemberDualPriceHtml(baseTotal, memberTotal, currency));
      } else {
        restoreLinePrice(lineRoot);
      }
    }
  }
} else {
	  // Без campaign blocks показываем для BuyXGetOneFree платную часть в основной строке,
	  // а бесплатную часть — отдельной virtual FREE строкой.
	  const totalQty = Math.max(0, Number(line.quantity || 0));
	  const freeQty = Math.max(0, Number(line.freeUnits || 0));
	  const paidQty = Math.max(0, totalQty - freeQty);

	  if (freeQty > 0) {
	    const currency = pricing.currencyCode || "EUR";
	    const paidBaseTotal = Number(line.baseUnitPrice || 0) * paidQty;
	    const paidMemberTotal = Number(line.memberUnitPrice || 0) * paidQty;
	    setLineQuantityDisplay(lineRoot, paidQty);
	    if (lineHasMemberDiscount(line)) {
	      setLinePriceOverride(lineRoot, buildMemberDualPriceHtml(paidBaseTotal, paidMemberTotal, currency));
	    } else {
	      setLinePriceOverride(lineRoot, formatMoney(paidMemberTotal, currency));
	    }
	  } else {
	    restoreLineQuantityDisplay(lineRoot);
	    if (!isFreeLine) {
	      const currency = pricing.currencyCode || "EUR";
	      if (lineHasMemberDiscount(line)) {
	        const baseTotal = Number(line.baseUnitPrice || 0) * totalQty;
	        const memberTotal = Number(line.memberUnitPrice || 0) * totalQty;
	        setLinePriceOverride(lineRoot, buildMemberDualPriceHtml(baseTotal, memberTotal, currency));
	      } else {
	        restoreLinePrice(lineRoot);
	      }
	    }
	  }
}

	    });
	      // ✅ hide real gift lines in DOM (stable by line index)

    } catch (e) {
      console.warn("[cart.js] refreshPricing error:", e);
    } finally {
      mkEndLoading(getMainCartRoot());
      inFlight = false;
      if (pendingRefresh) {
        const nextHint = pendingCartHint;
        const nextReason = pendingReason || "queued";
        pendingRefresh = false;
        pendingCartHint = null;
        pendingReason = "";
        mkDebug("running queued refresh");
        setTimeout(() => refreshPricing(nextReason, nextHint), 50);
      }
    }
  }

  async function onFreeChoiceChange(selectEl) {
    if (!selectEl) return;
    const campaignId = String(selectEl.getAttribute("data-campaign-id") || "");
    if (!campaignId) return;

    const scopeRoot =
      selectEl.closest("main-cart") ||
      selectEl.closest("cart-drawer") ||
      selectEl.closest("#CartDrawer") ||
      document;

    const selects = Array.from(scopeRoot.querySelectorAll("[data-mk-free-choice-select]"))
      .filter((el) => String(el.getAttribute("data-campaign-id") || "") === campaignId)
      .sort((a, b) => Number(a.getAttribute("data-slot-index") || 0) - Number(b.getAttribute("data-slot-index") || 0));
    const giftQty = Math.max(1, selects.length || 1);

    const selectedChoices = selects
      .map((el) => toGid(el.value || ""))
      .filter(Boolean)
      .slice(0, giftQty);
    while (selectedChoices.length < giftQty) {
      selectedChoices.push(selectedChoices[0] || "");
    }

    const chosen = selectedChoices[0] || "";

    selects.forEach((el) => el.setAttribute("disabled", "true"));
    try {
      const changed = await writeCartAttributesPatch({
        itella_free_choice_variant_id: chosen || "",
        itella_free_choice_selections: JSON.stringify(selectedChoices.filter(Boolean)),
        itella_free_choice_campaign_id: campaignId,
        itella_draft_order_invoice_url: "",
      });
      if (changed) {
        suppressMutationsUntil = Date.now() + 450;
      }
    } catch (e) {
      console.warn("[cart.js] failed to save free gift choice", e);
    } finally {
      selects.forEach((el) => el.removeAttribute("disabled"));
    }

    refreshPricing("free-choice-change");
  }

  function scheduleRefresh(event) {
    if (event?.type === "cart:refresh" && event?.detail?.source === "mk-cart") {
      mkDebug("skip self cart:refresh");
      return;
    }
    const forceBecauseCartUpdated = event?.type === "cart:updated";
    const cartHint =
      event?.detail?.cart && Array.isArray(event.detail.cart.items)
        ? event.detail.cart
        : null;
    if (!forceBecauseCartUpdated && Date.now() < suppressMutationsUntil) return;
    mkDebug("scheduleRefresh");
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
      () => refreshPricing(event?.type || "debounce", cartHint),
      forceBecauseCartUpdated ? 90 : 250,
    );
  }

  function isMkMutation(records) {
    for (const r of records) {
      const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])];
      for (const n of nodes) {
        if (!n || n.nodeType !== 1) continue;
        if (
          n.hasAttribute?.("data-mk-virtual-gift") ||
          n.hasAttribute?.("data-mk-campaign-block") ||
          n.hasAttribute?.("data-mk-free-choice-panel") ||
          n.hasAttribute?.("data-mk-gift-choice") ||
          n.getAttribute?.("data-discount-badges") === "1" ||
          n.classList?.contains("mk-gift-inline-select") ||
          n.classList?.contains("mk-cart-overlay") ||
          n.closest?.("[data-mk-virtual-gift],[data-mk-campaign-block],[data-mk-free-choice-panel],[data-mk-gift-choice]")
        ) {
          return true;
        }
        if (
          n.closest?.("[data-discount-badges='1']") ||
          n.closest?.(".mk-cart-overlay") ||
          n.closest?.("[data-mk-free-choice-panel]") ||
          n.closest?.("[data-mk-gift-choice]")
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function watchMutations() {
    const targets = [getMainCartRoot(), document.getElementById("CartDrawer"), document.querySelector("cart-drawer"), document.querySelector("#CartDrawer")].filter(Boolean);

    if (!targets.length) return;

    const observer = new MutationObserver((records) => {
      if (Date.now() < suppressMutationsUntil) return;
      if (isMkMutation(records)) return;
      scheduleRefresh();
    });

    targets.forEach((t) => observer.observe(t, { childList: true, subtree: true }));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      scheduleRefresh();
      watchMutations();
    });
  } else {
    scheduleRefresh();
    watchMutations();
  }

  document.addEventListener("cart:updated", scheduleRefresh);
  document.addEventListener("cart:refresh", scheduleRefresh);
  document.addEventListener("change", (event) => {
    const target = event?.target;
    if (!target || !target.matches) return;
    if (!target.matches("[data-mk-free-choice-select]")) return;
    onFreeChoiceChange(target);
  });

  if (MK_DEBUG) {
    document.addEventListener(
      "change",
      (event) => {
        const t = event?.target;
        if (!t || !t.matches) return;
        if (!t.matches("input[name='updates[]'], input.quantity__input")) return;
        mkDebug("qty input change", {
          value: t.value,
          index: t.getAttribute("data-index"),
          variantId: t.getAttribute("data-quantity-variant-id"),
          isConnected: t.isConnected,
        });
      },
      true,
    );

    window.addEventListener("error", (event) => {
      const message = String(event?.message || "");
      if (!message.includes("Cannot read properties of null (reading 'id')")) return;
      mkDebug("captured theme null.id error", {
        filename: event?.filename || "",
        lineno: event?.lineno || 0,
        colno: event?.colno || 0,
        mainCartCount: document.querySelectorAll("main-cart").length,
      });
    });
  }
})();
