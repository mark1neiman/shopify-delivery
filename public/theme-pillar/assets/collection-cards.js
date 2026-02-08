if (!customElements.get('collection-cards')) {
  customElements.define(
    'collection-cards',
    class CollectionCards extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.selectors = {
          cardsWrap: '.collection-cards__inner',
          nextEl: '.swiper-button-next',
          prevEl: '.swiper-button-prev',
        };

        this.classes = {
          grid: 'f-grid',
          swiper: 'swiper',
          swiperWrapper: 'swiper-wrapper',
        };

        this.sectionId = this.dataset.sectionId;
        this.section = this.closest(`.section-${this.sectionId}`);
        this.enableSlider = this.dataset.enableSlider === 'true';
        this.items = parseInt(this.dataset.items) || 2;
        this.tabletItems = parseInt(this.dataset.tabletItems) || 2;
        this.totalItems = parseInt(this.dataset.totalItems) || 0;
        this.cardsWrap = this.querySelector(this.selectors.cardsWrap);

        this.sliderInstance = false;
        if (!this.enableSlider) return;

        if (!this.cardsWrap) return;

        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = this.init.bind(this);

        const mqlTablet = window.matchMedia(FoxTheme.config.mediaQueryTablet);
        mqlTablet.onchange = this.init.bind(this);

        this.init();
      }

      init() {
        if (FoxTheme.config.mqlMobile) {
          this.destroySlider();
        } else {
          const currentItems = FoxTheme.config.mqlTablet ? this.tabletItems : this.items;

          if (this.totalItems > currentItems) {
            this.initSlider();
          } else {
            this.destroySlider();
          }
        }
      }

      initSlider() {
        if (typeof this.sliderInstance === 'object') return;

        const columnGap = window.getComputedStyle(this.cardsWrap).getPropertyValue('--f-column-gap');
        const spaceBetween = parseFloat(columnGap.replace('rem', '')) * 10;

        this.sliderOptions = {
          slidesPerView: 2,
          spaceBetween: spaceBetween,
          navigation: {
            nextEl: this.section.querySelector(this.selectors.nextEl),
            prevEl: this.section.querySelector(this.selectors.prevEl),
          },
          breakpoints: {
            768: {
              slidesPerView: this.tabletItems,
            },
            1024: {
              slidesPerView: this.items,
            },
          },
          loop: false,
          threshold: 2,
          mousewheel: {
            enabled: true,
            forceToAxis: true,
          },
        };

        this.classList.add(this.classes.swiper);
        this.cardsWrap.classList.remove(this.classes.grid);
        this.cardsWrap.classList.add(this.classes.swiperWrapper);

        this.sliderInstance = new window.FoxTheme.Carousel(this, this.sliderOptions, [FoxTheme.Swiper.Mousewheel]);
        this.sliderInstance.init();
        this.handleAccessibility();
      }

      handleAccessibility() {
        const focusableElements = FoxTheme.a11y.getFocusableElements(this);

        focusableElements.forEach((element) => {
          element.addEventListener('focusin', (event) => {
            if (event.relatedTarget !== null) {
              if (element.closest('.swiper-slide')) {
                const slide = element.closest('.swiper-slide');
                this.sliderInstance.slider.slideTo(this.sliderInstance.slider.slides.indexOf(slide));
              }
            } else {
              element.blur();
            }
          });
        });

        if (Shopify.designMode) {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId !== this.sectionId) return;
            const index = Number(e.target.dataset.index);
            this.sliderInstance.slider.slideTo(index);
          });
        }
      }

      destroySlider() {
        this.classList.remove(this.classes.swiper);
        this.cardsWrap.classList.remove(this.classes.swiperWrapper);
        this.cardsWrap.classList.add(this.classes.grid);
        if (typeof this.sliderInstance !== 'object') return;
        this.sliderInstance.slider.destroy();
        this.sliderInstance = false;
      }
    }
  );
}
