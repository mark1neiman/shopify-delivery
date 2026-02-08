class CustomerAddresses {
  constructor() {
    this.selectors = {
      customerAddresses: '[data-customer-addresses]',
      addressCountrySelect: '[data-address-country-select]',
      toggleAddressButton: '[data-toggle-target]',
      deleteAddressButton: 'button[data-confirm-message]',
    };
    this.attributes = {
      confirmMessage: 'data-confirm-message',
    };
    this.elements = this._getElements();
    if (Object.keys(this.elements).length === 0) return;
    this._setupCountries();
    this._setupEventListeners();
  }

  _getElements() {
    const container = document.querySelector(this.selectors.customerAddresses);
    return container
      ? {
          container,
          addressContainer: container.querySelector(this.selectors.addressContainer),
          toggleButtons: document.querySelectorAll(this.selectors.toggleAddressButton),
          deleteButtons: container.querySelectorAll(this.selectors.deleteAddressButton),
          countrySelects: container.querySelectorAll(this.selectors.addressCountrySelect),
        }
      : {};
  }

  _setupCountries() {
    if (Shopify && Shopify.CountryProvinceSelector) {
      // eslint-disable-next-line no-new
      new Shopify.CountryProvinceSelector('AddressCountryNew', 'AddressProvinceNew', {
        hideElement: 'AddressProvinceContainerNew',
      });
      this.elements.countrySelects.forEach((select) => {
        const formId = select.dataset.formId;
        // eslint-disable-next-line no-new
        new Shopify.CountryProvinceSelector(`AddressCountry_${formId}`, `AddressProvince_${formId}`, {
          hideElement: `AddressProvinceContainer_${formId}`,
        });
      });
    }
  }

  _setupEventListeners() {
    this.elements.toggleButtons.forEach((element) => {
      element.addEventListener('click', (e) => {
        const {currentTarget} = e;
        const toggleTarget = document.getElementById(`${currentTarget.dataset.toggleTarget}`);
        toggleTarget.classList.toggle('hidden');
        // toggleTarget.classList.toggle('active');
      });
    });
    this.elements.deleteButtons.forEach((element) => {
      element.addEventListener('click', this._handleDeleteButtonClick);
    });
  }

  _handleDeleteButtonClick = ({ currentTarget }) => {
    // eslint-disable-next-line no-alert
    if (confirm(currentTarget.getAttribute(this.attributes.confirmMessage))) {
      Shopify.postLink(currentTarget.dataset.target, {
        parameters: { _method: 'delete' },
      });
    }
  };
}