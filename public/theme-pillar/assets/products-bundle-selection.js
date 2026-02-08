if (!customElements.get('products-bundle-selection')) {
  customElements.define(
    'products-bundle-selection',
    class ProductsBundleSelection extends HTMLElement {
      constructor() {
        super();

        this.variants = [];
        this.preventDuplicateItems = this.dataset.preventDuplicateItems === 'true';
        this.minItems = parseInt(this.dataset.minItems);
        this.maxItems = parseInt(this.dataset.maxItems);

        this.rawItems = this.bundleBarListEl.querySelectorAll('.products-bundle-selection__bar-item');

        FoxTheme.Motion.inView(this.querySelector('.products-bundle-selection-bar-trigger'), () => {
          this.hideBlur();

          return () => {
            this.showBlur();
          };
        });
      }

      hideBlur() {
        this.classList.add('blur--disabled');
      }

      showBlur() {
        this.classList.remove('blur--disabled');
      }

      get productTabs() {
        return this.closest('.section__wrapper');
      }

      get bundleBarEl() {
        return (this._bundleBarEl = this._bundleBarEl || this.querySelector('.products-bundle-selection__bar'));
      }

      get bundleBarListEl() {
        return (this._bundleBarListEl =
          this._bundleBarListEl || this.bundleBarEl.querySelector('.products-bundle-selection__bar-list'));
      }

      get bundleBarCountEl() {
        return (this._bundleBarCountEl =
          this._bundleBarCountEl || this.bundleBarEl.querySelector('.products-bundle-selection__count'));
      }

      get addToCartButtonEl() {
        return (this._addToCartButtonEl =
          this._addToCartButtonEl || this.bundleBarEl.querySelector('.products-bundle-selection__bar-add'));
      }

      get bunderBarHelpEl() {
        return this.bundleBarEl.querySelector('.products-bundle-selection__bar-help');
      }

      get cartDrawerEl() {
        return document.querySelector('cart-drawer');
      }

      connectedCallback() {
        this.updateButton();

        this.addToCartButtonEl.addEventListener('click', this.onSubmitClick.bind(this));
        this.bundleBarEl.addEventListener('click', this.onClick.bind(this));

        if (this.productTabs.getAttribute('is') === 'product-tabs') {
          this.productTabs.addEventListener('tabChange', this.handleTabChange.bind(this));
        }
      }

      onClick(event) {
        const removeBtn = event.target.closest('.products-bundle-selection__bar-item-remove');
        if (removeBtn) {
          event.preventDefault();

          const variantToRemove = removeBtn.closest('.products-bundle-selection__bar-item');
          const index = variantToRemove.dataset.variantIndex;
          this.removeFromBundle(index);
        }
      }

      handleTabChange(event) {
        const tab = event.detail.selectedTab;
        this.updateAddToBundleButtons(tab);
      }

      async onSubmitClick(event) {
        if (this.getCount() < this.minItems) {
          return;
        }

        this.showErrorMessage();
        this.lastSubmittedElement = event.submitter || event.currentTarget;

        const items = this.variants.map((variant) => ({
          id: parseInt(variant.id, 10),
          quantity: variant.quantity,
        }));

        let sectionsToBundle = [];
        document.documentElement.dispatchEvent(
          new CustomEvent('cart:grouped-sections', { bubbles: true, detail: { sections: sectionsToBundle } })
        );

        const config = FoxTheme.utils.fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        config.body = JSON.stringify({
          sections: sectionsToBundle,
          sections_url: window.location.pathname,
          items: items,
        });

        this.addToCartButtonEl.setAttribute('aria-disabled', 'true');
        this.addToCartButtonEl.classList.add('btn--loading');

        this.handleFormSubmission(config);
      }

      handleFormSubmission = (config) => {
        fetch(`${FoxTheme.routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then(async (parsedState) => {
            if (parsedState.status) {
              this.showErrorMessage(parsedState.description);
              return;
            }

            const cartJson = await (
              await fetch(`${FoxTheme.routes.cart_url}`, { ...FoxTheme.utils.fetchConfig() })
            ).json();
            cartJson['sections'] = parsedState['sections'];

            this.updateCartState(cartJson);
            this.dispatchProductAddedEvent(parsedState);

            this.clearBundle();
            this.showCartDrawer();
          })
          .catch((error) => {
            console.log(error);
          })
          .finally(() => {
            this.addToCartButtonEl.classList.remove('btn--loading');

            if (!this.hasError) {
              this.addToCartButtonEl.removeAttribute('aria-disabled');
            }
          });
      };

      showErrorMessage(errorMessage = false) {
        this.errorMessageElement = this.errorMessageElement || this.querySelector('.product-form__error-message');
        if (this.errorMessageElement) {
          this.errorMessageElement.hidden = !errorMessage;

          if (errorMessage) this.errorMessageElement.textContent = errorMessage;
        } else {
          errorMessage && alert(errorMessage);
        }
      }

      updateCartState = (cartJson) => {
        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: cartJson });
      };

      dispatchProductAddedEvent = (parsedState) => {
        document.dispatchEvent(
          new CustomEvent('product-ajax:added', {
            detail: {
              product: parsedState,
            },
          })
        );
      };

      showCartDrawer = () => {
        this.cartDrawerEl && this.cartDrawerEl.show(this.lastSubmittedElement);
      };

      addToBundle(variant) {
        if (this.getCount() + variant.quantity > this.maxItems) {
          alert(this.dataset.limitMessage);
          return;
        }

        if (this.preventDuplicateItems && this.variants.some((v) => v.productId === variant.productId)) {
          alert(this.dataset.duplicateMessage);
          return;
        }

        this.variants.push(variant);

        this.updateBundleBar();
      }

      updateAddToBundleButtons(context = this) {
        if (!this.preventDuplicateItems) {
          return;
        }

        const forms = context.querySelectorAll('[is="product-bundle-selection"]');
        forms &&
          forms.forEach((form) => {
            const productId = form.dataset.productId;
            let found = false;

            for (const variant of this.variants) {
              if (variant.productId == productId) {
                found = true;
              }
            }

            const submitButton = form.querySelector('button');
            if (found) {
              submitButton.setAttribute('aria-disabled', true);
            } else {
              submitButton.removeAttribute('aria-disabled');
            }
          });
      }

      removeFromBundle(index) {
        if (index >= 0 && index < this.variants.length) {
          this.variants.splice(index, 1);
          this.updateBundleBar();
        }
      }

      clearBundle() {
        this.variants = [];

        this.updateBundleBar();
      }

      updateBundleBar() {
        const rawItems = Array.from(this.rawItems); // Get raw template items.

        this.updateButton();
        this.updateAddToBundleButtons();
        this.bundleBarCountEl.textContent = this.getCount(); // Update count.

        // Update total.
        const totalPrice = this.variants.reduce((sum, variant) => {
          return sum + (variant.price || 0);
        }, 0);
        const totalEl = this.bundleBarEl.querySelector('.products-bundle-selection__bar-total');
        if (totalEl) {
          totalEl.innerHTML = FoxTheme.Currency.formatMoney(totalPrice, FoxTheme.settings.moneyFormat);
        }

        this.bunderBarHelpEl.classList.toggle('hidden', this.getCount() < this.minItems);

        let variantIndex = 0;
        let variant = false;
        let variantRepeatTimes = 0;
        const updatedItems = rawItems.map((item) => {
          const wrapper = item.cloneNode(true);
          wrapper.dataset.variantIndex = variantIndex;

          if (variantRepeatTimes > 0) {
            variantRepeatTimes--;
          } else {
            variant = this.variants[variantIndex];
            variantRepeatTimes = variant ? variant.quantity - 1 : 0;
          }

          if (variantRepeatTimes == 0) {
            variantIndex++;
          }

          if (variant) {
            const contentEl = wrapper.querySelector('.products-bundle-selection__bar-item-content');
            contentEl.innerHTML = '';
            wrapper.classList.remove('is-placeholder');
            wrapper.classList.add('is-product');
            wrapper.setAttribute('data-variant-id', variant.id);
            contentEl.appendChild(variant.thumbnail.cloneNode(true));
          }

          return wrapper;
        });

        this.bundleBarListEl.innerHTML = ''; // Clear current items.
        updatedItems.forEach((el) => this.bundleBarListEl.appendChild(el)); // Append new items.
      }

      getCount() {
        return this.variants.reduce((quantity, item) => quantity + item.quantity, 0);
      }

      updateButton() {
        const buttonTextEl = this.addToCartButtonEl.querySelector('.btn__text');
        const count = this.getCount();
        const remainingItems = this.minItems - count;

        if (count >= this.minItems) {
          this.addToCartButtonEl.removeAttribute('disabled');
          buttonTextEl.textContent = this.dataset.addToCart;
        } else {
          this.addToCartButtonEl.setAttribute('disabled', 'true');
          const textTemplate = remainingItems > 1 ? this.dataset.addFewMore : this.dataset.addOneMore;

          buttonTextEl.textContent = textTemplate.replace('%%count%%', remainingItems);
        }
      }
    }
  );
}

if (!customElements.get('product-bundle-selection')) {
  customElements.define(
    'product-bundle-selection',
    class ProductsBundleSelection extends HTMLFormElement {
      constructor() {
        super();

        this.variantSelect = this.querySelector('select');
        this.variantSelect.addEventListener('change', this.handleVariantChange.bind(this));
        this.addEventListener('submit', this.handleFormSubmit);
      }

      get productTabs() {
        return this.closest('.section__wrapper');
      }

      get bundleSelectionEl() {
        return (this._bundleSelectionEl = this._bundleSelectionEl || this.closest('products-bundle-selection'));
      }

      get submitButtonEl() {
        return (this._submitButtonEl = this._submitButtonEl || this.querySelector('button'));
      }

      get productId() {
        return this.dataset.productId;
      }

      get productUrl() {
        return this.dataset.productUrl;
      }

      get sectionId() {
        return this.bundleSelectionEl.dataset.sectionId;
      }

      connectedCallback() {}

      getProductCardFromSource(html) {
        let tabPanel = html;

        if (this.productTabs.getAttribute('is') === 'product-tabs') {
          const activeIndex = this.productTabs.currentIndex;

          tabPanel = html.querySelector(`.tabs__panel[data-index="${activeIndex}"]`);
          if (!tabPanel) {
            const template = html.querySelector(`template[data-index="${activeIndex}"]`);
            tabPanel = template.content.cloneNode(true).firstElementChild;
          }
        }

        return tabPanel.querySelector(`.product-card__wrapper[data-product-id="${this.productId}"]`);
      }

      handleVariantChange(event) {
        const variantSelect = event.target;
        const productId = variantSelect.closest('.product-card').dataset.productId;
        this.currentOptionIds = variantSelect.options[variantSelect.selectedIndex].dataset.optionsId;
        this.currentVariantId = variantSelect.value;

        fetch(`${this.productUrl.split('?')[0]}?section_id=${this.sectionId}&option_values=${this.currentOptionIds}`)
          .then((response) => response.text())
          .then((responseText) => {
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            const pcardSource = this.getProductCardFromSource(html);
            const pcardDestination = this.closest(`.product-card__wrapper[data-product-id="${this.productId}"]`);

            const updateSourceFromDestination = (selector) => {
              const source = pcardSource.querySelector(selector);
              const destination = pcardDestination.querySelector(selector);
              if (source && destination) {
                destination.replaceWith(source);
              }
            };

            if (pcardSource && pcardDestination) {
              updateSourceFromDestination('.product-card__image-wrapper');
              updateSourceFromDestination('.product-card__info-main');
            }
          })
          .catch((error) => {
            console.error(error);
          });
      }

      handleFormSubmit = (event) => {
        event.preventDefault();

        if (this.submitButtonEl.getAttribute('aria-disabled') == 'true') {
          return;
        }

        const productCard = this.closest('.product-card');
        const thumbnail = productCard.querySelector('.product-card__image-wrapper img').cloneNode(true);
        const variant = this.querySelector('[name="id"]').selectedOptions[0];
        const itemPrice = parseFloat(variant.dataset.price);
        const quantityInput = this.querySelector('[name="quantity"]');
        const quantity = quantityInput && quantityInput.value != '' ? parseInt(quantityInput.value) : 1;

        this.bundleSelectionEl.addToBundle({
          productId: this.dataset.productId,
          id: variant.value,
          thumbnail: thumbnail,
          price: itemPrice,
          quantity: quantity,
        });
      };
    },
    { extends: 'form' }
  );
}

if (!customElements.get('products-bundle-selection-bar-toggle')) {
  customElements.define(
    'products-bundle-selection-bar-toggle',
    class ProductsBundleSelectionBarToggle extends AccordionDetails {
      constructor() {
        super();
      }

      connectedCallback() {
        this.open = !(FoxTheme.config.mqlMobile || FoxTheme.config.mqlTablet);

        document.addEventListener('matchTablet', () => {
          this.open = false;
        });

        document.addEventListener('unmatchTablet', () => {
          this.open = FoxTheme.config.mqlMobile ? false : true;
        });
      }
    },
    { extends: 'details' }
  );
}
