class CartDrawer extends DrawerComponent {
  constructor() {
    super();
    window.FoxKitSections = FoxTheme.utils.getSectionId(this);
    this.onCartRefreshListener = this.onCartRefresh.bind(this);
    this.getSectionToRenderListener = this.getSectionToRender.bind(this);
  }

  get requiresBodyAppended() {
    return false;
  }

  get sectionId() {
    return this.getAttribute('data-section-id');
  }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener('cart:grouped-sections', this.getSectionToRenderListener);
    document.addEventListener('cart:refresh', this.onCartRefreshListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('cart:grouped-sections', this.getSectionToRenderListener);
    document.removeEventListener('cart:refresh', this.onCartRefreshListener);
  }

  getSectionToRender(event) {
    event.detail.sections.push(FoxTheme.utils.getSectionId(this));
  }

  show(focusElement = null, animate = true) {
    super.show(focusElement, animate);

    if (this.open && !Shopify.designMode) {
      FoxTheme.a11y.trapFocus(this, this.focusElement);
    }
  }

  async onCartRefresh(event) {
    try {
      // Fetch both HTML and JSON data in parallel for better performance
      const [htmlResponse, cartResponse] = await Promise.all([
        fetch(`${FoxTheme.routes.root_url}?section_id=${this.sectionId}`),
        fetch(`${FoxTheme.routes.cart_url}.js`),
      ]);

      if (!htmlResponse.ok || !cartResponse.ok) {
        throw new Error('Failed to fetch cart data');
      }

      const [responseText, cartData] = await Promise.all([htmlResponse.text(), cartResponse.json()]);

      const parser = new DOMParser();
      const parsedHTML = parser.parseFromString(responseText, 'text/html');
      const sectionToRender = parsedHTML.getElementById(`CartDrawer-${this.sectionId}`);

      if (!sectionToRender) {
        console.warn('Cart drawer section not found in response');
        return;
      }

      // Add sections data to cartData for pubsub system
      cartData.sections = {};
      cartData.sections[this.sectionId] = sectionToRender.innerHTML;

      FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, {
        cart: cartData,
      });

      if (event.detail && event.detail.open === true) {
        this.show();
      }
    } catch (error) {
      console.error('Error refreshing cart:', error);
    }
  }
}
customElements.define('cart-drawer', CartDrawer);

class CartAddonModal extends ModalComponent {
  constructor() {
    super();
  }

  /**
   * To avoid lost focus input elements
   */
  get focusElement() {
    return this.querySelector('input, textarea, select') || this.querySelector('button');
  }
}
customElements.define('cart-addon-modal', CartAddonModal);

