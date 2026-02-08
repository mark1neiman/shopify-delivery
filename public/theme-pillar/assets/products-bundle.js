if (!customElements.get('products-bundle')) {
  customElements.define(
    'products-bundle',
    class ProductsBundle extends HTMLElement {
      constructor() {
        super();

        this.cartDrawerElement = document.querySelector('cart-drawer');
        this.addToCartButtonElement = this.querySelector('.products-bundle__button button');

        this.addToCartButtonElement &&
          this.addToCartButtonElement.addEventListener('click', this.handleButtonClick.bind(this));
      }

      handleButtonClick(event) {
        event.preventDefault();
        this.lastClickedElement = event.submitter || event.currentTarget;

        const products = this.querySelectorAll('product-bundle-variant-selector');

        const items = {
          items: [...products].map((product) => ({
            id: product.querySelector("[name=id]").value,
            quantity: product.querySelector("quantity-input") ? Number(product.querySelector("quantity-input").input.value) : 1,
          }))
        };

        if (document.body.classList.contains('cart-template') || FoxTheme.settings.cartType != 'drawer') {
          FoxTheme.utils.postLink(FoxTheme.routes.cart_add_url, {
            parameters: {
              ...items,
            },
          });
          return;
        }

        this.showErrorMessage();
        this.toggleButtonLoading(true);

        let sectionsToBundle = [];
        document.documentElement.dispatchEvent(
          new CustomEvent('cart:grouped-sections', { bubbles: true, detail: { sections: sectionsToBundle } })
        );

        const body = JSON.stringify({
          ...items,
          sections: sectionsToBundle,
          section_url: window.pathname,
        });

        fetch(`${FoxTheme.routes.cart_add_url}`, { ...FoxTheme.utils.fetchConfig('javascript'), ...{ body } })
          .then((response) => response.json())
          .then(async (parsedState) => {
            if (parsedState.status) {
              this.showErrorMessage(parsedState.description);
              return;
            }
            if (parsedState.status === 422) {
              document.dispatchEvent(
                new CustomEvent('product-ajax:error', {
                  detail: {
                    errorMessage: parsedState.description,
                  },
                })
              );
            } else {
              const cartJson = await (
                await fetch(`${FoxTheme.routes.cart_url}`, { ...FoxTheme.utils.fetchConfig() })
              ).json();
              cartJson['sections'] = parsedState['sections'];

              FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: cartJson });
              document.dispatchEvent(
                new CustomEvent('product-ajax:added', {
                  detail: {
                    product: parsedState,
                  },
                })
              );
              this.cartDrawerElement && this.cartDrawerElement.show(this.lastClickedElement);
            }
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            this.toggleButtonLoading(false);
          });
      }

      showErrorMessage(errorMessage = false) {
        this.errorMessageElement = this.errorMessageElement || this.querySelector('.product-form__error-message');
        if (this.errorMessageElement) {
          this.errorMessageElement.hidden = !errorMessage;

          if (errorMessage) this.errorMessageElement.textContent = errorMessage;
        } else {
          errorMessage && alert(errorMessage);
        }
      }

      toggleButtonLoading(status) {
        if (status) {
          this.addToCartButtonElement.classList.add('btn--loading');
          this.addToCartButtonElement.setAttribute('disabled', true);
        } else {
          this.addToCartButtonElement.classList.remove('btn--loading');
          this.addToCartButtonElement.removeAttribute('disabled');
        }
      }
    }
  );
}

