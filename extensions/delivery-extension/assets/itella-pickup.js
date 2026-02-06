(async function () {
  console.log("[ITELLA PICKUP] VERSION 2026-02-06 12:40");

  // Support multiple instances of the block (cart page + cart drawer, etc.)
  const roots = document.querySelectorAll('[data-itella-pickup-root="1"]');
  if (!roots.length) return;

  roots.forEach((root) => {
    // Prevent double init on same DOM node (themes often re-render cart sections)
    if (root.dataset.itellaInit === "1") return;
    root.dataset.itellaInit = "1";

    // ----------- Scoped DOM queries (ONLY inside this root) -----------
    const checkoutBtn = root.querySelector("[data-itella-checkout-btn]");

    const countryBtn = root.querySelector("#pickup-country-btn");
    const countryMenu = root.querySelector("#pickup-country-menu");
    const countryLabel = root.querySelector("#pickup-country-label");
    const countryFlag = root.querySelector("#pickup-country-flag");

    const providersWrap = root.querySelector("#pickup-providers");
    const pointsWrap = root.querySelector("#pickup-points");
    const search = root.querySelector("#pickup-search");
    const pointBtn = root.querySelector("#pickup-point-btn");
    const pointMenu = root.querySelector("#pickup-point-menu");
    const pointList = root.querySelector("#pickup-point-list");
    const pointLabel = root.querySelector("#pickup-point-label");
    const current = root.querySelector("#pickup-current");
    const fallbackNotice = root.querySelector("#pickup-fallback");

    const nameInput = root.querySelector("#pickup-name");
    const addressInput = root.querySelector("#pickup-address1");
    const cityInput = root.querySelector("#pickup-city");
    const zipInput = root.querySelector("#pickup-zip");
    const phoneCodeInput = root.querySelector("#pickup-phone-code"); // NEW
    const phoneInput = root.querySelector("#pickup-phone");
    const emailInput = root.querySelector("#pickup-email");

    const woltWrap = root.querySelector("#pickup-wolt");
    const woltNotice = root.querySelector("#pickup-wolt-notice");
    const woltDateInput = root.querySelector("#pickup-wolt-date");
    const woltTimeSelect = root.querySelector("#pickup-wolt-time");

    const DEFAULT_COUNTRY = (root.dataset.defaultCountry || "EE").toUpperCase();

    const i18n = {
      labelCountry: root.dataset.labelCountry || "Country",
      labelProvider: root.dataset.labelProvider || "Please select a service provider",
      labelPickupPoint: root.dataset.labelPickupPoint || "Pickup point",
      textLoading: root.dataset.textLoading || "Loading…",
      textSelectPickup: root.dataset.textSelectPickup || "Select pickup point…",
      textPickupNotRequired: root.dataset.textPickupNotRequired || "Pickup point not required",
      textNoProviders: root.dataset.textNoProviders || "No providers enabled for this country.",
      textNoPoints: root.dataset.textNoPoints || "No pickup points found.",
      textSelected: root.dataset.textSelected || "Selected",
      textPriceLabel: root.dataset.textPriceLabel || "Price",
      textFallback:
        root.dataset.textFallback ||
        "Using fallback delivery settings. Enable App Proxy to load saved config.",
      textSearchPlaceholder: root.dataset.textSearchPlaceholder || "Search by city / address / name",
    };

    // URLs you provided
    const LOCATIONS_BY_COUNTRY = {
      FI: "https://production.parcely.app/locations_4_11.json",
      EE: "https://production.parcely.app/locations_1_1.json",
      LV: "https://production.parcely.app/locations_2_1.json",
      LT: "https://production.parcely.app/locations_3_1.json",
    };

    // Fallback if proxy config isn't available yet
    const FALLBACK_CONFIG = {
      countries: [
        {
          code: "EE",
          label: "Estonia",
          flagUrl: "https://flagcdn.com/w40/ee.png",
          enabled: true,
          providers: ["smartposti", "flat_rate"],
          providerLabels: { flat_rate: "Flat rate delivery" },
          pricesByProvider: { smartposti: "3.99", flat_rate: "4.99" },
        },
        {
          code: "LV",
          label: "Latvia",
          flagUrl: "https://flagcdn.com/w40/lv.png",
          enabled: true,
          providers: ["smartposti", "flat_rate"],
          providerLabels: { flat_rate: "Flat rate delivery" },
          pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
        },
        {
          code: "LT",
          label: "Lithuania",
          flagUrl: "https://flagcdn.com/w40/lt.png",
          enabled: true,
          providers: ["smartposti", "flat_rate"],
          providerLabels: { flat_rate: "Flat rate delivery" },
          pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
        },
        {
          code: "FI",
          label: "Finland",
          flagUrl: "https://flagcdn.com/w40/fi.png",
          enabled: true,
          providers: ["smartposti", "flat_rate"],
          providerLabels: { flat_rate: "Flat rate delivery" },
          pricesByProvider: { smartposti: "6.99", flat_rate: "7.99" },
        },
      ],
      providerMeta: {
        smartposti: {
          title: "Smartposti parcel lockers",
          logo: "https://production.parcely.app/images/itella.png",
        },
        flat_rate: {
          title: "Flat rate delivery",
        },
      },
    };

    let config = null;

    let state = {
      country: DEFAULT_COUNTRY,
      provider: "smartposti",
      points: [],
      filtered: [],
    };

    const customerDefaults = {
      loggedIn: root.dataset.customerLoggedIn === "true",
      email: (root.dataset.customerEmail || "").trim(),
      name: (root.dataset.customerName || "").trim(),
      address1: (root.dataset.customerAddress1 || "").trim(),
      city: (root.dataset.customerCity || "").trim(),
      zip: (root.dataset.customerZip || "").trim(),
      phone: (root.dataset.customerPhone || "").trim(),
    };

    const WOLT_TIME_SLOTS = [
      { label: "9:00 - 10:30", start: 9 * 60 },
      { label: "10:30 - 12:00", start: 10 * 60 + 30 },
      { label: "12:00 - 13:30", start: 12 * 60 },
      { label: "13:30 - 15:00", start: 13 * 60 + 30 },
      { label: "15:00 - 16:30", start: 15 * 60 },
      { label: "16:30 - 18:00", start: 16 * 60 + 30 },
    ];

    function normalize(s) {
      return (s || "").toString().toLowerCase().trim();
    }

    function sanitizePhone(s) {
      return (s || "")
        .toString()
        .replace(/[^\d+]/g, "")
        .trim();
    }

    function combinePhone(code, phone) {
      const c = sanitizePhone(code);
      const p = sanitizePhone(phone);
      if (!c && !p) return "";
      if (c && p) return `${c} ${p}`.trim();
      return (c || p).trim();
    }

    function maskEmail(email) {
      const e = (email || "").trim();
      if (!e.includes("@")) return e ? "***" : "";
      const [u, d] = e.split("@");
      const u2 = u.length <= 2 ? u[0] + "*" : u.slice(0, 2) + "***";
      return `${u2}@${d}`;
    }

    function maskPhone(phone) {
      const p = (phone || "").replace(/\s+/g, " ").trim();
      if (!p) return "";
      if (p.length <= 4) return "***";
      return p.slice(0, 4) + "***";
    }

    function isSameDay(dateA, dateB) {
      return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate()
      );
    }

    function isWeekend(date) {
      const day = date.getDay();
      return day === 0 || day === 6;
    }

    function formatDateInput(date) {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    function parseDateInput(value) {
      if (!value) return null;
      const [yyyy, mm, dd] = value.split("-").map(Number);
      if (!yyyy || !mm || !dd) return null;
      return new Date(yyyy, mm - 1, dd);
    }

    function getNextValidDate(startDate) {
      const date = new Date(startDate);
      while (isWeekend(date)) {
        date.setDate(date.getDate() + 1);
      }
      return date;
    }

    let cartAttributes = null;

    async function fetchJSON(url) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    }

    async function readCartAttributes() {
      const res = await fetch("/cart.js", { cache: "no-store" });
      const cart = await res.json();
      cartAttributes = cart.attributes || {};
      return cartAttributes;
    }

    async function readCart() {
      const res = await fetch("/cart.js", { cache: "no-store" });
      return await res.json();
    }

    function attributesMatch(current, payload) {
      return Object.keys(payload).every((key) => {
        const currentValue = current?.[key] ?? "";
        const nextValue = payload?.[key] ?? "";
        return String(currentValue) === String(nextValue);
      });
    }

    async function writeCartAttributes(payload) {
      const current = cartAttributes ?? (await readCartAttributes());
      if (attributesMatch(current, payload)) return;
      const nextAttributes = { ...current, ...payload };
      await fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: nextAttributes }),
      });
      cartAttributes = nextAttributes;
    }

    function getCountryConfig(code) {
      return (config.countries || []).find((country) => country.code === code);
    }

    function setCountryUI(country) {
      if (!countryLabel || !countryFlag) return;
      countryLabel.textContent = country?.label || country?.code || "Unknown";
      if (country?.flagUrl) {
        countryFlag.style.backgroundImage = `url(${country.flagUrl})`;
        countryFlag.textContent = "";
      } else {
        countryFlag.style.backgroundImage = "";
        countryFlag.textContent = country?.code || "🏳️";
      }
    }

    function getProviderMeta(providerKey, country) {
      if (country?.providerLabels?.[providerKey]) {
        return { title: country.providerLabels[providerKey] };
      }
      return (config.providerMeta && config.providerMeta[providerKey]) || { title: providerKey };
    }

    function parsePriceToCents(price) {
      if (!price) return 0;
      const normalized = String(price).replace(",", ".").replace(/[^\d.]/g, "").trim();
      const value = Number.parseFloat(normalized);
      if (Number.isNaN(value)) return 0;
      return Math.round(value * 100);
    }

    function parsePriceDetails(price) {
      if (!price) return { amount: "", currency: "" };
      const amount = String(price).replace(",", ".").match(/[\d.]+/)?.[0];
      const currency = String(price).match(/[A-Z]{3}/)?.[0] || "";
      return { amount: amount || "", currency };
    }

    function formatMoney(cents, currency) {
      const value = Number.isFinite(cents) ? cents / 100 : 0;
      if (typeof Intl !== "undefined" && currency) {
        try {
          return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
        } catch {
          return `${currency} ${value.toFixed(2)}`;
        }
      }
      return value.toFixed(2);
    }

    async function updateCartTotals(price) {
      const cart = await readCart();
      const currency = cart.currency || cart.currency_code || cart.presentment_currency;
      const deliveryCents = parsePriceToCents(price);
      const subtotalCents = cart.total_price || 0;
      const totalWithDelivery = subtotalCents + deliveryCents;

      // NOTE: totals live outside the block, so this remains global
      const totalTargets = document.querySelectorAll(
        "[data-itella-cart-total], .cart-subtotal__price, .totals__subtotal-value",
      );

      totalTargets.forEach((node) => {
        if (node.closest("button, a")) return;
        let target = node;
        if (node.children.length > 0) {
          const nested = node.querySelector(
            "[data-itella-cart-total], .money, .price, .totals__subtotal-value",
          );
          if (!nested) return;
          target = nested;
        }
        target.textContent = formatMoney(totalWithDelivery, currency);
      });
    }

    async function syncProviderAttributes(country, providerKey) {
      const meta = getProviderMeta(providerKey, country);
      const price = country?.pricesByProvider?.[providerKey] || "";
      const priceDetails = parsePriceDetails(price);

      await writeCartAttributes({
        itella_pickup_provider: providerKey,
        itella_pickup_country: country?.code || state.country,
        itella_delivery_title: meta.title || providerKey,
        itella_delivery_price: price,
        itella_delivery_currency: priceDetails.currency,
      });

      await updateCartTotals(price);

      if (providerKey !== "wolt") {
        await writeCartAttributes({
          itella_wolt_date: "",
          itella_wolt_time: "",
        });
      }
    }

    function getRecipientPayload() {
      const phoneCode = (phoneCodeInput?.value || "").trim();
      const phone = (phoneInput?.value || "").trim();
      const email = (emailInput?.value || customerDefaults.email || "").trim();

      return {
        itella_recipient_name: nameInput?.value?.trim() || "",
        itella_recipient_address1: addressInput?.value?.trim() || "",
        itella_recipient_city: cityInput?.value?.trim() || "",
        itella_recipient_zip: zipInput?.value?.trim() || "",
        itella_recipient_phone_code: phoneCode,
        itella_recipient_phone: phone,
        itella_recipient_email: email,
      };
    }

    function getCityValue() {
      const city = normalize(cityInput?.value);
      if (city) return city;
      if (cartAttributes?.itella_recipient_city) return normalize(cartAttributes.itella_recipient_city);
      return "";
    }

    function isTallinn() {
      const city = getCityValue();
      return state.country === "EE" && (city.includes("tallinn") || city.includes("таллин"));
    }

    function shouldInvalidateDraft(prevAttrs, nextAttrs) {
      // if any of these change, cached invoiceUrl might become outdated
      const keys = [
        "itella_pickup_provider",
        "itella_pickup_country",
        "itella_pickup_id",
        "itella_delivery_title",
        "itella_delivery_price",
        "itella_delivery_currency",
        "itella_recipient_name",
        "itella_recipient_address1",
        "itella_recipient_city",
        "itella_recipient_zip",
        "itella_recipient_phone_code",
        "itella_recipient_phone",
        "itella_recipient_email",
        "itella_wolt_date",
        "itella_wolt_time",
      ];
      return keys.some((k) => String(prevAttrs?.[k] || "") !== String(nextAttrs?.[k] || ""));
    }

    async function syncRecipientAttributes() {
      if (!nameInput || !addressInput || !cityInput || !zipInput || !phoneInput) return;

      const prev = cartAttributes ?? (await readCartAttributes());
      const payload = getRecipientPayload();

      await writeCartAttributes(payload);

      // invalidate cached invoice URL if key recipient fields changed
      const next = cartAttributes ?? (await readCartAttributes());
      if (shouldInvalidateDraft(prev, next)) {
        await writeCartAttributes({
          itella_draft_order_invoice_url: "",
        });
      }

      await updateWoltAvailability();
    }

    async function syncWoltAttributes() {
      if (!woltDateInput || !woltTimeSelect) return;

      const prev = cartAttributes ?? (await readCartAttributes());
      await writeCartAttributes({
        itella_wolt_date: woltDateInput.value || "",
        itella_wolt_time: woltTimeSelect.value || "",
      });

      const next = cartAttributes ?? (await readCartAttributes());
      if (shouldInvalidateDraft(prev, next)) {
        await writeCartAttributes({
          itella_draft_order_invoice_url: "",
        });
      }
    }

    async function createDraftOrder() {
      console.log("[itella] createDraftOrder called", new Date().toISOString());

      const cart = await readCart();
      if (!cart?.items?.length) return null;

      const attrs = await readCartAttributes();
      const payload = {
        mode: "checkout",
        customerId: null,
        items: cart.items.map((item) => ({
          variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
          quantity: item.quantity,
        })),
        shipping: {
          method:
            attrs.itella_pickup_provider === "wolt"
              ? "wolt"
              : attrs.itella_pickup_provider === "smartposti"
                ? "smartposti"
                : "pickup",
          pickupPointId: attrs.itella_pickup_id || null,
        },
        promoCode: attrs.itella_promo_code || null,
        freeChoiceVariantId: attrs.itella_free_choice_variant_id || null,
      };

      // Masked debug log (safe for prod). If you want full, replace with console.log(payload)
      console.log("[itella] checkout payload (masked):", {
        ...payload,
      });

      const res = await fetch("/apps/checkout/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errText = "";
        try {
          errText = await res.text();
        } catch {}
        console.error("[itella] checkout prepare failed", res.status, errText);
        return null;
      }

      const data = await res.json();

      if (data?.draftOrderId) {
        await writeCartAttributes({
          itella_draft_order_id: data.draftOrderId,
          itella_draft_order_invoice_url: data.invoiceUrl || "",
        });
      }

      return data || null;
    }

    function renderCountryMenu(countries) {
      if (!countryMenu) return;
      countryMenu.innerHTML = "";

      countries.forEach((country) => {
        const code = country.code;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pickup-menu-item";
        btn.innerHTML = `
          <span class="pickup-flag" style="background-image:url('${country.flagUrl || ""}')"></span>
          <span class="pickup-country-code">${code}</span>
          <span class="pickup-country-name">${country.label || code}</span>
        `;

        btn.addEventListener("click", async () => {
          countryMenu.hidden = true;
          await setCountry(code, country);
        });

        countryMenu.appendChild(btn);
      });
    }

    function renderProviders(providerKeys, pricesByProvider, country) {
      if (!providersWrap) return;
      providersWrap.innerHTML = "";

      if (!providerKeys || providerKeys.length === 0) {
        providersWrap.innerHTML = `<div style="opacity:.7">${i18n.textNoProviders}</div>`;
        return;
      }

      providerKeys.forEach((key) => {
        const meta = getProviderMeta(key, country);
        const displayTitle = meta.title || key;
        const price = pricesByProvider?.[key];
        const woltDisabled = false;

        const label = document.createElement("label");
        label.className = "pickup-provider";
        if (woltDisabled) label.classList.add("is-disabled");

        label.innerHTML = `
          <input type="radio" name="pickup_provider_${state.country}" ${
            state.provider === key ? "checked" : ""
          } />
          ${meta.logo ? `<img src="${meta.logo}" alt="${key}" />` : ""}
          <div style="display:flex;flex-direction:column;gap:2px;">
            <div style="font-weight:600">${displayTitle}</div>
            ${
              price
                ? `<div style="font-size:12px;opacity:.7">${i18n.textPriceLabel}: ${price}</div>`
                : ""
            }
          </div>
          ${key === "wolt" ? `<div class="pickup-provider-note">Tallinn only</div>` : ""}
        `;

        label.addEventListener("click", async () => {
          state.provider = key;
          const c = getCountryConfig(state.country);

          const prev = cartAttributes ?? (await readCartAttributes());
          await syncProviderAttributes(c, key);
          const next = cartAttributes ?? (await readCartAttributes());
          if (shouldInvalidateDraft(prev, next)) {
            await writeCartAttributes({ itella_draft_order_invoice_url: "" });
          }

          await updateWoltVisibility();
          await setPointsVisibility();

          if (key !== "smartposti") {
            await clearPickupSelection();
            return;
          }
          await loadPoints();
        });

        providersWrap.appendChild(label);
      });
    }

    function renderPoints(list) {
      if (!pointList) return;
      pointList.innerHTML = "";

      if (!list.length) {
        pointList.innerHTML = `<div style="padding:10px 12px;opacity:.7">${i18n.textNoPoints}</div>`;
        return;
      }

      list.forEach((p) => {
        const label = `${p.name} — ${p.address}${p.town ? ` (${p.town})` : ""}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pickup-point-option";
        btn.textContent = label;
        btn.dataset.id = p.id;
        btn.dataset.name = p.name;
        btn.dataset.address = p.address;

        btn.addEventListener("click", async () => {
          await selectPoint(btn.dataset.id, btn.dataset.name, btn.dataset.address, label);
          if (pointMenu) pointMenu.hidden = true;
        });

        pointList.appendChild(btn);
      });
    }

    function setCurrentUI(attrs) {
      if (!current) return;
      if (attrs.itella_pickup_provider && attrs.itella_pickup_provider !== "smartposti") {
        current.textContent = "";
        return;
      }

      const c = attrs.itella_pickup_country || "";
      const id = attrs.itella_pickup_id || "";
      const name = attrs.itella_pickup_name || "";
      const addr = attrs.itella_pickup_address || "";

      if (!id && !name) {
        current.textContent = "";
        return;
      }

      current.textContent = `${i18n.textSelected}: ${c} — ${name} (${id}) — ${addr}`;
    }

    async function loadConfig() {
      try {
        const proxyRes = await fetch("/apps/checkout/pickup-config", { cache: "no-store" });
        if (proxyRes.ok) {
          const proxyJson = await proxyRes.json();
          if (proxyJson?.config && !proxyJson?.warning) {
            return { config: proxyJson.config, usedFallback: false };
          }
        }
      } catch {
        // ignore proxy failure and fall through to fallback
      }

      return { config: FALLBACK_CONFIG, usedFallback: true };
    }

    async function loadPoints() {
      if (state.provider !== "smartposti") {
        state.points = [];
        state.filtered = [];
        renderPoints([]);
        if (pointLabel) pointLabel.textContent = i18n.textPickupNotRequired;
        return;
      }

      const url = LOCATIONS_BY_COUNTRY[state.country] || LOCATIONS_BY_COUNTRY.EE;
      const data = await fetchJSON(url);

      const points = [];
      for (const townBlock of data) {
        const town = townBlock.town || "";
        for (const p of townBlock.points || []) {
          points.push({
            id: String(p.id),
            name: p.name || "",
            address: p.address || "",
            town,
          });
        }
      }

      state.points = points;
      state.filtered = points;

      renderPoints(points);

      const attrs = await readCartAttributes();
      setCurrentUI(attrs);
      if (attrs.itella_pickup_id && pointLabel) {
        pointLabel.textContent = attrs.itella_pickup_name || i18n.textSelected;
      }
    }

    async function setCountry(code, countryOverride) {
      state.country = code;
      const country = countryOverride || getCountryConfig(code);
      if (!country) return;

      setCountryUI(country);

      const allowedProviders = country.providers || [];
      state.provider = allowedProviders[0] || "smartposti";

      renderProviders(allowedProviders, country.pricesByProvider, country);

      const prev = cartAttributes ?? (await readCartAttributes());
      await syncProviderAttributes(country, state.provider);
      const next = cartAttributes ?? (await readCartAttributes());
      if (shouldInvalidateDraft(prev, next)) {
        await writeCartAttributes({ itella_draft_order_invoice_url: "" });
      }

      await updateWoltVisibility();
      await setPointsVisibility();

      await clearPickupSelection(code, state.provider);
      await loadPoints();
    }

    async function clearPickupSelection(countryCode = state.country, provider = state.provider) {
      const prev = cartAttributes ?? (await readCartAttributes());

      await writeCartAttributes({
        itella_pickup_country: countryCode,
        itella_pickup_provider: provider,
        itella_pickup_id: "",
        itella_pickup_name: "",
        itella_pickup_address: "",
      });

      const next = cartAttributes ?? (await readCartAttributes());
      if (shouldInvalidateDraft(prev, next)) {
        await writeCartAttributes({ itella_draft_order_invoice_url: "" });
      }

      setCurrentUI({ itella_pickup_provider: provider });
      if (search) search.value = "";
    }

    async function setPointsVisibility() {
      if (!pointsWrap) return;
      const isPickup = state.provider === "smartposti";
      pointsWrap.style.display = isPickup ? "flex" : "none";
    }

    function updateWoltOptions(dateValue) {
      if (!woltTimeSelect || !woltNotice) return;
      woltTimeSelect.innerHTML = "";

      let selectedDate = parseDateInput(dateValue);
      if (!selectedDate) {
        woltNotice.textContent = "Select a delivery date.";
        woltNotice.hidden = false;
        woltTimeSelect.disabled = true;
        return;
      }

      if (isWeekend(selectedDate)) {
        const nextValid = getNextValidDate(selectedDate);
        if (woltDateInput) woltDateInput.value = formatDateInput(nextValid);
        selectedDate = nextValid;
        woltNotice.textContent = "Weekend delivery is not available. Moved to the next weekday.";
        woltNotice.hidden = false;
      } else {
        woltNotice.hidden = true;
      }

      const now = new Date();
      const minLeadMinutes = 60;
      const minMinutes = isSameDay(selectedDate, now)
        ? now.getHours() * 60 + now.getMinutes() + minLeadMinutes
        : 0;

      const available = WOLT_TIME_SLOTS.filter((slot) => slot.start >= minMinutes);

      if (!available.length) {
        woltNotice.textContent =
          "No delivery slots available for this date. Please choose another day.";
        woltNotice.hidden = false;
        woltTimeSelect.disabled = true;
        return;
      }

      woltTimeSelect.disabled = false;

      available.forEach((slot) => {
        const option = document.createElement("option");
        option.value = slot.label;
        option.textContent = slot.label;
        woltTimeSelect.appendChild(option);
      });

      if (!available.some((slot) => slot.label === woltTimeSelect.value)) {
        woltTimeSelect.value = available[0].label;
      }
    }

    async function updateWoltVisibility() {
      if (!woltWrap) return;

      const isWoltProvider = state.provider === "wolt";
      if (!isWoltProvider) {
        woltWrap.hidden = true;
        woltWrap.style.display = "none";
        if (woltNotice) woltNotice.hidden = true;
        return;
      }

      woltWrap.hidden = false;
      woltWrap.style.display = "flex";

      const tallinnAllowed = isTallinn();
      if (!tallinnAllowed) {
        if (woltNotice) {
          woltNotice.textContent = "Wolt delivery is available only in Tallinn.";
          woltNotice.hidden = false;
        }
        woltDateInput.disabled = true;
        woltTimeSelect.disabled = true;

        await writeCartAttributes({
          itella_wolt_date: "",
          itella_wolt_time: "",
        });

        return;
      }

      if (woltNotice) woltNotice.hidden = true;
      woltDateInput.disabled = false;
      woltTimeSelect.disabled = false;

      const today = new Date();
      const nextValid = getNextValidDate(today);

      woltDateInput.min = formatDateInput(today);
      woltDateInput.max = formatDateInput(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14),
      );

      if (!woltDateInput.value) {
        woltDateInput.value = formatDateInput(nextValid);
      }

      updateWoltOptions(woltDateInput.value);
      await syncWoltAttributes();
    }

    async function updateWoltAvailability() {
      const c = getCountryConfig(state.country);
      if (!c) return;
      renderProviders(c.providers, c.pricesByProvider, c);
      await updateWoltVisibility();
    }

    async function selectPoint(id, name, address, label) {
      if (!id) {
        await clearPickupSelection();
        if (pointLabel) pointLabel.textContent = i18n.textSelectPickup;
        setCurrentUI({});
        return;
      }

      const prev = cartAttributes ?? (await readCartAttributes());

      const payload = {
        itella_pickup_country: state.country,
        itella_pickup_provider: state.provider,
        itella_pickup_id: id,
        itella_pickup_name: name || label || "",
        itella_pickup_address: address || "",
      };

      await writeCartAttributes(payload);

      const next = cartAttributes ?? (await readCartAttributes());
      if (shouldInvalidateDraft(prev, next)) {
        await writeCartAttributes({ itella_draft_order_invoice_url: "" });
      }

      if (pointLabel) pointLabel.textContent = name || label || i18n.textSelected;
      setCurrentUI(payload);
    }

    // ------------------ UI events (scoped + safe) ------------------
    if (countryBtn && countryMenu) {
      countryBtn.addEventListener("click", () => {
        countryMenu.hidden = !countryMenu.hidden;
      });
    }

    if (pointBtn && pointMenu) {
      pointBtn.addEventListener("click", () => {
        pointMenu.hidden = !pointMenu.hidden;
      });
    }

    // Click outside close
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (countryMenu && countryBtn) {
        if (!countryMenu.contains(t) && !countryBtn.contains(t)) countryMenu.hidden = true;
      }
      if (pointMenu && pointBtn) {
        if (!pointMenu.contains(t) && !pointBtn.contains(t)) pointMenu.hidden = true;
      }
    });

    if (search) {
      search.addEventListener("input", () => {
        const q = normalize(search.value);
        if (!q) state.filtered = state.points;
        else {
          state.filtered = state.points.filter((p) => {
            const hay = normalize(`${p.name} ${p.address} ${p.town}`);
            return hay.includes(q);
          });
        }
        renderPoints(state.filtered);
      });
    }

    // Recipient fields
    const recipientInputs = [
      nameInput,
      addressInput,
      cityInput,
      zipInput,
      phoneCodeInput,
      phoneInput,
      emailInput,
    ].filter(Boolean);

    recipientInputs.forEach((input) => {
      input.addEventListener("change", syncRecipientAttributes);
      input.addEventListener("blur", syncRecipientAttributes);
    });

    if (cityInput) {
      cityInput.addEventListener("input", () => {
        updateWoltAvailability();
      });
    }

    if (woltDateInput) {
      woltDateInput.addEventListener("change", () => {
        updateWoltOptions(woltDateInput.value);
        syncWoltAttributes();
      });
    }

    if (woltTimeSelect) {
      woltTimeSelect.addEventListener("change", () => {
        syncWoltAttributes();
      });
    }

    // ------------------ Checkout click: lock + cached URL first ------------------
    let creatingDraft = false;

    function hasEmailFieldOnPage() {
      return !!emailInput;
    }

    async function validateCheckout() {
      await syncRecipientAttributes();
      await syncWoltAttributes();
      const latestAttrs = await readCartAttributes();

      const missing = [];
      if (!latestAttrs.itella_recipient_name) missing.push("Full name");
      if (!latestAttrs.itella_recipient_address1) missing.push("Address");
      if (!latestAttrs.itella_recipient_city) missing.push("City");
      if (!latestAttrs.itella_recipient_zip) missing.push("Postal code");

      // phone must exist (either with code or without)
      const phoneCombined = combinePhone(
        latestAttrs.itella_recipient_phone_code || "",
        latestAttrs.itella_recipient_phone || "",
      );
      if (!phoneCombined) missing.push("Phone");

      // email: if field exists on page -> require
      if (hasEmailFieldOnPage() && !latestAttrs.itella_recipient_email) {
        missing.push("Email");
      }

      if (state.provider === "smartposti" && !latestAttrs.itella_pickup_id) {
        missing.push("Pickup point");
      }

      if (state.provider === "wolt") {
        if (!isTallinn()) missing.push("Wolt delivery is available only in Tallinn");
        if (!latestAttrs.itella_wolt_date) missing.push("Wolt delivery date");
        if (!latestAttrs.itella_wolt_time) missing.push("Wolt delivery time");
      }

      if (missing.length) {
        window.alert(`Please заполните: ${missing.join(", ")}`);
        return false;
      }
      return true;
    }

    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", async () => {
        if (creatingDraft) return;
        creatingDraft = true;
        checkoutBtn.disabled = true;

        try {
          if (!(await validateCheckout())) return;

          // 1) Use cached invoice URL first
          const attrs0 = await readCartAttributes();
          const cachedUrl = (attrs0.itella_draft_order_invoice_url || "").trim();
          if (cachedUrl) {
            window.location.href = cachedUrl;
            return;
          }

          // 2) Create/update draft
          const draftOrder = await createDraftOrder();
          const invoiceUrl = (draftOrder?.invoiceUrl || "").trim();
          if (invoiceUrl) {
            window.location.href = invoiceUrl;
            return;
          }

          // 3) Fallback: try reading again
          const attrs1 = await readCartAttributes();
          const url = (attrs1.itella_draft_order_invoice_url || "").trim();
          if (url) {
            window.location.href = url;
            return;
          }

          window.location.href = "/checkout";
        } finally {
          checkoutBtn.disabled = false;
          creatingDraft = false;
        }
      });
    }

    // ------------------ Boot ------------------
    (async function boot() {
      const configResponse = await loadConfig();
      config = configResponse.config;
      const usedFallback = configResponse.usedFallback;

      if (fallbackNotice) {
        fallbackNotice.textContent = usedFallback ? i18n.textFallback : "";
        fallbackNotice.hidden = !usedFallback;
      }

      // Enabled countries from config
      const enabledCountries = (config.countries || []).filter((country) => country.enabled);
      const finalCountries = usedFallback ? FALLBACK_CONFIG.countries : enabledCountries;

      renderCountryMenu(finalCountries);

      // Restore from cart
      const attrs = await readCartAttributes();
      await updateCartTotals(attrs.itella_delivery_price || "");

      if (nameInput) nameInput.value = attrs.itella_recipient_name || customerDefaults.name || "";
      if (addressInput) addressInput.value = attrs.itella_recipient_address1 || customerDefaults.address1 || "";
      if (cityInput) cityInput.value = attrs.itella_recipient_city || customerDefaults.city || "";
      if (zipInput) zipInput.value = attrs.itella_recipient_zip || customerDefaults.zip || "";

      if (phoneCodeInput) {
        phoneCodeInput.value = (attrs.itella_recipient_phone_code || "").trim() || phoneCodeInput.value || "";
      }
      if (phoneInput) phoneInput.value = attrs.itella_recipient_phone || customerDefaults.phone || "";
      if (emailInput) emailInput.value = attrs.itella_recipient_email || customerDefaults.email || "";

      if (woltDateInput) woltDateInput.value = attrs.itella_wolt_date || "";
      if (woltTimeSelect && attrs.itella_wolt_time) {
        const option = document.createElement("option");
        option.value = attrs.itella_wolt_time;
        option.textContent = attrs.itella_wolt_time;
        woltTimeSelect.appendChild(option);
        woltTimeSelect.value = attrs.itella_wolt_time;
      }

      // Persist defaults if any
      const recipientDefaults = getRecipientPayload();
      if (Object.values(recipientDefaults).some((value) => value)) {
        await writeCartAttributes(recipientDefaults);
      }

      const restoredCountry = (attrs.itella_pickup_country || DEFAULT_COUNTRY).toUpperCase();
      const startCountry = finalCountries.find((c) => c.code === restoredCountry)
        ? restoredCountry
        : finalCountries[0]?.code || "EE";

      await setCountry(startCountry);

      // Validate restored provider against allowed providers
      const restoredProvider = (attrs.itella_pickup_provider || "").trim();
      const country = getCountryConfig(startCountry);
      const allowed = country?.providers || [];

      if (restoredProvider) {
        if (!allowed.includes(restoredProvider)) {
          state.provider = allowed[0] || "smartposti";
          await writeCartAttributes({ itella_pickup_provider: state.provider });
        } else {
          state.provider = restoredProvider;
        }

        if (country) {
          renderProviders(country.providers, country.pricesByProvider, country);
          await syncProviderAttributes(country, state.provider);
          await setPointsVisibility();
          await loadPoints();
          await updateWoltVisibility();
        }
      }
    })();
  });
})();
