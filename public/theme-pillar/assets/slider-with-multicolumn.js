if (!customElements.get('multicolumn-slider')) {
  customElements.define(
    'multicolumn-slider',
    class multicolumnSlider extends HTMLElement {
      constructor() {
        super();
      }
      connectedCallback() {
        this.swiper = this.querySelector('.swiper');
        this.sliderControls = this.querySelector('.swiper-controls');
        this.sliderPagination = this.querySelector('.swiper-pagination');
        this.enableSlider = this.swiper.dataset.enableSlider === 'true';

        this.selectedIndex = this.selectedIndex;

        if (!this.enableSlider);
        this.initSlider();
      }

      static get observedAttributes() {
        return ['selected-index'];
      }

      get selectedIndex() {
        return parseInt(this.getAttribute('selected-index')) || 0;
      }

      set selectedIndex(index) {
        this.setAttribute('selected-index', `${index}`);
      }

      initSlider() {
        const additionModules = [FoxTheme.Swiper.Autoplay, FoxTheme.Swiper.EffectFade];
        this.sliderOptions = {
          slidesPerView: 1,
          loop: true,
          effect: 'fade',
          fadeEffect: {
            crossFade: true,
          },
          navigation: {
            nextEl: this.sliderControls.querySelector('.swiper-button-next'),
            prevEl: this.sliderControls.querySelector('.swiper-button-prev'),
          },
          pagination: {
            el: this.sliderPagination,
            clickable: true,
          },
          on: {
            init: this.handleAfterInit.bind(this),
          },
        };

        const autoplayDelay = parseInt(this.swiper.dataset.autoplay);
        if (autoplayDelay > 0) {
          this.sliderOptions = {
            ...this.sliderOptions,
            autoplay: {
              delay: autoplayDelay,
              disableOnInteraction: false,
            },
          };
        }

        this.sliderInstance = new window.FoxTheme.Carousel(this.swiper, this.sliderOptions, additionModules);
        this.sliderInstance.init();

        this.sliderInstance.slider.on('realIndexChange', this.handleSlideChange.bind(this));

        if (Shopify.designMode) {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId !== this.swiper.dataset.sectionId) return;
            const target = e.target;
            const blockType = target.dataset.type;
            if (blockType !== 'slide') return;
            const index = Number(target.dataset.index);
            this.sliderInstance.slider.slideToLoop(index);
          });
        }
        if (this.sliderInstance) {
          const motionTextElements = Array.from(this.querySelectorAll('motion-element[data-text]'));
          motionTextElements &&
            motionTextElements.forEach((motionTextElement) => {
              if (
                typeof motionTextElement.resetAnimation === 'function' &&
                !motionTextElement.closest('.swiper-slide-active')
              ) {
                motionTextElement.resetAnimation();
              }
            });
          this.selectedElement = this.sliderInstance.slider.slides[this.sliderInstance.slider.activeIndex];
          this.onReady(this.selectedElement, this.sliderInstance.slider.slides);

          const focusableElements = FoxTheme.a11y.getFocusableElements(this);
          focusableElements.forEach((element) => {
            if (!element.classList.contains('swiper-button')) {
              element.addEventListener('focusin', () => {
                const slide = element.closest('.swiper-slide');
                if (slide) {
                  this.sliderInstance.slider.slideToLoop(this.sliderInstance.slider.slides.indexOf(slide));
                }
              });
            }
          });
        }
      }

      onReady(selectedElement) {
        if (!FoxTheme.config.motionReduced) {
          const motionEls = selectedElement.querySelectorAll('motion-element');
          motionEls.forEach((motionEl) => {
            motionEl && motionEl.refreshAnimation();
          });
        }
      }

      handleAfterInit() {
        // Fix active bullet not transition on the first time.
        if (this.sliderControls) {
          const activeBullet = this.sliderControls.querySelector('.swiper-pagination-bullet-active');

          if (activeBullet) {
            activeBullet.classList.remove('swiper-pagination-bullet-active');
            activeBullet.offsetHeight; // Trigger reflow.
            activeBullet.classList.add('swiper-pagination-bullet-active');
          }
        }
      }

      handleSlideChange(swiper) {
        const { slides, realIndex, activeIndex } = swiper;
        this.selectedIndex = realIndex;

        this.updateControlsScheme(slides[activeIndex]);
      }

      attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'selected-index' && oldValue !== null && oldValue !== newValue) {
          const fromElements = this.querySelectorAll(`[data-swiper-slide-index="${oldValue}"]`);
          const toElements = this.querySelectorAll(`[data-swiper-slide-index="${newValue}"]`);

          fromElements.forEach((fromElement) => {
            const motionEls = fromElement.querySelectorAll('motion-element');
            motionEls &&
              motionEls.forEach((motionEl) => {
                if (motionEl.hasAttribute('data-text')) {
                  motionEl.resetAnimation();
                }
              });
          });

          toElements.forEach((toElement) => {
            setTimeout(() => {
              if (toElement.classList.contains('swiper-slide-active')) {
                const motionEls = toElement.querySelectorAll('motion-element');
                motionEls.forEach((motionEl) => {
                  motionEl && motionEl.refreshAnimation();
                });
              }
            });
          });
        }
      }

      updateControlsScheme(activeSlide) {
        if (this.sliderControls) {
          const classesToRemove = Array.from(this.sliderControls.classList).filter((className) =>
            className.startsWith('color-')
          );
          classesToRemove.forEach((className) => this.sliderControls.classList.remove(className));
          const colorScheme = activeSlide.dataset.colorScheme;
          this.sliderControls.classList.add(colorScheme);
        }
      }
    }
  );
}
