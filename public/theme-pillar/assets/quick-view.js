if (!customElements.get('quick-view-modal')) {
  customElements.define(
    'quick-view-modal',
    class QuickViewModal extends DrawerComponent {
      constructor() {
        super();

        this.classesToRemoveOnLoad = 'drawer--loading';
        this.drawerBody = this.querySelector(this.selector);
      }

      get selector() {
        return '.quick-view__content';
      }

      get requiresBodyAppended() {
        return !(Shopify.designMode && this.closest('.section-group-overlay-quick-view'));
      }

      prepareToShow() {
        super.prepareToShow();
        this.quickview();
      }

      handleAfterShow() {
        super.handleAfterShow();
        document.dispatchEvent(
          new CustomEvent('quick-view:open', {
            detail: { productUrl: this.dataset.productUrl },
          })
        );
      }

      handleAfterHide() {
        super.handleAfterHide();
        const drawerContent = this.querySelector(this.selector);
        drawerContent.innerHTML = '';
        this.classList.add(this.classesToRemoveOnLoad);
      }

      getProductQuickViewSectionId() {
        let sectionId = FoxTheme.QuickViewSectionId || false;

        if (!sectionId) {
          // Get section id from overlay groups.
          const productQuickView = document.querySelector('.section-group-overlay-quick-view');
          if (productQuickView) {
            sectionId = FoxTheme.utils.getSectionId(productQuickView);
          }

          // Cache for better performance.
          FoxTheme.QuickViewSectionId = sectionId;
        }

        return sectionId;
      }

      quickview() {
        const drawerContent = this.querySelector(this.selector);
        const sectionId = this.getProductQuickViewSectionId();
        const sectionUrl = `${this.dataset.productUrl.split('?')[0]}?section_id=${sectionId}`;
        fetch(sectionUrl)
          .then((response) => response.text())
          .then((responseText) => {
            const productElement = new DOMParser()
              .parseFromString(responseText, 'text/html')
              .querySelector(this.selector);

            this.setInnerHTML(drawerContent, productElement.innerHTML);
            FoxTheme.a11y.trapFocus(this, this.focusElement);
            if (window.Shopify && Shopify.PaymentButton) {
              Shopify.PaymentButton.init();
            }

            document.dispatchEvent(
              new CustomEvent('quick-view:loaded', {
                detail: { productUrl: this.dataset.productUrl },
              })
            );
          })
          .catch((e) => {
            console.error(e);
          });
      }

      setInnerHTML(element, innerHTML) {
        element.innerHTML = innerHTML;
        element.querySelectorAll('script').forEach((oldScriptTag) => {
          const newScriptTag = document.createElement('script');
          Array.from(oldScriptTag.attributes).forEach((attribute) => {
            newScriptTag.setAttribute(attribute.name, attribute.value);
          });
          newScriptTag.appendChild(document.createTextNode(oldScriptTag.innerHTML));
          oldScriptTag.parentNode.replaceChild(newScriptTag, oldScriptTag);
        });

        this.classList.remove(this.classesToRemoveOnLoad);
      }
    }
  );
}
