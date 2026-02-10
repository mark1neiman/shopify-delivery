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
  // MK: simplest + most stable UX: show gifts as real cart lines (FREE), no campaign blocks in cart UI
    const MK_USE_CAMPAIGN_BLOCKS = false;

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

  function gidToNumericVariantId(gid) {
    const m = String(gid || "").match(/ProductVariant\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  async function readCart() {
    const res = await fetch("/cart.js", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to read /cart.js");
    return await res.json();
  }
async function mkRefreshMainCartSection() {
  const cartRoot = getMainCartRoot();
  if (!cartRoot || !cartRoot.id) return false;

  // Dawn обычно: id="MainCart-{{ section.id }}"
  const sectionId = cartRoot.id.replace(/^MainCart-/, "");
  if (!sectionId || sectionId === cartRoot.id) return false;

  const html = await fetch(`/cart?section_id=${encodeURIComponent(sectionId)}`, { cache: "no-store" }).then(r => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const next = doc.querySelector("main-cart");
  if (!next) return false;

  cartRoot.replaceWith(next);
  return true;
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

  function getMainCartRoot() {
    return document.querySelector("main-cart[id^='MainCart-']") || document.querySelector("main-cart") || null;
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

    if (line.isGiftLine) badges.push("GIFT");

    if (!line.isGiftLine && Number(line.memberUnitPrice) < Number(line.baseUnitPrice)) badges.push("-15% member");
    if (line.isFree || (line.freeUnits && line.freeUnits > 0)) badges.push("FREE");
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
    if (!root || !pricing?.breakdown) return;

    const b = pricing.breakdown;
    const currency = pricing.currencyCode || "EUR";

    root.innerHTML = `
      <div style="display:grid;gap:6px;font-size:13px;">
        <div style="display:flex;justify-content:space-between;">
          <span>Subtotal</span>
          <span>${formatMoney(b.baseSubtotal, currency)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#16a34a;">
          <span>Member discount</span>
          <span>- ${formatMoney(b.memberDiscount, currency)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#16a34a;">
          <span>Campaigns</span>
          <span>- ${formatMoney(b.campaignDiscount, currency)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#16a34a;">
          <span>Promo code</span>
          <span>- ${formatMoney(b.promoDiscount, currency)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:700;">
          <span>Total</span>
          <span>${formatMoney(b.finalSubtotal, currency)}</span>
        </div>
      </div>
    `;
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
    if (giftSyncInFlight) return;
    giftSyncInFlight = true;
    let latestCart = cart;
    suppressMutationsUntil = Date.now() + 1800;

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

      // current gifts map: key -> qty
      const current = new Map();
      for (const it of cart.items || []) {
        const isGift = it.properties && String(it.properties._mk_gift) === "1";
        if (!isGift) continue;
        const k = giftKeyFromCartItem(it);
        current.set(k, (current.get(k) || 0) + Number(it.quantity || 0));
      }

      // 1) add or update required gifts
      for (const [k, desiredQty] of desired.entries()) {
        const [numericIdStr, campaignId] = k.split("::");
        const numericId = Number(numericIdStr);
        const curQty = current.get(k) || 0;

        if (desiredQty <= 0) continue;

        const indexes = findGiftLineIndexes(latestCart, numericId, campaignId);

        if (indexes.length === 0) {
          await cartAddGift(numericId, desiredQty, campaignId);
          latestCart = await readCart();
          continue;
        }

        if (curQty !== desiredQty) {
          const lineIndex = indexes[0];
          await cartChangeLine(lineIndex, desiredQty);
          latestCart = await readCart();
        }

        let latestIndexes = findGiftLineIndexes(latestCart, numericId, campaignId);
        if (latestIndexes.length > 1) {
          const extras = latestIndexes.slice(1).sort((a, b) => b - a);
          for (const extraIndex of extras) {
            await cartChangeLine(extraIndex, 0);
            latestCart = await readCart();
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
            await cartChangeLine(index, 0);
            latestCart = await readCart();
          }
          indexes = findGiftLineIndexes(latestCart, numericId, campaignId);
        }
      }
    } catch (e) {
      console.warn("[cart.js] syncGifts error:", e);
    } finally {
      giftSyncInFlight = false;
    }
    return latestCart;
  }

  // ---------- core ----------
  let inFlight = false;
  let debounceTimer = null;
  let suppressMutationsUntil = 0;

  async function refreshPricing() {
    if (inFlight) return;

    const mainCart = getMainCartRoot();
    cleanupOldBadges();
    mkBeginLoading(mainCart);

    inFlight = true;
    try {
      const cart = await readCart();
      const attrs = cart.attributes || {};

      if (!cart?.items?.length) {
        console.info("[cart.js] no items in cart, skipping prepare preview");
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
        return;
      }

      const payload = {
        mode: "preview",
        customerId: null,
        items: payloadItems,
        shipping: null,
        promoCode: attrs.itella_promo_code || null,
        freeChoiceVariantId: attrs.itella_free_choice_variant_id || null,
      };

      console.log("[cart.js] preview payload -> /apps/checkout/prepare", payload);

      const res = await fetch(PREVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

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

      if (!pricing?.lines?.length) return;

      // ✅ auto add/remove gift products in Shopify cart
const hadGiftLines = (pricing?.lines || []).some(l => l && l.isGiftLine);

const syncedCart = (await syncGifts(cart, pricing)) || cart;
suppressMutationsUntil = Date.now() + 1000;

// если подарки есть — гарантируем, что DOM обновился и строка появится
if (hadGiftLines) {
  await mkRefreshMainCartSection();
}



let allocMaps = null;

renderBreakdown(pricing);

if (MK_USE_CAMPAIGN_BLOCKS) {
  allocMaps = mkBuildAllocMaps(pricing);
  const campaignPayload = buildCampaignPayload(pricing, syncedCart, allocMaps);
  dispatchCampaignPayload(campaignPayload);
  applyCampaignLineVisibility(pricing, syncedCart, allocMaps);
}




      // try render badges per line (best effort)
      const nodeMap = findLineNodesMap();
      const lineMap = new Map();
      pricing.lines.forEach((line) => {


        if (!lineMap.has(line.variantId)) lineMap.set(line.variantId, line);
      });
const campaignLabelById = new Map(
  (Array.isArray(pricing?.appliedCampaigns) ? pricing.appliedCampaigns : [])
    .map(c => [String(c?.id), String(c?.label || c?.id || "")])
);

      for (const [variantGid, line] of lineMap.entries()) {
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
        if (!node) continue;

        const lineRoot = node.closest(".cart-item") || node.closest("[data-cart-item]") || node.closest("tr") || node;

        const isFreeLine = line.isFree || (line.freeUnits && line.freeUnits > 0) || line.isGiftLine;
        if (isFreeLine) {
          lineRoot.setAttribute("data-line-free", "true");
        } else {
          lineRoot.removeAttribute("data-line-free");
        }

        updateLinePriceDisplay(node, isFreeLine);

          const badgeContainer = ensureBadgeContainer(node);

// --- GIFT LINE ---
if (line.isGiftLine) {
  lockGiftLineControls(lineRoot);
  updateLinePriceDisplay(node, true);

  const campId = String(line.giftCampaignId || "");
  const campLabel = campaignLabelById.get(campId) || campId || "Campaign";

  renderBadges(badgeContainer, {
    ...line,
    isGiftLine: true,
    isFree: true,
    freeUnits: 1,
    appliedCampaignLabels: [`Campaign: ${campLabel}`],
  });

  continue;
}

// --- NORMAL LINE ---
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
      const remainingTotal = Number(line.finalUnitPrice) * remainingQty;
      setLinePriceOverride(lineRoot, formatMoney(remainingTotal, currency));
    }
  } else {
    restoreLineQuantityDisplay(lineRoot);
    if (!isFreeLine) restoreLinePrice(lineRoot);
  }
} else {
  // если campaign blocks выключены — на всякий случай всегда восстанавливаем
  restoreLineQuantityDisplay(lineRoot);
  if (!isFreeLine) restoreLinePrice(lineRoot);
}

    }
      // ✅ hide real gift lines in DOM (stable by line index)

    } catch (e) {
      console.warn("[cart.js] refreshPricing error:", e);
    } finally {
      mkEndLoading(getMainCartRoot());
      inFlight = false;
    }
  }

  function scheduleRefresh() {
    if (Date.now() < suppressMutationsUntil) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refreshPricing, 250);
  }

  function isMkMutation(records) {
    for (const r of records) {
      const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])];
      for (const n of nodes) {
        if (!n || n.nodeType !== 1) continue;
        if (
          n.hasAttribute?.("data-mk-virtual-gift") ||
          n.hasAttribute?.("data-mk-campaign-block") ||
          n.closest?.("[data-mk-virtual-gift],[data-mk-campaign-block]")
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
})();
