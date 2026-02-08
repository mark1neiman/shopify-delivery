if (!customElements.get('quantity-popover')) {
  customElements.define(
    'quantity-popover',
    class QuantityPopover extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.button = this.querySelector('.quantity-popover__toggle');
        this.closeBtn = this.querySelector('.quantity-popover__close');

        // Initial state based on attributes
        this._open = this.hasAttribute('open');

        // Event listeners for summary element
        this.button && this.button.addEventListener('click', this.handleClick.bind(this));
        this.closeBtn && this.closeBtn.addEventListener('click', this.handleClick.bind(this));

        if (this.trigger === 'hover') {
          this.button &&
            this.button.addEventListener('focusin', (event) => {
              if (event.target === this.button) {
                this.open = true;
              }
            });
          this.button &&
            this.button.addEventListener('focusout', (event) => {
              if (!this.contains(event.relatedTarget)) {
                this.open = false;
              }
            });
        }

        document.addEventListener('click', this.handleOutsideClick.bind(this));

        this.detectHoverListener = this.detectHover.bind(this);
        this.addEventListener('mouseenter', this.detectHoverListener.bind(this));
        this.addEventListener('mouseleave', this.detectHoverListener.bind(this));
      }

      disconnectCallback() {}

      set open(value) {
        // Check if the new value is different from the current value
        if (value !== this._open) {
          // Update the internal state
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
        if (this.hasAttribute('trigger')) {
          return this.getAttribute('trigger');
        } else {
          return 'click';
        }
      }

      handleClick(event) {
        event.preventDefault();
        this.open = !this.open;
      }

      handleOutsideClick(event) {
        const isClickInside = this.contains(event.target);

        if (!isClickInside) {
          this.open = false;
        }
      }

      detectHover(event) {
        if (this.trigger === 'hover') {
          this.open = event.type === 'mouseenter';
        }
      }
    }
  );
}
