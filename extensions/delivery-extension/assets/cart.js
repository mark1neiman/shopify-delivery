(function () {
  const PREVIEW_ENDPOINT = "/apps/checkout/prepare";

  function toGid(variantId) {
    const raw = String(variantId || "").trim();
    if (!raw) return "";
    if (raw.startsWith("gid://")) return raw;
    return `gid://shopify/ProductVariant/${raw}`;
  }

  function formatMoney(value) {
    if (window.Shopify && typeof window.Shopify.formatMoney === "function") {
      return window.Shopify.formatMoney(Math.round(value * 100));
    }
    return value.toFixed(2);
  }

  function readItemsFromDrawer() {
    const nodes = document.querySelectorAll("li[data-variant-id]");
    const items = [];
    nodes.forEach((node) => {
      const variantId = node.getAttribute("data-variant-id");
      const quantityAttr = node.getAttribute("data-quantity");
      const qtyInput = node.querySelector("input[name='updates[]'], input.quantity__input");
      const quantity = Number.parseInt(quantityAttr || qtyInput?.value || "0", 10);
      if (!variantId || !quantity) return;
      items.push({
        variantId: toGid(variantId),
        quantity,
        node,
      });
    });
    return items;
  }

  function readPromoCode() {
    const input = document.querySelector(
      "input[name='discount'], input[name='promo'], input[name='promo_code']",
    );
    const value = input?.value?.trim();
    return value || null;
  }

  function renderBadges(container, line) {
    if (!container) return;
    container.innerHTML = "";
    const badges = [];

    if (line.isFree || (line.freeUnits && line.freeUnits > 0)) {
      badges.push("FREE");
    }

    if (line.memberUnitPrice < line.baseUnitPrice) {
      badges.push("-15% member");
    }

    if (line.appliedCampaignLabels?.length) {
      badges.push(...line.appliedCampaignLabels);
    }

    if (line.appliedPromoCode) {
      badges.push(`Promo: ${line.appliedPromoCode}`);
    }

    badges.forEach((label) => {
      const badge = document.createElement("span");
      badge.textContent = label;
      badge.style.cssText =
        "display:inline-flex;margin-right:6px;margin-top:4px;padding:2px 6px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px;font-weight:600;";
      container.appendChild(badge);
    });
  }

  function renderBreakdown(breakdown) {
    const root = document.getElementById("CartDrawer-PricingBreakdown");
    if (!root || !breakdown) return;

    root.innerHTML = `
      <div style="display:grid;gap:6px;font-size:13px;">
        <div style="display:flex;justify-content:space-between;">
          <span>Subtotal</span>
          <span>${formatMoney(breakdown.baseSubtotal)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#16a34a;">
          <span>Member discount</span>
          <span>- ${formatMoney(breakdown.memberDiscount)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#16a34a;">
          <span>Campaigns</span>
          <span>- ${formatMoney(breakdown.campaignDiscount)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#16a34a;">
          <span>Promo code</span>
          <span>- ${formatMoney(breakdown.promoDiscount)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:700;">
          <span>Total</span>
          <span>${formatMoney(breakdown.finalSubtotal)}</span>
        </div>
      </div>
    `;
  }

  async function refreshPricing() {
    const items = readItemsFromDrawer();
    if (!items.length) return;

    const payload = {
      mode: "preview",
      customerId: null,
      items: items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      shipping: null,
      promoCode: readPromoCode(),
      freeChoiceVariantId: null,
    };

    const res = await fetch(PREVIEW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return;
    const data = await res.json();
    const pricing = data.pricing;
    if (!pricing) return;

    const lineMap = new Map();
    pricing.lines.forEach((line) => {
      lineMap.set(line.variantId, line);
    });

    items.forEach((item) => {
      const line = lineMap.get(item.variantId);
      if (!line) return;
      let badgeContainer = item.node.querySelector("[data-discount-badges]");
      if (!badgeContainer) {
        badgeContainer = document.createElement("div");
        badgeContainer.setAttribute("data-discount-badges", "1");
        item.node.appendChild(badgeContainer);
      }
      renderBadges(badgeContainer, line);

      if (line.isFree || (line.freeUnits && line.freeUnits > 0)) {
        item.node.setAttribute("data-line-free", "true");
      } else {
        item.node.removeAttribute("data-line-free");
      }
    });

    renderBreakdown(pricing.breakdown);
  }

  function watchCartDrawer() {
    const drawer = document.getElementById("CartDrawer") || document.body;
    const observer = new MutationObserver(() => {
      refreshPricing();
    });
    observer.observe(drawer, { childList: true, subtree: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    refreshPricing();
    watchCartDrawer();
  });

  document.addEventListener("cart:updated", refreshPricing);
  document.addEventListener("cart:refresh", refreshPricing);
})();
