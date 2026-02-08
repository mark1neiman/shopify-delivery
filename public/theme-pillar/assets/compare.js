class CompareUtils {
  static cookieName = 'hypertheme:compare-products';

  /**
   *
   * @returns {array}
   */
  static getSelectedProducts() {
    const products = FoxTheme.utils.getStorage(this.cookieName);
    return products || [];
  }

  static setSelectedProducts(products) {
    if (products.length > 0) {
      FoxTheme.utils.setStorage(this.cookieName, products);
    } else {
      localStorage.removeItem(this.cookieName);
    }
  }

  static getProductsCount() {
    return this.getSelectedProducts().length;
  }

  /**
   * Check the given product id in compare list.
   * @param {*} productId
   * @returns {boolean}
   */
  static isProductInList(productId) {
    const products = this.getSelectedProducts();

    return products.find((product) => product.id === productId);
  }

  /**
   *
   * @param {*} productId
   * @param {*} productUrl
   * @returns {boolean} True if the product added to list.
   */
  static addToList(productId, productUrl) {
    let products = FoxTheme.utils.getStorage(this.cookieName) || [];

    if (products.length < FoxTheme.compare.maxProductsInCompare) {
      if (!products.some((product) => product.id === productId)) {
        products.push({ id: productId, url: productUrl });
      }

      this.setSelectedProducts(products);
      this.updateCompareCheckboxes(products);

      FoxTheme.pubsub.publish('compare:add', { products: products, productId: productId, productUrl: productUrl });

      return true;
    } else {
      alert(FoxTheme.compare.alertMessage);

      return false;
    }
  }

  static removeFromList(productId) {
    let products = this.getSelectedProducts();
    if (products) {
      products = products.filter((product) => product.id !== productId);
    }
    this.setSelectedProducts(products);
    this.updateCompareCheckboxes(products);
    FoxTheme.pubsub.publish('compare:remove', { products: products, productId: productId });
  }

  static clearList() {
    const products = this.getSelectedProducts();
    if (products) {
      products.forEach((product) => {
        this.removeFromList(product.id);
      });
    }
  }

  static updateCompareCheckboxes(products = null) {
    products = products || this.getSelectedProducts();
    document.querySelectorAll('.js-compare-checkbox').forEach((checkbox) => {
      checkbox.checked = products.filter((product) => product.id === checkbox.dataset.productId).length;
    });
  }

  static getTemplateUrl(productUrl, queryObj = {}) {
    let url = productUrl;
    const separator = productUrl.includes('?') ? '&' : '?';
    const params = new URLSearchParams();

    for (const key in queryObj) {
      if (Object.prototype.hasOwnProperty.call(queryObj, key)) {
        params.append(key, queryObj[key]);
      }
    }

    // Append parameters to the URL if any were added.
    if (Array.from(params).length > 0) {
      url += `${separator}${params.toString()}`;
    }

    return url;
  }

  static getCompareBarItemTemplate(productUrl) {
    return this.getTemplateUrl(productUrl, {
      sections: 'product-compare-bar-item',
    });
  }
}

class CompareSwitch extends HTMLElement {
  constructor() {
    super();

    this.cookieName = 'hypertheme:compare-is-active';

    this.classes = {
      isActive: 'is-product-comparing',
    };

    this.checkboxEl = this.querySelector('input');
    this.onChangeHandler = this.onChange.bind(this);
  }

  connectedCallback() {
    this.init();
    this.checkboxEl.addEventListener('change', this.onChangeHandler);
  }

  disconnectedCallback() {
    this.checkboxEl.removeEventListener('change', this.onChangeHandler);
  }

  init() {
    if (FoxTheme.config.hasLocalStorage) {
      const isActive = window.localStorage.getItem(this.cookieName) === 'true';
      if (isActive) {
        this.checkboxEl.checked = isActive;
        this.handleChange(isActive);
      }
    }
  }

  onChange(evt) {
    evt.preventDefault();

    this.handleChange(this.checkboxEl.checked);
  }

