if (!customElements.get('slideshow-component')) {
  customElements.define(
    'slideshow-component',
    class SlideshowComponent extends HTMLElement {
      constructor() {
        super();

        this.sliderControls = this.querySelector('.swiper-controls');
        this.sliderInstance = false;
        this.enableSlider = this.dataset.enableSlider === 'true';
        this.selectedIndex = this.selectedIndex;
        this.sectionId = this.dataset.sectionId;
        this.section = this.closest(`.section-${this.sectionId}`);
        this.containerWidth = this.dataset.container;
        this.cleanupScrollAnimations = [];
        this.enableZoom = this.dataset.enableZoom ? this.dataset.enableZoom === 'true' : true;
        this.borderRadius = this.dataset.borderRadius;
        this.zoom = 0;

        if (!this.enableSlider) return;

        this.setupZoom();
        window.addEventListener('resize', this.setupZoom.bind(this));

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

      setupZoom() {
        if (!this.enableZoom) return;

        this.destroyZoom();

        const pageWidthEl = this.querySelector('.page-width');
        const paddingLeft = window.getComputedStyle(pageWidthEl).getPropertyValue('padding-left');
        this.zoom = Math.min(parseFloat(paddingLeft.replace('px', '')), window.innerWidth * 0.04);

        if (this.zoom > 15) {
          this.initZoom();
        }
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
            if (!element.classList.contains('swiper-button') && !element.classList.contains('btn')) {
              element.addEventListener('focusin', () => {
                const slide = element.closest('.swiper-slide');
                this.sliderInstance.slider.slideToLoop(this.sliderInstance.slider.slides.indexOf(slide));
              });
            }
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

      initZoom() {
        if (this.containerWidth !== 'full') return;

        const motionTarget = {
          target: this.section,
          offset: [
            [-0.1, 0],
            [0.7, 0],
          ],
        };

        this.querySelectorAll('.slideshow__item-wrap').forEach((slide) => {
          const slideBg = slide.querySelector('.slideshow__bg');

          this.cleanupScrollAnimations.push(
            FoxTheme.Motion.scroll(
              FoxTheme.Motion.animate(slideBg, {
                transform: [`scale(1) translateZ(0)`, `scale(1.1) translateZ(0)`],
              }),
              motionTarget
            )
          );
        });

        this.cleanupScrollAnimations.push(
          FoxTheme.Motion.scroll(
            FoxTheme.Motion.animate(this, {
              clipPath: [
                `inset(0%)`,
                `inset(${Math.min(50, this.zoom)}px ${this.zoom}px round ${this.borderRadius}px)`,
              ],
            }),
            motionTarget
          )
        );

        if (this.sliderControls) {
          this.cleanupScrollAnimations.push(
            FoxTheme.Motion.scroll(
              FoxTheme.Motion.animate(this.sliderControls, {
                bottom: [`0`, `${Math.min(50, this.zoom)}px`],
              }),
              motionTarget
            )
          );
        }
      }

      destroyZoom() {
        this.cleanupScrollAnimations.forEach((fn) => fn());
        this.cleanupScrollAnimations = [];
        this.style.clipPath = 'none';
        if (this.sliderControls) this.sliderControls.style.bottom = 0;
      }
    }
  );
}
