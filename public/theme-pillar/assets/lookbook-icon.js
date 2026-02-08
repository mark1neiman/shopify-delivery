if (!customElements.get('lookbook-icon')) {
  customElements.define(
    'lookbook-icon',
    class LookbookIcon extends HTMLElement {
      constructor() {
        super();

        this.selectors = {
          cardContainer: '.lookbook-card',
          cardProduct: '.lookbook-icon__card',
        };

        this.cardContainer = this.closest(this.selectors.cardContainer);
        this.cardProduct = this.querySelector(this.selectors.cardProduct);

        this.init();
        document.addEventListener('matchMobile', () => {
          this.init();
        });
        document.addEventListener('unmatchMobile', () => {
          this.init();
        });
        this.addEventListener('mouseover', this.init.bind(this));
      }

      disconnectedCallback() {
        this.removeEventListener('mouseover', this.init.bind(this));
      }

      init() {
        this.classes = '';
        if (this.cardProduct) {
          this.cardContainerOffsetX = this.cardContainer.getBoundingClientRect().left;
          this.cardContainerOffsetY = this.cardContainer.getBoundingClientRect().top;

          this.offsetX = this.getBoundingClientRect().left - this.cardContainerOffsetX;
          this.offsetY = this.getBoundingClientRect().top - this.cardContainerOffsetY;

          this.width = this.clientWidth
          this.cardWidth = this.cardProduct.clientWidth;
          this.cardHeight = this.cardProduct.clientHeight;
          this.wrapperWidth = this.cardContainer.clientWidth
          this.wrapperHeight = this.cardContainer.clientHeight

          this.cardPosition = this.offsetY > this.cardHeight ? 'top' : 'bottom'

          if ((this.offsetX + this.width) > this.cardWidth) {
            this.cardPosition += '-left'
          } else if ((this.wrapperWidth - this.offsetX) > this.cardWidth) {
            this.cardPosition += '-right'
          }

          this.dataset.position = this.cardPosition;
        }

        if (Shopify.designMode) {
          this.addEventListener('shopify:block:select', () => {
            this.cardProduct.style.transition = 'none';
            this.classList.add('is-active');
          });

          this.addEventListener('shopify:block:deselect', () => {
            this.classList.remove('is-active');
          });
        }
      }
    }
  );
}
