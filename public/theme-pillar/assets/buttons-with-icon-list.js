if (!customElements.get('button-list')) {
  class CollectionList extends HTMLElement {
    constructor() {
      super();
    }

    connectedCallback() {
      this.selectors = {
        sliderWrapper: '.button-list__items',
        nextEl: '.swiper-button-next',
        prevEl: '.swiper-button-prev',
      };
      this.classes = {
        grid: 'f-flex',
        swiper: 'swiper',
        swiperWrapper: 'swiper-wrapper',
      };

      this.sectionId = this.dataset.sectionId;
      this.section = this.closest(`.section-${this.sectionId}`);
      this.sliderWrapper = this.querySelector(this.selectors.sliderWrapper);
      this.slides = this.sliderWrapper.querySelectorAll('.swiper-slide');

      this.enableSlider = this.dataset.enableSlider === 'true';

      this.sliderInstance = false;

      if (this.enableSlider) {
        this.init();
        document.addEventListener('matchMobile', () => {
          this.init();
        });
        document.addEventListener('unmatchMobile', () => {
          this.init();
        });
      }
    }

    init() {
      if (FoxTheme.config.mqlMobile) {
        this.destroySlider();
      } else {
        this.initSlider();
      }
    }

    initSlider() {
      const columnGap = window.getComputedStyle(this.sliderWrapper).getPropertyValue('--column-gap');
      const spaceBetween = parseFloat(columnGap.replace('rem', '')) * 10 || 12;
      const sliderOptions = {
        slidesPerView: 'auto',
        centeredSlides: false,
        spaceBetween: spaceBetween,
        navigation: {
          nextEl: this.section.querySelector(this.selectors.nextEl),
          prevEl: this.section.querySelector(this.selectors.prevEl),
        },
        pagination: false,
        threshold: 2,
      };

      if (typeof this.sliderInstance !== 'object') {
        this.classList.add(this.classes.swiper);
        this.sliderWrapper.classList.remove(this.classes.grid);
        this.sliderWrapper.classList.add(this.classes.swiperWrapper);
        this.sliderInstance = new window.FoxTheme.Carousel(this, sliderOptions);
        this.sliderInstance.init();

        const focusableElements = FoxTheme.a11y.getFocusableElements(this);
        focusableElements.forEach((element) => {
          element.addEventListener('focusin', () => {
            const slide = element.closest('.swiper-slide');
            this.sliderInstance.slider.slideTo(this.sliderInstance.slider.slides.indexOf(slide));
          });
        });

        this.sliderInstance.slider.on('progress', ({ progress }) => {
          this.updateSliderReach(progress === 0 ? 'begin' : progress === 1 ? 'end' : 'progress');
        });
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
      this.sliderWrapper.classList.add(this.classes.grid);
      if (typeof this.sliderInstance === 'object') {
        this.sliderInstance.slider.destroy();
        this.sliderInstance = false;
      }
    }

    updateSliderReach = (position) => {
      this.dataset.sliderReach = position;
    };
  }
  customElements.define('button-list', CollectionList);
}
