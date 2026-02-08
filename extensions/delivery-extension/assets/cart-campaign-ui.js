// extensions/delivery-extension/assets/cart-campaign-ui.js
// Virtual campaign gifts renderer for cart DOM (opt-in via data-mk-* markers)
(function () {
  if (window.__mk_cart_campaign_ui_loaded) return;
  window.__mk_cart_campaign_ui_loaded = true;

  const SELECTORS = {
    cartRoot: "main-cart[id^='MainCart-']",
    tbody: "tbody[data-mk-cart-tbody]",
    giftsStart: "tr[data-mk-gifts-start]",
    giftsEnd: "tr[data-mk-gifts-end]",
    pricingBreakdown: "[data-mk-pricing-breakdown]",
    appliedCampaigns: "[data-mk-applied-campaigns]",
  };

  function qsa(root, sel) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function removeBetweenMarkers(startEl, endEl) {
    if (!startEl || !endEl) return;
    let n = startEl.nextSibling;
    while (n && n !== endEl) {
      const next = n.nextSibling;
      if (n.nodeType === 1) n.remove();
      n = next;
    }
  }

  function insertGiftsRows(cartRoot, gifts) {
    const tbody = cartRoot.querySelector(SELECTORS.tbody);
    if (!tbody) return;

    const start = tbody.querySelector(SELECTORS.giftsStart);
    const end = tbody.querySelector(SELECTORS.giftsEnd);
    if (!start || !end) return;

    removeBetweenMarkers(start, end);

    const safeGifts = Array.isArray(gifts) ? gifts : [];
    if (!safeGifts.length) return;

    const rowsHtml = safeGifts
      .filter((g) => g && g.title)
      .map((g) => {
        const title = escapeHtml(g.title);
        const qty = Number(g.quantity || 1);
        const img = g.image ? String(g.image) : "";
        const url = g.url ? String(g.url) : "";
        const note = g.note ? escapeHtml(g.note) : "";

        const mediaHtml = img
          ? `<a class="cart-item__media blocks-radius media-wrapper" href="${escapeHtml(
              url || "#",
            )}" tabindex="-1" aria-label="${title}">
                <img src="${escapeHtml(
                  img,
                )}" alt="${title}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
             </a>`
          : "";

        const titleHtml = url
          ? `<a href="${escapeHtml(url)}" class="cart-item__title text-pcard-title reversed-link">${title}</a>`
          : `<span class="cart-item__title text-pcard-title">${title}</span>`;

        return `
<tr class="cart-item cart-item--mk-virtual" data-mk-virtual-gift>
  <td class="cart-item__product">
    <div class="flex items-start md:items-center gap-3 md:gap-6">
      <span class="items-center justify-center relative hidden md:flex btn-remove" aria-hidden="true" style="opacity:.35;pointer-events:none;">
        <!-- empty (virtual item) -->
      </span>

      ${mediaHtml}

      <div class="cart-item__product--info flex flex-col items-start gap-3 flex-grow">
        <div class="flex justify-between w-full md:grid gap-3">
          <div class="grid gap-1 w-full">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="block">
                ${titleHtml}
              </div>
              <span class="blocks-radius" style="padding:.2rem .5rem;font-size:12px;font-weight:700;border:1px solid currentColor;opacity:.9;">
                FREE
              </span>
            </div>

            ${note ? `<div class="text-sm text-subtext">${note}</div>` : ""}

            <div class="text-sm text-subtext">
              Qty: ${qty}
            </div>
          </div>

          <div class="grid gap-2 hidden lg:grid">
            <div class="cart-item__prices">
              <div class="price text-right flex flex-wrap items-center gap-x-2 font-body-bolder">
                <span>FREE</span>
              </div>
            </div>
          </div>

          <span class="items-start justify-center relative flex md:hidden btn-remove" aria-hidden="true" style="opacity:.35;pointer-events:none;">
            <!-- empty -->
          </span>
        </div>
      </div>
    </div>
  </td>

  <td class="cart-item__quantity hidden lg:table-cell">
    <div class="cart-item__action flex items-center justify-between cart-item__quantity-wrapper" style="opacity:.7;">
      ${qty}
    </div>
  </td>

  <td class="cart-item__total hidden lg:table-cell">
    <span class="font-body-bolder">FREE</span>
  </td>
</tr>`;
      })
      .join("");

    end.insertAdjacentHTML("beforebegin", rowsHtml);
  }

  function renderSidebar(cartRoot, payload) {
    const breakdownEls = qsa(cartRoot, SELECTORS.pricingBreakdown);
    const campaignsEls = qsa(cartRoot, SELECTORS.appliedCampaigns);

    const breakdownHtml = typeof payload?.breakdownHtml === "string" ? payload.breakdownHtml : "";
    const campaignsHtml = typeof payload?.campaignsHtml === "string" ? payload.campaignsHtml : "";

    breakdownEls.forEach((el) => {
      el.innerHTML = breakdownHtml || "";
      el.style.display = breakdownHtml ? "" : "none";
    });

    campaignsEls.forEach((el) => {
      el.innerHTML = campaignsHtml || "";
      el.style.display = campaignsHtml ? "" : "none";
    });
  }

  function applyPayloadToAllCarts(payload) {
    qsa(document, SELECTORS.cartRoot).forEach((cartRoot) => {
      insertGiftsRows(cartRoot, payload?.gifts);
      renderSidebar(cartRoot, payload);
    });
  }

  window.MKCartCampaignUI = window.MKCartCampaignUI || {};
  window.MKCartCampaignUI.render = (payload) => {
    try {
      applyPayloadToAllCarts(payload || {});
    } catch (e) {
      console.warn("[MKCartCampaignUI] render error", e);
    }
  };

  window.addEventListener("mk:cart-pricing", (e) => {
    window.MKCartCampaignUI.render(e?.detail || {});
  });

  function reapplyLast() {
    const last = window.__MK_CART_PRICING_LAST__;
    if (last) window.MKCartCampaignUI.render(last);
  }

  const origRender = window.MKCartCampaignUI.render;
  window.MKCartCampaignUI.render = (payload) => {
    window.__MK_CART_PRICING_LAST__ = payload || {};
    origRender(payload);
  };

  const EVENTS = ["cart:updated", "cart:change", "cart:refresh", "ajaxCart:rendered", "shopify:section:load"];
  EVENTS.forEach((ev) => window.addEventListener(ev, () => setTimeout(reapplyLast, 0)));

  const mo = new MutationObserver(() => {
    Promise.resolve().then(reapplyLast);
  });

  function startObserver() {
    qsa(document, SELECTORS.cartRoot).forEach((root) => {
      try {
        mo.observe(root, { childList: true, subtree: true });
      } catch (_) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startObserver();
      reapplyLast();
    });
  } else {
    startObserver();
    reapplyLast();
  }
})();
