if (!customElements.get('image-cards')) {
  customElements.define(
    'image-cards',
    class ImageCards extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.selectors = {
          sliderWrapper: '.image-cards__inner',
          nextEl: '.swiper-button-next',
          prevEl: '.swiper-button-prev',
          pagination: '.swiper-pagination',
        };
        this.classes = {
          grid: 'f-grid',
          swiper: 'swiper',
          swiperWrapper: 'swiper-wrapper',
        };

        this.sectionId = this.dataset.sectionId;
        this.sectionEl = this.closest(`.section-${this.sectionId}`);
        this.sliderWrapper = this.querySelector(this.selectors.sliderWrapper);

        this.enableSlider = this.dataset.enableSlider === 'true';
        this.items = parseInt(this.dataset.items);
        this.tabletItems = parseInt(this.dataset.tabletItems);
        this.laptopItems = parseInt(this.dataset.laptopItems);
        this.paginationType = this.dataset.paginationType || 'bullets';

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
      }

      initSlider() {
        if (typeof this.sliderInstance === 'object') return;
        const columnGap = window.getComputedStyle(this.sliderWrapper).getPropertyValue('--f-column-gap');
        const spaceBetween = parseFloat(columnGap.replace('rem', '')) * 10;

        this.sliderOptions = {
          slidesPerView: 2,
          spaceBetween: spaceBetween,
          navigation: {
            nextEl: this.sectionEl.querySelector(this.selectors.nextEl),
            prevEl: this.sectionEl.querySelector(this.selectors.prevEl),
          },
          pagination: {
            el: this.sectionEl.querySelector(this.selectors.pagination),
            type: this.paginationType,
          },
          breakpoints: {
            768: {
              slidesPerView: this.tabletItems,
            },
            1024: {
              slidesPerView: this.laptopItems,
            },
            1280: {
              slidesPerView: this.items,
            },
          },
          loop: false,
          threshold: 2,
          watchSlidesProgress: true,
          mousewheel: {
            enabled: true,
            forceToAxis: true,
          },
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