class CartItems extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('change', (event) => {
      const target = event.target;
      if (target && target.closest('quantity-input')) {
        FoxTheme.utils.debounce(this.onChange(event), 300);
      }
    });
    this.cartUpdateUnsubscriber = FoxTheme.pubsub.subscribe(
      FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate,
      this.onCartUpdate.bind(this)
    );

    this.cartItemProducts = this.querySelectorAll('.cart-item__product');
    this.cartItemQuantitys = this.querySelectorAll('.cart-item__quantity');

    const loadTemplateContent = (elements, parentSelector) => {
      elements.forEach((element) => {
        const template = element.querySelector('template');
        const templateContent = template && document.importNode(template.content, true);
        const parent = element.querySelector(parentSelector);

        if (parent && template && !parent.querySelector('.template-content')) {
          const contentWrapper = document.createElement('div');
          contentWrapper.classList.add('template-content');
          contentWrapper.appendChild(templateContent);
          parent.appendChild(contentWrapper);
        }
      });
    };

    const removeTemplateContent = (elements, parentSelector) => {
      elements.forEach((element) => {
        const parent = element.querySelector(parentSelector);
        const templateContent = parent?.querySelector('.template-content');

        if (templateContent) {
          parent.removeChild(templateContent);
        }
      });
    };

    const handleTabletMatch = () => {
      loadTemplateContent(this.cartItemProducts, '.cart-item__product--info');
      removeTemplateContent(this.cartItemQuantitys, '.cart-item__quantity-wrapper');
    };

    const handleTabletUnmatch = () => {
      removeTemplateContent(this.cartItemProducts, '.cart-item__product--info');
      loadTemplateContent(this.cartItemQuantitys, '.cart-item__quantity-wrapper');
    };

    const mqlTablet = window.matchMedia(FoxTheme.config.mediaQueryTablet);
    FoxTheme.config.mqlTablet = mqlTablet.matches;

    if (FoxTheme.config.mqlTablet) {
      handleTabletMatch();
    } else {
      handleTabletUnmatch();
    }

    mqlTablet.onchange = (event) => {
      if (event.matches) {
        handleTabletMatch();
      } else {
        FoxTheme.config.mqlTablet = false;
        handleTabletUnmatch();
      }
    };

    window.FoxKitSections = FoxTheme.utils.getSectionId(this);
  }

  cartUpdateUnsubscriber = undefined;

  disconnectedCallback() {
    if (this.cartUpdateUnsubscriber) {
      this.cartUpdateUnsubscriber();
    }
  }

  onChange(event) {
    this.updateQuantity(
      event.target.dataset.index,
      event.target.value,
      document.activeElement.getAttribute('name'),
      event.target
    );
  }

  onCartError(errors, target) {
    if (target) {
      this.hideLoader(target.getAttribute('data-index'));
      this.setValidity(target, errors);
      return;
    } else {
      window.location.href = FoxTheme.routes.cart_url;
    }
    alert(errors);
  }

  setValidity(target, message) {
    target.setCustomValidity(message);
    target.reportValidity();
    target.value = target.defaultValue;
    target.select();
  }

  onCartUpdate(event) {
    if (event.cart.errors) {
      this.onCartError(event.cart.errors, event.target);
      return;
    }
    if (typeof event.cart.sections === 'undefined') {
      return;
    }

    const sectionId = FoxTheme.utils.getSectionId(this);
    const sectionToRender = new DOMParser().parseFromString(event.cart.sections[sectionId], 'text/html');

    const cartDrawer = document.querySelector(`#CartDrawer-${sectionId}`);
    const cartDrawerBody = document.querySelector(`#CartDrawerBody-${sectionId}`);
    const cartDrawerFooter = document.querySelector(`#CartDrawerFooter-${sectionId}`);
    const cartDrawerEmpty = document.querySelector(`#CartDrawerEmpty-${sectionId}`);
    if (cartDrawer) {
      const cartDrawerBodyUpdate = sectionToRender.querySelector(`#CartDrawerBody-${sectionId}`);
      const cartDrawerFooterUpdate = sectionToRender.querySelector(`#CartDrawerFooter-${sectionId}`);
      const cartDrawerEmptyUpdate = sectionToRender.querySelector(`#CartDrawerEmpty-${sectionId}`);

      if (cartDrawerBodyUpdate) {
        cartDrawerBody.innerHTML = cartDrawerBodyUpdate.innerHTML;
      }
      if (cartDrawerFooterUpdate) {
        cartDrawerFooter.innerHTML = cartDrawerFooterUpdate.innerHTML;
      }

      if (cartDrawerEmptyUpdate) {
        cartDrawerEmpty.innerHTML = cartDrawerEmptyUpdate.innerHTML;
      }

      if (event.cart.item_count > 0) {
        cartDrawerBody.classList.remove('hidden');
        cartDrawerFooter.classList.remove('hidden');
        cartDrawerEmpty.classList.add('hidden');
      } else {
        cartDrawerBody.classList.add('hidden');
        cartDrawerFooter.classList.add('hidden');
        cartDrawerEmpty.classList.remove('hidden');
      }
    }

    const mainCart = document.querySelector(`#MainCart-${sectionId}`);
    if (mainCart) {
      const updatedElement = sectionToRender.querySelector(`#MainCart-${sectionId}`);
      if (updatedElement) {
        mainCart.innerHTML = updatedElement.innerHTML;
        if (event.cart.item_count > 0) {
          mainCart.closest('.cart').classList.remove('is-empty');
        } else {
          mainCart.closest('.cart').classList.add('is-empty');
        }
      } else {
        mainCart.closest('.cart').classList.add('is-empty');
        mainCart.remove();
      }
    }

    const lineItem =
      document.getElementById(`CartItem-${event.line}`) || document.getElementById(`CartDrawer-Item-${event.line}`);

    if (lineItem && lineItem.querySelector(`[name="${event.name}"]`)) {
      FoxTheme.a11y.trapFocus(mainCart || cartDrawer, lineItem.querySelector(`[name="${event.name}"]`));
    } else if (event.cart.item_count === 0) {
      cartDrawer
        ? FoxTheme.a11y.trapFocus(cartDrawer, cartDrawer.querySelector('a'))
        : FoxTheme.a11y.trapFocus(document.querySelector('.cart__empty'), document.querySelector('a'));
    } else {
      cartDrawer
        ? FoxTheme.a11y.trapFocus(cartDrawer, cartDrawer.querySelector('.cart-item__title'))
        : FoxTheme.a11y.trapFocus(mainCart, mainCart.querySelector('.cart-item__title'));
    }

    document.dispatchEvent(
      new CustomEvent('cart:updated', {
        detail: {
          cart: event.cart,
        },
      })
    );
  }

  updateQuantity(line, quantity, name, target) {
    this.showLoader(line);

    let sectionsToBundle = [];
    document.documentElement.dispatchEvent(
      new CustomEvent('cart:grouped-sections', { bubbles: true, detail: { sections: sectionsToBundle } })
    );

    const body = JSON.stringify({
      line,
      quantity,
      sections: sectionsToBundle,
    });

    fetch(`${FoxTheme.routes.cart_change_url}`, { ...FoxTheme.utils.fetchConfig(), ...{ body } })
      .then((response) => response.json())
      .then((parsedState) => {
        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: parsedState, target, line, name });
      })
      .catch((error) => {
        console.log(error);
      });
  }

  showLoader(line) {
    const sectionId = FoxTheme.utils.getSectionId(this);
    const loaders = document.querySelectorAll(`#Loader-${sectionId}-${line}`);
    if (loaders) {
      loaders.forEach((loader) => {
        loader.classList.add('btn--loading');
      });
    }
  }

  hideLoader(line) {
    const sectionId = FoxTheme.utils.getSectionId(this);
    const loaders = document.querySelectorAll(`#Loader-${sectionId}-${line}`);
    if (loaders) {
      loaders.forEach((loader) => {
        loader.classList.remove('btn--loading');
      });
    }
  }
}
customElements.define('cart-items', CartItems);

