class PredictiveSearch extends HTMLElement {
  constructor() {
    super();
    this.cachedMap = new Map();
    this.focusElement = this.input;
    this.resetButton.addEventListener('click', this.clear.bind(this));
    this.input.addEventListener('input', FoxTheme.utils.debounce(this.onChange.bind(this), 300));
    this.input.addEventListener('focus', this.onFocus.bind(this));
    this.searchContent = this.querySelector('.search__content');
    this.searchRecommendationEmpty = this.dataset.searchRecommendationEmpty === 'true';
    this.header = document.querySelector('header');
    this.toggleNavigationButton = document.querySelector('.toggle-navigation-button');

    this.boundHandleClickOutside = this.handleClickOutside.bind(this);
    document.addEventListener('click', this.boundHandleClickOutside);
    this.searchProductTypes?.addEventListener('change', this.handleProductTypeChange.bind(this));

    this.isHeaderSearch = this.closest('header') !== null;

    document.addEventListener('menu-drawer:open', () => {
      this.classList.remove('predictive-search-open');
      document.body.classList.remove('search-open');
    });

    this.states = {
      OPEN: 'predictive-search-open',
      LOADING: 'btn--loading',
      SEARCH_OPEN: 'search-open',
    };
  }

  get input() {
    return this.querySelector('input[type="search"]');
  }
  get resetButton() {
    return this.querySelector('button[type="reset"]');
  }

  get searchProductTypes() {
    return this.querySelector('#SearchProductTypes');
  }

  onFocus(event) {
    document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
    document.documentElement.style.setProperty(
      '--header-bottom-position',
      `${parseInt(this.header.getBoundingClientRect().bottom)}px`
    );
    if (this.isHeaderSearch && !this.searchRecommendationEmpty) {
      document.body.classList.add('search-open');
      this.toggleNavButtonVisibility(false);
    }

    if (!this.searchRecommendationEmpty) {
      this.searchContent.classList.remove('hidden');
    }
    this.classList.add('predictive-search-open');
    if (this.getQuery().length === 0) {
      if (this.searchRecommendationEmpty) {
        this.searchContent.classList.add('hidden');
      }
      return;
    }
    const url = this.setupURL().toString();
    this.renderSection(url, event);
  }

  getQuery() {
    return this.input.value.trim();
  }

  clear(event = null) {
    event?.preventDefault();
    this.input.value = '';
    this.input.focus();
    this.removeAttribute('results');
    this.toggleSearchState(false);
  }

  handleProductTypeChange(evt) {
    const query = this.getQuery();
    if (query.length > 0) {
      const url = this.setupURL().toString();
      this.renderSection(url);
    }
  }

  setupURL() {
    const url = new URL(`${window.shopUrl}${FoxTheme.routes.predictive_search_url}`);
    let search_term = this.getQuery();
    if (this.searchProductTypes && this.searchProductTypes.value != '') {
      search_term = `product_type:${this.searchProductTypes.value} AND ${encodeURIComponent(search_term)}`;
    }
    return (
      url.searchParams.set('q', search_term),
      url.searchParams.set('resources[limit]', this.dataset.resultsLimit || 3),
      url.searchParams.set('resources[limit_scope]', 'each'),
      url.searchParams.set('section_id', FoxTheme.utils.getSectionId(this)),
      url
    );
  }

  onChange() {
    if (this.getQuery().length === 0) {
      this.clear();
      return;
    }
    const url = this.setupURL().toString();
    this.renderSection(url);
  }

  renderSection(url) {
    this.cachedMap.has(url) ? this.renderSectionFromCache(url) : this.renderSectionFromFetch(url);
  }

  renderSectionFromCache(url) {
    const responseText = this.cachedMap.get(url);
    this.renderSearchResults(responseText), this.setAttribute('results', '');
  }

  renderSectionFromFetch(url) {
    this.setLoadingState(true);

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.text();
      })
      .then((responseText) => {
        this.renderSearchResults(responseText);
        this.cachedMap.set(url, responseText);
      })
      .catch((error) => {
        console.error('Error fetching data: ', error);
        this.setAttribute('error', 'Failed to load data');
      })
      .finally(() => this.setLoadingState(false));
  }
  renderSearchResults(responseText) {
    const id = 'PredictiveSearchResults-' + FoxTheme.utils.getSectionId(this);
    const targetElement = document.getElementById(id);

    if (targetElement) {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(responseText, 'text/html');
      const contentElement = parsedDoc.getElementById(id);

      if (contentElement) {
        this.searchContent?.classList.remove('hidden');
        targetElement.innerHTML = contentElement.innerHTML;

        if (this.isHeaderSearch && !document.body.classList.contains('search-open')) {
          document.body.classList.add('search-open');
          this.toggleNavButtonVisibility(true);
          this.classList.add('predictive-search-open');
        } else {
          this.classList.add('predictive-search-open');
        }
      } else {
        console.error(`Element with id '${id}' not found in the parsed response.`);
      }
    } else {
      console.error(`Element with id '${id}' not found in the document.`);
    }
  }

  handleClickOutside(event) {
    const target = event.target;
    const shouldClose = this.isHeaderSearch
      ? !this.contains(target) &&
        ((target.classList.contains('fixed-overlay') && target.closest('.header-section')) ||
          target.classList.contains('header__search-close'))
      : !this.contains(target);

    if (shouldClose) {
      setTimeout(() => this.toggleSearchState(false));
    }
  }

  toggleSearchState(isOpen) {
    this.classList.toggle(this.states.OPEN, isOpen);
    if (this.isHeaderSearch) {
      document.body.classList.toggle(this.states.SEARCH_OPEN, isOpen);
      this.toggleNavButtonVisibility(!isOpen);
    }
    if (!isOpen && this.searchRecommendationEmpty) {
      this.searchContent?.classList.add('hidden');
    }
  }

  toggleNavButtonVisibility(isOpen) {
    this.toggleNavigationButton && this.toggleNavigationButton.classList.toggle('is-show', isOpen);
  }

  setLoadingState(isLoading) {
    if (isLoading) {
      this.setAttribute('loading', 'true');
      this.resetButton.classList.add(this.states.LOADING);
    } else {
      this.removeAttribute('loading');
      this.resetButton.classList.remove(this.states.LOADING);
      this.setAttribute('results', 'true');
    }
  }
}
customElements.define('predictive-search', PredictiveSearch);