  handleChange(isActive) {
    requestAnimationFrame(() => {
      if (isActive) {
        document.body.classList.add(this.classes.isActive);
      } else {
        document.body.classList.remove(this.classes.isActive);
      }
    });

    FoxTheme.pubsub.publish('compare:toggle', { isActive: isActive });

    if (FoxTheme.config.hasLocalStorage) {
      window.localStorage.setItem(this.cookieName, isActive);
    }
  }
}
customElements.define('compare-switch', CompareSwitch);

class CompareCheckbox extends HTMLElement {
  constructor() {
    super();

    this.checkboxEl = this.querySelector('input');
    this.onChangeHandler = this.onChange.bind(this);
  }

  connectedCallback() {
    this.init();
    this.checkboxEl.addEventListener('change', this.onChangeHandler);
  }

  disconnectedCallback() {
    this.checkboxEl.removeEventListener('change', this.onChangeHandler);
  }

  init() {
    const { productId } = this.checkboxEl.dataset;
    this.checkboxEl.checked = CompareUtils.isProductInList(productId);
  }

  onChange(evt) {
    evt.preventDefault();

    const { productId, productUrl } = this.checkboxEl.dataset;

    if (this.checkboxEl.checked) {
      const isAdded = CompareUtils.addToList(productId, productUrl);
      if (!isAdded) {
        this.checkboxEl.checked = false;
      }
    } else {
      CompareUtils.removeFromList(productId);
    }
  }
}
customElements.define('compare-checkbox', CompareCheckbox);

class CompareRemove extends HTMLButtonElement {
  constructor() {
    super();

    this.onClickHandler = this.onClick.bind(this);
    this.addEventListener('click', this.onClick.bind(this));
  }

  onClick(event) {
    event.preventDefault();

    const { productId } = this.dataset;
    const { target } = event;

    CompareUtils.removeFromList(productId);

    const compareModal = target.closest('.compare-drawer');
    if (compareModal) {
      compareModal.updateProductsCount();
    }

    if (CompareUtils.getProductsCount() < 2) {
      compareModal && compareModal.hide();
    } else {
      const compareTable = target.closest('.compare-table');
      if (compareTable) {
        const cell = target.closest('td');
        const colIndex = cell.cellIndex;

        const rows = compareTable.querySelectorAll('tr');
        rows.forEach((row) => {
          const cellToRemove = row.cells[colIndex];
          if (cellToRemove) {
            cellToRemove.remove();
          }
        });
      }
    }
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClickHandler);
  }
}
customElements.define('compare-remove', CompareRemove, { extends: 'button' });

class CompareBar extends HTMLElement {
  constructor() {
    super();

    this.selectors = {
      openBtn: '.compare-bar__open',
      clearBtns: ['.compare-bar__clear'],
      toggleList: '.compare-bar__toggle-list',
      list: '.compare-bar__list',
      counter: '.compare-bar__counter',
    };

    this.classes = {
      listVisible: 'is-show-list',
    };

    this.abortController = new AbortController();
    this.elements = FoxTheme.utils.queryDomNodes(this.selectors, this);
    this.atLeastItemToShow = Math.min(5, FoxTheme.compare.maxProductsInCompare); // Total compare products and placeholders.

    this.elements.clearBtns.forEach((clearBtn) => {
      clearBtn.addEventListener('click', this.handleClear.bind(this), {
        signal: this.abortController.signal,
      });
    });

    this.elements.toggleList.addEventListener('click', this.handleToggleList.bind(this), {
      signal: this.abortController.signal,
    });

    this.itemAddUnsubscriber = FoxTheme.pubsub.subscribe('compare:add', this.onItemAdded.bind(this));
    this.itemRemoveUnsubscriber = FoxTheme.pubsub.subscribe('compare:remove', this.onItemRemoved.bind(this));
  }

  itemAddUnsubscriber = undefined;
  itemRemoveUnsubscriber = undefined;

  connectedCallback() {
    this.renderBar();
    const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
    mql.onchange = this.setHeight.bind(this);
    this.setHeight();
  }