class CartRemoveItem extends HTMLAnchorElement {
  constructor() {
    super();

    this.addEventListener('click', (event) => {
      event.preventDefault();

      const cartItems = this.closest('cart-items');
      cartItems.updateQuantity(this.dataset.index, 0);
    });
  }
}
customElements.define('cart-remove-item', CartRemoveItem, { extends: 'a' });

class CartNote extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('change', FoxTheme.utils.debounce(this.onChange.bind(this), 300));

    if (this.button && this.cartNoteDetailsSummary) {
      this.button.addEventListener('click', () => {
        this.cartNoteDetailsSummary.close();
      });
    }
  }

  get cartNoteDetailsSummary() {
    return this.closest('[is="accordion-details"]');
  }

  get button() {
    return this.querySelector('[type="button"]');
  }

  onChange(event) {
    const body = JSON.stringify({ note: event.target.value });
    fetch(`${FoxTheme.routes.cart_update_url}`, { ...FoxTheme.utils.fetchConfig(), ...{ body } });
  }
}
customElements.define('cart-note', CartNote);

class CartDiscount extends HTMLFormElement {
  constructor() {
    super();

    this.addEventListener('submit', this.handleFormSubmit.bind(this));
  }

  get submitEl() {
    return (this._submitEl = this._submitEl || this.querySelector('[type="submit"]'));
  }

  get messageEl() {
    return (this._messageEl = this._messageEl || this.querySelector('.form__message'));
  }

  get couponEl() {
    return (this._couponEl = this._couponEl || this.querySelector('input[name="discount"]'));
  }

  get cartAddonDrawer() {
    return this.closest('.cart-addons-drawer');
  }

  get cartDiscountsEl() {
    return document.querySelector('.cart__discounts');
  }

  getDiscounts() {
    const discounts = [];

    if (this.cartDiscountsEl) {
      const items = this.cartDiscountsEl.querySelectorAll('.discount');
      items &&
        items.forEach((item) => {
          discounts.push(item.dataset.discountCode);
        });
    }

    return discounts;
  }

