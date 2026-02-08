if (!customElements.get('subscription-popup')) {
  customElements.define(
    'subscription-popup',
    class SubscriptionPopup extends DrawerComponent {
      static get observedAttributes() {
        return super.observedAttributes.concat(['data-trigger-open', 'data-repeat-open']);
      }

      constructor() {
        super();
      }

      get requiresBodyAppended() {
        return false;
      }

      connectedCallback() {
        super.connectedCallback();

        this.triggerOpen = this.dataset.triggerOpen;
        this.repeatOpen = this.dataset.repeatOpen;
        this.cookieName = 'hypertheme:popup';

        window.FoxTheme.DOMready(this.handleOpen.bind(this));
      }

      prepareToShow() {
        super.prepareToShow();
        this.setRepeatOpen();
      }

      handleOpen() {
        if (Shopify.designMode) return;

        let savedData = FoxTheme.utils.getStorage(this.cookieName);
        if (savedData && savedData.opened) {
          return false;
        }

        switch (this.triggerOpen) {
          case 'delay':
            setTimeout(() => {
              this.show();
            }, 5000);
            break;
          case 'scroll_down':
            this.triggerAfterScroll(700, this.show.bind(this));
            break;
          default:
            this.show();
            break;
        }
      }

      triggerAfterScroll(offset = 500, trigger) {
        let opened = false;
        const start = 0;
        window.addEventListener('scroll', (e) => {
          let scrollTop =
            window.pageYOffset || (document.documentElement || document.body.parentNode || document.body).scrollTop;

          if (scrollTop - start > offset && !opened) {
            trigger();
            opened = true;
            return;
          }
        });
      }

      setRepeatOpen() {
        if (Shopify.designMode) return;

        let expires;
        switch (this.repeatOpen) {
          case 'no_repeat':
            expires = 365;
            break;
          case 'every_3_mins':
            expires = 3 / 60 / 24;
            break;
          case 'every_5_mins':
            expires = 5 / 60 / 24;
            break;
          case 'every_10_mins':
            expires = 1 / 6 / 24;
            break;
          case 'every_15_mins':
            expires = 15 / 60 / 24;
            break;
          case 'every_30_mins':
            expires = 1 / 2 / 24;
            break;
          case 'every_1_hr':
            expires = 1 / 24;
            break;
          case 'every_6_hrs':
            expires = 6 / 24;
            break;
          case 'every_12_hrs':
            expires = 1 / 2;
            break;
          case 'every_day':
            expires = 1;
            break;
          case 'every_3_days':
            expires = 3;
            break;
          case 'every_week':
            expires = 7;
            break;
          case 'every_2_weeks':
            expires = 14;
            break;
          case 'every_month':
            expires = 30;
            break;
          default:
            expires = 7;
            break;
        }

        window.FoxTheme.utils.setStorage(this.cookieName, { opened: true }, expires);
      }
    }
  );
}
