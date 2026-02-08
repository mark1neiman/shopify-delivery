if (!customElements.get('quick-comparison-table')) {
  customElements.define(
    'quick-comparison-table',
    class QuickComparisonTable extends HTMLElement {
      constructor() {
        super();

        if ('requestIdleCallback' in window) {
          requestIdleCallback(this.init.bind(this), { timeout: 1500 });
        } else {
          FoxTheme.Motion.inView(this, this.init.bind(this), { margin: '0px 0px 400px 0px' });
        }
      }

      init() {
        fetch(this.dataset.url)
          .then((response) => response.text())
          .then((responseText) => {
            const sectionInnerHTML = new DOMParser()
              .parseFromString(responseText, 'text/html')
              .querySelector('.shopify-section');

            if (sectionInnerHTML === null) return;

            const recommendations = sectionInnerHTML.querySelector('quick-comparison-table');
            if (recommendations && recommendations.innerHTML.trim().length) {
              this.innerHTML = recommendations.innerHTML;
            }

            if (recommendations.querySelector('.quick-comparison-table-container')) {
              this.dispatchEvent(new CustomEvent('quick-comparison-table:loaded'));
            } else {
              this.closest('.shopify-section').remove();
              this.dispatchEvent(new CustomEvent('quick-comparison-table:empty'));
            }
          })
          .catch((e) => {
            console.error(e);
          });
      }
    }
  );
}
