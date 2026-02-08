if (!customElements.get('sticky-atc-bar')) {
  customElements.define(
    'sticky-atc-bar',
    class StickyAtcBar extends HTMLElement {
      constructor() {
        super();
        document.body.classList.add('sticky-atc-bar-enabled');
      }

      get variantIdSelect() {
        return this.querySelector('[name="id"]');
      }

      connectedCallback() {
        this.productFormActions = document.querySelector('.main-product-form');
        this.mainProductInfo = document.querySelector('product-info');
        this.container = this.closest('.sticky-atc-bar');

        this.variantData = this.getVariantData();
        this.select = this.querySelector('select');

        this.init();
        this.select.addEventListener('change', () => {
          if (this.isUpdating) return;
          this.isUpdating = true;

          this.mainVariantSelects = this.mainProductInfo && this.mainProductInfo.querySelector('variant-selects');
          const selectedVariantId = this.variantIdSelect.value;
          this.currentVariant = this.variantData.find((variant) => variant.id === Number(selectedVariantId));

          if (this.mainVariantSelects) {
            Array.from(this.mainVariantSelects.querySelectorAll('select, fieldset'), (element, index) => {
              const variantOptionVal = this.currentVariant.options[index];
              switch (element.tagName) {
                case 'SELECT':
                  element.value = variantOptionVal;
                  const options = element.querySelectorAll('option');
                  options.forEach((option) => option.removeAttribute('selected'));

                  element.value = variantOptionVal;
                  const selectedOption = element.querySelector(`option[value="${variantOptionVal}"]`);
                  if (selectedOption) {
                    selectedOption.setAttribute('selected', 'selected');
                  }
                  break;
                case 'FIELDSET':
                  Array.from(element.querySelectorAll('input')).forEach((radio) => {
                    if (radio.value === variantOptionVal) {
                      radio.checked = true;
                    }
                  });
                  break;
              }
            });
            setTimeout(() => {
              this.mainVariantSelects.dispatchEvent(new Event('change', { detail: { formStickty: true } }));
              this.isUpdating = false;
            }, 0);
          } else {
            this.isUpdating = false;
          }

          this.updatePrice();
          this.updateButton(true, '', false);
          if (!this.currentVariant) {
            this.updateButton(true, '', true);
          } else {
            this.updateButton(!this.currentVariant.available, FoxTheme.variantStrings.soldOut);
          }
        });
      }

      getVariantData() {
        this.variantData =
          this.variantData || JSON.parse(this.container.querySelector('[type="application/json"]').textContent);
        return this.variantData;
      }

      init() {
        if (!this.productFormActions) {
          this.container.classList.add('sticky-atc-bar--show');
          return;
        }
        this.productId = this.dataset.productId;

        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = this.checkDevice.bind(this);
        this.checkDevice();

        const rootMargin = `${this.productFormActions.offsetHeight}px 0px 0px 0px`;
        this.observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              this.container.classList.toggle('sticky-atc-bar--show', !entry.isIntersecting);
            });
          },
          { threshold: 1, rootMargin }
        );
        this.observer.observe(this.productFormActions);
        this.syncWithMainProductForm();
      }

      checkDevice() {
        document.documentElement.style.setProperty('--sticky-atc-bar-height', this.clientHeight + 'px');
      }

      updateButton(disable = true, text, modifyClass = true) {
        const productForm = this.querySelector('.sticky-atc-bar__form');
        if (!productForm) return;

        const addButton = productForm.querySelector('[name="add"]');
        if (!addButton) return;

        const addButtonText = addButton.querySelector('span');
        if (disable) {
          addButton.setAttribute('disabled', 'disabled');
          if (text) addButtonText.textContent = text;
        } else {
          addButton.removeAttribute('disabled');
          addButtonText.textContent = FoxTheme.variantStrings.addToCart;
        }
      }

      updatePrice() {
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

        const { compare_at_price, price, unit_price_measurement } = this.currentVariant;

        // On sale.
        if (compare_at_price && compare_at_price > price) {
          priceWrapper.classList.add(classes.onSale);
        } else {
          priceWrapper.classList.remove(classes.onSale);
        }

        // Sold out.
        if (!this.currentVariant.available) {
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
            this.currentVariant.unit_price,
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
          const variantInput = this.querySelector('[name="id"]');

          this.currentVariant = variant;
          variantInput.value = variant.id;
          this.updatePrice();
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
