if (!customElements.get('lookbook-card')) {
  customElements.define(
    'lookbook-card',
    class LookbookCard extends ModalComponent {
      constructor() {
        super();

        this.card = this.closest('.lbcard');

        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = () => {
          this.removeAttribute('open');
          document.body.classList.remove(this.classes.show);
        };
      }

      get isLockingNeeded() {
        return FoxTheme.config.mqlMobile;
      }
    
      get requiresBodyAppended() {
        return FoxTheme.config.mqlMobile;
      }

      prepareToShow() {
        super.prepareToShow();

        this.card.classList.add('is-open');
      }

      handleAfterHide() {
        super.handleAfterHide();

        this.card.classList.remove('is-open');
      }
    }
  );
}

if (!customElements.get('lookbook-card-wrapper')) {
  customElements.define(
    'lookbook-card-wrapper',
    class LookbookCardWrapper extends HTMLElement {
      constructor() {
        super();
      }

      get video() {
        return this.querySelector('video-element');
      }

      connectedCallback() {
        if (!this.video) return;

        this.addEventListener('mouseleave', this.handleMouseInteraction.bind(this, 'leave'));
        this.addEventListener('mouseenter', this.handleMouseInteraction.bind(this, 'enter'));
      }

      disconnectedCallback() {
        this.removeEventListener('mouseleave');
        this.removeEventListener('mouseenter');
      }

      handleMouseInteraction(type, event) {
        if (type === 'enter') {
          this.classList.add('is-hovering');
          this.video.play();
        } else {
          this.classList.remove('is-hovering');
          this.video.pause();
        }
      }
    }
  );
}