  handleFormSubmit(event) {
    event.preventDefault();

    if (this.submitEl.getAttribute('aria-disabled') === 'true') return;

    this.displayFormErrors();

    const newDiscountCode = this.couponEl.value;
    const discounts = this.getDiscounts();

    if (discounts.includes(newDiscountCode)) {
      this.displayFormErrors(FoxTheme.cartStrings.duplicateDiscountError);
      return;
    }

    discounts.push(newDiscountCode);

    let sectionsToBundle = [];
    document.documentElement.dispatchEvent(
      new CustomEvent('cart:grouped-sections', { bubbles: true, detail: { sections: sectionsToBundle } })
    );

    const config = FoxTheme.utils.fetchConfig('javascript');
    config.headers['X-Requested-With'] = 'XMLHttpRequest';
    delete config.headers['Content-Type'];

    const formData = new FormData();
    formData.append('sections', sectionsToBundle);
    formData.append('sections_url', window.location.pathname);
    formData.append('discount', discounts.join(','));

    config.body = formData;

    this.submitEl.setAttribute('aria-disabled', 'true');
    this.submitEl.classList.add('btn--loading');

    fetch(FoxTheme.routes.cart_update_url, config)
      .then((response) => response.json())
      .then(async (parsedState) => {
        if (
          parsedState.discount_codes.find((/** @type {{ code: string; applicable: boolean; }} */ discount) => {
            return discount.code === newDiscountCode && discount.applicable === false;
          })
        ) {
          this.couponEl.value = '';
          this.displayFormErrors(FoxTheme.cartStrings.applyDiscountError);
          return;
        }

        if (this.cartAddonDrawer) {
          this.cartAddonDrawer.hide();
        }

        const cartJson = await (await fetch(`${FoxTheme.routes.cart_url}`, { ...FoxTheme.utils.fetchConfig() })).json();
        cartJson['sections'] = parsedState['sections'];

        this.updateCartState(cartJson);
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        this.submitEl.removeAttribute('aria-disabled');
        this.submitEl.classList.remove('btn--loading');
      });
  }

  updateCartState = (cartJson) => {
    FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: cartJson });
  };

  displayFormErrors = (errorMessage = false) => {
    if (!this.messageEl) {
      if (errorMessage !== false) {
        alert(errorMessage);
      }
    } else {
      this.messageEl.classList.toggle('!hidden', !errorMessage);
      if (errorMessage !== false) {
        this.messageEl.innerText = errorMessage;
      }
    }
  };
}
customElements.define('cart-discount', CartDiscount, { extends: 'form' });

class CartDiscountRemove extends HTMLButtonElement {
  constructor() {
    super();

    this.selectors = {
      list: '.cart__discounts',
      item: '.discount',
    };

    this.clickHandler = this.handleClick.bind(this);
  }

  connectedCallback() {
    this.listEl = this.closest(this.selectors.list);

    this.addEventListener('click', this.clickHandler);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.clickHandler);
  }

  handleClick(event) {
    event.preventDefault();
    if (this.getAttribute('aria-disabled') === 'true') return;

    this.setAttribute('aria-disabled', 'true');
    this.classList.add('btn--loading');

    this.discounts = [];

    const thisItem = this.closest('li');
    const items = this.listEl.querySelectorAll(this.selectors.item);
    items &&
      items.forEach((item) => {
        if (item != thisItem) {
          this.discounts.push(item.dataset.discountCode);
        }
      });

    this.updateCartDiscounts();
  }

  updateCartDiscounts() {
    let sectionsToBundle = [];
    document.documentElement.dispatchEvent(
      new CustomEvent('cart:grouped-sections', { bubbles: true, detail: { sections: sectionsToBundle } })
    );

    const config = FoxTheme.utils.fetchConfig('javascript');
    config.headers['X-Requested-With'] = 'XMLHttpRequest';
    delete config.headers['Content-Type'];

    const formData = new FormData();
    formData.append('sections', sectionsToBundle);
    formData.append('sections_url', window.location.pathname);
    formData.append('discount', this.discounts.join(','));

    config.body = formData;

    fetch(FoxTheme.routes.cart_update_url, config)
      .then((response) => response.json())
      .then(async (parsedState) => {
        const cartJson = await (await fetch(`${FoxTheme.routes.cart_url}`, { ...FoxTheme.utils.fetchConfig() })).json();
        cartJson['sections'] = parsedState['sections'];

        this.updateCartState(cartJson);
      })
      .catch((e) => {
        console.error(e);
      });
  }

  updateCartState = (cartJson) => {
    FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: cartJson });
  };
}
customElements.define('cart-discount-remove', CartDiscountRemove, { extends: 'button' });

class CalculateShipping extends CartAddonModal {
  constructor() {
    super();
    this.countryProvince = this.querySelector('country-province');
    this.isCountrySetup = false;
  }
  static get observedAttributes() {
    return [...super.observedAttributes, 'data-show'];
  }
  show() {
    super.show();
    this.setAttribute('data-show', true);
  }

