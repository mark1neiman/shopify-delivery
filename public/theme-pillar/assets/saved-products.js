(function () {
  if (window.__mkSavedProductsBooted) return;
  window.__mkSavedProductsBooted = true;

  const API_URL = "/apps/checkout/saved-products";
  const BTN_SELECTOR = "[data-save-product-btn]";
  const ACTIVE_CLASS = "is-saved";

  const state = {
    items: [],
    isLoggedIn: true,
  };

  function normalizeId(value) {
    if (value == null) return "";
    const raw = String(value).trim();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return raw;

    const match = raw.match(/(\d+)(?!.*\d)/);
    return match ? match[1] : "";
  }

  function normalizeItems(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();

    list.forEach((row) => {
      const id = normalizeId(row && row.id);
      if (!id || seen.has(id)) return;
      seen.add(id);

      out.push({
        id,
        url: row && typeof row.url === "string" ? row.url : "",
        title: row && typeof row.title === "string" ? row.title : "",
        image: row && typeof row.image === "string" ? row.image : "",
        price: row && typeof row.price === "string" ? row.price : "",
      });
    });

    return out;
  }

  function escapeSelectorValue(value) {
    const raw = String(value || "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(raw);
    return raw.replace(/["\\]/g, "\\$&");
  }

  function getButtonData(button) {
    const id = normalizeId(button && button.getAttribute("data-product-id"));
    if (!id) return null;

    return {
      id,
      url: button.getAttribute("data-product-url") || "",
      title: button.getAttribute("data-product-title") || "",
      image: button.getAttribute("data-product-image") || "",
      price: button.getAttribute("data-product-price") || "",
    };
  }

  function setButtonState(button, isSaved) {
    button.classList.toggle(ACTIVE_CLASS, isSaved);
    button.setAttribute("aria-pressed", isSaved ? "true" : "false");

    const label = button.querySelector("[data-save-product-label]");
    if (label) label.textContent = isSaved ? "Saved" : "Save product";
  }

  function flashButtonError(id) {
    const selector = `${BTN_SELECTOR}[data-product-id="${escapeSelectorValue(id)}"]`;
    document.querySelectorAll(selector).forEach((button) => {
      button.classList.add("is-save-error");
      window.setTimeout(() => {
        button.classList.remove("is-save-error");
      }, 1400);
    });
  }

  function isValidApiPayload(data) {
    return Boolean(data && typeof data === "object" && Array.isArray(data.items));
  }

  function savedIdsSet() {
    return new Set(state.items.map((item) => item.id));
  }

  function syncButtons(onlyId) {
    const ids = savedIdsSet();
    const selector = onlyId
      ? `${BTN_SELECTOR}[data-product-id="${escapeSelectorValue(onlyId)}"]`
      : BTN_SELECTOR;

    document.querySelectorAll(selector).forEach((button) => {
      const id = normalizeId(button.getAttribute("data-product-id"));
      setButtonState(button, id ? ids.has(id) : false);
    });
  }

  function publishChange() {
    try {
      document.dispatchEvent(
        new CustomEvent("mk:saved-products:changed", {
          detail: {
            items: state.items,
            ids: state.items.map((item) => item.id),
            isLoggedIn: state.isLoggedIn,
          },
        }),
      );
    } catch (error) {
      console.warn("[saved-products] publish exception", error);
    }
  }

  function setItems(items) {
    state.items = normalizeItems(items);
    syncButtons();
    publishChange();
  }

  function redirectToLogin() {
    const returnUrl = `${location.pathname}${location.search}${location.hash}`;
    location.href = `/account/login?return_url=${encodeURIComponent(returnUrl)}`;
  }

  async function apiGet() {
    const response = await fetch(API_URL, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function apiToggle(item) {
    const response = await fetch(API_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ action: "toggle", item }),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function loadSavedProducts() {
    try {
      const { response, data } = await apiGet();

      if (response.status === 401 && data && data.code === "AUTH_REQUIRED") {
        state.isLoggedIn = false;
        setItems([]);
        return;
      }

      if (!response.ok || !isValidApiPayload(data)) {
        console.warn("[saved-products] load failed", data);
        return;
      }

      state.isLoggedIn = true;
      setItems(data && data.items);
    } catch (error) {
      console.warn("[saved-products] load exception", error);
    }
  }

  function lockButtons(id, locked) {
    const selector = `${BTN_SELECTOR}[data-product-id="${escapeSelectorValue(id)}"]`;
    document.querySelectorAll(selector).forEach((button) => {
      button.disabled = Boolean(locked);
      button.setAttribute("aria-busy", locked ? "true" : "false");
    });
  }

  async function toggleSaved(button) {
    const item = getButtonData(button);
    if (!item) return;

    if (!state.isLoggedIn) {
      redirectToLogin();
      return;
    }

    const previous = state.items.slice();
    const exists = previous.some((row) => row.id === item.id);
    const optimistic = exists
      ? previous.filter((row) => row.id !== item.id)
      : [item, ...previous.filter((row) => row.id !== item.id)];

    state.items = normalizeItems(optimistic);
    syncButtons(item.id);
    publishChange();
    lockButtons(item.id, true);

    try {
      const { response, data } = await apiToggle(item);

      if (response.status === 401 && data && data.code === "AUTH_REQUIRED") {
        state.isLoggedIn = false;
        state.items = previous;
        syncButtons(item.id);
        publishChange();
        redirectToLogin();
        return;
      }

      if (!response.ok || !isValidApiPayload(data)) {
        state.items = previous;
        syncButtons(item.id);
        publishChange();
        flashButtonError(item.id);
        console.warn("[saved-products] toggle failed", data);
        return;
      }

      state.isLoggedIn = true;
      state.items = normalizeItems(data && data.items);
      syncButtons(item.id);
      publishChange();
    } catch (error) {
      state.items = previous;
      syncButtons(item.id);
      publishChange();
      flashButtonError(item.id);
      console.warn("[saved-products] toggle exception", error);
    } finally {
      lockButtons(item.id, false);
    }
  }

  function onDocumentClick(event) {
    const rawTarget = event.target;
    const target =
      rawTarget instanceof Element
        ? rawTarget
        : rawTarget && rawTarget.parentElement instanceof Element
          ? rawTarget.parentElement
          : null;
    if (!target) return;

    const button = target.closest(BTN_SELECTOR);
    if (!button) return;

    event.preventDefault();
    toggleSaved(button);
  }

  function bindEvents() {
    document.addEventListener("click", onDocumentClick, true);

    document.addEventListener("shopify:section:load", () => {
      requestAnimationFrame(() => {
        syncButtons();
      });
    });
  }

  function boot() {
    bindEvents();
    syncButtons();
    loadSavedProducts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
