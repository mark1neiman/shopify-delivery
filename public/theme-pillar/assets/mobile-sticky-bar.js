if (!customElements.get('mobile-sticky-bar')) {
  customElements.define(
    'mobile-sticky-bar',
    class MobileStickyBar extends HTMLElement {
      constructor() {
        super();

        this.classes = {
          enabled: 'mobile-sticky-bar-enabled',
          isShow: 'mobile-sticky-bar-up',
          isHide: 'mobile-sticky-bar-down',
        };

        this.compareToggleUnsubscriber = FoxTheme.pubsub.subscribe('compare:toggle', this.onCompareToggle.bind(this));
      }

      compareToggleUnsubscriber = undefined;

      connectedCallback() {
        document.body.classList.add(this.classes.enabled);
        if (this.isCompareBarShowing()) {
          this.hide();
        } else {
          this.show();
        }

        this.lastScrollTop = 0;
        this.scrollHandler = FoxTheme.utils.debounce(this.onScrollHandler.bind(this), 10);
        this.init();
      }

      disconnectedCallback() {
        window.removeEventListener('scroll', this.scrollHandler);

        if (this.compareToggleUnsubscriber) {
          this.compareToggleUnsubscriber();
        }
      }

      init() {
        this.calculateHeight();
        window.addEventListener('scroll', this.scrollHandler, false);
      }

      calculateHeight() {
        requestAnimationFrame(() => {
          document.documentElement.style.setProperty('--mobile-sticky-bar-height', `${this.offsetHeight}px`);
        });
      }

      isCompareBarShowing() {
        return document.body.classList.contains('is-product-comparing');
      }

      onCompareToggle(event) {
        if (event.isActive) {
          this.hide();
        } else {
          this.show();
        }
      }

      onScrollHandler() {
        if (this.isCompareBarShowing()) {
          this.hide();
          return;
        }

        const offsetTop = document.getElementById('mobileNavStatic').offsetTop;
        const scrollTop = window.scrollY;
        const pointTouch = offsetTop - scrollTop - window.innerHeight;

        requestAnimationFrame(() => {
          this.scrollDirection = scrollTop > this.lastScrollTop ? 'down' : 'up';
          this.lastScrollTop = scrollTop;

          if (this.scrollDirection == 'up' && pointTouch > 0) {
            this.show();
          } else {
            this.hide();
          }
        });
      }

      show() {
        document.body.classList.remove(this.classes.isHide);
        document.body.classList.add(this.classes.isShow);
      }

      hide() {
        document.body.classList.remove(this.classes.isShow);
        document.body.classList.add(this.classes.isHide);
      }
    }
  );
}
