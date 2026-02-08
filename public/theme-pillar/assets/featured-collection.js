if (!customElements.get('featured-collection')) {
  customElements.define(
    'featured-collection',
    class FeaturedCollection extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.selectors = {
          sliderWrapper: '.featured-collection__items',
          nextEl: '.swiper-button-next',
          prevEl: '.swiper-button-prev',
          pagination: '.swiper-pagination',
        };
        this.classes = {
          grid: 'f-grid',
          swiper: 'swiper',
          swiperWrapper: 'swiper-wrapper',
        };

        this.blockId = this.dataset.blockId;
        this.block = this.closest(`[data-id="${this.blockId}"`);
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
            nextEl: this.block.querySelector(this.selectors.nextEl),
            prevEl: this.block.querySelector(this.selectors.prevEl),
          },
          pagination: {
            el: this.block.querySelector(this.selectors.pagination),
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

        // const focusableElements = FoxTheme.a11y.getFocusableElements(this);

        // focusableElements.forEach((element) => {
        //   element.addEventListener('focusin', () => {
        //     const slide = element.closest('.swiper-slide');
        //     this.sliderInstance && this.sliderInstance.slider.slideTo(this.sliderInstance.slider.slides.indexOf(slide));
        //   });
        // });

        this.calcNavButtonsPosition();
        this.fixQuickviewDuplicate();
      }

      destroySlider() {
        this.classList.remove(this.classes.swiper);
        this.sliderWrapper.classList.remove(this.classes.swiperWrapper);
        this.sliderWrapper.classList.add(this.classes.grid);
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

      calcNavButtonsPosition() {
        if (this.dataset.navigationPosition !== 'center_image') return;

        const firstMedia = this.querySelector('.product-card__image-wrapper');
        const controls = this.block.querySelector('.swiper-controls');
        if (controls && firstMedia && firstMedia.clientHeight > 0) {
          controls.style.setProperty('--swiper-navigation-top-offset', parseInt(firstMedia.clientHeight) / 2 + 'px');
        }
      }
    }
  );
}
