(async function () {
  const root = document.getElementById("pickup-root");
  if (!root) return;

  const countryBtn = document.getElementById("pickup-country-btn");
  const countryMenu = document.getElementById("pickup-country-menu");
  const countryLabel = document.getElementById("pickup-country-label");
  const countryFlag = document.getElementById("pickup-country-flag");
  const providersWrap = document.getElementById("pickup-providers");
  const pointsWrap = document.getElementById("pickup-points");
  const search = document.getElementById("pickup-search");
  const pointBtn = document.getElementById("pickup-point-btn");
  const pointMenu = document.getElementById("pickup-point-menu");
  const pointList = document.getElementById("pickup-point-list");
  const pointLabel = document.getElementById("pickup-point-label");
  const current = document.getElementById("pickup-current");
  const fallbackNotice = document.getElementById("pickup-fallback");
  const nameInput = document.getElementById("pickup-name");
  const addressInput = document.getElementById("pickup-address1");
  const cityInput = document.getElementById("pickup-city");
  const zipInput = document.getElementById("pickup-zip");
  const phoneInput = document.getElementById("pickup-phone");
  const woltWrap = document.getElementById("pickup-wolt");
  const woltNotice = document.getElementById("pickup-wolt-notice");
  const woltDateInput = document.getElementById("pickup-wolt-date");
  const woltTimeSelect = document.getElementById("pickup-wolt-time");
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
    textSearchPlaceholder:
      root.dataset.textSearchPlaceholder || "Search by city / address / name",
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

  function isTallinn() {
    if (!cityInput) return false;
    const city = normalize(cityInput.value);
    return state.country === "EE" && city.includes("tallinn");
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

 let cartAttributes = null;

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
    if (attributesMatch(current, payload)) {
      return;
    }
    const nextAttributes = { ...current, ...payload };
    await fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ attributes: nextAttributes }),
    });
    cartAttributes = nextAttributes;
  }

  function getCountryConfig(code) {
    return (config.countries || []).find(
      (country) => country.code === code,
    );
  }

  function setCountryUI(country) {
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
    return (config.providerMeta && config.providerMeta[providerKey]) || {
      title: providerKey,
    };
  }

  function parsePriceToCents(price) {
    if (!price) return 0;
    const normalized = String(price)
      .replace(",", ".")
      .replace(/[^\d.]/g, "")
      .trim();
    const value = Number.parseFloat(normalized);
    if (Number.isNaN(value)) return 0;
    return Math.round(value * 100);
  }

  function parsePriceDetails(price) {
    if (!price) return { amount: "", currency: "" };
    const amount = String(price)
      .replace(",", ".")
      .match(/[\d.]+/)?.[0];
    const currency = String(price).match(/[A-Z]{3}/)?.[0] || "";
    return { amount: amount || "", currency };
  }

  function formatMoney(cents, currency) {
    const value = Number.isFinite(cents) ? cents / 100 : 0;
    if (typeof Intl !== "undefined" && currency) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency,
        }).format(value);
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

    const totalTargets = document.querySelectorAll(
      "[data-itella-cart-total], .cart-subtotal__price, .totals__subtotal-value",
    );
    totalTargets.forEach((node) => {
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
    scheduleDraftOrder();
  }

  function getRecipientPayload() {
    return {
      itella_recipient_name: nameInput?.value?.trim() || "",
      itella_recipient_address1: addressInput?.value?.trim() || "",
      itella_recipient_city: cityInput?.value?.trim() || "",
      itella_recipient_zip: zipInput?.value?.trim() || "",
      itella_recipient_phone: phoneInput?.value?.trim() || "",
    };
  }

  async function syncRecipientAttributes() {
    if (!nameInput || !addressInput || !cityInput || !zipInput || !phoneInput) {
      return;
    }
    await writeCartAttributes(getRecipientPayload());
    await updateWoltAvailability();
    scheduleDraftOrder();
  }

  async function syncWoltAttributes() {
    if (!woltDateInput || !woltTimeSelect) return;
    await writeCartAttributes({
      itella_wolt_date: woltDateInput.value || "",
      itella_wolt_time: woltTimeSelect.value || "",
    });
    scheduleDraftOrder();
  }

  let draftOrderTimer = null;

  function scheduleDraftOrder() {
    if (draftOrderTimer) {
      clearTimeout(draftOrderTimer);
    }
    draftOrderTimer = setTimeout(() => {
      createDraftOrder().catch(() => {
        // ignore draft order errors for UI flow
      });
    }, 500);
  }

  async function createDraftOrder() {
    const cart = await readCart();
    if (!cart?.items?.length) return;

    const attrs = await readCartAttributes();
    const priceDetails = parsePriceDetails(attrs.itella_delivery_price || "");
    const payload = {
      lineItems: cart.items.map((item) => ({
        variantId: item.variant_id,
        quantity: item.quantity,
      })),
      shippingAddress: {
        name: attrs.itella_recipient_name || "",
        address1: attrs.itella_recipient_address1 || "",
        city: attrs.itella_recipient_city || "",
        zip: attrs.itella_recipient_zip || "",
        countryCode: attrs.itella_pickup_country || state.country,
        phone: attrs.itella_recipient_phone || "",
      },
      delivery: {
        title: attrs.itella_delivery_title || "",
        price: priceDetails.amount || attrs.itella_delivery_price || "",
        currency: attrs.itella_delivery_currency || priceDetails.currency || "",
        provider: attrs.itella_pickup_provider || "",
        pickupId: attrs.itella_pickup_id || "",
        pickupName: attrs.itella_pickup_name || "",
        pickupAddress: attrs.itella_pickup_address || "",
        country: attrs.itella_pickup_country || "",
      },
      attributes: {
        itella_pickup_provider: attrs.itella_pickup_provider || "",
        itella_pickup_country: attrs.itella_pickup_country || "",
        itella_pickup_id: attrs.itella_pickup_id || "",
        itella_pickup_name: attrs.itella_pickup_name || "",
        itella_pickup_address: attrs.itella_pickup_address || "",
        itella_delivery_title: attrs.itella_delivery_title || "",
        itella_delivery_price: attrs.itella_delivery_price || "",
        itella_delivery_currency: attrs.itella_delivery_currency || "",
        itella_recipient_name: attrs.itella_recipient_name || "",
        itella_recipient_address1: attrs.itella_recipient_address1 || "",
        itella_recipient_city: attrs.itella_recipient_city || "",
        itella_recipient_zip: attrs.itella_recipient_zip || "",
        itella_recipient_phone: attrs.itella_recipient_phone || "",
        itella_wolt_date: attrs.itella_wolt_date || "",
        itella_wolt_time: attrs.itella_wolt_time || "",
      },
    };

    const res = await fetch("/apps/draft-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return;
    const data = await res.json();
    if (data?.draftOrder?.id) {
      await writeCartAttributes({
        itella_draft_order_id: data.draftOrder.id,
        itella_draft_order_invoice_url: data.draftOrder.invoiceUrl || "",
      });
    }
  }

  function renderCountryMenu(countries) {
    countryMenu.innerHTML = "";

    countries.forEach((country) => {
      const code = country.code;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `
        <span class="pickup-flag" style="background-image:url('${country.flagUrl || ""}')"></span>
        <span style="min-width:30px">${code}</span>
        <span style="opacity:.8">${country.label || code}</span>
      `;

      btn.addEventListener("click", async () => {
        countryMenu.hidden = true;
        await setCountry(code, country);
      });

      countryMenu.appendChild(btn);
    });
  }

  function renderProviders(providerKeys, pricesByProvider, country) {
    providersWrap.innerHTML = "";

    if (!providerKeys || providerKeys.length === 0) {
      providersWrap.innerHTML = `<div style="opacity:.7">${i18n.textNoProviders}</div>`;
      return;
    }

    providerKeys.forEach((key) => {
      const meta = getProviderMeta(key, country);
      const displayTitle = meta.title || key;
      const price = pricesByProvider?.[key];
      const woltDisabled = key === "wolt" && !isTallinn();

      const label = document.createElement("label");
      label.className = "pickup-provider";
      if (woltDisabled) {
        label.classList.add("is-disabled");
      }
      label.innerHTML = `
        <input type="radio" name="pickup_provider" ${state.provider === key ? "checked" : ""} ${
          woltDisabled ? "disabled" : ""
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
        ${
          key === "wolt"
            ? `<div class="pickup-provider-note">Tallinn only</div>`
            : ""
        }
      `;

      label.addEventListener("click", async () => {
        if (woltDisabled) return;
        state.provider = key;
        const country = getCountryConfig(state.country);
        await syncProviderAttributes(country, key);
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
        pointMenu.hidden = true;
      });
      pointList.appendChild(btn);
    });
  }

  function setCurrentUI(attrs) {
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
      const proxyRes = await fetch("/apps/pickup-config", { cache: "no-store" });
      if (proxyRes.ok) {
        const proxyJson = await proxyRes.json();
        if (proxyJson?.config && !proxyJson?.warning) {
          return { config: proxyJson.config, usedFallback: false };
        }
      }
    } catch (e) {
      // ignore proxy failure and fall through to fallback
    }

    return { config: FALLBACK_CONFIG, usedFallback: true };
  }

  async function loadPoints() {
    if (state.provider !== "smartposti") {
      state.points = [];
      state.filtered = [];
      renderPoints([]);
      pointLabel.textContent = i18n.textPickupNotRequired;
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

    // Fill dropdown with all points
    renderPoints(points);

    // restore selection if exists
    const attrs = await readCartAttributes();
    setCurrentUI(attrs);
    if (attrs.itella_pickup_id) {
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
    await syncProviderAttributes(country, state.provider);
    await updateWoltVisibility();
    await setPointsVisibility();

    // Clear pickup selection on country change
    await clearPickupSelection(code, state.provider);
    await loadPoints();
  }

  async function clearPickupSelection(countryCode = state.country, provider = state.provider) {
    await writeCartAttributes({
      itella_pickup_country: countryCode,
      itella_pickup_provider: provider,
      itella_pickup_id: "",
      itella_pickup_name: "",
      itella_pickup_address: "",
    });

    setCurrentUI({ itella_pickup_provider: provider });
    search.value = "";
    scheduleDraftOrder();
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
      if (woltDateInput) {
        woltDateInput.value = formatDateInput(nextValid);
      }
      selectedDate = nextValid;
      woltNotice.textContent =
        "Weekend delivery is not available. Moved to the next weekday.";
      woltNotice.hidden = false;
    } else {
      woltNotice.hidden = true;
    }

    const now = new Date();
    const minLeadMinutes = 60;
    const minMinutes =
      isSameDay(selectedDate, now) ? now.getHours() * 60 + now.getMinutes() + minLeadMinutes : 0;

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
    if (!woltWrap || !woltDateInput || !woltTimeSelect) return;
    const woltAvailable = state.provider === "wolt" && isTallinn();

    if (!woltAvailable) {
      woltWrap.hidden = true;
      if (woltNotice) {
        woltNotice.hidden = true;
      }
      if (state.provider !== "wolt") {
        return;
      }
      return;
    }

    woltWrap.hidden = false;
    const today = new Date();
    const nextValid = getNextValidDate(today);
    woltDateInput.min = formatDateInput(today);
    woltDateInput.max = formatDateInput(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));
    if (!woltDateInput.value) {
      woltDateInput.value = formatDateInput(nextValid);
    }
    updateWoltOptions(woltDateInput.value);
    await syncWoltAttributes();
  }

  async function updateWoltAvailability() {
    const country = getCountryConfig(state.country);
    if (!country) return;
    if (state.provider === "wolt" && !isTallinn()) {
      const nextProvider = (country.providers || []).find((key) => key !== "wolt");
      state.provider = nextProvider || "smartposti";
      renderProviders(country.providers, country.pricesByProvider, country);
      await syncProviderAttributes(country, state.provider);
      await setPointsVisibility();
    } else {
      renderProviders(country.providers, country.pricesByProvider, country);
    }
    await updateWoltVisibility();
  }

  // UI events
  countryBtn.addEventListener("click", () => {
    countryMenu.hidden = !countryMenu.hidden;
  });

  pointBtn.addEventListener("click", () => {
    pointMenu.hidden = !pointMenu.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!countryMenu.contains(e.target) && !countryBtn.contains(e.target)) {
      countryMenu.hidden = true;
    }
    if (!pointMenu.contains(e.target) && !pointBtn.contains(e.target)) {
      pointMenu.hidden = true;
    }
  });

  search.addEventListener("input", () => {
    const q = normalize(search.value);
    if (!q) {
      state.filtered = state.points;
    } else {
      state.filtered = state.points.filter((p) => {
        const hay = normalize(`${p.name} ${p.address} ${p.town}`);
        return hay.includes(q);
      });
    }
    renderPoints(state.filtered);
  });

  if (nameInput && addressInput && cityInput && zipInput && phoneInput) {
    [nameInput, addressInput, cityInput, zipInput, phoneInput].forEach(
      (input) => {
        input.addEventListener("change", syncRecipientAttributes);
        input.addEventListener("blur", syncRecipientAttributes);
      },
    );
  }

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

  async function selectPoint(id, name, address, label) {
    if (!id) {
      await clearPickupSelection();
      pointLabel.textContent = i18n.textSelectPickup;
      setCurrentUI({});
      return;
    }

    const payload = {
      itella_pickup_country: state.country,
      itella_pickup_provider: state.provider,
      itella_pickup_id: id,
      itella_pickup_name: name || label || "",
      itella_pickup_address: address || "",
    };

    await writeCartAttributes(payload);
    pointLabel.textContent = name || label || i18n.textSelected;
    setCurrentUI(payload);
    scheduleDraftOrder();
  }

  // Boot
  const configResponse = await loadConfig();
  config = configResponse.config;
  const usedFallback = configResponse.usedFallback;
  if (fallbackNotice) {
    fallbackNotice.textContent = usedFallback ? i18n.textFallback : "";
    fallbackNotice.hidden = !usedFallback;
  }

  // Enabled countries from config
  const enabledCountries = (config.countries || []).filter((country) => country.enabled);

  // If config fetch failed → fallback
  const finalCountries = usedFallback
    ? FALLBACK_CONFIG.countries
    : enabledCountries;

  renderCountryMenu(finalCountries);

  // Restore from cart if user already selected something
  const attrs = await readCartAttributes();
  await updateCartTotals(attrs.itella_delivery_price || "");
  if (nameInput) nameInput.value = attrs.itella_recipient_name || "";
  if (addressInput) addressInput.value = attrs.itella_recipient_address1 || "";
  if (cityInput) cityInput.value = attrs.itella_recipient_city || "";
  if (zipInput) zipInput.value = attrs.itella_recipient_zip || "";
  if (phoneInput) phoneInput.value = attrs.itella_recipient_phone || "";
  if (woltDateInput) woltDateInput.value = attrs.itella_wolt_date || "";
  if (woltTimeSelect && attrs.itella_wolt_time) {
    const option = document.createElement("option");
    option.value = attrs.itella_wolt_time;
    option.textContent = attrs.itella_wolt_time;
    woltTimeSelect.appendChild(option);
    woltTimeSelect.value = attrs.itella_wolt_time;
  }
  const restoredCountry = (attrs.itella_pickup_country || DEFAULT_COUNTRY).toUpperCase();

  const startCountry = finalCountries.find((country) => country.code === restoredCountry)
    ? restoredCountry
    : (finalCountries[0]?.code || "EE");

  await setCountry(startCountry);

  const restoredProvider = attrs.itella_pickup_provider;
  if (restoredProvider) {
    state.provider = restoredProvider;
    const country = getCountryConfig(startCountry);
    if (country?.providers?.includes(restoredProvider)) {
      renderProviders(country.providers, country.pricesByProvider, country);
      await syncProviderAttributes(country, restoredProvider);
      await setPointsVisibility();
      await loadPoints();
    }
  }
  scheduleDraftOrder();
})();
