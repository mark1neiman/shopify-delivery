// extensions/delivery-extension/assets/cart.js
// Pricing preview + auto add/remove campaign gift items via /apps/checkout/prepare
// - Items source of truth: /cart.js (NOT DOM)
// - DOM is used only for badges rendering (best effort)
// - Debounced + guarded against parallel calls
// - Robust against non-JSON (e.g., HTML error pages)

(function () {
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
      const a = root.querySelector("a[href*='variant=']");
      const numeric = a ? extractVariantIdFromHref(a.getAttribute("href") || "") : null;
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

  function findGiftLineIndex(cart, numericVariantId, campaignId) {
    const items = cart?.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) continue;
      if (Number(it.variant_id) !== Number(numericVariantId)) continue;

      const isGift = it.properties && String(it.properties._mk_gift) === "1";
      if (!isGift) continue;

      const camp = it.properties?._mk_campaign_id ? String(it.properties._mk_campaign_id) : "";
      if (camp !== String(campaignId || "")) continue;

      return i + 1; // 1-based
    }
    return null;
  }

  let giftSyncInFlight = false;

  async function syncGifts(cart, pricing) {
    if (giftSyncInFlight) return;
    giftSyncInFlight = true;

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

        if (curQty === 0) {
          await cartAddGift(numericId, desiredQty, campaignId);
          continue;
        }

        if (curQty !== desiredQty) {
          const latest = await readCart();
          const lineIndex = findGiftLineIndex(latest, numericId, campaignId);
          if (lineIndex) {
            await cartChangeLine(lineIndex, desiredQty);
          }
        }
      }

      // 2) remove gifts that are no longer desired
      for (const [k] of current.entries()) {
        if (desired.has(k)) continue;

        const [numericIdStr, campaignId] = k.split("::");
        const numericId = Number(numericIdStr);

        const latest = await readCart();
        const lineIndex = findGiftLineIndex(latest, numericId, campaignId);
        if (lineIndex) {
          await cartChangeLine(lineIndex, 0);
        }
      }
    } catch (e) {
      console.warn("[cart.js] syncGifts error:", e);
    } finally {
      giftSyncInFlight = false;
    }
  }

  // ---------- core ----------
  let inFlight = false;
  let debounceTimer = null;

  async function refreshPricing() {
    if (inFlight) return;

    inFlight = true;
    try {
      const cart = await readCart();
      const attrs = cart.attributes || {};

      if (!cart?.items?.length) return;

      const payload = {
        mode: "preview",
        customerId: null,
        items: cart.items
          .map((it) => ({
            variantId: toGid(it.variant_id),
            quantity: Number(it.quantity || 0),
          }))
          .filter((x) => x.variantId && x.quantity > 0),
        shipping: null,
        promoCode: attrs.itella_promo_code || null,
        freeChoiceVariantId: attrs.itella_free_choice_variant_id || null,
      };

      if (!payload.items.length) return;

      // DEBUG
      console.log("[cart.js] preview payload -> /apps/checkout/prepare", payload);

      const res = await fetch(PREVIEW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await safeReadJsonResponse(res);
      if (!data) return;

      if (data.ok === false) {
        console.warn("[cart.js] prepare returned ok:false", data.error || data);
        return;
      }

      const pricing = data?.pricing;
      console.log("[cart.js] preview response pricing:", pricing);

      if (!pricing?.lines?.length) return;

      // ✅ auto add/remove gift products in Shopify cart
      await syncGifts(cart, pricing);

      renderBreakdown(pricing);

      // try render badges per line (best effort)
      const nodeMap = findLineNodesMap();
      const lineMap = new Map();
      pricing.lines.forEach((line) => {
        // NOTE: DOM mapping by variantId is imperfect if the same variant appears twice.
        // It's still OK as best-effort badges.
        if (!lineMap.has(line.variantId)) lineMap.set(line.variantId, line);
      });

      for (const [variantGid, line] of lineMap.entries()) {
        const node = nodeMap.get(variantGid);
        if (!node) continue;

        const badgeContainer = ensureBadgeContainer(node);
        renderBadges(badgeContainer, line);

        if (line.isFree || (line.freeUnits && line.freeUnits > 0)) {
          node.setAttribute("data-line-free", "true");
        } else {
          node.removeAttribute("data-line-free");
        }
      }
    } catch (e) {
      console.warn("[cart.js] refreshPricing error:", e);
    } finally {
      inFlight = false;
    }
  }

  function scheduleRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refreshPricing, 250);
  }

  function watchMutations() {
    const targets = [
      document.getElementById("CartDrawer"),
      document.querySelector("cart-drawer"),
      document.querySelector("main"),
      document.body,
    ].filter(Boolean);

    const observer = new MutationObserver(scheduleRefresh);
    targets.forEach((t) => observer.observe(t, { childList: true, subtree: true }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    scheduleRefresh();
    watchMutations();
  });

  document.addEventListener("cart:updated", scheduleRefresh);
  document.addEventListener("cart:refresh", scheduleRefresh);
})();