  disconnectedCallback() {
    this.abortController.abort();

    if (this.itemAddUnsubscriber) {
      this.itemAddUnsubscriber();
    }

    if (this.itemRemoveUnsubscriber) {
      this.itemRemoveUnsubscriber();
    }
  }

  onItemAdded(event) {
    const { products, productId, productUrl } = event;

    this.appendBarItem(products, productId, productUrl);
    this.toggleCompareButton(products.length);
    this.updateCounters(products.length);
  }

  onItemRemoved(event) {
    const { products, productId } = event;
    const itemToDelete = this.elements.list.querySelector(`.compare-bar__item[data-product-id="${productId}"]`);

    itemToDelete && itemToDelete.remove();
    this.toggleCompareButton(products.length);
    this.updateCounters(products.length);
    this.removePlaceholdes();
    this.addPlaceholders(products.length);
  }

  async renderBar() {
    const products = CompareUtils.getSelectedProducts();

    let output = '';
    const compareItemHtmls = await this.getBarItems(products);
    compareItemHtmls.forEach((htmlStr) => {
      output += htmlStr;
    });

    this.removePlaceholdes();
    this.elements.list.innerHTML = output;
    this.addPlaceholders(products.length);

    this.toggleCompareButton(products.length);
    this.updateCounters(products.length);
  }

  async getBarItems(products) {
    const tmps = [];
    await Promise.all(
      products.map(async (product) => {
        const fetchUrl = CompareUtils.getCompareBarItemTemplate(product.url);
        await fetch(CompareUtils.getCompareBarItemTemplate(product.url))
          .then((response) => response.json())
          .then((response) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response['product-compare-bar-item'], 'text/html');
            const itemHtml = doc.querySelector('.shopify-section');

            tmps[product.id] = itemHtml.innerHTML;
          });
      })
    );

    const returns = [];
    products.forEach((product) => returns.push(tmps[product.id]));
    return returns;
  }

  async appendBarItem(products, productId, productUrl) {
    this.removePlaceholdes();
    this.elements.list.insertAdjacentHTML(
      'beforeend',
      `<li class="compare-bar__item" data-product-id="${productId}"></li>`
    );
    this.addPlaceholders(products.length);

    await fetch(CompareUtils.getCompareBarItemTemplate(productUrl))
      .then((response) => response.json())
      .then((response) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(response['product-compare-bar-item'], 'text/html');
        const itemHtml = doc.querySelector('.shopify-section');

        const itemEl = this.elements.list.querySelector('[data-product-id="' + productId + '"]');
        if (itemEl) {
          itemEl.outerHTML = itemHtml.innerHTML;
        }
      });
  }

  handleToggleList(event) {
    event.preventDefault();

    if (this.classList.contains(this.classes.listVisible)) {
      this.classList.remove(this.classes.listVisible);
    } else {
      this.classList.add(this.classes.listVisible);
    }

    this.setHeight();
  }

  handleClear() {
    CompareUtils.clearList();
  }

  toggleCompareButton(count) {
    this.elements.openBtn.disabled = !(count > 1);
  }

  updateCounters(count) {
    this.elements.counter.innerText = count;
  }

  removePlaceholdes() {
    Array.from(this.elements.list.querySelectorAll('li')).forEach((li) => {
      if (li.classList.contains('compare-bar__item-placeholder')) {
        li.remove();
      }
    });
  }

  addPlaceholders(count) {
    const placeholderCount = this.atLeastItemToShow - count;

    for (let i = 0; i < placeholderCount; i++) {
      const placeholderItem = document.createElement('li');

      placeholderItem.classList.add('compare-bar__item', 'compare-bar__item-placeholder');
      this.elements.list.appendChild(placeholderItem);
    }
  }

  setHeight() {
    requestAnimationFrame(() => {
      const offsetHeight = Math.round(this.offsetHeight);
      document.documentElement.style.setProperty('--compare-bar-height', `${offsetHeight}px`);
    });
  }
}
customElements.define('compare-bar', CompareBar);

class CompareDrawer extends DrawerComponent {
  constructor() {
    super();

    this.selectors = {
      table: '.compare-table',
    };

    this.classesToRemoveOnLoad = 'drawer--loading';
  }

