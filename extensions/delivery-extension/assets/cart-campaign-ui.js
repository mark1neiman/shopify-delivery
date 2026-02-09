// extensions/delivery-extension/assets/cart-campaign-ui.js
// Virtual campaign gifts renderer for cart DOM (opt-in via data-mk-* markers)
(function () {
  if (window.__mk_cart_campaign_ui_loaded) return;
  window.__mk_cart_campaign_ui_loaded = true;

  const SELECTORS = {
    cartRoot: "main-cart[id^='MainCart-'], cart-drawer, #CartDrawer",
    tbody: "tbody[data-mk-cart-tbody]",
    list: "ul[data-mk-cart-list]",
    giftsStart: "[data-mk-gifts-start]",
    giftsEnd: "[data-mk-gifts-end]",
    campaignsStart: "[data-mk-campaigns-start]",
    campaignsEnd: "[data-mk-campaigns-end]",
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

  function buildGiftRow({ title, quantity, image, url, note }) {
    const safeTitle = escapeHtml(title);
    const qty = Number(quantity || 1);
    const img = image ? String(image) : "";
    const link = url ? String(url) : "";
    const noteHtml = note ? `<div class="text-sm text-subtext">${escapeHtml(note)}</div>` : "";

    const mediaHtml = img
      ? `<a class="cart-item__media blocks-radius media-wrapper" href="${escapeHtml(
          link || "#",
        )}" tabindex="-1" aria-label="${safeTitle}">
            <img src="${escapeHtml(
              img,
            )}" alt="${safeTitle}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
         </a>`
      : "";

    const titleHtml = link
      ? `<a href="${escapeHtml(link)}" class="cart-item__title text-pcard-title reversed-link">${safeTitle}</a>`
      : `<span class="cart-item__title text-pcard-title">${safeTitle}</span>`;

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

            ${noteHtml}

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
  }

  function buildGiftListItem({ title, quantity, image, url, note }) {
    const safeTitle = escapeHtml(title);
    const qty = Number(quantity || 1);
    const img = image ? String(image) : "";
    const link = url ? String(url) : "";
    const noteHtml = note ? `<div class="text-sm text-subtext">${escapeHtml(note)}</div>` : "";

    const mediaHtml = img
      ? `<a class="cart-item__media blocks-radius media-wrapper" href="${escapeHtml(
          link || "#",
        )}" tabindex="-1" aria-label="${safeTitle}">
            <img src="${escapeHtml(
              img,
            )}" alt="${safeTitle}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
         </a>`
      : "";

    const titleHtml = link
      ? `<a href="${escapeHtml(link)}" class="cart-item__title text-pcard-title reversed-link">${safeTitle}</a>`
      : `<span class="cart-item__title text-pcard-title">${safeTitle}</span>`;

    return `
<li class="cart-item cart-item--mk-virtual" data-mk-virtual-gift>
  <div class="cart-item__product flex items-start gap-3">
    ${mediaHtml}
    <div class="cart-item__details flex-grow flex flex-col gap-3">
      <div class="flex justify-between gap-3">
        <div class="grid flex-1">
          <div class="block">${titleHtml}</div>
          ${noteHtml}
          <div class="text-sm text-subtext">Qty: ${qty}</div>
        </div>
        <span class="blocks-radius" style="padding:.2rem .5rem;font-size:12px;font-weight:700;border:1px solid currentColor;opacity:.9;align-self:flex-start;">
          FREE
        </span>
      </div>
    </div>
  </div>
</li>`;
  }

  function insertGiftsRows(cartRoot, gifts) {
    const safeGifts = Array.isArray(gifts) ? gifts : [];

    const tbody = cartRoot.querySelector(SELECTORS.tbody);
    if (tbody) {
      const start = tbody.querySelector(SELECTORS.giftsStart);
      const end = tbody.querySelector(SELECTORS.giftsEnd);
      if (!start || !end) return;

      removeBetweenMarkers(start, end);
      if (!safeGifts.length) return;

      const rowsHtml = safeGifts
        .filter((g) => g && g.title)
        .map((g) => buildGiftRow(g))
        .join("");

      end.insertAdjacentHTML("beforebegin", rowsHtml);
      return;
    }

    const list = cartRoot.querySelector(SELECTORS.list);
    if (!list) return;

    const start = list.querySelector(SELECTORS.giftsStart);
    const end = list.querySelector(SELECTORS.giftsEnd);
    if (!start || !end) return;

    removeBetweenMarkers(start, end);
    if (!safeGifts.length) return;

    const rowsHtml = safeGifts
      .filter((g) => g && g.title)
      .map((g) => buildGiftListItem(g))
      .join("");

    end.insertAdjacentHTML("beforebegin", rowsHtml);
  }

  function buildCampaignBlockHtml(block) {
    const label = escapeHtml(block.label || "Campaign");
    const type = block.type ? ` <span style="opacity:.7;">(${escapeHtml(block.type)})</span>` : "";

    const itemsHtml = (block.items || [])
      .map((item) => {
        const safeTitle = escapeHtml(item.title || "Item");
        const qty = Number(item.quantity || 0);
        const note = item.note ? `<div class="text-sm text-subtext">${escapeHtml(item.note)}</div>` : "";
        const img = item.image ? String(item.image) : "";
        const link = item.url ? String(item.url) : "";

        const mediaHtml = img
          ? `<a class="cart-item__media blocks-radius media-wrapper" href="${escapeHtml(
              link || "#",
            )}" tabindex="-1" aria-label="${safeTitle}">
                <img src="${escapeHtml(
                  img,
                )}" alt="${safeTitle}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />
             </a>`
          : "";

        const titleHtml = link
          ? `<a href="${escapeHtml(link)}" class="cart-item__title text-pcard-title reversed-link">${safeTitle}</a>`
          : `<span class="cart-item__title text-pcard-title">${safeTitle}</span>`;

        const badge = item.isGift
          ? `<span class="blocks-radius" style="padding:.2rem .5rem;font-size:12px;font-weight:700;border:1px solid currentColor;opacity:.9;">FREE</span>`
          : `<span class="blocks-radius" style="padding:.2rem .5rem;font-size:12px;font-weight:600;border:1px dashed currentColor;opacity:.85;">Campaign</span>`;

        return `
<div class="cart-item__product flex items-start md:items-center gap-3 md:gap-6">
  ${mediaHtml}
  <div class="cart-item__product--info flex flex-col items-start gap-3 flex-grow">
    <div class="flex justify-between w-full md:grid gap-3">
      <div class="grid gap-1 w-full">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="block">${titleHtml}</div>
          ${badge}
        </div>
        ${note}
        <div class="text-sm text-subtext">Qty: ${qty}</div>
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
</div>`;
      })
      .join("");

    return `
<div style="padding:12px;border:1px dashed rgba(0,0,0,.15);border-radius:12px;display:grid;gap:12px;background:rgba(0,0,0,.02);">
  <div class="font-body-bolder">Campaign: ${label}${type}</div>
  <div style="display:grid;gap:12px;">
    ${itemsHtml}
  </div>
</div>`;
  }

  function insertCampaignBlocks(cartRoot, blocks) {
    const safeBlocks = Array.isArray(blocks) ? blocks : [];

    const tbody = cartRoot.querySelector(SELECTORS.tbody);
    if (tbody) {
      const start = tbody.querySelector(SELECTORS.campaignsStart);
      const end = tbody.querySelector(SELECTORS.campaignsEnd);
      if (!start || !end) return;

      removeBetweenMarkers(start, end);
      if (!safeBlocks.length) return;

      const rowsHtml = safeBlocks
        .filter((b) => b && Array.isArray(b.items) && b.items.length)
        .map(
          (block) => `
<tr class="cart-item cart-item--mk-campaign-block" data-mk-campaign-block>
  <td class="cart-item__product" colspan="3">
    ${buildCampaignBlockHtml(block)}
  </td>
</tr>`,
        )
        .join("");

      end.insertAdjacentHTML("beforebegin", rowsHtml);
      return;
    }

    const list = cartRoot.querySelector(SELECTORS.list);
    if (!list) return;

    const start = list.querySelector(SELECTORS.campaignsStart);
    const end = list.querySelector(SELECTORS.campaignsEnd);
    if (!start || !end) return;

    removeBetweenMarkers(start, end);
    if (!safeBlocks.length) return;

    const rowsHtml = safeBlocks
      .filter((b) => b && Array.isArray(b.items) && b.items.length)
      .map(
        (block) => `
<li class="cart-item cart-item--mk-campaign-block" data-mk-campaign-block>
  ${buildCampaignBlockHtml(block)}
</li>`,
      )
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
    const payloadKey = buildPayloadKey(payload || {});
    if (window.__MK_CART_CAMPAIGN_LAST_KEY__ === payloadKey) return;
    window.__MK_CART_CAMPAIGN_LAST_KEY__ = payloadKey;

    qsa(document, SELECTORS.cartRoot).forEach((cartRoot) => {
      insertCampaignBlocks(cartRoot, payload?.campaignBlocks);
      if (payload?.showVirtualGifts) {
        insertGiftsRows(cartRoot, payload?.gifts);
      } else {
        insertGiftsRows(cartRoot, []);
      }
      renderSidebar(cartRoot, payload);
    });
  }

  window.MKCartCampaignUI = window.MKCartCampaignUI || {};
  let renderInProgress = false;

  function safeRender(payload) {
    if (renderInProgress) return;
    renderInProgress = true;
    try {
      applyPayloadToAllCarts(payload || {});
    } catch (e) {
      console.warn("[MKCartCampaignUI] render error", e);
    } finally {
      setTimeout(() => {
        renderInProgress = false;
      }, 0);
    }
  }

  window.MKCartCampaignUI.render = (payload) => {
    try {
      safeRender(payload);
    } catch (e) {
      console.warn("[MKCartCampaignUI] render error", e);
    }
  };

  window.addEventListener("mk:cart-pricing", (e) => {
    window.MKCartCampaignUI.render(e?.detail || {});
  });

  function reapplyLast() {
    if (renderInProgress) return;
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
    if (renderInProgress) return;
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