if (!customElements.get('product-bundle-variant-selector')) {
  customElements.define(
    'product-bundle-variant-selector',

    class ProductBundleVariantSelector extends HTMLElement {
      constructor() {
        super();
      }

      get priceElement() {
        return this.querySelector('.f-price');
      }

      get variantSelect() {
        return this.querySelector('select');
      }

      get productId() {
        return this.dataset.productId;
      }

      get productHandle() {
        return this.dataset.productHandle;
      }

      get quantityInput() {
        return this.querySelector('quantity-input input');
      }

      get rootUrl() {
        return window.Shopify.routes.root;
      }

      get sectionId() {
        return this.dataset.sectionId;
      }

      get blockId() {
        return this.dataset.blockId;
      }

      connectedCallback() {
        this.selectors = {
          mainImg: '.product-card__image--main',
          soldOut: 'f-price--sold-out',
          onSale: 'f-price--on-sale',
          noCompare: 'f-price--no-compare',
        };

        this.mainImage = this.querySelector(this.selectors.mainImg);
        this.currentOptionIds = this.variantSelect ? this.variantSelect.options[this.variantSelect.selectedIndex].dataset.optionsId : null;
        this.currentVariantId = this.variantSelect ? this.variantSelect.value : null;
        this.variantSelect && this.variantSelect.addEventListener('change', this.handleVariantChange.bind(this));
      }

      handleVariantChange(event) {
        const variantSelect = event.target;
        this.currentOptionIds = variantSelect.options[variantSelect.selectedIndex].dataset.optionsId;
        this.currentVariantId = variantSelect.value;

        this.updatePrice(variantSelect);

        fetch(`${this.rootUrl}products/${this.productHandle}/?section_id=${this.sectionId}&option_values=${this.currentOptionIds}`)
        .then(response => response.text())
        .then((responseText) => {
          const html = new DOMParser().parseFromString(responseText, 'text/html');

          const updateSourceFromDestination = (id, shouldHide = (source) => false) => {
            const source = html.getElementById(`${id}-${this.blockId}`);
            const destination = this.querySelector(`#${id}-${this.dataset.blockId}`);
            if (source && destination) {
              destination.innerHTML = source.innerHTML;
              destination.classList.toggle('hidden', shouldHide(source));
            }
          };
  
          updateSourceFromDestination('QuantityRule', ({ classList }) => classList.contains('hidden'));

          this.updateQuantityRules(this.blockId, this.productId, html);

          // update media
          const selectedVariantMedia = html.querySelector(`.product-bundle-card[data-block-id=${this.blockId}] .selected-variant-media`);
          if (selectedVariantMedia && this.mainImage) {
            this.mainImage.innerHTML = selectedVariantMedia.innerHTML;
          }
        }).catch((error) => {
          console.error(error);
        });
      }

      updatePrice(variantSelect) {
        const selectedVariant = variantSelect.options[variantSelect.selectedIndex];
        const compareAtPrice = parseInt(selectedVariant.dataset.compare_at_price || 0);
        const price = parseInt(selectedVariant.dataset.price || 0);
        const available = selectedVariant.dataset.available === 'true';
        const priceVaries = variantSelect.dataset.price_varies === 'true';
        const compareAtPriceVaries = variantSelect.dataset.compare_at_price_varies === 'true';

        // Remove classes
        this.priceElement.classList.remove(this.selectors.soldOut);
        this.priceElement.classList.remove(this.selectors.onSale);
        this.priceElement.classList.remove(this.selectors.noCompare);

        // Add classes
        if (!available) {
          this.priceElement.classList.add(this.selectors.soldOut);
        } else if (compareAtPrice > price && available) {
          this.priceElement.classList.add(this.selectors.onSale);
        }
        if (!priceVaries && compareAtPriceVaries) {
          this.priceElement.classList.add(this.selectors.noCompare);
        }

        // Change price
        const regularPriceElement = this.querySelector('.f-price__regular');
        regularPriceElement.querySelector('.f-price-item--regular').innerHTML = `${FoxTheme.Currency.formatMoney(
          price,
          FoxTheme.settings.moneyFormat
        )}`;

        const salePriceElement = this.querySelector('.f-price__sale');
        salePriceElement.querySelector('.f-price-item--regular').innerHTML = `<s>${FoxTheme.Currency.formatMoney(
          compareAtPrice,
          FoxTheme.settings.moneyFormat
        )}</s>`;
        salePriceElement.querySelector('.f-price-item--sale').innerHTML = `${FoxTheme.Currency.formatMoney(
          price,
          FoxTheme.settings.moneyFormat
        )}`;
      }

      updateQuantityRules(sectionId, productId, parsedHTML) {
        if (!this.quantityInput) return;

        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.quantityRules, {
          data: {
            sectionId,
            productId,
            parsedHTML,
          },
        });

        this.setQuantityBoundries();
      }

      setQuantityBoundries() {
        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.quantityBoundries, {
          data: {
            sectionId: this.blockId,
            productId: this.productId,
          },
        });
      }
    }
  )
}

