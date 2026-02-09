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
  return (
    document.querySelector("main-cart[id^='MainCart-']") ||
    document.querySelector("main-cart") ||
    null
  );
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
    // cartRoot должен быть relative
    const cs = getComputedStyle(cartRoot);
    if (cs.position === "static") cartRoot.style.position = "relative";
    cartRoot.appendChild(overlay);
  }
  return overlay;
}

function mkBeginLoading(cartRoot) {
  if (!cartRoot) return;

  ensureMkOverlay(cartRoot);

  // freeze height (чтобы не прыгало при вставке/удалении строк)
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
      const numeric = extractVariantIdFromHref(a.getAttribute("href") || "");
      if (!numeric) return;

      const gid = toGid(numeric);

      // pick a reasonable “line root”
      const root =
        a.closest("li") ||
        a.closest("[data-cart-item]") ||
        a.closest("[class*='cart-item']") ||
        a.closest("[class*='CartItem']") ||
        a.closest("tr") ||
        a.parentElement;

      if (root && !map.has(gid)) map.set(gid, root);
    });

    // C) quantity inputs updates[] (common) — not perfect but helps
    document.querySelectorAll("input[name='updates[]'], input.quantity__input").forEach((inp) => {
      const root =
        inp.closest("li") ||
        inp.closest("[data-cart-item]") ||
        inp.closest("[class*='cart-item']") ||
        inp.closest("tr") ||
        inp.parentElement;

      if (!root) return;

      // try to find variant from nearby link
const inputVariantId = String(inp.getAttribute("data-quantity-variant-id") || "").replace(/[^\d]/g, "");
      let numeric = inputVariantId || "";
      if (!numeric) {
        // try to find variant from nearby link
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

    // try append into a common “details” area, otherwise append to root
    const target =
      lineNode.querySelector("[class*='cart-item__details']") ||
      lineNode.querySelector("[class*='CartItem__Details']") ||
      lineNode;

    target.appendChild(c);
    return c;
  }
function cleanupOldBadges() {
  document.querySelectorAll("[data-discount-badges='1']").forEach((n) => {
    try { n.remove(); } catch {}
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
  // Main cart table uses <tr id="CartItem-{{ index }}">
  const byId = document.getElementById(`CartItem-${lineIndex1Based}`);
  if (byId) return byId;

  // fallback: many themes keep data-index on remove buttons/inputs
  const byDataIndex =
    document.querySelector(`[data-index="${lineIndex1Based}"]`) ||
    document.querySelector(`[data-line="${lineIndex1Based}"]`);

  if (byDataIndex) {
    return (
      byDataIndex.closest(".cart-item") ||
      byDataIndex.closest("tr") ||
      byDataIndex.closest("li") ||
      byDataIndex
    );
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


  function renderBreakdown(pricing) {
    // Optional: put <div id="CartDrawer-PricingBreakdown"></div> in drawer,
    // or use any existing container.
    const root =
      document.getElementById("CartDrawer-PricingBreakdown") ||
      document.getElementById("Cart-PricingBreakdown");

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

function buildCampaignPayload(pricing, cart) {
  const cartItems = Array.isArray(cart?.items) ? cart.items : [];

  // map variant_id -> cart item (first match)
  const cartItemByVariantId = new Map();
  cartItems.forEach((it) => {
    const key = Number(it.variant_id);
    if (!Number.isFinite(key)) return;
    if (!cartItemByVariantId.has(key)) cartItemByVariantId.set(key, it);
  });

  const appliedCampaigns = Array.isArray(pricing?.appliedCampaigns) ? pricing.appliedCampaigns : [];

  // 1) collect all campaign ids from lines (including giftCampaignId)
  const idSet = new Set();
  (pricing?.lines || []).forEach((line) => {
    if (!line) return;
    const ids = Array.isArray(line.appliedCampaignIds) ? line.appliedCampaignIds : [];
    ids.forEach((id) => id && idSet.add(String(id)));
    if (line.isGiftLine && line.giftCampaignId) idSet.add(String(line.giftCampaignId));
  });

  // 2) include meta from appliedCampaigns
  appliedCampaigns.forEach((c) => c?.id && idSet.add(String(c.id)));

  // 3) build blocks
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

  // 4) fill items from pricing.lines
  (pricing?.lines || []).forEach((line) => {
    if (!line) return;

    const numericId = gidToNumericVariantId(line.variantId);
    const cartItem = numericId ? cartItemByVariantId.get(Number(numericId)) : null;

    const title = cartItem?.product_title || cartItem?.title || "Campaign item";
    const image = cartItem?.image || cartItem?.featured_image?.url || "";
    const url = cartItem?.url || cartItem?.product_url || "";

    const quantity = Number(line.quantity || 0);
    if (quantity <= 0) return;

    // Gift lines => show ONLY inside campaign block (NOT in global gifts list)
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
      });
      return;
    }

    // Base lines that participate in campaigns
    const campaignIds = Array.isArray(line.appliedCampaignIds) ? line.appliedCampaignIds : [];
    if (!campaignIds.length) return;

    const freeUnits = Number(line.freeUnits || 0);

    campaignIds.forEach((campaignId) => {
      const block = blocksById.get(String(campaignId || ""));
      if (!block) return;

      // Keep your existing semantics (show quantity participating)
      const campaignQuantity = freeUnits > 0 ? Math.min(freeUnits, quantity) : quantity;
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
      });
    });
  });

  const campaignBlocks = blocks.filter((b) => Array.isArray(b.items) && b.items.length > 0);

  // IMPORTANT: disable global gifts rendering => removes duplicate virtual gift row
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

      // DEBUG
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
      const syncedCart = (await syncGifts(cart, pricing)) || cart;

      suppressMutationsUntil = Date.now() + 1000;

      renderBreakdown(pricing);
      dispatchCampaignPayload(buildCampaignPayload(pricing, syncedCart));

      // try render badges per line (best effort)
      const nodeMap = findLineNodesMap();
      const lineMap = new Map();
      pricing.lines.forEach((line) => {
        // NOTE: DOM mapping by variantId is imperfect if the same variant appears twice.
        // It's still OK as best-effort badges.
        if (!lineMap.has(line.variantId)) lineMap.set(line.variantId, line);
      });

      for (const [variantGid, line] of lineMap.entries()) {
        let node = nodeMap.get(variantGid);
        if (!node) {
          const numericId = gidToNumericVariantId(variantGid);
          if (numericId) {
            const inputMatch = document.querySelector(
              `input[data-quantity-variant-id='${numericId}'], input[data-quantity-variant-id='${String(
                numericId,
              )}']`,
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

        const lineRoot =
          node.closest(".cart-item") ||
          node.closest("[data-cart-item]") ||
          node.closest("tr") ||
          node;



        const isFreeLine = line.isFree || (line.freeUnits && line.freeUnits > 0) || line.isGiftLine;
        if (isFreeLine) {
          lineRoot.setAttribute("data-line-free", "true");
        } else {
          lineRoot.removeAttribute("data-line-free");
        }

        updateLinePriceDisplay(node, isFreeLine);
      }

// ✅ hide real gift lines in DOM (stable by line index)
hideGiftLinesInDomByCart(syncedCart);
setTimeout(() => {
  try { hideGiftLinesInDomByCart(syncedCart); } catch {}
}, 0);

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
  const targets = [
    getMainCartRoot(),
    document.getElementById("CartDrawer"),
    document.querySelector("cart-drawer"),
    document.querySelector("#CartDrawer"),
  ].filter(Boolean);

  if (!targets.length) return;

  const observer = new MutationObserver((records) => {
    if (Date.now() < suppressMutationsUntil) return;
    if (isMkMutation(records)) return; // игнорим наши вставки
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
