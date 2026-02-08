if (!customElements.get('collapsible-tabs')) {
  customElements.define(
    'collapsible-tabs',
    class CollapsibleTabs extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        this.detailsElements = this.querySelectorAll('.accordion-details');
        this.colorScheme = this.dataset.colorScheme;

        this.detailsElements.length > 0 &&
          this.detailsElements.forEach((details) => {
            details.open ? this.handleOpen(details) : this.handleClose(details);
            details.addEventListener('toggle', this.onToggle.bind(this));
          });
      }

      onToggle(event) {
        const activeDetails = event.target;
        if (activeDetails.open) {
          this.handleOpen(activeDetails);
        } else {
          this.handleClose(activeDetails);
        }
      }

      handleOpen(details) {
        const parent = details.closest('.accordion-item');
        parent.classList.contains('accordion-card') && parent.classList.add(this.colorScheme);
      }

      handleClose(details) {
        const parent = details.closest('.accordion-item');
        parent.classList.contains('accordion-card') && parent.classList.remove(this.colorScheme);
      }
    }
  );
}