  hide() {
    super.hide();
    this.setAttribute('data-show', false);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === 'data-show' && newValue === 'true' && !this.isCountrySetup && this.countryProvince) {
      const template = this.countryProvince.querySelector('template');
      const templateContent = document.importNode(template.content, true);
      this.countryProvince.countryElement.appendChild(templateContent);
      this.countryProvince.init();
      this.isCountrySetup = true;
    }
  }
}
customElements.define('calculate-shipping', CalculateShipping);
class CountryProvinceForm extends HTMLElement {
  constructor() {
    super();
    this.provinceElement = this.querySelector('[name="address[province]"]');
    this.countryElement = this.querySelector('[name="address[country]"]');
    this.template = this.dataset.template;
    this.countryElement.addEventListener('change', this.handleCountryChange.bind(this));
    if (this.template && this.template === 'cart') {
      this.init();
    }
  }

  init() {
    if (this.getAttribute('country') !== '') {
      this.countryElement.selectedIndex = Math.max(
        0,
        Array.from(this.countryElement.options).findIndex((option) => option.textContent === this.dataset.country)
      );
      this.countryElement.dispatchEvent(new Event('change'));
    } else {
      this.handleCountryChange();
    }
  }

  handleCountryChange() {
    const option = this.countryElement.options[this.countryElement.selectedIndex],
      provinces = JSON.parse(option.dataset.provinces);

    this.provinceElement.closest('.form-field').hidden = provinces.length === 0;

    if (provinces.length === 0) {
      return;
    }

    this.provinceElement.innerHTML = '';

    provinces.forEach((data) => {
      const selected = data[1] === this.dataset.province;
      this.provinceElement.options.add(new Option(data[1], data[0], selected, selected));
    });
  }
}
customElements.define('country-province', CountryProvinceForm);

class ShippingCalculator extends HTMLFormElement {
  constructor() {
    super();

    this.submitButton = this.querySelector('[type="submit"]');
    this.resultsElement = this.lastElementChild;

    this.submitButton.addEventListener('click', this.handleFormSubmit.bind(this));
  }

  handleFormSubmit(event) {
    event.preventDefault();

    const zip = this.querySelector('[name="address[zip]"]').value,
      country = this.querySelector('[name="address[country]"]').value,
      province = this.querySelector('[name="address[province]"]').value;

    this.submitButton.classList.add('btn--loading');

    const body = JSON.stringify({
      shipping_address: { zip, country, province },
    });
    let sectionUrl = `${FoxTheme.routes.cart_url}/shipping_rates.json`;

    sectionUrl = sectionUrl.replace('//', '/');

    fetch(sectionUrl, { ...FoxTheme.utils.fetchConfig('javascript'), ...{ body } })
      .then((response) => response.json())
      .then((parsedState) => {
        if (parsedState.shipping_rates) {
          this.formatShippingRates(parsedState.shipping_rates);
        } else {
          this.formatError(parsedState);
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        this.resultsElement.hidden = false;
        this.submitButton.classList.remove('btn--loading');
      });
  }

  formatError(errors) {
    const shippingRatesList = Object.keys(errors).map((errorKey) => {
      return `<li>${errors[errorKey]}</li>`;
    });
    this.resultsElement.innerHTML = `
      <div class="alert alert--error blocks-radius grid gap-2">
        <p class="font-body-bolder m-0">${FoxTheme.shippingCalculatorStrings.error}</p>
        <ul class="list-disc grid gap-1 text-sm" role="list">${shippingRatesList.join('')}</ul>
      </div>
    `;
  }

  formatShippingRates(shippingRates) {
    const shippingRatesList = shippingRates.map(({ presentment_name, currency, price }) => {
      return `<li>${presentment_name}: ${currency} ${price}</li>`;
    });
    this.resultsElement.innerHTML = `
      <div class="alert blocks-radius alert--${
        shippingRates.length === 0 ? 'error' : 'success'
      } grid gap-2 leading-tight">
        <p class="font-body-bolder m-0">${
          shippingRates.length === 0
            ? FoxTheme.shippingCalculatorStrings.notFound
            : shippingRates.length === 1
            ? FoxTheme.shippingCalculatorStrings.oneResult
            : FoxTheme.shippingCalculatorStrings.multipleResults
        }</p>
        ${
          shippingRatesList === ''
            ? ''
            : `<ul class="list-disc grid gap-1 text-sm" role="list">${shippingRatesList.join('')}</ul>`
        }
      </div>
    `;
  }
}
customElements.define('shipping-calculator', ShippingCalculator, { extends: 'form' });

class CartDrawerProductsRecommendation extends HTMLElement {
  constructor() {
    super();
    this.carousel = false;
    this.isLoading = false;

    this.classes = {
      grid: 'f-grid',
      swiper: 'swiper',
      swiperWrapper: 'swiper-wrapper',
      loading: 'is-loading',
    };

    // Handle Safari separately
    const isSafari = navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome');
    if (isSafari) {
      this.init();
    } else {
      FoxTheme.Motion.inView(this, this.init.bind(this), { margin: '600px 0px 600px 0px' });
    }
  }