  get requiresBodyAppended() {
    return false;
  }

  get selector() {
    return '.product-comparison-table';
  }

  get sourceSelector() {
    return '#MainProduct-compare__rows';
  }

  get placeholderSelector() {
    return '#MainProduct-compare__placeholder';
  }

  getSectionId() {
    let sectionId = FoxTheme.ProductCompareSectionId || false;

    if (!sectionId) {
      // Get section id from overlay groups.
      const sectionEl = document.querySelector('.section-group-overlay-product-compare');
      if (sectionEl) {
        sectionId = FoxTheme.utils.getSectionId(sectionEl);
      }

      // Cache for better performance.
      FoxTheme.ProductCompareSectionId = sectionId;
    }

    return sectionId;
  }

  // shouleBeShow() {
  //   const sectionId = this.getSectionId();
  //   return typeof sectionId === 'string';
  // }

  prepareToShow() {
    super.prepareToShow();
    this.renderCompareTable();
  }

  async renderCompareTable() {
    const drawerContent = this.querySelector(this.selector);
    const sectionId = this.getSectionId();

    const products = CompareUtils.getSelectedProducts();

    this.updateProductsCount();

    this.elements = FoxTheme.utils.queryDomNodes(this.selectors, this);
    const tableRows = this.elements.table.querySelectorAll('tbody tr');
    let compareRows = await this.getCompareTableRows(products);

    if (Shopify.designMode) {
      // Append placeholder items in editor mode.
      let maxPlaceholderItems = 3;

      if (compareRows.length == 2) {
        maxPlaceholderItems = 2;
      }

      let numberPlaceholderItems =
        compareRows.length > 0 ? maxPlaceholderItems - compareRows.length : maxPlaceholderItems;

      if (numberPlaceholderItems > 0) {
        const placeholderRows = this.getCompareTablePlaceholderRows(numberPlaceholderItems);

        compareRows = compareRows.concat(placeholderRows);

        this.updateProductsCount(maxPlaceholderItems);
      }
    }

    compareRows.forEach((compareRow) => {
      tableRows.forEach((row) => {
        const compareKey = row.dataset.compareKey;
        const compareCol = compareRow.querySelector(`td[data-compare-key="${compareKey}"]`);
        row.appendChild(compareCol);
      });
    });

    setTimeout(() => {
      this.classList.remove(this.classesToRemoveOnLoad);
    }, 300);
  }

  updateProductsCount(count) {
    this.style.setProperty('--number-items', count || CompareUtils.getProductsCount());
  }

  async getCompareTableRows(products) {
    const tmps = [];
    const sectionId = this.getSectionId();
    await Promise.all(
      products.map(async (product) => {
        const fetchUrl = CompareUtils.getTemplateUrl(product.url, {
          section_id: sectionId,
        });
        await fetch(fetchUrl)
          .then((response) => response.text())
          .then((responseText) => {
            const rowTemplate = new DOMParser()
              .parseFromString(responseText, 'text/html')
              .querySelector(this.sourceSelector);

            tmps[product.id] = rowTemplate.content.cloneNode(true);
          });
      })
    );

    const returns = [];
    products.forEach((product) => returns.push(tmps[product.id]));
    return returns;
  }

  getCompareTablePlaceholderRows(count) {
    const rowTemplate = this.querySelector(this.placeholderSelector);

    const returns = [];
    for (let i = 0; i < count; i++) {
      returns.push(rowTemplate.content.cloneNode(true));
    }

    return returns;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.handleAfterHide();
  }

  handleAfterHide() {
    super.handleAfterHide();
    // Clean the table.
    this.querySelectorAll('.compare-table > tbody > tr').forEach((row) => {
      const nonLabelCells = row.querySelectorAll('td:not(.td-label)');
      nonLabelCells.forEach((cell) => {
        cell.remove();
      });
    });

    this.classList.add(this.classesToRemoveOnLoad);
  }
}
customElements.define('compare-drawer', CompareDrawer);