if (!customElements.get('products-bundle-slider')) {
  customElements.define(
    'products-bundle-slider',
    class ProductsBundleSlider extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.selectors = {
          sliderWrapper: '.products-bundle__items',
          nextEl: '.swiper-button-next',
          prevEl: '.swiper-button-prev',
          controls: '.swiper-controls',
        };
        this.classes = {
          grid: 'f-grid',
          swiper: 'swiper',
          swiperWrapper: 'swiper-wrapper',
        };

        this.sectionId = this.dataset.sectionId;
        this.productsBundle = this.closest('products-bundle');
        this.sliderWrapper = this.querySelector(this.selectors.sliderWrapper);

        this.enableSlider = this.dataset.enableSlider === 'true';
        this.enableSwipeMobile = this.dataset.enableSwipeMobile === 'true';
        this.total = parseInt(this.dataset.total);
        this.items = parseInt(this.dataset.items);
        this.laptopItems = parseInt(this.dataset.laptopItems);
        this.tabletItems = parseInt(this.dataset.tabletItems);
        this.mobileItems = parseInt(this.dataset.mobileItems);

        this.sliderInstance = false;

        this.init();
        Array.from([FoxTheme.config.mediaQueryMobile, FoxTheme.config.mediaQueryTablet, FoxTheme.config.mediaQueryLaptop]).forEach((mediaQuery) => {
          const mql = window.matchMedia(mediaQuery);
          mql.onchange = this.init.bind(this);
        });
      }

      get columnEls() {
        return this.querySelectorAll('.f-column');
      }

      get columnGap() {
        const columnGap = window.getComputedStyle(this.sliderWrapper).getPropertyValue('--f-column-gap');
        return parseFloat(columnGap.replace('rem', '')) * 10;
      }

      init() {
        if (FoxTheme.config.mqlMobile) {
          this.enableSlider = this.total > this.mobileItems && !this.enableSwipeMobile ? true : false;
        } else if (FoxTheme.config.mqlTablet) {
          this.enableSlider = this.total > this.tabletItems ? true : false;
        } else if (FoxTheme.config.mqlLaptop) {
          this.enableSlider = this.total > this.laptopItems ? true : false;
        } else {
          this.enableSlider = this.dataset.enableSlider === 'true';
        }

        this.enableSlider ? this.initSlider() : this.destroySlider();
      }

      initSlider() {
        if (typeof this.sliderInstance === 'object') return;
        this.sliderOptions = {
          slidesPerView: this.mobileItems,
          spaceBetween: this.columnGap,
          navigation: {
            nextEl: this.productsBundle.querySelector(this.selectors.nextEl),
            prevEl: this.productsBundle.querySelector(this.selectors.prevEl),
          },
          pagination: false,
          breakpoints: {
            768: {
              slidesPerView: this.tabletItems
            },
            1024: {
              slidesPerView: this.laptopItems
            },
            1280: {
              slidesPerView: this.items
            }
          },
          loop: false,
          threshold: 2
        };

        this.classList.add(this.classes.swiper);
        this.sliderWrapper.classList.remove(this.classes.grid);
        this.sliderWrapper.classList.add(this.classes.swiperWrapper);
        this.productsBundle.querySelector(this.selectors.controls)?.classList.remove('hidden');

        this.sliderInstance = new window.FoxTheme.Carousel(this, this.sliderOptions);
        this.sliderInstance.init();

        if (Shopify.designMode && typeof this.sliderInstance === 'object') {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId != this.sectionId) return;
            let { target } = e;
            const index = Number(target.dataset.index);
  
            this.sliderInstance.slider.slideTo(index);
          });
        }
      }

      destroySlider() {
        this.classList.remove(this.classes.swiper);
        this.sliderWrapper.classList.remove(this.classes.swiperWrapper);
        this.sliderWrapper.classList.add(this.classes.grid);
        this.productsBundle.querySelector(this.selectors.controls)?.classList.add('hidden');
        if (typeof this.sliderInstance !== 'object') return;
        this.sliderInstance.slider.destroy();
        this.sliderInstance = false;
      }
    }
  );
}

