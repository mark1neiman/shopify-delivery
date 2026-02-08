if (!customElements.get('product-tabs')) {
  customElements.define(
    'product-tabs',
    class ProductTabs extends HTMLDivElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.sectionId = this.dataset.sectionId;
        this.tabPanels = this.querySelector('.tabs__panels');
        this.tabBtns = this.querySelectorAll('.tabs__btn');
        this.currentIndex = 0;
        this.init();
      }

      init() {
        this.tabBtns.forEach((btn) => {
          btn.addEventListener('click', this.onClick.bind(this));
        });

        if (Shopify.designMode) {
          this.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId != this.sectionId) return;
            let { target } = e;
            const index = Number(target.dataset.index);

            this.setActiveTab(index);
          });
        }
      }

      onClick(e) {
        e.preventDefault();
        const { target } = e;
        const button = target.closest('button');
        const index = Number(button.dataset.index);
        this.setActiveTab(index);
      }

      setActiveTab(index) {
        if (this.currentIndex === index) return;

        let newTab, newBtn, currentItem;

        currentItem = this.tabBtns[this.currentIndex];
        newBtn = this.tabBtns[index];

        currentItem.classList.remove('active');
        newBtn.classList.add('active');

        const tabPanel = this.tabPanels.querySelectorAll('.tabs__panel');
        tabPanel.forEach((panel) => {
          panel.hidden = true;
        });

        newTab = this.tabPanels.querySelector(`.tabs__panel[data-index="${index}"]`);

        if (!newTab) {
          const template = this.tabPanels.querySelector(`template[data-index="${index}"]`);
          newTab = template.content.cloneNode(true).firstElementChild;
          this.tabPanels.appendChild(newTab);
        }
        const translateY = FoxTheme.config.motionReduced ? 0 : 2.5;

        FoxTheme.Motion.animate(newTab, { transform: `translateY(${translateY}rem)`, opacity: 0.01 }, { duration: 0 });

        newTab.hidden = false;
        this.fixBlurryImagesOnSafari(newTab);

        setTimeout(() => {
          FoxTheme.Motion.animate(
            newTab,
            { transform: 'translateY(0)', opacity: 1 },
            { duration: 0.5, delay: this.animationDelay, easing: [0, 0, 0.3, 1] }
          );
        }, 50);

        this.currentIndex = index;

        this.dispatchEvent(
          new CustomEvent('tabChange', {
            bubbles: true,
            detail: { selectedIndex: index, selectedTab: newTab },
          })
        );
      }

      /**
       * Fix for Safari 15.6: force images to reload with correct size after becoming visible
       * @param {*} container
       * @returns
       */
      fixBlurryImagesOnSafari(tab) {
        const isOldSafari =
          /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && navigator.userAgent.includes('Version/15.');

        if (!isOldSafari) return;

        if (tab.classList.contains('images-loaded')) return;
        tab.classList.add('images-loaded');

        const images = tab.querySelectorAll('img[srcset]');
        images.forEach((img) => {
          const src = img.currentSrc || img.src;
          img.srcset = img.srcset; // Trick to trigger evaluation.
          img.src = ''; // Force reload.
          img.src = src;
        });
      }
    },
    { extends: 'div' }
  );
}