  disconnectedCallback() {
    // Cleanup
    this.destroyCarousel();
    const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
    mql.removeEventListener('change', this.handleCarousel.bind(this));
  }

  init() {
    if (this.isLoading || !this.dataset.url) return;

    this.isLoading = true;
    this.classList.add(this.classes.loading);

    fetch(this.dataset.url)
      .then((response) => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.text();
      })
      .then((responseText) => {
        const sectionInnerHTML = new DOMParser()
          .parseFromString(responseText, 'text/html')
          .querySelector('.shopify-section');

        if (!sectionInnerHTML) return;

        const recommendations = sectionInnerHTML.querySelector('cart-drawer-products-recommendation');
        if (recommendations?.innerHTML.trim().length) {
          this.innerHTML = recommendations.innerHTML;
          const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
          mql.addEventListener('change', this.handleCarousel.bind(this));
          this.handleCarousel();
          this.dispatchEvent(new CustomEvent('recommendations:loaded'));
        } else {
          this.closest('.shopify-section')?.remove();
        }
      })
      .catch((error) => {
        console.error('Error loading recommendations:', error);
        this.classList.add('has-error');
      })
      .finally(() => {
        this.isLoading = false;
        this.classList.remove(this.classes.loading);
      });
  }

  initCarousel() {
    if (!this.wrapper?.innerHTML.trim().length) {
      this.classList.add('hidden');
      return;
    }

    if (typeof this.carousel !== 'object') {
      try {
        this.container.classList.add(this.classes.swiper);
        this.wrapper.classList.remove(this.classes.grid);
        this.wrapper.classList.add(this.classes.swiperWrapper);

        let options = {
          slidesPerView: this.columns,
          spaceBetween: 8,
          loop: false,
          navigation: {
            nextEl: this.sliderNext,
            prevEl: this.sliderPrev,
          },
        };

        const paginationEl = this.querySelector('.swiper-pagination');
        if (paginationEl) {
          options = {
            ...options,
            pagination: {
              el: paginationEl,
              clickable: true,
              type: 'fraction',
            },
          };
        }

        this.carousel = new FoxTheme.Carousel(this.slideContainer, options);

        if (this.carousel) {
          this.carousel.init();
          this.calcNavButtonsPosition();
        }
      } catch (error) {
        console.error('Error initializing carousel:', error);
        this.destroyCarousel();
      }
    }
  }

  handleCarousel() {
    const containerEl = this.container;
    this.columns = containerEl.dataset.columns;
    this.enableSliderMobile = containerEl.dataset.enableSliderMobile === 'true';

    if (FoxTheme.config.mqlMobile) {
      this.enableSliderMobile ? this.initCarousel() : this.destroyCarousel();
    } else {
      this.initCarousel();
    }
  }

  destroyCarousel() {
    if (!this.wrapper?.innerHTML.trim().length) {
      this.classList.add('hidden');
      return;
    }
    this.container?.classList.remove(this.classes.swiper);
    this.wrapper?.classList.remove(this.classes.swiperWrapper);
    this.wrapper?.classList.add(this.classes.grid);

    if (typeof this.sliderInstance !== 'object') return;
    this.carousel.slider.destroy();
    this.carousel = false;
  }

  calcNavButtonsPosition() {
    if (!this.dataset.calcButtonPosition === 'true') return;
    const firstMedia = this.querySelector('.product-card__image-wrapper');
    if (firstMedia && firstMedia.clientHeight > 0) {
      this.style.setProperty('--swiper-navigation-top-offset', parseInt(firstMedia.clientHeight) / 2 + 'px');
    }
  }

  get slideContainer() {
    return this.querySelector('.swiper');
  }

  get sliderPagination() {
    return this.querySelector('.swiper-pagination');
  }

  get sliderNext() {
    return this.querySelector('.swiper-button-next');
  }