if (!customElements.get('products-bundle-hotspot')) {
  customElements.define(
    'products-bundle-hotspot',
    class ProductsBundleHotspot extends HTMLElement {
      constructor() {
        super();

        this.cssClasses = {
          hover: 'is-hover',
          active: 'is-active',
        };
      }

      connectedCallback() {
        this.init();
        Array.from([FoxTheme.config.mediaQueryMobile, FoxTheme.config.mediaQuerySmallDesktop]).forEach((mediaQuery) => {
          const mql = window.matchMedia(mediaQuery);
          mql.onchange = this.init.bind(this);
        });
      }

      disconnectedCallback() {
        this.removeEventListener('mouseover', this.handleHover.bind(this));
        this.removeEventListener('mouseleave', this.handleHover.bind(this));
      }

      init() {
        this.sliderInstance = this.bundleSlider.sliderInstance;

        this.addEventListener('mouseover', this.handleHover.bind(this, 'enter'));
        this.addEventListener('mouseleave', this.handleHover.bind(this, 'leave'));

        if (Shopify.designMode) {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId != this.sectionId) return;
            let { target } = e;
            this.toggleActive(target);
          });

          document.addEventListener('shopify:block:deselect', () => {
            this.toggleActive(null);
          });
        }
      }

      handleHover(type, event) {
        this.section.classList.toggle(this.cssClasses.hover, type === 'enter');
        const selectedItem = this.bundleSlider.columnEls[this.index];

        if (type === 'enter') {
          this.toggleActive(event.target);
          selectedItem.classList.add('is-selected');
          if (typeof this.sliderInstance === 'object') {
            this.sliderInstance.slider.slideTo(this.index);
          }
          
          // Handle scroll to selected item
          if (FoxTheme.config.mqlMobile) {
            this.scrollToTop(selectedItem);
            if (this.bundleSlider.enableSwipeMobile) {
              const totalWidth = this.bundleSlider.columnEls[0].offsetWidth * parseInt(this.index);
              const totalGap = this.bundleSlider.columnGap * parseInt(this.index)
              const offset = totalWidth + totalGap;
              this.bundleSlider.scrollTo({
                behavior: 'smooth',
                left: offset
              })
            }
          }
        } else {
          this.toggleActive(null);
          Array.from(this.bundleSlider.columnEls).forEach(col => col.classList.remove('is-selected'));
        }
      }

      toggleActive(target) {
        if (target) {
          if (this.dataset.blockId === target.dataset.blockId) {
            this.classList.add(this.cssClasses.active);
          } else {
            this.classList.remove(this.cssClasses.active);
          }
        } else {
          this.classList.remove(this.cssClasses.active);
        }
      }

      scrollToTop(target, offset = 80) {
        const scrollIntoView = (selector, offset) => {
          window.scrollTo({
            behavior: 'smooth',
            top: selector.getBoundingClientRect().top - document.body.getBoundingClientRect().top - offset
          })
        }
    
        scrollIntoView(target, offset);
      };

      get sectionId() {
        return this.dataset.sectionId;
      }

      get section() {
        return this.closest(`.section-${this.sectionId}`);
      }

      get bundleSlider() {
        return this.section.querySelector('products-bundle-slider');
      }

      get index() {
        return this.dataset.index;
      }
    }
  );
}
