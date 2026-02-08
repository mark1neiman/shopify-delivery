if (!customElements.get('collection-item-slider')) {
  customElements.define(
    'collection-item-slider',
    class CollectionItemSlider extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.enableSlider = this.dataset.enableSlider === 'true';
        this.enableSliderMobile = this.dataset.enableSliderMobile === 'true';
        if (!this.enableSlider && !this.enableSliderMobile) return;

        this.selectors = {
          productsWrap: '.collection-item-slider__products-wrap',
          products: '.collection-item-slider__products',
        };

        this.classes = {
          grid: 'f-grid',
          swiper: 'swiper',
          swiperWrapper: 'swiper-wrapper',
        };

        this.productsWrap = this.querySelector(this.selectors.productsWrap);
        this.products = this.querySelector(this.selectors.products);
        this.sliderInstance = false;
        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = this.init.bind(this);
        this.init();
      }

      init() {
        if (FoxTheme.config.mqlMobile) {
          if (this.enableSliderMobile) {
            this.initSlider();
          } else {
            this.destroySlider();
          }
        } else {
          if (this.enableSlider) {
            this.initSlider();
          } else {
            this.destroySlider();
          }
        }
      }
      

      initSlider() {
        if (typeof this.sliderInstance === 'object') return;

        const items = parseInt(this.dataset.items);
        const columnGap = window.getComputedStyle(this.products).getPropertyValue('--f-column-gap');
        const spaceBetween = parseFloat(columnGap.replace('rem', '')) * 10;

        this.sliderOptions = {
          slidesPerView: 'auto',
          spaceBetween: spaceBetween,
          breakpoints: {
            768: {
              slidesPerView: items,
            },
          },
          navigation: {
            nextEl: this.querySelector('.swiper-button-next'),
            prevEl: this.querySelector('.swiper-button-prev'),
          },
          loop: true,
          threshold: 2,
        };

        this.productsWrap.classList.add(this.classes.swiper);
        this.products.classList.remove(this.classes.grid);
        this.products.classList.add(this.classes.swiperWrapper);
        this.sliderInstance = new window.FoxTheme.Carousel(this.productsWrap, this.sliderOptions);
        this.sliderInstance.init();

        this.handleAccessibility();
        this.fixQuickviewDuplicate();
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
      }

      destroySlider() {
        this.productsWrap.classList.remove(this.classes.swiper);
        this.products.classList.remove(this.classes.swiperWrapper);
        this.products.classList.add(this.classes.grid);
        if (typeof this.sliderInstance !== 'object') return;
        this.sliderInstance.slider.destroy();
        this.sliderInstance = false;
      }

      fixQuickviewDuplicate() {
        let modalIds = [];
        Array.from(this.querySelectorAll('quick-view-modal')).forEach((modal) => {
          const modalID = modal.getAttribute('id');
          if (modalIds.includes(modalID)) {
            modal.remove();
          } else {
            modalIds.push(modalID);
          }
        });
      }
    }
  );
}
