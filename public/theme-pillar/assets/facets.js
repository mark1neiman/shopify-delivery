class FacetShort extends HTMLSelectElement {
  constructor() {
    super();
    this.initMotionInView();
    this.addEventListener('change', this.onSelectChange.bind(this));
  }

  get options() {
    return this.getElementsByTagName('option');
  }

  get fakeSelectElement() {
    return this.previousElementSibling;
  }

  initMotionInView() {
    FoxTheme.Motion.inView(this, this.calcSelectWidth.bind(this), { margin: '200px 0px 200px 0px' });
  }

  calcSelectWidth() {
    const selectStyle = window.getComputedStyle(this);
    const selectedOptionText = this.options[this.selectedIndex].text;

    const textElement = this.createTextElement(selectedOptionText, selectStyle);
    document.body.appendChild(textElement);
    const selectWidth = textElement.offsetWidth;
    textElement.remove();

    this.style.setProperty('--width', `${selectWidth + 22}px`);
  }

  createTextElement(text, style) {
    const textElement = document.createElement('span');
    textElement.style.fontFamily = style.fontFamily;
    textElement.style.fontSize = style.fontSize;
    textElement.style.fontWeight = style.fontWeight;
    textElement.style.visibility = 'hidden';
    textElement.style.position = 'absolute';
    textElement.innerHTML = text;
    return textElement;
  }

  onSelectChange(event) {
    this.calcSelectWidth();
    this.updateFormParams(event);
  }

  updateFormParams(event) {
    const form = this.getClosestFacetForm() || this.getFirstFacetForm();

    if (form) {
      const url = new URL(window.location.href);
      url.searchParams.set('sort_by', event.target.value);
      url.searchParams.set('section_id', FoxTheme.utils.getSectionId(form));
      url.searchParams.delete('page');
      form.renderSection(url.toString(), event);
    }
  }

  getClosestFacetForm() {
    return this.closest('form[is="facet-form"]');
  }

  getFirstFacetForm() {
    return document.querySelector('form[is="facet-form"]');
  }
}
customElements.define('facet-short', FacetShort, { extends: 'select' });

class PriceRange extends HTMLElement {
  constructor() {
    super();

    this.minRangeInput = this.querySelector('input[type="range"]:first-child');
    this.maxRangeInput = this.querySelector('input[type="range"]:last-child');
    this.minPriceInput = this.querySelector('input[name="filter.v.price.gte"]');
    this.maxPriceInput = this.querySelector('input[name="filter.v.price.lte"]');

    this.minPriceInput.addEventListener('focus', this.minPriceInput.select);
    this.maxPriceInput.addEventListener('focus', this.maxPriceInput.select);
    this.minPriceInput.addEventListener('change', this.handleInputMinChange.bind(this));
    this.maxPriceInput.addEventListener('change', this.handleInputMaxChange.bind(this));

    this.minRangeInput.addEventListener('change', this.handleRangeMinChange.bind(this));
    this.maxRangeInput.addEventListener('change', this.handleRangeMaxChange.bind(this));
    this.minRangeInput.addEventListener('input', this.handleRangeMinInput.bind(this));
    this.maxRangeInput.addEventListener('input', this.handleRangeMaxInput.bind(this));
  }

  handleInputMinChange(event) {
    event.preventDefault();
    event.target.value = Math.max(
      Math.min(parseInt(event.target.value), parseInt(this.maxPriceInput.value || event.target.max) - 1),
      event.target.min
    );
    this.minRangeInput.value = event.target.value;
    this.minRangeInput.parentElement.style.setProperty(
      '--range-min',
      `${(parseInt(this.minRangeInput.value) / parseInt(this.minRangeInput.max)) * 100}%`
    );
  }

  handleInputMaxChange(event) {
    event.preventDefault();
    event.target.value = Math.min(
      Math.max(parseInt(event.target.value), parseInt(this.minPriceInput.value || event.target.min) + 1),
      event.target.max
    );
    this.maxRangeInput.value = event.target.value;
    this.maxRangeInput.parentElement.style.setProperty(
      '--range-max',
      `${(parseInt(this.maxRangeInput.value) / parseInt(this.maxRangeInput.max)) * 100}%`
    );
  }

