if (!customElements.get('sticky-atc-bar-minimalist')) {
  customElements.define(
    'sticky-atc-bar-minimalist',
    class StickyAtcBarMinimalist extends HTMLElement {
      constructor() {
        super();

        this.classes = {
          isOpen: 'sticky-atc-bar--show',
        };

        this.submitEl.addEventListener('click', this.onClick.bind(this));
      }

      get submitEl() {
        return (this._submitEl = this._submitEl || this.querySelector('[type="submit"]'));
      }

      connectedCallback() {
        this.productFormActions = document.querySelector('.main-product-form');
        this.mainProductInfo = document.querySelector('product-info');

        this.init();

        this.cartErrorUnsubscriber = FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.cartError, () => {
          this.resetButtonLoading();
          this.scrollToTop(this.productFormActions);
        });

        this.cartUpdateUnsubscriber = FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, () => {
          this.resetButtonLoading();
        });
      }

      disconnectedCallback() {
        if (this.cartErrorUnsubscriber) {
          this.cartErrorUnsubscriber();
        }

        if (this.cartUpdateUnsubscriber) {
          this.cartUpdateUnsubscriber();
        }
      }

      init() {
        if (!this.productFormActions) {
          this.classList.remove(this.classes.isOpen);
          return;
        }

        const rootMargin = `${this.productFormActions.offsetHeight}px 0px 0px 0px`;
        this.observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              const isAboveViewport = !entry.isIntersecting && entry.boundingClientRect.top < 0;
              this.classList.toggle(this.classes.isOpen, isAboveViewport);
            });
          },
          { threshold: 1, rootMargin }
        );
        this.observer.observe(this.productFormActions);
        this.syncWithMainProductForm();
      }

      onClick() {
        this.submitEl.setAttribute('aria-disabled', 'true');
        this.submitEl.classList.add('btn--loading');
      }

      resetButtonLoading() {
        this.submitEl.removeAttribute('aria-disabled');
        this.submitEl.classList.remove('btn--loading');
      }

      scrollToTop(target, offset = 200) {
        const scrollIntoView = (selector, offset) => {
          window.scrollTo({
            behavior: 'smooth',
            top: selector.getBoundingClientRect().top - document.body.getBoundingClientRect().top - offset,
          });
        };

        scrollIntoView(target, offset);
      }

      updateButton(disable = true, text, modifyClass = true) {
        const addButton = this.querySelector('[name="add"]');
        if (!addButton) return;

        const addButtonText = addButton.querySelector('span');
        if (disable) {
          addButton.setAttribute('disabled', 'disabled');
          if (text) addButtonText.textContent = text;
        } else {
          addButton.removeAttribute('disabled');
          addButtonText.textContent = FoxTheme.variantStrings.addToCartShort;
        }
      }

      updatePrice(variant) {
        const classes = {
          onSale: 'f-price--on-sale',
          soldOut: 'f-price--sold-out',
        };
        const selectors = {
          priceWrapper: '.f-price',
          salePrice: '.f-price-item--sale',
          compareAtPrice: ['.f-price-item--regular'],
          unitPriceWrapper: '.f-price__unit-wrapper',
        };
        const moneyFormat = FoxTheme.settings.moneyFormat;
        const { priceWrapper, salePrice, unitPriceWrapper, compareAtPrice } = FoxTheme.utils.queryDomNodes(
          selectors,
          this
        );
        const unitPrice = unitPriceWrapper.querySelector('.f-price__unit');

        const { compare_at_price, price, unit_price_measurement } = variant;

        // On sale.
        if (compare_at_price && compare_at_price > price) {
          priceWrapper.classList.add(classes.onSale);
        } else {
          priceWrapper.classList.remove(classes.onSale);
        }

        // Sold out.
        if (!variant.available) {
          priceWrapper.classList.add(classes.soldOut);
        } else {
          priceWrapper.classList.remove(classes.soldOut);
        }

        if (salePrice) salePrice.innerHTML = FoxTheme.Currency.formatMoney(price, moneyFormat);

        if (compareAtPrice && compareAtPrice.length && compare_at_price > price) {
          compareAtPrice.forEach(
            (item) => (item.innerHTML = `<s>${FoxTheme.Currency.formatMoney(compare_at_price, moneyFormat)}</s>`)
          );
        } else {
          compareAtPrice.forEach((item) => (item.innerHTML = FoxTheme.Currency.formatMoney(price, moneyFormat)));
        }

        if (unit_price_measurement && unitPrice) {
          unitPriceWrapper.classList.remove('hidden');
          const unitPriceContent = `<span>${FoxTheme.Currency.formatMoney(
            variant.unit_price,
            moneyFormat
          )}</span>/<span data-unit-price-base-unit>${this._getBaseUnit()}</span>`;
          unitPrice.innerHTML = unitPriceContent;
        } else {
          unitPriceWrapper.classList.add('hidden');
        }
      }

      syncWithMainProductForm() {
        FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, (event) => {
          const isMainProduct = event.data.sectionId === this.mainProductInfo.dataset.section;
          if (!isMainProduct) return;
          const variant = event.data.variant;
          this.updatePrice(variant);
          this.updateButton(true, '', false);
          if (!variant) {
            this.updateButton(true, '', true);
          } else {
            this.updateButton(!variant.available, FoxTheme.variantStrings.soldOut);
          }
        });
      }
    }
  );
}
