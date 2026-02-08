if (!customElements.get('press-element')) {
  customElements.define(
    'press-element',
    class PressElement extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.testimonials = this.querySelector('.press-testimonials');
        this.thumbs = this.querySelector('.press-thumbs');
        this.sectionId = this.dataset.sectionId;
        this.testimonialsSlider = this.testimonials.querySelector('.swiper');
        this.thumbsSlider = this.thumbs.querySelector('.swiper');

        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = this.init.bind(this);
      
        window.addEventListener('resize', () => {
          this.updateGap();
          this.init(); 
        });
      
        this.updateGap();
        this.init();
      }

      init() {
        this.destroySlider();
        this.initSlider();
      }

      updateGap() {
        const columnGap = window.getComputedStyle(this.thumbs).getPropertyValue('--f-column-gap');
        this.columnGap = columnGap;
      }

      setSliderOptions() {
        const spaceBetween = parseFloat((this.columnGap || '0rem').replace('rem', '')) * 10;

        // Testimonials slider
        this.testimonialsOptions = {
          slidesPerView: 1,
          spaceBetween: 30,
          loop: true,
          threshold: 1,
          grabCursor: true,
        };
      
        // Thumbs slider
        this.thumbsOptions = {
          slidesPerView: 'auto',
          spaceBetween: spaceBetween,
          threshold: 1,
          freeMode: true,
          centeredSlides: true,
          slideToClickedSlide: true,
          loop: true,
        };
      }

      initSlider() {
        this.setSliderOptions();
      
        const modules = [FoxTheme.Swiper.Thumbs];
      
        this.thumbsInstance = new FoxTheme.Carousel(this.thumbsSlider, this.thumbsOptions, modules);
        this.thumbsInstance.init();
      
        this.testimonialsOptions.thumbs = {
          swiper: this.thumbsInstance.slider,
        };
      
        this.sliderInstance = new FoxTheme.Carousel(this.testimonialsSlider, this.testimonialsOptions, modules);
        this.sliderInstance.init();
      
        this.sliderInstance.slider.on('realIndexChange', (swiper) => {
          const { realIndex, thumbs } = swiper;
          thumbs.swiper.slideToLoop(realIndex);
        });

        //shopify desgin mode
        if (Shopify.designMode && typeof this.sliderInstance === 'object') {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId != this.sectionId) return;
            let { target } = e;
            const index = Number(target.dataset.index);
            this.sliderInstance.slider.slideToLoop(index);
          });
        }
      }

      destroySlider() {
        if (typeof this.sliderInstance !== 'object') return;
        this.sliderInstance.slider.destroy();
        this.sliderInstance = false;

        this.thumbsInstance.slider.destroy();
        this.thumbsInstance = false;
      }
    }
  );
}
