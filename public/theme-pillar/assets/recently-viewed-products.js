if (!customElements.get('recently-viewed-products')) {
  customElements.define(
    'recently-viewed-products',
    class RecentlyViewedProducts extends HTMLElement {
      constructor() {
        super();

        if ('requestIdleCallback' in window) {
          requestIdleCallback(this.init.bind(this), { timeout: 1500 });
        } else {
          FoxTheme.Motion.inView(this, this.init.bind(this), { margin: '0px 0px 400px 0px' });
        }
      }

      init() {
        const queryUrl = this.getQueryUrl();
        if (!queryUrl) {
          this.removeSection();
          return;
        }

        fetch(queryUrl)
          .then((response) => response.text())
          .then((responseText) => {
            const sectionInnerHTML = new DOMParser()
              .parseFromString(responseText, 'text/html')
              .querySelector('.shopify-section');

            if (sectionInnerHTML === null) return;

            const recommendations = sectionInnerHTML.querySelector('recently-viewed-products');
            if (recommendations && recommendations.innerHTML.trim().length) {
              const section = recommendations.querySelector('.section');
              section.classList.remove('hidden');

              this.innerHTML = recommendations.innerHTML;
            }

            if (recommendations.querySelector('.product-card')) {
              this.dispatchEvent(new CustomEvent('recommendations:loaded'));
            } else {
              this.removeSection();
              this.dispatchEvent(new CustomEvent('recommendations:empty'));
            }
          })
          .catch((e) => {
            console.error(e);
          });
      }

      getQueryUrl() {
        const items = JSON.parse(window.localStorage.getItem('hypertheme:recently-viewed') || '[]');
        const productId = parseInt(this.dataset.productId);
        const productsToShow = parseInt(this.dataset.productsToShow);

        if (items.includes(productId)) {
          items.splice(items.indexOf(productId), 1);
        }

        if (items.length > 0) {
          const queryParams = items
            .map((item) => 'id:' + item)
            .slice(0, productsToShow)
            .join(' OR ');

          return this.dataset.url + queryParams;
        }

        return false;
      }

      removeSection() {
        this.remove();
      }

      sendTrekkieEvent(numberProducts) {
        if (!window.ShopifyAnalytics || !window.ShopifyAnalytics.lib || !window.ShopifyAnalytics.lib.track) {
          return;
        }
        let didPageJumpOccur = this.getBoundingClientRect().top <= window.innerHeight;

        window.ShopifyAnalytics.lib.track('Recently Viewed Products Displayed', {
          theme: Shopify.theme.name,
          didPageJumpOccur: didPageJumpOccur,
          numberOfRecommendationsDisplayed: numberProducts,
        });
      }
    }
  );
}
