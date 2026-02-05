(async function () {
  const root = document.getElementById("pickup-root");
  if (!root) return;

  const countryBtn = document.getElementById("pickup-country-btn");
  const countryMenu = document.getElementById("pickup-country-menu");
  const countryLabel = document.getElementById("pickup-country-label");
  const countryFlag = document.getElementById("pickup-country-flag");

  const providersWrap = document.getElementById("pickup-providers");
  const search = document.getElementById("pickup-search");
  const select = document.getElementById("pickup-point-select");
  const current = document.getElementById("pickup-current");

  const DEFAULT_COUNTRY = (root.dataset.defaultCountry || "EE").toUpperCase();

  const COUNTRY_META = {
    EE: { label: "Estonia", flag: "🇪🇪" },
    LV: { label: "Latvia", flag: "🇱🇻" },
    LT: { label: "Lithuania", flag: "🇱🇹" },
    FI: { label: "Finland", flag: "🇫🇮" },
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
    countries: ["EE", "LV", "LT", "FI"],
    providersByCountry: {
      EE: ["smartposti"],
      LV: ["smartposti"],
      LT: ["smartposti"],
      FI: ["smartposti"],
    },
    providerMeta: {
      smartposti: {
        title: "Smartposti parcel lockers",
        logo: "https://production.parcely.app/images/itella.png",
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

  function setCountryUI(code) {
    const meta = COUNTRY_META[code] || { label: code, flag: "🏳️" };
    countryLabel.textContent = meta.label;
    countryFlag.textContent = meta.flag;
  }

  function renderCountryMenu(enabledCountries) {
    countryMenu.innerHTML = "";

    enabledCountries.forEach((code) => {
      const meta = COUNTRY_META[code] || { label: code, flag: "🏳️" };

      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `
        <span style="width:22px">${meta.flag}</span>
        <span style="min-width:30px">${code}</span>
        <span style="opacity:.8">${meta.label}</span>
      `;

      btn.addEventListener("click", async () => {
        countryMenu.hidden = true;
        await setCountry(code);
      });

      countryMenu.appendChild(btn);
    });
  }

  function renderProviders(providerKeys, providerMeta) {
    providersWrap.innerHTML = "";

    if (!providerKeys || providerKeys.length === 0) {
      providersWrap.innerHTML = `<div style="opacity:.7">No providers enabled for this country.</div>`;
      return;
    }

    providerKeys.forEach((key) => {
      const meta = (providerMeta && providerMeta[key]) || { title: key, logo: "" };

      const label = document.createElement("label");
      label.className = "pickup-provider";
      label.innerHTML = `
        <input type="radio" name="pickup_provider" ${state.provider === key ? "checked" : ""} />
        ${meta.logo ? `<img src="${meta.logo}" alt="${key}" />` : ""}
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div style="font-weight:600">${key}</div>
          <div style="opacity:.75;font-size:13px">${meta.title || ""}</div>
        </div>
      `;

      label.addEventListener("click", async () => {
        state.provider = key;

        await writeCartAttributes({
          itella_pickup_provider: key,
          itella_pickup_country: state.country,
        });

        // If you add other providers later, switch logic here.
        await loadPoints();
      });

      providersWrap.appendChild(label);
    });
  }

  function renderPoints(list) {
    select.innerHTML = `<option value="">Select pickup point…</option>`;

    list.forEach((p) => {
      const label = `${p.name} — ${p.address}${p.town ? ` (${p.town})` : ""}`;
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = label;
      opt.dataset.name = p.name;
      opt.dataset.address = p.address;
      select.appendChild(opt);
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
    // only smartposti for now
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
    if (attrs.itella_pickup_id) select.value = attrs.itella_pickup_id;
  }

  async function setCountry(code) {
    state.country = code;
    setCountryUI(code);

    const allowedProviders = (config.providersByCountry && config.providersByCountry[code]) || [];
    state.provider = allowedProviders[0] || "smartposti";

    renderProviders(allowedProviders, config.providerMeta);

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

  // UI events
  countryBtn.addEventListener("click", () => {
    countryMenu.hidden = !countryMenu.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!countryMenu.contains(e.target) && !countryBtn.contains(e.target)) {
      countryMenu.hidden = true;
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

  select.addEventListener("change", async () => {
    const opt = select.options[select.selectedIndex];
    const id = select.value;

    if (!id) {
      await writeCartAttributes({
        itella_pickup_id: "",
        itella_pickup_name: "",
        itella_pickup_address: "",
      });
      setCurrentUI({});
      return;
    }

    const payload = {
      itella_pickup_country: state.country,
      itella_pickup_provider: state.provider,
      itella_pickup_id: id,
      itella_pickup_name: opt.dataset.name || opt.textContent || "",
      itella_pickup_address: opt.dataset.address || "",
    };

    await writeCartAttributes(payload);
    setCurrentUI(payload);
  });

  // Boot
  config = await loadConfig();

  // Enabled countries from config
  const enabledCountries = (config.countries || [])
    .map((c) => (c || "").toUpperCase())
    .filter((c) => COUNTRY_META[c]);

  // If config empty → fallback
  const finalCountries = enabledCountries.length ? enabledCountries : Object.keys(COUNTRY_META);

  renderCountryMenu(finalCountries);

  // Restore from cart if user already selected something
  const attrs = await readCartAttributes();
  const restoredCountry = (attrs.itella_pickup_country || DEFAULT_COUNTRY).toUpperCase();

  const startCountry = finalCountries.includes(restoredCountry)
    ? restoredCountry
    : (finalCountries[0] || "EE");

  await setCountry(startCountry);
})();
