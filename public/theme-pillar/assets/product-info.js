if (!customElements.get('product-info')) {
  customElements.define(
    'product-info',
    class ProductInfo extends HTMLElement {
      abortController = undefined;
      onVariantChangeUnsubscriber = undefined;
      pendingRequestUrl = null;
      preProcessHtmlCallbacks = [];
      postProcessHtmlCallbacks = [];

      constructor() {
        super();
      }

      get variantSelectors() {
        return this.querySelector('variant-selects');
      }

      get productId() {
        return this.getAttribute('data-product-id');
      }

      get sectionId() {
        return this.dataset.originalSection || this.dataset.section;
      }

      get pickupAvailability() {
        return this.querySelector(`pickup-availability`);
      }

      get quantityInput() {
        return this.querySelector('quantity-input input');
      }

      connectedCallback() {
        this.initializeProductSwapUtility();

        this.onVariantChangeUnsubscriber = FoxTheme.pubsub.subscribe(
          FoxTheme.pubsub.PUB_SUB_EVENTS.optionValueSelectionChange,
          this.handleOptionValueChange.bind(this)
        );

        this.initQuantityHandlers();

        this.currentVariant = this.getSelectedVariant(this);
        if (this.currentVariant) {
          this.updateMedia(this.currentVariant);
        }
      }

      disconnectedCallback() {
        this.onVariantChangeUnsubscriber();
      }

      initializeProductSwapUtility() {
        this.postProcessHtmlCallbacks.push((newNode) => {
          window?.Shopify?.PaymentButton?.init();
          window?.ProductModel?.loadShopifyXR();
        });
      }

      handleOptionValueChange({ data: { event, target, selectedOptionValues } }) {
        if (!this.contains(event.target)) return;

        this.resetProductFormState();

        const productUrl = target.dataset.productUrl || this.pendingRequestUrl || this.dataset.url;
        const shouldSwapProduct = this.dataset.url !== productUrl;
        const shouldFetchFullPage = this.dataset.updateUrl === 'true' && shouldSwapProduct;
        const viewMode = this.dataset.viewMode || 'main-product';

        this.renderProductInfo({
          requestUrl: this.buildRequestUrlWithParams(productUrl, selectedOptionValues, shouldFetchFullPage),
          targetId: target.id,
          callback: shouldSwapProduct
            ? this.handleSwapProduct(productUrl, shouldFetchFullPage, viewMode)
            : this.handleUpdateProductInfo(productUrl, viewMode),
        });
      }

      get productForm() {
        return this.querySelector('form[is="product-form"');
      }

      resetProductFormState() {
        const productForm = this.productForm;
        productForm?.resetFormState();
      }

      handleSwapProduct(productUrl, updateFullPage, viewMode) {
        return (html) => {
          const quickView = html.querySelector('#MainProduct-quick-view__content');
          if (quickView && viewMode === 'quick-view') {
            html = quickView.content.cloneNode(true);
          }
          const selector = updateFullPage ? "product-info[id^='MainProduct']" : 'product-info';
          const variant = this.getSelectedVariant(html.querySelector(selector));

          this.updateURL(productUrl, variant?.id);

          if (updateFullPage) {
            document.querySelector('head title').innerHTML = html.querySelector('head title').innerHTML;
            HTMLUpdateUtility.viewTransition(
              document.querySelector('main'),
              html.querySelector('main'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
            HTMLUpdateUtility.viewTransition(
              document.getElementById('shopify-section-sticky-atc-bar'),
              html.getElementById('shopify-section-sticky-atc-bar'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          } else {
            HTMLUpdateUtility.viewTransition(
              this,
              html.querySelector('product-info'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          }

          this.currentVariant = variant;
        };
      }

      handleUpdateProductInfo(productUrl, viewMode) {
        return (html) => {
          const quickView = html.querySelector('#MainProduct-quick-view__content');
          if (quickView && viewMode === 'quick-view') {
            html = quickView.content.cloneNode(true);
          }
          const variant = this.getSelectedVariant(html);

          this.pickupAvailability?.update(variant);
          this.updateOptionValues(html);
          this.updateURL(productUrl, variant?.id);
          this.updateShareUrl(variant?.id);
          this.updateVariantInputs(variant?.id);

          if (!variant) {
            this.setUnavailable();
            return;
          }

          this.updateMedia(variant);

          const updateSourceFromDestination = (id, shouldHide = (source) => false) => {
            const source = html.getElementById(`${id}-${this.sectionId}`);
            const destination = this.querySelector(`#${id}-${this.dataset.section}`);
            if (source && destination) {
              destination.innerHTML = source.innerHTML;
              destination.classList.toggle('hidden', shouldHide(source));
            }
          };

          updateSourceFromDestination('price');
          updateSourceFromDestination('Sku', ({ classList }) => classList.contains('hidden'));
          updateSourceFromDestination('Barcode', ({ classList }) => classList.contains('hidden'));
          updateSourceFromDestination('Inventory', ({ innerText }) => innerText === '');
          updateSourceFromDestination('Badges', ({ classList }) => classList.contains('hidden'));
          updateSourceFromDestination('PricePerItem', ({ classList }) => classList.contains('hidden'));
          updateSourceFromDestination('Volume');

          this.updateQuantityRules(this.sectionId, this.productId, html);
          this.querySelector(`#QuantityRules-${this.dataset.section}`)?.classList.remove('hidden');
          this.querySelector(`#VolumeNote-${this.dataset.section}`)?.classList.remove('hidden');

          HTMLUpdateUtility.viewTransition(
            document.querySelector(`#SizeChart-${this.sectionId}`),
            html.querySelector(`#SizeChart-${this.sectionId}`),
            this.preProcessHtmlCallbacks,
            this.postProcessHtmlCallbacks
          );

          const addButtonUpdated = html.getElementById(`ProductSubmitButton-${this.sectionId}`);
          this.toggleAddButton(
            addButtonUpdated ? addButtonUpdated.hasAttribute('disabled') : true,
            FoxTheme.variantStrings.soldOut
          );

          document.dispatchEvent(
            new CustomEvent('variant:changed', {
              detail: {
                variant: this.currentVariant,
              },
            })
          );

          FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, {
            data: {
              sectionId: this.sectionId,
              html,
              variant,
            },
          });
        };
      }

      buildRequestUrlWithParams(url, optionValues, shouldFetchFullPage = false) {
        const params = [];

        !shouldFetchFullPage && params.push(`section_id=${this.sectionId}`);

        if (optionValues.length) {
          params.push(`option_values=${optionValues.join(',')}`);
        }

        return `${url}?${params.join('&')}`;
      }

      getSelectedVariant(productInfoNode) {
        const selectedVariant = productInfoNode.querySelector('variant-selects [data-selected-variant]')?.innerHTML;
        return !!selectedVariant ? JSON.parse(selectedVariant) : null;
      }

      renderProductInfo({ requestUrl, targetId, callback }) {
        this.abortController?.abort();
        this.abortController = new AbortController();

        fetch(requestUrl, { signal: this.abortController.signal })
          .then((response) => response.text())
          .then((responseText) => {
            this.pendingRequestUrl = null;
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            callback(html);
          })
          .then(() => {
            // set focus to last clicked option value
            document.querySelector(`#${targetId}`)?.focus();
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              console.log('Fetch aborted by user');
            } else {
              console.error(error);
            }
          });
      }

      updateOptionValues(html) {
        const variantSelects = html.querySelector('variant-selects');
        if (variantSelects) {
          HTMLUpdateUtility.viewTransition(this.variantSelectors, variantSelects, this.preProcessHtmlCallbacks);
        }
      }

      updateURL(url, variantId) {
        if (this.dataset.updateUrl === 'false') return;
        window.history.replaceState({}, '', `${url}${variantId ? `?variant=${variantId}` : ''}`);
      }

      updateVariantInputs(variantId) {
        document
          .querySelectorAll(`#product-form-${this.dataset.section}, #product-form-installment-${this.dataset.section}`)
          .forEach((productForm) => {
            const input = productForm.querySelector('input[name="id"]');
            input.value = variantId ?? '';
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
      }

      updateMedia(variant) {
        const productMedia = this.querySelector(`[id^="MediaGallery-${this.dataset.section}"]`);
        if (!productMedia) return; // Early return if productMedia is not found

        const setActiveMedia = () => {
          if (typeof productMedia.setActiveMedia === 'function') {
            productMedia.init();
            productMedia.setActiveMedia(variant);
            return true; // Indicate success
          }
          return false; // Indicate failure
        };

        if (!setActiveMedia()) {
          this.timer = setInterval(() => {
            if (setActiveMedia()) {
              clearInterval(this.timer);
            }
          }, 100);
        }
      }

      updateShareUrl(variantId) {
        if (!variantId) return;
        const shareButton = document.getElementById(`ProductShare-${this.dataset.section}`);
        if (!shareButton || !shareButton.updateUrl) return;
        shareButton.updateUrl(`${window.shopUrl}${this.dataset.url}?variant=${variantId}`);
      }

      toggleAddButton(disable = true, text, modifyClass = true) {
        const productForm = document.getElementById(`product-form-${this.dataset.section}`);
        if (!productForm) return;
        const addButton = productForm.querySelector('[name="add"]');
        const addButtonText = productForm.querySelector('[name="add"] > span');
        if (!addButton) return;

        if (disable) {
          addButton.setAttribute('disabled', 'disabled');
          if (text) addButtonText.textContent = text;
        } else {
          addButton.removeAttribute('disabled');
          addButtonText.innerHTML = FoxTheme.variantStrings.addToCart;
        }

        if (!modifyClass) return;
      }

      setUnavailable() {
        this.toggleAddButton(true, FoxTheme.variantStrings.unavailable);
        const price = document.getElementById(`price-${this.dataset.section}`);
        const inventory = document.getElementById(`Inventory-${this.dataset.section}`);
        const sku = document.getElementById(`Sku-${this.dataset.section}`);

        if (price) price.classList.add('hidden');
        if (inventory) inventory.classList.add('hidden');
        if (sku) sku.classList.add('hidden');
      }

      initQuantityHandlers() {
        if (!this.quantityInput) return;

        this.setQuantityBoundries();
        if (!this.hasAttribute('data-original-section')) {
          this.cartUpdateUnsubscriber = FoxTheme.pubsub.subscribe(
            FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate,
            this.fetchQuantityRules.bind(this)
          );
        }
      }

      setQuantityBoundries() {
        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.quantityBoundries, {
          data: {
            sectionId: this.sectionId,
            productId: this.productId,
          },
        });
      }

      fetchQuantityRules() {
        const currentVariantId = this.productForm?.productIdInput?.value;
        if (!currentVariantId) return;

        this.querySelector('.quantity__rules-cart')?.classList.add('btn--loading');

        fetch(`${this.getAttribute('data-url')}?variant=${currentVariantId}&section_id=${this.sectionId}`)
          .then((response) => response.text())
          .then((responseText) => {
            const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
            this.updateQuantityRules(this.sectionId, this.productId, parsedHTML);
          })
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            this.querySelector('.quantity__rules-cart')?.classList.remove('btn--loading');
          });
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
    }
  );
}

if (!customElements.get('product-promotion-alert')) {
  customElements.define(
    'product-promotion-alert',
    class ProductPromotionAlert extends HTMLElement {
      constructor() {
        super();

        this.abortController = new AbortController();
        this.buttonEl = this.querySelector('button');
        this.buttonEl.addEventListener('click', this.onClick.bind(this), {
          signal: this.abortController.signal,
        });
      }

      onClick(evt) {
        evt.preventDefault();

        this.closest('.product__block').classList.add('hidden');
      }

      disconnectedCallback() {
        this.abortController.abort();
      }
    }
  );
}
