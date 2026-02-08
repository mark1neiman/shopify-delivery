if (!customElements.get('image-with-text-slider')) {
  customElements.define(
    'image-with-text-slider',
    class ImageWithTextSlider extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.enableSlider = this.dataset.enableSlider === 'true';

        this.swipers = this.querySelectorAll('.swiper');
        this.sliderControls = this.querySelector('.swiper-controls');
        this.sectionId = this.dataset.sectionId;
        this.selectedIndex = this.selectedIndex;
        this.swiperInstances = [];

        if (!this.enableSlider) return;
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

        this.swipers.forEach((swiper) => {
          const autoplayDelay = parseInt(swiper.dataset.autoplay);
          const sliderOptions = {
            slidesPerView: 1,
            loop: true,
            effect: 'fade',
            fadeEffect: { crossFade: true },
            ...(this.sliderControls && {
              navigation: {
                nextEl: this.sliderControls.querySelector('.swiper-button-next'),
                prevEl: this.sliderControls.querySelector('.swiper-button-prev'),
              },
            }),
            pagination: {
              el: this.querySelector('.swiper-pagination'),
              clickable: true,
            },
            on: {
              init: this.handleAfterInit.bind(this),
            },
            ...(autoplayDelay > 0 && {
              autoplay: {
                delay: autoplayDelay,
                disableOnInteraction: false,
              },
            }),
          };

          const sliderInstance = new window.FoxTheme.Carousel(swiper, sliderOptions, additionModules);
          sliderInstance.init();
          this.swiperInstances.push(sliderInstance);

          //Trigger update UI on init
          this.updateActiveSlide(sliderInstance.slider)

          //handle real slide change
          sliderInstance.slider.on('realIndexChange', (swiperInstance) => {
            this.handleSlideChange(swiperInstance, swiper);
          });
          sliderInstance.slider.on('slideChange', () => {
            const currentIndex = sliderInstance.slider.realIndex;
            this.swiperInstances.forEach((instance) => {
              if (instance.slider !== sliderInstance.slider) {
                instance.slider.slideToLoop(currentIndex);
              }
            });
          });
        });

        //Shopify desgin mode
        if (Shopify.designMode) {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId !== this.sectionId) return;
            const index = Number(e.target.dataset.index);
            this.swiperInstances.forEach((instance) => {
              if (instance && instance.slider) {
                instance.slider.slideToLoop(index);
              }
              this.updateActiveSlide(instance.slider);
            });
          });
        }
      }

      updateActiveSlide(slider) {
        const { slides, activeIndex } = slider;
        this.updateControlsScheme(slides[activeIndex]);
        this.updateContentScheme(slides[activeIndex]);
        this.updateControlsPadding(slides[activeIndex]);
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
        if (this.sliderControls) {
          const activeBullet = this.sliderControls.querySelector('.swiper-pagination-bullet-active');

          if (activeBullet) {
            activeBullet.classList.remove('swiper-pagination-bullet-active');
            activeBullet.offsetHeight;
            activeBullet.classList.add('swiper-pagination-bullet-active');
          }
        }
      }

      handleSlideChange(swiper) {
        const { slides, realIndex, activeIndex } = swiper;
        this.selectedIndex = realIndex;

        this.updateControlsScheme(slides[activeIndex]);
        this.updateContentScheme(slides[activeIndex]);
        this.updateControlsPadding(slides[activeIndex]);
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

      updateContentScheme(activeSlide) {
        const classesToRemove = Array.from(this.querySelector('.image-slider__content').classList).filter((className) =>
          className.startsWith('color-')
        );
        classesToRemove.forEach((className) =>
          this.querySelector('.image-slider__content').classList.remove(className)
        );
        const colorScheme = activeSlide.dataset.colorScheme;
        this.querySelector('.image-slider__content').classList.add(colorScheme);
      }

      updateControlsPadding(activeSlide) {
        if (this.sliderControls) {
          const controlsElement = Array.from(this.sliderControls.classList).filter((className) =>
            className.startsWith('color-inherit')
          );

          controlsElement.forEach((className) => this.sliderControls.classList.remove(className));
          const paddingCustom = activeSlide.dataset.padding === 'custom';
          this.sliderControls.classList.toggle('color-inherit', paddingCustom);
        }
      }
    }
  );
}
