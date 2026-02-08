if (!customElements.get('collection-tabs')) {
  customElements.define(
    'collection-tabs',
    class CollectionTabs extends HTMLElement {
      constructor() {
        super();

        this.tab = this.querySelector('tabs-component');
        this.tabPanels = this.querySelectorAll('[role="tabpanel"]');
        this.tabNavs = this.querySelectorAll('[role="tab"]');
        this.contentWrapper = this.querySelector('.collection-tabs__content');
        this.imagesWrapper = this.querySelector('.collection-tabs__images');
        this.tooltipEl = this.querySelector('.tooltip-element');
        this.alignItems = window.getComputedStyle(this).getPropertyValue('align-items');

        this.init();
      }

      connectedCallback() {
        this.tab.addEventListener('tabChange', (event) => {
          this.handleTabChange(event);
        });
      }

      init() {
        this.handleTooltip(0);
        this.calculatePadding();
        window.addEventListener('resize', this.calculatePadding.bind(this));
      }

      handleTabChange(event) {
        const {selectedIndex} = event.detail;
        this.handleTooltip(selectedIndex);

        this.imagesWrapper.querySelectorAll('.collection-tabs__image').forEach((image) => image.classList.remove('is-active'));
        this.imagesWrapper.querySelector(`.collection-tabs__image[data-index="${selectedIndex}"]`).classList.add('is-active');
      }

      handleTooltip(tabIndex) {
        if (!window.matchMedia("(hover: hover)").matches) return;
        const currentTab = this.tabPanels[tabIndex];
        const productListWrapper = currentTab.querySelector('.collection-tab__products');
        const hoverEls = productListWrapper.querySelectorAll('a');

        hoverEls.forEach((el) => {
          el.addEventListener('mousemove', (e) => {
            const { target } = e;
            const title = target.dataset.title;

            this.tooltipEl.innerHTML = title;

            this.tooltipEl.style.opacity = '1';
            this.tooltipEl.style.top = `${e.clientY - this.tooltipEl.offsetHeight - 5}px`;
            this.tooltipEl.style.left = `${e.clientX}px`;
          });

          el.addEventListener('mouseleave', (e) => {
            this.tooltipEl.style.opacity = '0';
          })
        });
      }

      calculatePadding() {
        const contentHeight = this.contentWrapper.offsetHeight
        const ImageHeight = this.imagesWrapper.offsetHeight
        const diff = Math.abs(ImageHeight - contentHeight);

        if ( this.alignItems === 'center' || diff < 0 ) return;
        this.contentWrapper.style.marginTop = `${diff / 2}px`
      }
    }
  );
}