  handleRangeMinChange(event) {
    event.stopPropagation();
    this.minPriceInput.value = event.target.value;
    this.minPriceInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  handleRangeMaxChange(event) {
    event.stopPropagation();
    this.maxPriceInput.value = event.target.value;
    this.maxPriceInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  handleRangeMinInput(event) {
    event.target.value = Math.min(
      parseInt(event.target.value),
      parseInt(this.maxPriceInput.value || event.target.max) - 1
    );
    event.target.parentElement.style.setProperty(
      '--range-min',
      `${(parseInt(event.target.value) / parseInt(event.target.max)) * 100}%`
    );
    this.minPriceInput.value = event.target.value;
  }

  handleRangeMaxInput(event) {
    event.target.value = Math.max(
      parseInt(event.target.value),
      parseInt(this.minPriceInput.value || event.target.min) + 1
    );
    event.target.parentElement.style.setProperty(
      '--range-max',
      `${(parseInt(event.target.value) / parseInt(event.target.max)) * 100}%`
    );
    this.maxPriceInput.value = event.target.value;
  }
}
customElements.define('price-range', PriceRange);

class FacetForm extends HTMLFormElement {
  constructor() {
    super();

    this.dirty = false;
    this.cachedMap = new Map();

    this.addEventListener('change', this.onFormChange);
    this.addEventListener('submit', this.onFormSubmit);
  }

  onFormChange() {
    this.dirty = true;
    this.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  onFormSubmit(event) {
    event.preventDefault();
    if (!this.dirty) return;

    const url = this.buildUrl().toString();
    this.renderSection(url, event);
  }

  buildUrl() {
    const searchParams = new URLSearchParams(new FormData(this));
    const url = new URL(this.action);

    url.search = '';
    searchParams.forEach((value, key) => url.searchParams.append(key, value));

    ['page', 'filter.v.price.gte', 'filter.v.price.lte'].forEach((item) => {
      if (url.searchParams.get(item) === '') {
        url.searchParams.delete(item);
      }
    });

    url.searchParams.set('section_id', FoxTheme.utils.getSectionId(this));
    return url;
  }

  updateURLHash(url) {
    const clonedUrl = new URL(url);
    clonedUrl.searchParams.delete('section_id');
    history.replaceState({}, '', clonedUrl.toString());
  }

  beforeRenderSection() {
    const container = document.getElementById('ProductGridContainer');
    const loadings = document.querySelectorAll('[data-facet-loading]');
    const translateY = FoxTheme.config.motionReduced ? 0 : 50;

    FoxTheme.Motion.timeline([[container, { y: translateY, opacity: 0 }, { duration: 0 }]]);

    setTimeout(() => {
      const target = document.querySelector('.collection');
      window.scrollTo({
        top: target.getBoundingClientRect().top + window.scrollY - 200,
        behavior: FoxTheme.config.motionReduced ? 'auto' : 'smooth',
      });
      if (loadings) {
        loadings.forEach((loading) => {
          loading.classList.add('btn--loading');
        });
      }
    }, 100);
  }

  afterRenderSection() {
    const container = document.getElementById('ProductGridContainer');
    const items = container.querySelectorAll('.product-card');
    const loadings = document.querySelectorAll('[data-facet-loading]');
    const translateY = FoxTheme.config.motionReduced ? 0 : 50;

    FoxTheme.Motion.timeline([
      [container, { y: [translateY, 0], opacity: [0, 1] }],
      [
        items,
        { y: [translateY, 0], opacity: [0, 1], visibility: ['hidden', 'visible'] },
        { duration: 0.5, delay: FoxTheme.config.motionReduced ? 0 : FoxTheme.Motion.stagger(0.1) },
      ],
    ]);

    if (loadings) {
      loadings.forEach((loading) => {
        loading.classList.remove('btn--loading');
      });
    }

    document.dispatchEvent(new CustomEvent('collection:rerendered'));
  }

  renderSection(url, event) {
    this.cachedMap.has(url) ? this.renderSectionFromCache(url, event) : this.renderSectionFromFetch(url, event);

    if (this.hasAttribute('data-history')) this.updateURLHash(url);

    this.dirty = false;
  }

  renderSectionFromFetch(url, event) {
    this.beforeRenderSection();
    const start = performance.now();

    fetch(url)
      .then((response) => response.text())
      .then((responseText) => {
        const execution = performance.now() - start;

        setTimeout(
          () => {
            this.renderFilters(responseText, event);
            this.renderFiltersActive(responseText);
            this.renderProductGridContainer(responseText);
            this.renderFacetFiltersContainer(responseText);
            this.renderProductCount(responseText);
            this.renderSortBy(responseText);
            this.renderSortByMobile(responseText);

            FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.facetUpdate, { responseText: responseText });
            this.cachedMap.set(url, responseText);

            this.afterRenderSection();
          },
          execution > 250 ? 0 : 250
        );
      });
  }

  renderSectionFromCache(url, event) {
    this.beforeRenderSection();

    setTimeout(() => {
      const responseText = this.cachedMap.get(url);
      this.renderFilters(responseText, event);
      this.renderFiltersActive(responseText);
      this.renderProductGridContainer(responseText);
      this.renderFacetFiltersContainer(responseText);
      this.renderProductCount(responseText);
      this.renderSortBy(responseText);
      this.renderSortByMobile(responseText);

      FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.facetUpdate, { responseText: responseText });

      this.afterRenderSection();
    }, 250);
  }

  renderFilters(responseText, event) {
    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
    const facetElements = parsedHTML.querySelectorAll(
      '#FacetFiltersContainer [data-filter], #MobileFacetFiltersContainer [data-filter], #DrawerFacetFiltersContainer [data-filter]'
    );

    const facetElementsFormDom = document.querySelectorAll(
      '#FacetFiltersContainer [data-filter], #MobileFacetFiltersContainer [data-filter], #DrawerFacetFiltersContainer [data-filter]'
    );

    Array.from(facetElementsFormDom).forEach((currentElement) => {
      if (!Array.from(facetElements).some(({ id }) => currentElement.id === id)) {
        currentElement.classList.add('hidden');
      }
    });

    const matchesIndex = (element) => {
      const jsFilter = event ? event.target.closest('[data-filter]') : undefined;
      return jsFilter ? element.dataset.index === jsFilter.dataset.index : false;
    };
    const facetsToRender = Array.from(facetElements).filter((element) => !matchesIndex(element));

    facetsToRender.forEach((element) => {
      const filter = document.querySelector(`[data-filter][data-index="${element.dataset.index}"]`);
      if (filter !== null) {
        filter.classList.remove('hidden');
        if (filter.tagName === 'DETAILS') {
          filter.querySelector('summary + *').innerHTML = element.querySelector('summary + *').innerHTML;
        } else {
          filter.innerHTML = element.innerHTML;
        }
      }
    });
  }

  renderFiltersActive(responseText) {
    const id = 'FacetFiltersActive';
    if (document.getElementById(id) === null) return;
    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');

    document.getElementById(id).innerHTML = parsedHTML.getElementById(id) && parsedHTML.getElementById(id).innerHTML;
  }

  renderProductGridContainer(responseText) {
    const id = 'ProductGridContainer';
    if (document.getElementById(id) === null) return;
    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');

    document.getElementById(id).innerHTML = parsedHTML.getElementById(id) && parsedHTML.getElementById(id).innerHTML;

    const layoutSwitcher = document.querySelector('layout-switcher');
    if (layoutSwitcher) layoutSwitcher.onButtonClick(layoutSwitcher.querySelector('.btn--active'));
  }

  renderFacetFiltersContainer(responseText) {
    const id = 'FacetFiltersContainer';
    if (document.getElementById(id) === null) return;
    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');

    document.getElementById(id).innerHTML = parsedHTML.getElementById(id) && parsedHTML.getElementById(id).innerHTML;
  }

  renderProductCount(responseText) {
    const id = 'ProductCount';
    if (document.getElementById(id) === null) return;
    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');

    document.getElementById(id).innerHTML = parsedHTML.getElementById(id) && parsedHTML.getElementById(id).innerHTML;
  }

  renderSortBy(responseText) {
    const id = 'SortByContainer';
    if (document.getElementById(id) === null) return;
    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');

    document.getElementById(id).innerHTML = parsedHTML.getElementById(id) && parsedHTML.getElementById(id).innerHTML;
  }

  renderSortByMobile(responseText) {
    const id = 'SortByContainerMobile';
    if (document.getElementById(id) === null) return;
    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');

    document.getElementById(id).innerHTML = parsedHTML.getElementById(id) && parsedHTML.getElementById(id).innerHTML;
  }
}
customElements.define('facet-form', FacetForm, { extends: 'form' });

class FacetRemove extends HTMLAnchorElement {
  constructor() {
    super();
    this.addEventListener('click', this.onClick);
  }

