if (!customElements.get('multiple-product-bundles')) {
  customElements.define(
    'multiple-product-bundles',
    class MultipleProductBundles extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.selectors = {
          sliderWrapper: '.multiple-product-bundles__inner',
          nextEl: '.section__header .swiper-button-next',
          prevEl: '.section__header .swiper-button-prev',
        };
        this.classes = {
          grid: 'f-grid',
          swiper: 'swiper',
          swiperWrapper: 'swiper-wrapper',
        };

        this.sectionId = this.dataset.sectionId;
        this.section = document.querySelector(`.section-${this.sectionId}`);
        this.sliderWrapper = this.querySelector(this.selectors.sliderWrapper);

        this.enableSlider = this.dataset.enableSlider === 'true';
        this.total = parseInt(this.dataset.total);
        this.items = parseInt(this.dataset.items);
        this.tabletItems = parseInt(this.dataset.tabletItems);

        this.sliderInstance = false;

        this.init();
        Array.from([FoxTheme.config.mediaQueryMobile, FoxTheme.config.mediaQueryTablet]).forEach((mediaQuery) => {
          const mql = window.matchMedia(mediaQuery);
          mql.onchange = this.init.bind(this);
        });
      }

      init() {
        if (FoxTheme.config.mqlMobile) {
          this.enableSlider = false;
        } else if (FoxTheme.config.mqlTablet) {
          this.enableSlider = this.total > this.tabletItems ? true : false;
        } else {
          this.enableSlider = this.dataset.enableSlider === 'true';
        }

        this.enableSlider ? this.initSlider() : this.destroySlider();
      }

      initSlider() {
        if (typeof this.sliderInstance === 'object') return;
        const columnGap = window.getComputedStyle(this.sliderWrapper).getPropertyValue('--f-column-gap');
        const spaceBetween = parseFloat(columnGap.replace('rem', '')) * 10;

        this.sliderOptions = {
          slidesPerView: 1,
          spaceBetween: spaceBetween,
          navigation: {
            nextEl: this.section.querySelector(this.selectors.nextEl),
            prevEl: this.section.querySelector(this.selectors.prevEl),
          },
          loop: false,
          threshold: 2,
          watchSlidesProgress: true,
          mousewheel: {
            enabled: true,
            forceToAxis: true,
          },
          breakpoints: {
            768: {
              slidesPerView: this.tabletItems
            },
            1024: {
              slidesPerView: this.items
            }
          }
        };

        this.classList.add(this.classes.swiper);
        this.sliderWrapper.classList.remove(this.classes.grid);
        this.sliderWrapper.classList.add(this.classes.swiperWrapper);

        this.sliderInstance = new window.FoxTheme.Carousel(this, this.sliderOptions, [FoxTheme.Swiper.Mousewheel]);
        this.sliderInstance.init();

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
        this.sliderWrapper.classList.add(this.classes.grid);
        if (typeof this.sliderInstance !== 'object') return;
        this.sliderInstance.slider.destroy();
        this.sliderInstance = false;
      }
    }
  );
}
