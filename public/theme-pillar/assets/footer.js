if (!customElements.get("footer-details")) {
  class FooterDetails extends AccordionDetails {
    constructor() {
      super();
    }
    
    connectedCallback() {
      this.openDefault = this.dataset.openDefault === 'true';

      if (FoxTheme.config.mqlTablet) {
        if (!this.openDefault) this.open = false;
      }

      document.addEventListener('matchTablet', () => {
        if (!this.openDefault) {
          this.open = false;
        } else {
          this.open = true;
        }
      });

      document.addEventListener('unmatchTablet', () => {
        this.open = true;
      });
    }
  }
  customElements.define('footer-details', FooterDetails, { extends: 'details' });
}