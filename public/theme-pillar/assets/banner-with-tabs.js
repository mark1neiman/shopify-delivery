if (!customElements.get('banner-with-tabs')) {
  class BannerWithTabs extends TabsComponent {
    constructor() {
      super();
      this.totalItems = this.buttons.length;
      this.addEventListener('tabChange', this.handleTabChange.bind(this));
      this.sectionId = this.dataset.sectionId;
      this.section = document.querySelector(`.section-${this.sectionId}`);

      if (Shopify.designMode) {
        document.addEventListener('shopify:block:select', (e) => {
          if (e.detail.sectionId != this.sectionId) return;
          let { target } = e;
          const index = Number(target.dataset.index);
          this.setActiveTab(index);
        });
      }
    }

    get panels() {
      return Array.from(this.domNodes.tabPanels);
    }

    get banners() {
      return Array.from(this.section.querySelectorAll('.banner-with-tabs__banner'));
    }

    handleTabChange(e) {
      this.priorityItems = {};
      const { tabPanels } = this.domNodes;

      tabPanels.forEach((panel) => {
        panel.classList.remove('active');
      });

      this.banners.forEach((banner) => {
        banner.classList.remove('active');
      });

      e.detail.selectedTab.classList.add('active');
      this.banners[e.detail.selectedIndex].classList.add('active');

      this.findSiblingItems();
      this.setStyle();
    }

    findSiblingItems() {
      this.panels.forEach((panel) => {
        panel.classList.remove('prev-item', 'next-item');
      });

      this.prevItemsLength = this.selectedTab.dataset.index;
      this.nextItemsLength = this.totalItems - this.selectedTab.dataset.index - 1 || 0;

      if (this.prevItemsLength > 0) {
        for (let i=0; i < this.prevItemsLength; i++) {
          this.panels[i].classList.add('prev-item');
        }
      }

      if (this.nextItemsLength > 0) {
        for (let i=0; i < this.nextItemsLength; i++) {
          const index = this.totalItems - i - 1;
          this.panels[index].classList.add('next-item');
        }
      }

      this.prevItems = this.querySelectorAll('.prev-item');
      this.nextItems = this.querySelectorAll('.next-item');

      this.prevItems.forEach((item,i) => {
        const index = this.nextItemsLength + i + 1;
        this.priorityItems[index] = {type: 'prev', item: item};
      });
      this.nextItems.forEach((item,i) => {
        this.priorityItems[i+1] = {type: 'next', item: item};
      });
      this.priorityItems[0] = {type: 'active', item: this.selectedTab};
    }

    setStyle() {
      for (const [i, obj] of Object.entries(this.priorityItems)) {
        const index = parseInt(i);
        const { type, item } = obj
        const transform = `translate3d(0, ${index * 22}px, 0) scale(${1 - index * 0.07})`;

        item.style.setProperty('--card-transform', transform);
        item.style.setProperty('--card-z-index', Object.entries(this.priorityItems).length - index + 1);
      }
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (name === 'data-selected' && oldValue !== null && oldValue !== newValue) {
        const fromElement = this.section.querySelector(`.banner-with-tabs__banner[data-index="${oldValue}"]`);
        const toElement = this.section.querySelector(`.banner-with-tabs__banner[data-index="${newValue}"]`);

        setTimeout(() => {
          if (toElement.classList.contains('active')) {
            const motionEls = toElement.querySelectorAll('motion-element');
            motionEls.forEach((motionEl) => {
              setTimeout(() => {
                motionEl && motionEl.refreshAnimation();
              });
            });
          }
        });
      }
    }
  }
  customElements.define('banner-with-tabs', BannerWithTabs);
}