  onClick(event) {
    const form = this.closest('form[is="facet-form"]') || document.querySelector('form[is="facet-form"]');

    if (form) {
      event.preventDefault();

      const url = new URL(this.href);
      url.searchParams.set('section_id', FoxTheme.utils.getSectionId(form));
      form.renderSection(url.toString(), event);
    }
  }
}
customElements.define('facet-remove', FacetRemove, { extends: 'a' });

class FacetCount extends HTMLElement {
  constructor() {
    super();
  }

  facetUpdateUnsubscriber = undefined;

  connectedCallback() {
    this.facetUpdateUnsubscriber = FoxTheme.pubsub.subscribe(
      FoxTheme.pubsub.PUB_SUB_EVENTS.facetUpdate,
      this.onFacetUpdate.bind(this)
    );
  }

  disconnectedCallback() {
    if (this.facetUpdateUnsubscriber) {
      this.facetUpdateUnsubscriber();
    }
  }

  get itemCount() {
    return parseInt(this.innerText.replace(/\D/g, ''));
  }

  onFacetUpdate(event) {
    const parsedHTML = new DOMParser().parseFromString(event.responseText, 'text/html');
    const facetCount = parsedHTML.querySelector('facet-count');
    this.innerText = facetCount && facetCount.innerHTML;
    this.hidden = this.itemCount === 0;
  }
}
customElements.define('facet-count', FacetCount);

class FacetToggler extends HTMLButtonElement {
  constructor() {
    super();
    this.onClickHandler = this.onClick.bind(this);
  }

