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

  const DEFAULT_COUNTRY = (root.dataset.defaultCountry || "EE").toUpperCase();

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
        pricesByProvider: { smartposti: "3.99", flat_rate: "4.99" },
      },
      {
        code: "LV",
        label: "Latvia",
        flagUrl: "https://flagcdn.com/w40/lv.png",
        enabled: true,
        providers: ["smartposti", "flat_rate"],
        pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
      },
      {
        code: "LT",
        label: "Lithuania",
        flagUrl: "https://flagcdn.com/w40/lt.png",
        enabled: true,
        providers: ["smartposti", "flat_rate"],
        pricesByProvider: { smartposti: "4.99", flat_rate: "5.99" },
      },
      {
        code: "FI",
        label: "Finland",
        flagUrl: "https://flagcdn.com/w40/fi.png",
        enabled: true,
        providers: ["smartposti", "flat_rate"],
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

  function normalize(s) {
    return (s || "").toString().toLowerCase().trim();
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }

  async function readCartAttributes() {
    const res = await fetch("/cart.js", { cache: "no-store" });
    const cart = await res.json();
    return cart.attributes || {};
  }

  async function writeCartAttributes(payload) {
    await fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: payload }),
    });
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

  function getProviderMeta(providerKey) {
    return (config.providerMeta && config.providerMeta[providerKey]) || {
      title: providerKey,
    };
  }

  async function syncProviderAttributes(country, providerKey) {
    const meta = getProviderMeta(providerKey);
    const price = country?.pricesByProvider?.[providerKey] || "";
    await writeCartAttributes({
      itella_pickup_provider: providerKey,
      itella_pickup_country: country?.code || state.country,
      itella_delivery_title: meta.title || providerKey,
      itella_delivery_price: price,
    });
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

  function renderProviders(providerKeys, pricesByProvider) {
    providersWrap.innerHTML = "";

    if (!providerKeys || providerKeys.length === 0) {
      providersWrap.innerHTML = `<div style="opacity:.7">No providers enabled for this country.</div>`;
      return;
    }

    providerKeys.forEach((key) => {
      const meta = getProviderMeta(key);
      const displayTitle = meta.title || key;
      const price = pricesByProvider?.[key];

      const label = document.createElement("label");
      label.className = "pickup-provider";
      label.innerHTML = `
        <input type="radio" name="pickup_provider" ${state.provider === key ? "checked" : ""} />
        ${meta.logo ? `<img src="${meta.logo}" alt="${key}" />` : ""}
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div style="font-weight:600">${displayTitle}</div>
          ${
            price
              ? `<div style="font-size:12px;opacity:.7">Price: ${price}</div>`
              : ""
          }
        </div>
      `;

      label.addEventListener("click", async () => {
        state.provider = key;
        const country = getCountryConfig(state.country);
        await syncProviderAttributes(country, key);

        await setPointsVisibility();
        await loadPoints();
      });

      providersWrap.appendChild(label);
    });
  }

  function renderPoints(list) {
    pointList.innerHTML = "";

    if (!list.length) {
      pointList.innerHTML = `<div style="padding:10px 12px;opacity:.7">No pickup points found.</div>`;
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
    const c = attrs.itella_pickup_country || "";
    const id = attrs.itella_pickup_id || "";
    const name = attrs.itella_pickup_name || "";
    const addr = attrs.itella_pickup_address || "";

    if (!id && !name) {
      current.textContent = "";
      return;
    }
    current.textContent = `Selected: ${c} — ${name} (${id}) — ${addr}`;
  }

  async function loadConfig() {
    try {
      // ✅ App Proxy endpoint (витрина)
      const json = await fetchJSON("/apps/pickup-config");
      if (json && json.config) return json.config;
    } catch (e) {
      // fallback below
    }
    return FALLBACK_CONFIG;
  }

  async function loadPoints() {
    if (state.provider !== "smartposti") {
      state.points = [];
      state.filtered = [];
      renderPoints([]);
      pointLabel.textContent = "Pickup point not required";
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
      pointLabel.textContent = attrs.itella_pickup_name || "Selected pickup point";
    }
  }

  async function setCountry(code, countryOverride) {
    state.country = code;
    const country = countryOverride || getCountryConfig(code);
    if (!country) return;
    setCountryUI(country);

    const allowedProviders = country.providers || [];
    state.provider = allowedProviders[0] || "smartposti";

    renderProviders(allowedProviders, country.pricesByProvider);
    await syncProviderAttributes(country, state.provider);
    await setPointsVisibility();

    // Clear pickup selection on country change
    await writeCartAttributes({
      itella_pickup_country: code,
      itella_pickup_provider: state.provider,
      itella_pickup_id: "",
      itella_pickup_name: "",
      itella_pickup_address: "",
    });

    setCurrentUI({});
    search.value = "";
    await loadPoints();
  }

  async function setPointsVisibility() {
    if (!pointsWrap) return;
    const isPickup = state.provider === "smartposti";
    pointsWrap.style.display = isPickup ? "flex" : "none";
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

  async function selectPoint(id, name, address, label) {
    if (!id) {
      await writeCartAttributes({
        itella_pickup_id: "",
        itella_pickup_name: "",
        itella_pickup_address: "",
      });
      pointLabel.textContent = "Select pickup point…";
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
    pointLabel.textContent = name || label || "Selected pickup point";
    setCurrentUI(payload);
  }

  // Boot
  config = await loadConfig();

  // Enabled countries from config
  const enabledCountries = (config.countries || []).filter((country) => country.enabled);

  // If config empty → fallback
  const finalCountries = enabledCountries.length
    ? enabledCountries
    : FALLBACK_CONFIG.countries;

  renderCountryMenu(finalCountries);

  // Restore from cart if user already selected something
  const attrs = await readCartAttributes();
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
      renderProviders(country.providers, country.pricesByProvider);
      await syncProviderAttributes(country, restoredProvider);
      await setPointsVisibility();
      await loadPoints();
    }
  }
})();
