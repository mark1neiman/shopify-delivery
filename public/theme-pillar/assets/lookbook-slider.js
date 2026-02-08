if (!customElements.get('lookbook-slider')) {
  customElements.define(
    'lookbook-slider',
    class LookbookSlider extends HTMLElement {
      constructor() {
        super();
      }
      connectedCallback() {
        this.selectors = {
          sliderWrapper: '.lookbook-slider__items',
          nextEl: '.swiper-button-next',
          prevEl: '.swiper-button-prev',
          pagination: '.swiper-pagination',
        };

        this.classes = {
          swiper: 'swiper',
          swiperWrapper: 'swiper-wrapper',
        };

        this.sectionId = this.dataset.sectionId;
        this.section = this.closest(`.section-${this.sectionId}`);
        this.sliderWrapper = this.querySelector(this.selectors.sliderWrapper);
        this.paginationType = this.dataset.paginationType || 'bullets';
        this.enableSlider = this.dataset.enableSlider === 'true';

        this.sliderInstance = false;

        if (!this.enableSlider) return;
        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = this.init.bind(this);
        this.init();
      }

      init() {
        if (FoxTheme.config.mqlMobile) {
          this.destroySlider();
        } else {
          this.initSlider();
        }

        this.calculateItemsWidth();
      }

      initSlider() {
        this.sliderOptions = {
          slidesPerView: 'auto',
          navigation: {
            nextEl: this.section.querySelector(this.selectors.nextEl),
            prevEl: this.section.querySelector(this.selectors.prevEl),
          },
          pagination: {
            el: this.section.querySelector(this.selectors.pagination),
            type: this.paginationType,
          },
          loop: false,
          threshold: 2,
          mousewheel: {
            enabled: true,
            forceToAxis: true,
          },
          watchSlidesProgress: true,
        };

        if (typeof this.sliderInstance !== 'object') {
          this.classList.add(this.classes.swiper);
          this.sliderWrapper.classList.add(this.classes.swiperWrapper);
          this.sliderInstance = new window.FoxTheme.Carousel(this, this.sliderOptions, [FoxTheme.Swiper.Mousewheel]);
          this.sliderInstance.init();

          // const focusableElements = FoxTheme.a11y.getFocusableElements(this);

          // focusableElements.forEach((element) => {
          //   element.addEventListener('focusin', () => {
          //     const slide = element.closest('.swiper-slide');
          //     this.sliderInstance.slider.slideTo(this.sliderInstance.slider.slides.indexOf(slide));
          //   });
          // });
        }
        if (Shopify.designMode && typeof this.sliderInstance === 'object') {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId != this.sectionId) return;
            let { target } = e;
            const index = Number(target.dataset.index);

            this.sliderInstance.slider.slideTo(index);
          });
        }
      }

      destroySlider() {
        this.classList.remove(this.classes.swiper);
        this.sliderWrapper.classList.remove(this.classes.swiperWrapper);
        if (typeof this.sliderInstance !== 'object') return;
        this.sliderInstance.slider.destroy();
        this.sliderInstance = false;
      }

      calculateItemsWidth() {
        Array.from(this.sliderWrapper.children).forEach((item) => {
          const width = item.dataset.width;
          const widthMobile = item.dataset.widthMobile;
          item.style.setProperty('--item-width', width);
          item.style.setProperty('--item-width-mobile', widthMobile);
        });
      }
    }
  );
}

if (!customElements.get('lookbook-scroll-progress-bar')) {
  customElements.define(
    'lookbook-scroll-progress-bar',
    class LookbookScrollProgressBar extends ScrollProgressBar {
      get totalWidth() {
        this.allChildren = this.target.children;

        let totalWidth = 0;
        [...this.allChildren].forEach((child) => {
          totalWidth += child.offsetWidth;
        });

        return totalWidth;
      }
    }
  );
}