  get sliderPrev() {
    return this.querySelector('.swiper-button-prev');
  }

  get container() {
    return this.querySelector('.cart-drawer-products-recommendation__container');
  }

  get wrapper() {
    return this.querySelector('.cart-drawer-products-recommendation__wrapper');
  }
}
customElements.define('cart-drawer-products-recommendation', CartDrawerProductsRecommendation);

class MainCart extends HTMLElement {
  constructor() {
    super();

    document.addEventListener('cart:grouped-sections', this.getSectionToRender.bind(this));
  }

  getSectionToRender(event) {
    event.detail.sections.push(FoxTheme.utils.getSectionId(this));
  }
}
customElements.define('main-cart', MainCart);

class FreeShippingGoal extends HTMLElement {
  constructor() {
    super();
    this.selectors = {
      leftToSpend: '[data-left-to-spend]',
    };
    this.goal = Number(this.dataset.minimumAmount) * Number(window.Shopify.currency.rate || 1) || 0;
    this.progress = this.querySelector('progress-bar');
    this.money_format = window.FoxTheme.settings.moneyFormat;
  }

  connectedCallback() {
    this.updateShippingGloal(Number(this.dataset.cartTotal));
    document.addEventListener('cart:updated', (event) => {
      this.updateShippingGloal(event.detail.cart.items_subtotal_price);
    });
  }

  updateShippingGloal(amount) {
    if (amount > 0) {
      this.classList.remove('hidden');
    } else {
      this.classList.add('hidden');
    }

    this.cartTotal = amount / 100;
    this.goalLeft = this.goal - this.cartTotal;
    this.goalDone = this.goalLeft <= 0;

    this.percent = (this.cartTotal * 100) / this.goal;

    if (this.percent >= 100) this.percent = 100;

    if (this.cartTotal >= this.goal) {
      this.progress.style.setProperty('--percent', `${this.percent}%`);
      this.classList.add('free-shipping-goal--done');
      this.progress.dataset.value = this.cartTotal;
      this.progress.dataset.max = this.goal;
    } else {
      let spend = (this.goal - this.cartTotal) * 100;
      this.querySelector(this.selectors.leftToSpend).innerHTML = FoxTheme.Currency.formatMoney(
        spend,
        this.money_format
      );
      this.classList.remove('free-shipping-goal--done');
      this.progress.style.setProperty('--percent', `${this.percent}%`);
      this.progress.dataset.value = this.cartTotal;
      this.progress.dataset.max = this.goal;
    }
  }
}
customElements.define('free-shipping-goal', FreeShippingGoal);

window.FoxKitAddToCart = async (payload) => {
  if (!payload?.properties?.['_FoxKit offer']) return;

  const cartJson = await (
    await fetch(`${FoxTheme.routes.cart_url}`, {
      ...FoxTheme.utils.fetchConfig(),
    })
  ).json();
  cartJson['sections'] = payload['sections'];
  FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: cartJson });

  document.dispatchEvent(
    new CustomEvent('product-ajax:added', {
      detail: {
        product: payload,
      },
    })
  );
};

/* ============================================================
 * Pricing preview (Campaigns / Breakdown) via your app endpoint
 * Renders into:
 *  - #Cart-PricingBreakdown
 *  - #Cart-AppliedCampaigns
 * Works on cart page and cart drawer (because we listen to cart:updated).
 * ============================================================ */

(() => {
  const ENDPOINT = "/apps/checkout/prepare";

const elsBreakdown = () => Array.from(document.querySelectorAll("[data-pricing-breakdown]"));
const elsCampaigns = () => Array.from(document.querySelectorAll("[data-applied-campaigns]"));


  const money = (amountMajor, currencyCode) => {
    // amountMajor is number like 21 (EUR). Keep it simple + safe.
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode || "EUR",
      }).format(Number(amountMajor || 0));
    } catch {
      return `${amountMajor} ${currencyCode || ""}`.trim();
    }
  };

  const buildPayloadFromCart = (cart) => {
    return {
      mode: "preview",
      customerId: null,
      items: (cart.items || []).map((it) => ({
        // You already do this GID mapping in console snippet.
        variantId: `gid://shopify/ProductVariant/${String(it.variant_id).replace(/[^\d]/g, "")}`,
        quantity: Number(it.quantity || 0),
      })),
      shipping: null,
      promoCode: cart.attributes?.itella_promo_code || null,
      freeChoiceVariantId: cart.attributes?.itella_free_choice_variant_id || null,
    };
  };

