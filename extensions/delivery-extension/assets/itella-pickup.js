// shopify-delivery/extensions/delivery-extension/assets/itella-pickup.js
// VERSION 2026-02-11 v10
// Fix: cart qty +/- re-render -> block stuck in Loading forever
// - Adds global re-init (MutationObserver) to init new roots after Shopify replaces cart HTML
// - Keeps per-root state isolated
// - Uses ONE global "click outside" handler (no leaks on re-renders)
// - Keeps promo synced ONLY via syncPromoAttributes (no duplicates)

(function () {
  console.log("[ITELLA PICKUP] VERSION 2026-02-11 v10 (reinit after cart rerender)");

  // ---------- GLOBAL GUARDS ----------
  if (window.__itellaPickupV9Booted) {
    // Still expose manual init (safe) even if script is injected twice
    if (typeof window.__itellaPickupManualInit !== "function") {
      window.__itellaPickupManualInit = function () {};
    }
    return;
  }
  window.__itellaPickupV9Booted = true;

  const PICKUP_DEBUG =
    (typeof window !== "undefined" && window.__ITELLA_PICKUP_DEBUG === true) ||
    (typeof location !== "undefined" &&
      /(?:\?|&)itella_debug=1(?:&|$)/.test(String(location.search || "")));

  const runtime = (window.__itellaPickupRuntime =
    window.__itellaPickupRuntime || {
      configCache: null,
      configPromise: null,
      pointsCacheByUrl: {},
      pointsPromiseByUrl: {},
      cartCache: null,
      cartCacheAt: 0,
      cartPromise: null,
      totalsSignature: "",
      stats: {
        cartRead: 0,
        cartWrite: 0,
        configRead: 0,
        pointsRead: 0,
        prepareRead: 0,
      },
    });

  function pickupDebug(...args) {
    if (!PICKUP_DEBUG) return;
    console.debug("[itella debug]", ...args);
  }

  window.__itellaPickupGetStats = function () {
    return { ...runtime.stats };
  };

  window.__itellaPickupResetStats = function () {
    Object.keys(runtime.stats).forEach((k) => {
      runtime.stats[k] = 0;
    });
    pickupDebug("stats reset");
  };

  async function trackedFetch(url, options, statKey) {
    if (statKey && runtime.stats[statKey] != null) {
      runtime.stats[statKey] += 1;
    }
    pickupDebug("fetch", { url: String(url || ""), statKey });
    return await fetch(url, options);
  }

  // ---------- GLOBAL HELPERS ----------
  function debounce(fn, ms) {
    let t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function hasPickupRoot(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.('[data-itella-pickup-root="1"]')) return true;
    return !!node.querySelector?.('[data-itella-pickup-root="1"]');
  }

  // One global "click outside" close for menus (prevents leaks on rerenders)
  if (!window.__itellaPickupGlobalOutsideClickBound) {
    window.__itellaPickupGlobalOutsideClickBound = true;

    document.addEventListener("click", (e) => {
      const t = e.target;
      const roots = document.querySelectorAll('[data-itella-pickup-root="1"]');
      roots.forEach((root) => {
        const countryBtn = root.querySelector("#pickup-country-btn");
        const countryMenu = root.querySelector("#pickup-country-menu");
        const pointBtn = root.querySelector("#pickup-point-btn");
        const pointMenu = root.querySelector("#pickup-point-menu");

        if (countryMenu && countryBtn) {
          if (!countryMenu.contains(t) && !countryBtn.contains(t)) countryMenu.hidden = true;
        }
        if (pointMenu && pointBtn) {
          if (!pointMenu.contains(t) && !pointBtn.contains(t)) pointMenu.hidden = true;
        }
      });
    });
  }

  // ---------- MAIN INIT (can be called again) ----------
  function initAll() {
    const roots = document.querySelectorAll('[data-itella-pickup-root="1"]');
    if (!roots.length) return;

    roots.forEach((root) => {
      try {
        // Prevent double init on same DOM node (themes re-render cart sections)
        if (root.dataset.itellaInit === "1") return;
        root.dataset.itellaInit = "1";

        initRoot(root);
      } catch (err) {
        console.error("[itella] initRoot failed:", err);
        try {
          const fallbackNotice = root.querySelector("#pickup-fallback");
          if (fallbackNotice) {
            fallbackNotice.textContent =
              "Pickup block failed to initialize. Please reload the page.";
            fallbackNotice.hidden = false;
          }
          const countryLabel = root.querySelector("#pickup-country-label");
          if (countryLabel) countryLabel.textContent = "Error";
        } catch {}
      }
    });
  }

  // Expose manual init for debugging or external triggers
  window.__itellaPickupManualInit = initAll;

  // MutationObserver: when Shopify replaces cart HTML after qty +/-,
  // new pickup roots appear -> init them.
  if (!window.__itellaPickupGlobalObserverBound) {
    window.__itellaPickupGlobalObserverBound = true;

    const schedule = debounce(() => {
      try {
        initAll();
      } catch (e) {
        console.error("[itella] reinit failed:", e);
      }
    }, 80);

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes || []) {
          if (hasPickupRoot(n)) {
            schedule();
            return;
          }
        }
      }
    });

    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Run once on initial load
  initAll();

  // ---------- PER-ROOT IMPLEMENTATION ----------
  function initRoot(root) {
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
    const phoneCodeInput = root.querySelector("#pickup-phone-code");
    const phoneInput = root.querySelector("#pickup-phone");
    const emailInput = root.querySelector("#pickup-email");

    // PROMO
    const promoInput = root.querySelector("#pickup-promo");
    const promoApplyBtn = root.querySelector("#pickup-promo-apply");
    const promoStatus = root.querySelector("#pickup-promo-status");

    const woltWrap = root.querySelector("#pickup-wolt");
    const woltNotice = root.querySelector("#pickup-wolt-notice");
    const woltDateInput = root.querySelector("#pickup-wolt-date");
    const woltTimeSelect = root.querySelector("#pickup-wolt-time");

    const DEFAULT_COUNTRY = (root.dataset.defaultCountry || "EE").toUpperCase();

    const i18n = {
      labelCountry: root.dataset.labelCountry || "Country",
      labelProvider: root.dataset.labelProvider || "Please select a service provider",
      labelPickupPoint: root.dataset.labelPickupPoint || "Pickup point",
      labelPromo: root.dataset.labelPromo || "Promo code",
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

    // App proxy endpoints (storefront)
    const CONFIG_ENDPOINT_PRIMARY = "/apps/checkout/pickup-config";
    const CONFIG_ENDPOINT_FALLBACK = "/apps/pickup-config";
    const PREPARE_ENDPOINT = "/apps/checkout/prepare";

    // Parcely / SmartPosti locations endpoints
    const LOCATIONS_BY_COUNTRY = {
      FI: "https://production.parcely.app/locations_4_11.json",
      EE: "https://production.parcely.app/locations_1_1.json",
      LV: "https://production.parcely.app/locations_2_1.json",
      LT: "https://production.parcely.app/locations_3_1.json",
    };
    const COUNTRY_DIAL_CODES = {
      EE: "372",
      LV: "371",
      LT: "370",
      FI: "358",
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
        flat_rate: { title: "Flat rate delivery" },
        wolt: { title: "Wolt delivery" },
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
      id: (root.dataset.customerId || "").trim(),
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
      return (s || "").toString().replace(/[^\d+]/g, "").trim();
    }

    function normalizePhoneCode(code, countryCode) {
      const raw = String(code || "").trim();
      const digits = raw.replace(/[^\d]/g, "");
      if (!digits && countryCode) {
        const inferred = COUNTRY_DIAL_CODES[String(countryCode || "").toUpperCase()];
        if (inferred) return `+${inferred}`;
      }
      return digits ? `+${digits}` : "";
    }

    function stripPhoneCountryCode(code, phone, countryCode) {
      const normalizedCode = normalizePhoneCode(code, countryCode);
      const codeDigits = normalizedCode.replace(/[^\d]/g, "");
      const raw = sanitizePhone(phone);
      if (!raw || !codeDigits) return raw;

      const digits = raw.replace(/[^\d]/g, "");
      if (!digits.startsWith(codeDigits)) return raw;

      const localDigits = digits.slice(codeDigits.length);
      return localDigits || "";
    }

    function combinePhone(code, phone, countryCode) {
      const c = normalizePhoneCode(code, countryCode);
      const pRaw = sanitizePhone(phone);
      let p = stripPhoneCountryCode(c, pRaw, countryCode) || pRaw;
      const codeDigits = String(c || "").replace(/[^\d]/g, "");
      if (codeDigits && p) {
        const pDigits = String(p).replace(/[^\d]/g, "");
        if (pDigits.startsWith(codeDigits + codeDigits)) {
          p = pDigits.slice(codeDigits.length);
        }
      }
      if (!c && !p) return "";
      if (c && p) return `${c} ${p}`.trim();
      return (c || p).trim();
    }

    function setPromoStatus(text, tone) {
      if (!promoStatus) return;
      if (!text) {
        promoStatus.hidden = true;
        promoStatus.textContent = "";
        promoStatus.removeAttribute("data-tone");
        return;
      }
      promoStatus.hidden = false;
      promoStatus.textContent = text;
      promoStatus.setAttribute("data-tone", tone || "ok");
    }

    function notifyPricingRefresh() {
      try {
        const cachedCart = runtime.cartCache && typeof runtime.cartCache === "object" ? runtime.cartCache : null;
        const subtotal =
          Number(cachedCart?.items_subtotal_price) ||
          Number(cachedCart?.total_price) ||
          0;
        const detail = {
          source: "itella-promo",
          force: true,
          cart: {
            ...(cachedCart || {}),
            items_subtotal_price: subtotal,
          },
        };

        // Use cart:refresh to avoid theme listeners that expect strict cart:updated payload shape.
        document.dispatchEvent(new CustomEvent("cart:refresh", { detail }));
      } catch {}
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

    function setCartCache(cart) {
      if (!cart || typeof cart !== "object") return;
      runtime.cartCache = cart;
      runtime.cartCacheAt = Date.now();
      cartAttributes = cart.attributes || {};
    }

    async function fetchJSON(url) {
      const res = await trackedFetch(url, { cache: "no-store" }, "pointsRead");
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    }

    async function readCart(force = false) {
      const now = Date.now();
      if (runtime.cartPromise) {
        return await runtime.cartPromise;
      }
      if (!force && runtime.cartCache && now - runtime.cartCacheAt < 500) {
        return runtime.cartCache;
      }

      runtime.cartPromise = (async () => {
        const res = await trackedFetch("/cart.js", { cache: "no-store" }, "cartRead");
        const cart = await res.json();
        setCartCache(cart);
        return cart;
      })();

      try {
        return await runtime.cartPromise;
      } finally {
        runtime.cartPromise = null;
      }
    }

    async function readCartAttributes(force = false) {
      const cacheFresh = runtime.cartCacheAt && Date.now() - runtime.cartCacheAt < 500;
      if (!force && cartAttributes && cacheFresh) return cartAttributes;
      const cart = await readCart(force);
      cartAttributes = cart.attributes || {};
      return cartAttributes;
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

      await trackedFetch(
        "/cart/update.js",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: nextAttributes }),
        },
        "cartWrite",
      );

      cartAttributes = nextAttributes;
      if (runtime.cartCache && typeof runtime.cartCache === "object") {
        runtime.cartCache.attributes = nextAttributes;
      }
    }

    function getCountryConfig(code) {
      return (config?.countries || []).find((country) => country.code === code);
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
      return (config?.providerMeta && config.providerMeta[providerKey]) || { title: providerKey };
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

    function formatAmount(amount, currency) {
      const value = Number(amount || 0);
      if (!Number.isFinite(value)) return "0.00";
      if (typeof Intl !== "undefined" && currency) {
        try {
          return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
        } catch {}
      }
      return value.toFixed(2);
    }

    async function updateCartTotals(price, cartSnapshot) {
      const cart = cartSnapshot || (await readCart());
      const currency = cart.currency || cart.currency_code || cart.presentment_currency;
      const deliveryCents = parsePriceToCents(price);
      const subtotalCents = cart.total_price || 0;
      const totalWithDelivery = subtotalCents + deliveryCents;
      const sig = `${currency}|${subtotalCents}|${deliveryCents}`;
      if (runtime.totalsSignature === sig) return;
      runtime.totalsSignature = sig;

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

    function getPromoPayload() {
      return {
        itella_promo_code: (promoInput?.value || "").trim(),
      };
    }

    function parseFreeChoiceSelectionsFromAttrs(attrs) {
      const raw = String(attrs?.itella_free_choice_selections || "").trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((id) => String(id || "").trim()).filter(Boolean);
        }
      } catch {}
      if (raw.includes("|")) {
        return raw
          .split("|")
          .map((id) => String(id || "").trim())
          .filter(Boolean);
      }
      return [raw];
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
      // If any of these change, cached invoiceUrl might become outdated
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
        "itella_promo_code",
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

      const next = cartAttributes ?? (await readCartAttributes());
      if (shouldInvalidateDraft(prev, next)) {
        await writeCartAttributes({ itella_draft_order_invoice_url: "" });
      }

      await updateWoltAvailability();
    }

    async function syncPromoAttributes(options = {}) {
      if (!promoInput) return;

      const prev = cartAttributes ?? (await readCartAttributes());
      const prevCode = String(prev?.itella_promo_code || "").trim();
      await writeCartAttributes(getPromoPayload());

      const next = cartAttributes ?? (await readCartAttributes());
      const nextCode = String(next?.itella_promo_code || "").trim();
      if (shouldInvalidateDraft(prev, next)) {
        await writeCartAttributes({ itella_draft_order_invoice_url: "" });
      }

      const changed = prevCode !== nextCode;
      if (changed || options.forceRefresh) {
        notifyPricingRefresh();
      }

      if (options.showStatus) {
        if (!nextCode) {
          setPromoStatus("Promo code cleared.", "ok");
        } else {
          let preview = null;
          try {
            preview = await previewPromoStatus(nextCode);
          } catch {}

          const promoDiscount = Number(preview?.discount || 0);
          const appliedCode = String(preview?.promo?.appliedCode || nextCode).trim();
          const reason = String(preview?.promo?.reason || "").trim();

          if (promoDiscount > 0) {
            setPromoStatus(
              `Applied ${appliedCode}: -${formatAmount(promoDiscount, preview?.currencyCode || "")}`,
              "ok",
            );
          } else {
            setPromoStatus(reason || "Promo code is not applicable to current cart.", "error");
          }
        }
      }
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
        await writeCartAttributes({ itella_draft_order_invoice_url: "" });
      }
    }

    function pickItellaAttributes(attrs) {
      const out = {};
      Object.keys(attrs || {}).forEach((key) => {
        if (String(key || "").startsWith("itella_")) {
          out[key] = attrs[key];
        }
      });
      return out;
    }

    async function previewPromoStatus(promoCode) {
      const code = String(promoCode || "").trim();
      if (!code) return null;

      const cart = await readCart(true);
      const attrs = cart.attributes || {};
      const payloadItems = (cart.items || [])
        .filter((item) => !(item?.properties && String(item.properties._mk_gift) === "1"))
        .map((item) => ({
          variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
          quantity: Number(item.quantity || 0),
        }))
        .filter((item) => item.variantId && Number(item.quantity || 0) > 0);

      if (!payloadItems.length) return null;

      const payload = {
        mode: "preview",
        customerId: customerDefaults.id || (customerDefaults.loggedIn ? "logged-in" : null),
        items: payloadItems,
        promoCode: code,
        freeChoiceVariantId: attrs.itella_free_choice_variant_id || null,
        freeChoiceSelections: parseFreeChoiceSelectionsFromAttrs(attrs),
      };

      const res = await trackedFetch(
        PREPARE_ENDPOINT,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        },
        "prepareRead",
      );
      if (!res.ok) return null;

      const json = await res.json();
      return {
        promo: json?.pricing?.promo || null,
        discount: Number(json?.pricing?.breakdown?.promoDiscount || 0),
        currencyCode:
          json?.pricing?.currencyCode ||
          cart.currency ||
          cart.currency_code ||
          cart.presentment_currency ||
          "",
      };
    }

    async function createDraftOrder() {
      console.log("[itella] createDraftOrder called", new Date().toISOString());

      const cart = await readCart(true);
      if (!cart?.items?.length) return null;

      const attrs = await readCartAttributes();

      const attributesFromInputs = {
        ...getRecipientPayload(),
        ...getPromoPayload(),
        itella_wolt_date: woltDateInput?.value || attrs.itella_wolt_date || "",
        itella_wolt_time: woltTimeSelect?.value || attrs.itella_wolt_time || "",
        itella_delivery_title: (attrs.itella_delivery_title || "").trim(),
        itella_delivery_price: (attrs.itella_delivery_price || "").trim(),
        itella_delivery_currency: (attrs.itella_delivery_currency || "").trim(),
        itella_pickup_provider: attrs.itella_pickup_provider || "",
        itella_pickup_id: attrs.itella_pickup_id || "",
        itella_pickup_name: attrs.itella_pickup_name || "",
        itella_pickup_address: attrs.itella_pickup_address || "",
        itella_pickup_country: attrs.itella_pickup_country || "",
      };

      const deliveryTitle = (attrs.itella_delivery_title || "").trim();
      const deliveryPrice = (attrs.itella_delivery_price || "").trim();
      const deliveryCurrency = (attrs.itella_delivery_currency || "").trim();

      const payloadItems = cart.items
        .filter((item) => !(item?.properties && String(item.properties._mk_gift) === "1"))
        .map((item) => ({
          variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
          quantity: item.quantity,
        }))
        .filter((item) => item.variantId && Number(item.quantity || 0) > 0);

      if (!payloadItems.length) {
        console.warn("[itella] no non-gift items for checkout payload");
        return null;
      }

      const payload = {
        mode: "checkout",
        customerId: customerDefaults.id || (customerDefaults.loggedIn ? "logged-in" : null),
        items: payloadItems,
        shipping: {
          method:
            attrs.itella_pickup_provider === "wolt"
              ? "wolt"
              : attrs.itella_pickup_provider === "smartposti"
                ? "smartposti"
                : "pickup",
          pickupPointId: attrs.itella_pickup_id || null,
        },
        email: (attrs.itella_recipient_email || "").trim() || null,
        shippingAddress: {
          name: (attrs.itella_recipient_name || "").trim(),
          address1: (attrs.itella_recipient_address1 || "").trim(),
          city: (attrs.itella_recipient_city || "").trim(),
          zip: (attrs.itella_recipient_zip || "").trim(),
          countryCode: (attrs.itella_pickup_country || "").trim(),
          phone: combinePhone(
            attrs.itella_recipient_phone_code || "",
            attrs.itella_recipient_phone || "",
            attrs.itella_pickup_country || state.country || "",
          ),
        },
        delivery: {
          title: deliveryTitle || null,
          price: deliveryPrice || null,
          currency: deliveryCurrency || null,
          provider: attrs.itella_pickup_provider || null,
          pickupId: attrs.itella_pickup_id || null,
          pickupName: attrs.itella_pickup_name || null,
          pickupAddress: attrs.itella_pickup_address || null,
          country: attrs.itella_pickup_country || null,
        },
        attributes: {
          ...pickItellaAttributes(attrs),
          ...attributesFromInputs,
        },
        promoCode: (attrs.itella_promo_code || "").trim() || null,
        freeChoiceVariantId: attrs.itella_free_choice_variant_id || null,
        freeChoiceSelections: parseFreeChoiceSelectionsFromAttrs(attrs),
      };

      console.log("[itella] checkout payload:", payload);

      const res = await trackedFetch(
        PREPARE_ENDPOINT,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        },
        "prepareRead",
      );

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

        const label = document.createElement("label");
        label.className = "pickup-provider";

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
      if (runtime.configCache) return runtime.configCache;
      if (runtime.configPromise) return await runtime.configPromise;

      runtime.configPromise = (async () => {
        try {
          let proxyRes = await trackedFetch(
            CONFIG_ENDPOINT_PRIMARY,
            { cache: "no-store" },
            "configRead",
          );
          if (!proxyRes.ok) {
            proxyRes = await trackedFetch(
              CONFIG_ENDPOINT_FALLBACK,
              { cache: "no-store" },
              "configRead",
            );
          }
          if (proxyRes.ok) {
            const proxyJson = await proxyRes.json();
            if (proxyJson?.config && !proxyJson?.warning) {
              const out = { config: proxyJson.config, usedFallback: false };
              runtime.configCache = out;
              return out;
            }
          }
        } catch {
          // ignore proxy failure and fall through to fallback
        }

        const fallbackOut = { config: FALLBACK_CONFIG, usedFallback: true };
        runtime.configCache = fallbackOut;
        return fallbackOut;
      })();

      try {
        return await runtime.configPromise;
      } finally {
        runtime.configPromise = null;
      }
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
      let data = runtime.pointsCacheByUrl[url];
      if (!data) {
        const existingPromise = runtime.pointsPromiseByUrl[url];
        if (existingPromise) {
          data = await existingPromise;
        } else {
          runtime.pointsPromiseByUrl[url] = fetchJSON(url).then((json) => {
            runtime.pointsCacheByUrl[url] = json;
            return json;
          });
          try {
            data = await runtime.pointsPromiseByUrl[url];
          } finally {
            delete runtime.pointsPromiseByUrl[url];
          }
        }
      }

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

    async function setCountry(code, countryOverride, options = {}) {
      state.country = code;
      const country = countryOverride || getCountryConfig(code);
      if (!country) return;

      setCountryUI(country);

      const allowedProviders = country.providers || [];
      const providerOverride = String(options.providerOverride || "").trim();
      state.provider =
        providerOverride && allowedProviders.includes(providerOverride)
          ? providerOverride
          : allowedProviders[0] || "smartposti";

      renderProviders(allowedProviders, country.pricesByProvider, country);

      const prev = cartAttributes ?? (await readCartAttributes());
      if (options.syncProvider !== false) {
        await syncProviderAttributes(country, state.provider);

        const next = cartAttributes ?? (await readCartAttributes());
        if (shouldInvalidateDraft(prev, next)) {
          await writeCartAttributes({ itella_draft_order_invoice_url: "" });
        }
      }

      await updateWoltVisibility();
      await setPointsVisibility();

      const shouldKeepSelection =
        Boolean(options.preserveSelection) &&
        state.provider === "smartposti" &&
        String(prev.itella_pickup_id || "").trim() !== "" &&
        String(prev.itella_pickup_country || "").toUpperCase() === String(code || "").toUpperCase() &&
        String(prev.itella_pickup_provider || "") === String(state.provider || "");

      if (!shouldKeepSelection) {
        await clearPickupSelection(code, state.provider);
      }
      await loadPoints();

      if (shouldKeepSelection) {
        setCurrentUI(prev);
        if (pointLabel) {
          pointLabel.textContent = prev.itella_pickup_name || i18n.textSelected;
        }
      }
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
        if (woltDateInput) woltDateInput.disabled = true;
        if (woltTimeSelect) woltTimeSelect.disabled = true;

        await writeCartAttributes({
          itella_wolt_date: "",
          itella_wolt_time: "",
        });

        return;
      }

      if (woltNotice) woltNotice.hidden = true;
      if (woltDateInput) woltDateInput.disabled = false;
      if (woltTimeSelect) woltTimeSelect.disabled = false;

      const today = new Date();
      const nextValid = getNextValidDate(today);

      if (woltDateInput) {
        woltDateInput.min = formatDateInput(today);
        woltDateInput.max = formatDateInput(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14),
        );

        if (!woltDateInput.value) {
          woltDateInput.value = formatDateInput(nextValid);
        }

        updateWoltOptions(woltDateInput.value);
      }

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

    // Recipient fields (promo excluded on purpose)
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

    // Promo field (separate sync)
    if (promoInput) {
      promoInput.addEventListener("change", () => syncPromoAttributes({ forceRefresh: true }));
      promoInput.addEventListener("blur", () => syncPromoAttributes({ forceRefresh: true }));
      promoInput.addEventListener("input", () => {
        setPromoStatus("", "");
      });
      promoInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        syncPromoAttributes({ forceRefresh: true, showStatus: true });
      });
    }

    if (promoApplyBtn) {
      promoApplyBtn.addEventListener("click", async () => {
        promoApplyBtn.disabled = true;
        try {
          await syncPromoAttributes({ forceRefresh: true, showStatus: true });
        } finally {
          promoApplyBtn.disabled = false;
        }
      });
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

    // ------------------ Checkout click: lock + cached URL first ------------------
    let creatingDraft = false;

    function hasEmailFieldOnPage() {
      return !!emailInput;
    }

    async function validateCheckout() {
      await syncRecipientAttributes();
      await syncPromoAttributes();
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
        latestAttrs.itella_pickup_country || state.country || "",
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
        window.alert(`Please fill: ${missing.join(", ")}`);
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

          // Always create/update draft to avoid stale checkout data.
          const draftOrder = await createDraftOrder();
          console.log("[itella] draft order response:", draftOrder);
          const invoiceUrl = (draftOrder?.invoiceUrl || "").trim();
          if (invoiceUrl) {
            window.location.href = invoiceUrl;
            return;
          }

          // Fallback: try reading cart attrs one more time.
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
    async function boot() {
      const configResponse = await loadConfig();
      config = configResponse.config;
      const usedFallback = configResponse.usedFallback;

      console.log(
        "[itella] config countries:",
        (config?.countries || []).map((c) => c.code),
        "usedFallback=",
        usedFallback,
      );

      if (fallbackNotice) {
        fallbackNotice.textContent = usedFallback ? i18n.textFallback : "";
        fallbackNotice.hidden = !usedFallback;
      }

      // Enabled countries from config
      const enabledCountries = (config.countries || []).filter((country) => country.enabled);
      const finalCountries = usedFallback ? FALLBACK_CONFIG.countries : enabledCountries;

      renderCountryMenu(finalCountries);

      // Restore from cart
      const cartSnapshot = await readCart(true);
      const attrs = cartSnapshot.attributes || {};
      cartAttributes = attrs;
      await updateCartTotals(attrs.itella_delivery_price || "", cartSnapshot);

      if (nameInput) nameInput.value = attrs.itella_recipient_name || customerDefaults.name || "";
      if (addressInput) {
        addressInput.value = attrs.itella_recipient_address1 || customerDefaults.address1 || "";
      }
      if (cityInput) cityInput.value = attrs.itella_recipient_city || customerDefaults.city || "";
      if (zipInput) zipInput.value = attrs.itella_recipient_zip || customerDefaults.zip || "";

      if (phoneCodeInput) {
        phoneCodeInput.value =
          (attrs.itella_recipient_phone_code || "").trim() || phoneCodeInput.value || "";
      }
      if (phoneInput) {
        const storedPhone = (attrs.itella_recipient_phone || "").trim();
        const fallbackPhone = stripPhoneCountryCode(
          phoneCodeInput?.value || "",
          customerDefaults.phone || "",
          attrs.itella_pickup_country || state.country || "",
        );
        phoneInput.value = storedPhone || fallbackPhone || customerDefaults.phone || "";
      }
      if (emailInput) emailInput.value = attrs.itella_recipient_email || customerDefaults.email || "";

      if (promoInput) promoInput.value = (attrs.itella_promo_code || "").trim();

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
      if (promoInput && promoInput.value) {
        await writeCartAttributes(getPromoPayload());
      }

      const restoredCountry = (attrs.itella_pickup_country || DEFAULT_COUNTRY).toUpperCase();
      const startCountry = finalCountries.find((c) => c.code === restoredCountry)
        ? restoredCountry
        : finalCountries[0]?.code || "EE";
      const restoredProvider = (attrs.itella_pickup_provider || "").trim();
      await setCountry(startCountry, null, {
        providerOverride: restoredProvider,
        preserveSelection: true,
        syncProvider: false,
      });

      const country = getCountryConfig(startCountry);
      if (!country) return;

      const expectedProvider = state.provider || "smartposti";
      const needsProviderSync =
        String(attrs.itella_pickup_country || "").toUpperCase() !== startCountry ||
        String(attrs.itella_pickup_provider || "") !== expectedProvider;

      if (needsProviderSync) {
        const prev = cartAttributes ?? (await readCartAttributes());
        await syncProviderAttributes(country, expectedProvider);
        const next = cartAttributes ?? (await readCartAttributes());
        if (shouldInvalidateDraft(prev, next)) {
          await writeCartAttributes({ itella_draft_order_invoice_url: "" });
        }
      }

      pickupDebug("boot complete", {
        country: startCountry,
        provider: expectedProvider,
        hasPickupId: Boolean((attrs.itella_pickup_id || "").trim()),
        stats: runtime.stats,
      });
    }

    boot().catch((err) => {
      console.error("[itella] boot failed:", err);
      try {
        if (fallbackNotice) {
          fallbackNotice.textContent =
            "Pickup block failed to load. Please reload the page.";
          fallbackNotice.hidden = false;
        }
        if (countryLabel) countryLabel.textContent = "Error";
      } catch {}
    });
  }
})();
