if (!customElements.get("password-details")) {
  class PasswordDetails extends AccordionDetails {
    constructor() {
      super();

      this.open = false;
    }
  }
  customElements.define('password-details', PasswordDetails, { extends: 'details' });
}