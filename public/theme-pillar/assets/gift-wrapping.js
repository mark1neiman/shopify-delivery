class GiftWrapping extends HTMLElement {
  constructor() {
    super();

    this.giftWrapProductId = this.dataset.giftWrapId;
    this.isGiftWrappingEnabled = this.dataset.giftWrapping;
    this.cartItemCount = parseInt(this.getAttribute('cart-items-size'));
    this.giftWrapItemCount = parseInt(this.getAttribute('gift-wraps-in-cart'));
    this.totalItemCount = parseInt(this.getAttribute('items-in-cart'));
    this.giftWrapMode = this.dataset.giftWrappingLimit;
  }

  connectedCallback() {
    this.initializeGiftWrapCheckbox();
    this.handleInitialGiftWrapState();
  }

  initializeGiftWrapCheckbox() {
    this.querySelector('[name="attributes[gift-wrapping]"]').addEventListener('change', (event) => {
      event.target.checked ? this.addGiftWrap() : this.removeGiftWrap();
    });
  }

  handleInitialGiftWrapState() {
    if (this.cartItemCount == 1 && this.giftWrapItemCount > 0) {
      return this.removeGiftWrap();
    }
    if (this.giftWrapItemCount > 0 && this.isGiftWrappingEnabled.length == 0) {
      return this.addGiftWrap();
    }
    if (this.giftWrapItemCount == 0 && this.isGiftWrappingEnabled.length > 0) {
      return this.addGiftWrap();
    }
  }

  addGiftWrap() {
    this.showLoader();
    const sectionsToUpdate = this.getSectionsToUpdate();
    const requestBody = this.createRequestBody(
      {
        [this.giftWrapProductId]: 1,
      },
      { 'gift-wrapping': true },
      sectionsToUpdate
    );
    this.updateCart(requestBody);
  }

  removeGiftWrap() {
    this.showLoader();
    const sectionsToUpdate = this.getSectionsToUpdate();
    const requestBody = this.createRequestBody(
      {
        [this.giftWrapProductId]: 0,
      },
      { 'gift-wrapping': '', 'gift-note': '' },
      sectionsToUpdate
    );
    this.updateCart(requestBody);
  }

  getSectionsToUpdate() {
    let sections = [];
    document.documentElement.dispatchEvent(
      new CustomEvent('cart:grouped-sections', { bubbles: true, detail: { sections } })
    );
    return sections;
  }

  createRequestBody(updates, attributes, sections) {
    return JSON.stringify({ updates, attributes, sections });
  }

  updateCart(body) {
    fetch(`${FoxTheme.routes.cart_update_url}`, { ...FoxTheme.utils.fetchConfig(), ...{ body } })
      .then((response) => response.json())
      .then((parsedState) => {
        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate, { cart: parsedState });
      })
      .catch((error) => {
        console.error('Error updating cart:', error);
      });
  }

  showLoader() {
    const loaderElement = this.querySelector('.loader');
    if (loaderElement) loaderElement.classList.add('btn--loading');
  }
}
customElements.define('gift-wrapping', GiftWrapping);

class GiftNote extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('change', FoxTheme.utils.debounce(this.updateGiftNote.bind(this), 300));
  }

  updateGiftNote(event) {
    const requestBody = JSON.stringify({ attributes: { 'gift-note': event.target.value } });
    fetch(`${FoxTheme.routes.cart_update_url}`, { ...FoxTheme.utils.fetchConfig(), ...{ body: requestBody } });
  }
}
customElements.define('gift-note', GiftNote);

class RemoveGiftWrapButton extends HTMLAnchorElement {
  constructor() {
    super();

    this.addEventListener('click', (event) => {
      event.preventDefault();

      const cartItemsElement = this.closest('cart-items');
      cartItemsElement.showLoader(this.dataset.index);

      const giftWrappingElement = document.querySelector('gift-wrapping');
      giftWrappingElement.removeGiftWrap();
    });
  }
}
customElements.define('gift-wrap-remove-item', RemoveGiftWrapButton, { extends: 'a' });