const renderPricing = (pricing) => {
  const bEls = elsBreakdown();
  const cEls = elsCampaigns();

  if (!bEls.length && !cEls.length) return;

  if (!pricing) {
    bEls.forEach((el) => (el.innerHTML = ""));
    cEls.forEach((el) => (el.innerHTML = ""));
    return;
  }

  const cc = pricing.currencyCode || "EUR";
  const br = pricing.breakdown || {};
  const applied = Array.isArray(pricing.appliedCampaigns) ? pricing.appliedCampaigns : [];

  // Breakdown
  const rows = [
    ["Base subtotal", money(br.baseSubtotal ?? 0, cc)],
    ["Campaign discount", br.campaignDiscount ? `-${money(br.campaignDiscount, cc)}` : money(0, cc)],
    ["Promo discount", br.promoDiscount ? `-${money(br.promoDiscount, cc)}` : money(0, cc)],
    ["Final subtotal", money(br.finalSubtotal ?? br.baseSubtotal ?? 0, cc)],
  ];

  const breakdownHtml = `
    <div style="padding:10px;border:1px solid rgba(0,0,0,.08);border-radius:12px;">
      <div style="font-weight:600;margin-bottom:6px;">Pricing preview</div>
      <div style="display:grid;gap:4px;">
        ${rows.map(([k,v]) => `
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <span style="opacity:.75;">${k}</span>
            <span style="font-weight:600;">${v}</span>
          </div>`).join("")}
      </div>
    </div>
  `;
  bEls.forEach((el) => (el.innerHTML = breakdownHtml));

  // Applied campaigns + FREE LINES info (если есть)
  const freeLines = Array.isArray(pricing.lines)
    ? pricing.lines.filter((l) => Number(l.finalUnitPrice || 0) === 0 && Number(l.quantity || 0) > 0)
    : [];

  let freeInfo = "";
  if (freeLines.length) {
    freeInfo = `
      <div style="margin-top:10px;opacity:.85;">
        <div style="font-weight:600;margin-bottom:4px;">Free items (preview)</div>
        <div style="display:grid;gap:4px;">
          ${freeLines.map((l) => `
            <div>• Variant: <span style="font-family:monospace;">${l.variantId}</span> × ${l.quantity}</div>
          `).join("")}
        </div>
        <div style="margin-top:6px;opacity:.75;font-size:12px;">
          Note: this is a preview from your price engine. Shopify cart won’t show it unless you actually add it to /cart.
        </div>
      </div>
    `;
  }

  const campaignsHtml = applied.length
    ? `
      <div style="padding:10px;border:1px solid rgba(0,0,0,.08);border-radius:12px;">
        <div style="font-weight:600;margin-bottom:6px;">Applied campaigns</div>
        <div style="display:grid;gap:6px;">
          ${applied.map((c) => {
            const label = c.label || c.id || "Campaign";
            const type = c.type ? ` <span style="opacity:.65;">(${c.type})</span>` : "";
            return `<div>• <span style="font-weight:600;">${label}</span>${type}</div>`;
          }).join("")}
        </div>
        ${freeInfo}
      </div>
    `
    : "";

  cEls.forEach((el) => (el.innerHTML = campaignsHtml));
};


  let timer = null;
  const scheduleUpdate = () => {
    clearTimeout(timer);
    timer = setTimeout(runUpdate, 250);
  };

  const runUpdate = async () => {
    // If containers do not exist on this page/state -> do nothing.
if (!elsBreakdown().length && !elsCampaigns().length) return;


    try {
      const cart = await (await fetch("/cart.js", { cache: "no-store" })).json();
      const payload = buildPayloadFromCart(cart);

      // Debug – можно убрать потом
      console.log("[pricing-preview] payload ->", payload);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn("[pricing-preview] prepare failed:", res.status);
        renderPricing(null);
        return;
      }

      const data = await res.json();
      console.log("[pricing-preview] prepare ->", data);

      renderPricing(data?.pricing || null);
    } catch (e) {
      console.error("[pricing-preview] error:", e);
      renderPricing(null);
    }
  };

  // 1) First load (cart page / drawer)
  document.addEventListener("DOMContentLoaded", scheduleUpdate);

  // 2) After any cart updates (your theme already dispatches this event)
  document.addEventListener("cart:updated", scheduleUpdate);

  // 3) When drawer refresh triggers cartUpdate -> onCartUpdate -> cart:updated (already covers it)
})();
