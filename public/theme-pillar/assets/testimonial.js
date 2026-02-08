if (!customElements.get('testimonials-component')) {
  class Testimonials extends HTMLElement {
    constructor() {
      super();
    }

    connectedCallback() {
      this.selectors = {
        sliderWrapper: '.testimonials__items',
        pagination: '.swiper-pagination',
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
      this.sliderWrapper = this.querySelector(this.selectors.sliderWrapper);

      this.enableSlider = this.dataset.enableSlider === 'true';
      this.items = parseInt(this.dataset.items);
      this.laptopItems = parseInt(this.dataset.laptopItems);
      this.tabletItems = parseInt(this.dataset.tabletItems);
      this.layout = this.dataset.layout;
      this.swipeMobile = this.dataset.swipeMobile === 'true';

      this.sliderInstance = false;

      if (!this.enableSlider) return;

      this.init();
      document.addEventListener('matchMobile', () => {
        this.init();
      });
      document.addEventListener('unmatchMobile', () => {
        this.init();
      });
    }

    get paginationType() {
      return this.dataset.paginationType;
    }

    init() {
      if (FoxTheme.config.mqlMobile && this.swipeMobile) {
        this.destroySlider()
      } else {
        this.initSlider();
      }
    }

    initSlider() {
      const columnGap = window.getComputedStyle(this.sliderWrapper).getPropertyValue('--f-column-gap');
      const columnGapMobile = window.getComputedStyle(this.sliderWrapper).getPropertyValue('--f-column-gap-mobile');
      const spaceBetween = parseFloat(columnGap.replace('rem', '')) * 10;
      const spaceBetweenMobile = parseFloat(columnGapMobile.replace('rem', '')) * 10;
      let additionModules = [];
      let slideToMethod = 'slideTo';

      this.defaultOptions = {
        slidesPerView: 1,
        spaceBetween: spaceBetween,
        navigation: {
          nextEl: this.section.querySelector(this.selectors.nextEl),
          prevEl: this.section.querySelector(this.selectors.prevEl),
        },
        pagination: false,
        breakpoints: {
          768: {
            slidesPerView: this.tabletItems > 3 ? 3 : this.tabletItems
          },
          1024: {
            slidesPerView: this.laptopItems > 3 ? 3 : this.laptopItems
          },
          1280: {
            slidesPerView: this.items
          },
        },
        loop: false,
        threshold: 2,
      };

      if ( this.layout === 'focused' ) {
        slideToMethod = 'slideToLoop';
        this.settings = {
          centeredSlides: true,
          spaceBetween: spaceBetweenMobile,
          pagination: {
            el: this.section.querySelector(this.selectors.pagination),
            clickable: true,
            type: this.paginationType
          },
          loop: true,
          breakpoints: {
            768: {
              slidesPerView: 2,
              spaceBetween: spaceBetween
            },
            1280: {
              slidesPerView: Math.max(2, this.getSlidesPerViewCentered(this.laptopItems)),
              spaceBetween: spaceBetween
            },
            1440: {
              slidesPerView: Math.max(2, this.getSlidesPerViewCentered(this.items)),
              spaceBetween: spaceBetween
            },
          }
        };
      } else {
        additionModules.push(FoxTheme.Swiper.Mousewheel);
        this.settings = {
          mousewheel: {
            enabled: true,
            forceToAxis: true,
            thresholdDelta: 10, 
            thresholdTime: 100
          }
        }
      }

      if (typeof this.sliderInstance !== 'object') {
        this.classList.add(this.classes.swiper);
        this.sliderWrapper.classList.remove(this.classes.grid);
        this.sliderWrapper.classList.add(this.classes.swiperWrapper);
        this.sliderInstance = new window.FoxTheme.Carousel(this, {...this.defaultOptions,...this.settings}, additionModules);
        this.sliderInstance.init();

        const focusableElements = FoxTheme.a11y.getFocusableElements(this);

        focusableElements.forEach((element) => {
          element.addEventListener('focusin', () => {
            const slide = element.closest('.swiper-slide');
            this.sliderInstance.slider[slideToMethod](this.sliderInstance.slider.slides.indexOf(slide));
          });
        });
      }
      if (Shopify.designMode && typeof this.sliderInstance === 'object') {
        document.addEventListener('shopify:block:select', (e) => {
          if (e.detail.sectionId != this.sectionId) return;
          let { target } = e;
          const index = Number(target.dataset.index);

          this.sliderInstance.slider[slideToMethod](index);
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
    getSlidesPerViewCentered(number) {
      if (number % 2 !== 0) return (number - 1);
      return number
    }
  }
  customElements.define('testimonials-component', Testimonials);
}


if (!customElements.get('testimonial-layered')) {
  class TestimonialLayered extends HTMLElement {
    constructor() {
      super();
    }

    connectedCallback() {
      this.hoverToOpen = this.trigger === 'hover' && window.matchMedia("(hover: hover)").matches ? true : false;

      if (this.hoverToOpen) {
        this.addEventListener('mouseenter', this.handleMouseOver.bind(this));
        this.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
      }

      this._open = this.hasAttribute('open');
      this.header = this.querySelector('.testimonial__header');
      this.text = this.querySelector('.testimonial__text');
      this.content = this.querySelector('.testimonial__content');
      this.summary = this.querySelector('.testimonial__summary');
      this.testimonialInner = this.querySelector('.testimonial__inner');
      this.header && this.header.addEventListener('click', this.handleClick.bind(this));
      document.addEventListener('click', this.handleOutsideClick.bind(this));
    }

    disconnectCallback() {
      this.header && this.header.removeEventListener('click', this.handleClick.bind(this));
      document.removeEventListener('click', this.handleOutsideClick.bind(this));
    }

    set open(value) {
      if (value !== this._open) {
        this._open = value;
  
        if (value) {
          this.setAttribute('open', '');
        } else {
          this.removeAttribute('open');
        }
      }
    }
  
    get open() {
      return this._open;
    }

    get trigger() {
      if (this.hasAttribute('data-trigger')) {
        return this.getAttribute('data-trigger');
      } else {
        return 'click';
      }
    }

    handleClick(event) {
      event.preventDefault();
      this.open = !this.open;
      this.toggleColor();
      this.toggleContentOverflow();
    }

    handleOutsideClick(event) {
      const isClickInside = this.testimonialInner.contains(event.target);

      if (!isClickInside) {
        this.open = false;
      }
      this.toggleColor();
      this.toggleContentOverflow();
    }

    handleMouseOver(e) {
      this.open = true;
      this.hoverTimeout = setTimeout(() => {
        if (this.text.getBoundingClientRect().height > this.content.getBoundingClientRect().height) this.content.classList.add('overflow-auto');
      }, 600);

      this.toggleColor();
    }

    handleMouseLeave(e) {
      this.open = false;
      clearTimeout(this.hoverTimeout);
      this.content.classList.remove('overflow-auto');

      this.toggleColor();
    }

    toggleColor() {
      const {colorScheme, contentColorScheme} = this.dataset;
      this.testimonialInner.classList.toggle(contentColorScheme, this.open);
      this.testimonialInner.classList.toggle(colorScheme, !this.open );
    }

    toggleContentOverflow() {
      if (!this.content || !this.text) return;

      const activeTimeOut = setTimeout(() => {
        const isScrollable = this.open ? (this.text.getBoundingClientRect().height > this.content.getBoundingClientRect().height) : false;
        if (isScrollable) this.content.classList.add('overflow-auto');
      }, 600);

      if (!this.open) {
        clearTimeout(activeTimeOut);
        this.content.classList.remove('overflow-auto');
      }
    }
  }
  customElements.define('testimonial-layered', TestimonialLayered);
}