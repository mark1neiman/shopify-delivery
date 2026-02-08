if (!customElements.get('slideshow-with-product')) {
  customElements.define(
    'slideshow-with-product',
    class SlideshowWithProduct extends HTMLElement {
      constructor() {
        super();

        if (this.dataset.enableSlider !== 'true') return;

        this.sectionId = this.dataset.sectionId;
        this.sliderControls = this.querySelector('.swiper-controls');
        this.sliderInstance = false;
        this.selectedIndex = this.selectedIndex;
        this.sliderHeightAdapt = this.classList.contains('slideshow-with-product-height--adapt');

        this.calcSlideHeight();
        window.addEventListener('resize', FoxTheme.utils.debounce(this.calcSlideHeight.bind(this), 100), false);

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
          spaceBetween: 10,
          loop: true,
          grabCursor: true,
          allowTouchMove: true,
          threshold: 2,
          effect: 'fade',
          on: {
            init: this.handleAfterInit.bind(this),
          },
          fadeEffect: {
            crossFade: true,
          },
        };

        if (this.sliderControls) {
          this.sliderOptions.navigation = {
            nextEl: this.sliderControls.querySelector('.swiper-button-next'),
            prevEl: this.sliderControls.querySelector('.swiper-button-prev'),
          };
          this.sliderOptions.pagination = {
            el: this.sliderControls.querySelector('.swiper-pagination'),
            type: 'fraction',
            clickable: true,
          };
        }

        const autoplayDelay = parseInt(this.dataset.autoplay);
        if (autoplayDelay > 0) {
          this.sliderOptions = {
            ...this.sliderOptions,
            autoplay: {
              delay: autoplayDelay,
              disableOnInteraction: false,
            },
          };
        }

        this.sliderInstance = new window.FoxTheme.Carousel(this, this.sliderOptions, additionModules);
        this.sliderInstance.init();

        this.sliderInstance.slider.on('realIndexChange', this.handleSlideChange.bind(this));

        if (this.sliderInstance) {
          this.selectedElement = this.sliderInstance.slider.slides[this.sliderInstance.slider.activeIndex];
          this.onReady(this.selectedElement, this.sliderInstance.slider.slides);

          // Fix accessibility
          const focusableElements = FoxTheme.a11y.getFocusableElements(this);
          focusableElements.forEach((element) => {
            if (!element.classList.contains('swiper-button') && element.tagName.toLowerCase() !== 'a') {
              element.addEventListener('focusin', () => {
                const slide = element.closest('.swiper-slide');
                this.sliderInstance.slider.slideToLoop(this.sliderInstance.slider.slides.indexOf(slide));
              });
            }
          });
        }

        if (Shopify.designMode && typeof this.sliderInstance === 'object') {
          document.addEventListener('shopify:block:select', (e) => {
            if (e.detail.sectionId != this.sectionId) return;
            let { target } = e;
            const index = Number(target.dataset.index);

            this.sliderInstance.slider.slideToLoop(index);
          });
        }
      }

      onReady(selectedElement) {
        if (selectedElement.dataset.type === 'video') {
          const videoElement = FoxTheme.utils.displayedMedia(selectedElement.querySelectorAll('video-element'));
          videoElement?.play();
        }

        if (!FoxTheme.config.motionReduced) {
          const motionEls = selectedElement.querySelectorAll('motion-element');
          motionEls.forEach((motionEl) => {
            setTimeout(() => {
              motionEl && motionEl.refreshAnimation();
            });
          });
        }
      }

      handleAfterInit() {
        this.removeAttribute('data-media-loading');

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
            if (fromElement.dataset.type === 'video') {
              const videoElement = FoxTheme.utils.displayedMedia([fromElement.querySelector('video-element')]);
              videoElement && videoElement.pause();
            }

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
                if (toElement.dataset.type === 'video') {
                  const videoElement = FoxTheme.utils.displayedMedia([toElement.querySelector('video-element')]);
                  videoElement && videoElement.play();
                }

                const motionEls = toElement.querySelectorAll('motion-element');
                motionEls.forEach((motionEl) => {
                  setTimeout(() => {
                    motionEl && motionEl.refreshAnimation();
                  });
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

      calcSlideHeight() {
        this.style.removeProperty('--slide-height');
        let maxHeight = 0;

        const slides = this.querySelectorAll('.swiper-slide');
        slides &&
          slides.forEach((slide) => {
            const slideText = slide.querySelector('.slideshow-with-product__content');
            if (slideText) {
              this.sliderHeightAdapt && slideText.classList.remove('absolute');
              const slideTextHeight = slideText.offsetHeight;
              if (slideTextHeight > maxHeight) {
                maxHeight = slideTextHeight;
              }
              this.sliderHeightAdapt && slideText.classList.add('absolute');
            }
          });

        this.style.setProperty('--slide-height', maxHeight + 'px');
      }
    }
  );
}
