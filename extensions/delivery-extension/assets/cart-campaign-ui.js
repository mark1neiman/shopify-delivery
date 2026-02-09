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
      // Удаляем только элементы (TR/LI/...), текстовые узлы можно игнорировать
      if (n.nodeType === 1) n.remove();
      n = next;
    }
  }

  // --- IMPORTANT: was missing in your file (caused render to silently fail) ---
  function stableStringify(obj) {
    // Безопасная JSON-сериализация со стабильным порядком ключей
    const seen = new WeakSet();
    return JSON.stringify(obj, function (key, value) {
      if (value && typeof value === "object") {
        if (seen.has(value)) return undefined;
        seen.add(value);

        if (Array.isArray(value)) return value;

        // сортируем ключи
        const out = {};
        Object.keys(value)
          .sort()
          .forEach((k) => {
            out[k] = value[k];
          });
        return out;
      }
      return value;
    });
  }

  function buildPayloadKey(payload) {
    // Берём только то, что влияет на DOM-рендер.
    const p = payload || {};
    const keyObj = {
      showVirtualGifts: !!p.showVirtualGifts,
      gifts: Array.isArray(p.gifts)
        ? p.gifts.map((g) => ({
            title: g?.title ?? "",
            quantity: Number(g?.quantity || 0),
            image: g?.image ?? "",
            url: g?.url ?? "",
            note: g?.note ?? "",
          }))
        : [],
      campaignBlocks: Array.isArray(p.campaignBlocks)
        ? p.campaignBlocks.map((b) => ({
            label: b?.label ?? "",
            type: b?.type ?? "",
            items: Array.isArray(b?.items)
              ? b.items.map((it) => ({
                  title: it?.title ?? "",
                  quantity: Number(it?.quantity || 0),
                  image: it?.image ?? "",
                  url: it?.url ?? "",
                  note: it?.note ?? "",
                  isGift: !!it?.isGift,
                  variantId: it?.variantId ?? "",
                  totalQuantity: Number(it?.totalQuantity || 0),
                }))
              : [],
          }))
        : [],
      breakdownHtml: typeof p.breakdownHtml === "string" ? p.breakdownHtml : "",
      campaignsHtml: typeof p.campaignsHtml === "string" ? p.campaignsHtml : "",
    };

    // Если HTML большой — всё равно ок, но ключ будет большим.
    // Можно урезать хэшированием, но пока оставим так для простоты/дебага.
    return stableStringify(keyObj);
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
        const variantId = item.variantId ? String(item.variantId) : "";
        const totalQuantity = Number(item.totalQuantity || 0);
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

        const priceHtml = item.isGift
          ? `<div class="cart-item__prices">
          <div class="price text-right flex flex-wrap items-center gap-x-2 font-body-bolder">
            <span>FREE</span>
          </div>
        </div>`
          : "";

        const qtyControls = !item.isGift && variantId && Number.isFinite(totalQuantity)
          ? `<div class="flex items-center gap-2 text-sm">
              <span class="text-subtext">Total:</span>
              <button type="button" data-mk-campaign-qty="dec" data-variant-id="${escapeHtml(
                variantId,
              )}" data-current-qty="${totalQuantity}" aria-label="Decrease quantity" style="width:28px;height:28px;border:1px solid rgba(0,0,0,.2);border-radius:999px;display:inline-flex;align-items:center;justify-content:center;">−</button>
              <span data-mk-campaign-qty-value>${totalQuantity}</span>
              <button type="button" data-mk-campaign-qty="inc" data-variant-id="${escapeHtml(
                variantId,
              )}" data-current-qty="${totalQuantity}" aria-label="Increase quantity" style="width:28px;height:28px;border:1px solid rgba(0,0,0,.2);border-radius:999px;display:inline-flex;align-items:center;justify-content:center;">+</button>
            </div>`
          : "";

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
        ${qtyControls}
      </div>
      <div class="grid gap-2 hidden lg:grid">${priceHtml}</div>
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

  // MK FIX: inject CSS to hide old badge pills if some other script still creates them
  (function ensureHideBadgePillsCss() {
    if (document.getElementById("mk-hide-discount-badges-css")) return;
    const style = document.createElement("style");
    style.id = "mk-hide-discount-badges-css";
    style.textContent = `
      [data-discount-badges="1"] { display:none !important; }
    `;
    document.head.appendChild(style);
  })();

  function applyPayloadToAllCarts(payload) {
    let payloadKey = "";
    try {
      payloadKey = buildPayloadKey(payload || {});
    } catch (e) {
      // Никогда не ломаем рендер из-за ключа
      console.warn("[MKCartCampaignUI] buildPayloadKey failed, skipping cache", e);
      payloadKey = "";
    }

    if (payloadKey && window.__MK_CART_CAMPAIGN_LAST_KEY__ === payloadKey) return;
    if (payloadKey) window.__MK_CART_CAMPAIGN_LAST_KEY__ = payloadKey;

    const campaignBlocks = Array.isArray(payload?.campaignBlocks) ? payload.campaignBlocks : [];

    qsa(document, SELECTORS.cartRoot).forEach((cartRoot) => {
      insertCampaignBlocks(cartRoot, campaignBlocks);

      // MK FIX: If we have campaign blocks, NEVER render gifts to avoid duplicates.
      // (gift items are already displayed inside campaign block items)
      const allowVirtualGifts = Boolean(payload?.showVirtualGifts) && campaignBlocks.length === 0;

      if (allowVirtualGifts) {
        insertGiftsRows(cartRoot, payload?.gifts);
      } else {
        insertGiftsRows(cartRoot, []);
      }

      renderSidebar(cartRoot, payload);
    });
  }

  window.MKCartCampaignUI = window.MKCartCampaignUI || {};
  let renderInProgress = false;

  async function updateCartQuantity(variantId, nextQty) {
    const res = await fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: Number(variantId), quantity: Number(nextQty) }),
    });
    if (!res.ok) throw new Error("cart/change.js failed");
    return res.json();
  }

  document.addEventListener("click", async (event) => {
    const btn = event.target?.closest?.("[data-mk-campaign-qty]");
    if (!btn) return;
    const action = btn.getAttribute("data-mk-campaign-qty");
    const variantId = btn.getAttribute("data-variant-id") || "";
    const currentQty = Number(btn.getAttribute("data-current-qty") || 0);
    if (!variantId || !Number.isFinite(currentQty)) return;

    const nextQty = action === "dec" ? Math.max(0, currentQty - 1) : currentQty + 1;
    try {
      await updateCartQuantity(variantId, nextQty);
      document.dispatchEvent(new Event("cart:updated"));
    } catch (e) {
      console.warn("[MKCartCampaignUI] failed to update quantity", e);
    }
  });

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

  // keep last payload
  const origRender = function (payload) {
    safeRender(payload);
  };

  window.MKCartCampaignUI.render = (payload) => {
    window.__MK_CART_PRICING_LAST__ = payload || {};
    try {
      origRender(payload);
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

  const EVENTS = ["cart:updated", "cart:change", "cart:refresh", "ajaxCart:rendered", "shopify:section:load"];
  EVENTS.forEach((ev) => window.addEventListener(ev, () => setTimeout(reapplyLast, 0)));

  // Observe existing cart roots AND cart roots created later (drawer/sections)
  const observedRoots = new WeakSet();

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    try {
      cartObserver.observe(root, { childList: true, subtree: true });
    } catch (_) {}
  }

  function scanAndObserveRoots() {
    qsa(document, SELECTORS.cartRoot).forEach(observeRoot);
  }

  const cartObserver = new MutationObserver(() => {
    if (renderInProgress) return;
    Promise.resolve().then(reapplyLast);
  });

  const rootSpawnerObserver = new MutationObserver(() => {
    // кто-то пересоздал cart drawer / main-cart / sections
    scanAndObserveRoots();
    setTimeout(reapplyLast, 0);
  });

  function startObservers() {
    scanAndObserveRoots();
    try {
      rootSpawnerObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startObservers();
      reapplyLast();
    });
  } else {
    startObservers();
    reapplyLast();
  }
})();