  connectedCallback() {
    this.facetEl = document.getElementById('FacetFiltersContainer');
    this.addEventListener('click', this.onClickHandler);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClickHandler);
  }

  onClick(evt) {
    evt.preventDefault();

    if (this.facetEl.classList.contains('xl:block')) {
      this.facetEl.classList.remove('xl:block');
    } else {
      this.facetEl.classList.add('xl:block');
    }
  }
}
customElements.define('facet-toggler', FacetToggler, { extends: 'button' });

class LoadMoreButton extends HTMLButtonElement {
  constructor() {
    super();
    this.onClickHandler = this.onClick.bind(this);
  }

  connectedCallback() {
    this.addEventListener('click', this.onClickHandler);

    if (this.getAttribute('type') == 'infinite') {
      FoxTheme.Motion.inView(this, this.onClickHandler, { margin: '200px 0px 200px 0px' });
    }
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClickHandler);
  }

  onClick() {
    if (this.classList.contains('btn--loading')) return;
    this.loadingState();

    const url = this.setUrl().toString();

    fetch(url)
      .then((response) => response.text())
      .then((responseText) => {
        this.renderPagination(responseText);
        this.renderProductGridContainer(responseText);
      });
  }

  renderPagination(responseText) {
    const productGridContainer = document.getElementById('ProductGridContainer');
    if (productGridContainer === null) return;

    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
    const pagination = productGridContainer.querySelector('.pagination');
    const source = parsedHTML.querySelector('.pagination');

    if (source) {
      pagination.innerHTML = source.innerHTML;
    } else {
      pagination.remove();
    }
  }

  renderProductGridContainer(responseText) {
    const productGridContainer = document.getElementById('ProductGridContainer');
    if (productGridContainer === null) return;

    const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
    const productList = productGridContainer.querySelector('.products-list');
    const source = parsedHTML.querySelector('.products-list');

    if (source && productList) {
      source.querySelectorAll('.f-column').forEach((item) => {
        productList.appendChild(item);
      });
    }
  }

  setUrl() {
    const url = new URL(this.getAttribute('action'));
    url.searchParams.set('section_id', FoxTheme.utils.getSectionId(this));
    return url;
  }

  loadingState() {
    this.classList.add('pointer-events-none');
    this.classList.add('btn--loading');
  }
}
customElements.define('load-more-button', LoadMoreButton, { extends: 'button' });

class LayoutSwitcher extends HTMLElement {
  constructor() {
    super();
    this.cookieName = 'hypertheme:collection-layout';

    this.initLayoutMode();
    this.buttons.forEach((button) => {
      button.addEventListener('click', this.onButtonClick.bind(this));
    });
  }

  get buttons() {
    return this.querySelectorAll('button');
  }

  /**
   * @param {event|element} evt
   */
  onButtonClick(evt) {
    const target = evt.currentTarget ? evt.currentTarget : evt;
    this.changeLayout(target, target.dataset.layoutMode);
  }

  initLayoutMode() {
    if (FoxTheme.config.hasLocalStorage) {
      const layoutMode = window.localStorage.getItem(this.cookieName);

      if (layoutMode !== null) {
        const target = this.querySelector(`button[data-layout-mode="${layoutMode}"]`);
        if (target) {
          this.changeLayout(target, layoutMode);
        }
      }
    }
  }

  changeLayout(target, layoutMode) {
    const productGrid = document.getElementById('ProductsList');
    if (!productGrid) return;

    productGrid.dataset.layout = layoutMode;

    const { gridClass, listClass } = productGrid.dataset;
    if ((gridClass || listClass) && gridClass !== listClass) {
      const productCards = productGrid.querySelectorAll('.product-card');
      productCards &&
        productCards.forEach((card) => {
          if ('grid' === layoutMode) {
            listClass && card.classList.remove(listClass);
            gridClass && card.classList.add(gridClass);
          } else {
            gridClass && card.classList.remove(gridClass);
            listClass && card.classList.add(listClass);
          }
        });
    }

    this.buttons.forEach((button) => {
      button.classList.remove('btn--active');
    });
    target.classList.add('btn--active');

    if (FoxTheme.config.hasLocalStorage) {
      window.localStorage.setItem(this.cookieName, layoutMode);
    }
  }
}
customElements.define('layout-switcher', LayoutSwitcher);
