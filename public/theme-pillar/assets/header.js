class BasicHeader extends HTMLElement {
  constructor() {
    super();
  }

  get headerSection() {
    return document.querySelector('.header-section');
  }

  get headerNavigation() {
    return this.querySelector('.header__bottom');
  }

  get navigationToggleButton() {
    return this.querySelector('.toggle-navigation-button');
  }

  get enableTransparent() {
    return this.dataset.enableTransparent === 'true';
  }

  connectedCallback() {
    this.init();
    if (window.ResizeObserver) {
      new ResizeObserver(this.setHeight.bind(this)).observe(this);
    }

    // window.addEventListener('resize', this.setMenuHeight.bind(this));

    if (Shopify.designMode) {
      const section = this.closest('.shopify-section');
      section.addEventListener('shopify:section:load', this.init.bind(this));
      section.addEventListener('shopify:section:unload', this.init.bind(this));
      section.addEventListener('shopify:section:reorder', this.init.bind(this));
    }
  }

  init() {
    new FoxTheme.delayUntilInteraction(this.setHeight.bind(this));

    if (this.enableTransparent) {
      this.headerSection.classList.add('header-transparent');
    }
  }

  calculateHeaderGroupHeight() {
    const headerGroups = document.querySelectorAll('.shopify-section-group-header-group');
    let totalHeight = 0;

    headerGroups.forEach((section) => {
      totalHeight += section.offsetHeight;
    });

    document.documentElement.style.setProperty('--header-group-height', `${totalHeight}px`);

    return totalHeight;
  }

  setHeight() {
    requestAnimationFrame(() => {
      const offsetHeight = Math.round(this.offsetHeight);
      const offsetTop = Math.round(this.parentElement.offsetTop);
      const offsetNavigationHeight = Math.round(this.headerNavigation.offsetHeight);

      document.documentElement.style.setProperty('--header-height', `${offsetHeight}px`);
      document.documentElement.style.setProperty('--header-offset-top', `${offsetTop}px`);
      document.documentElement.style.setProperty('--header-navigation-height', `${offsetNavigationHeight - 1}px`);

      this.calculateHeaderGroupHeight();
    });
  }
}

customElements.define('basic-header', BasicHeader, { extends: 'header' });

class StickyHeader extends BasicHeader {
  constructor() {
    super();

    // Group CSS classes in one object for easier management
    this.classes = {
      pinned: 'header-pinned',
      headerScrolled: 'header-scrolled',
      show: 'is-show',
      hide: 'is-hide',
      headerSticky: 'header-sticky',
      isHideNav: 'is-hide-nav',
    };

    // Track navigation toggle state
    this.navigationManuallyToggled = false;

    // Initialize scroll tracking variables
    this.currentScrollTop = 0;
    this.lastScrollPos = 0;

    // Add scroll threshold to prevent quick unpinning
    this.scrollThreshold = 200; // Minimum scroll amount before unpinning
    this.scrollDirection = 'none';
    this.scrollDistance = 0;
  }

  // Getters for easier property access
  get isAlwaysSticky() {
    return this.dataset.stickyType === 'always';
  }

  get collapseOnScroll() {
    return this.dataset.collapseOnScroll === 'true';
  }

  connectedCallback() {
    super.connectedCallback();

    // Store initial scroll position
    this.firstScrollTop = window.scrollY;

    // Cache header dimensions for performance optimization
    this.headerBounds = this.headerSection.getBoundingClientRect();

    // Initialize sticky header
    this.initStickyHeader();

    // Register toggle button event if needed
    if (this.collapseOnScroll && this.navigationToggleButton) {
      this.navigationToggleButton.addEventListener('click', this.handleNavigationToggle.bind(this));
    }
  }

  // Initialize sticky header behavior
  initStickyHeader() {
    this.headerSection.classList.add(this.classes.headerSticky);
    this.headerSection.dataset.stickyType = this.dataset.stickyType;
    window.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
  }

  // Handle navigation toggle button click
  handleNavigationToggle(event) {
    event.preventDefault();

    this.navigationManuallyToggled = true;
    const isHidden = this.headerNavigation.classList.contains(this.classes.hide);

    // Toggle visibility state
    setTimeout(
      () => {
        document.body.classList.toggle(this.classes.isHideNav, !isHidden);
      },
      isHidden ? 0 : 250
    );
    this.headerNavigation.classList.toggle(this.classes.hide, !isHidden);
    this.headerNavigation.classList.toggle(this.classes.show, isHidden);
    this.navigationToggleButton.setAttribute('aria-expanded', isHidden);

    // Reset toggle state after delay
    setTimeout(() => {
      this.navigationManuallyToggled = false;
    }, 1000);
  }

  // Handle scroll events
  handleScroll() {
    const scrollTop = window.scrollY;
    const headerSection = this.headerSection;

    // Avoid recalculating dimensions on each scroll
    const headerBoundsTop = this.headerBounds.top + this.firstScrollTop;
    const headerBoundsBottom = this.headerBounds.bottom + this.firstScrollTop;

    // Update scroll direction and distance
    this.updateScrollMetrics(scrollTop);

    // Use requestAnimationFrame for performance optimization
    requestAnimationFrame(() => {
      const isScrolledPastHeader = scrollTop > headerBoundsTop;

      // Handle different scroll positions
      if (isScrolledPastHeader) {
        this.handleScrolledPastHeader(scrollTop, headerBoundsBottom);
      } else {
        this.handleScrolledBeforeHeader();
      }

      this.currentScrollTop = scrollTop;
    });
  }

  // Update scroll direction and accumulated distance
  updateScrollMetrics(scrollTop) {
    // Determine scroll direction
    const newDirection = scrollTop > this.currentScrollTop ? 'down' : 'up';

    // Reset accumulated distance when direction changes
    if (newDirection !== this.scrollDirection) {
      this.scrollDistance = 0;
      this.scrollDirection = newDirection;
    } else {
      // Accumulate scroll distance in the same direction
      this.scrollDistance += Math.abs(scrollTop - this.currentScrollTop);
    }
  }

  // Handle scroll position after passing the header
  handleScrolledPastHeader(scrollTop, headerBoundsBottom) {
    this.headerSection.classList.add(this.classes.headerScrolled);

    // Handle collapse on scroll behavior
    if (this.collapseOnScroll) {
      this.navigationToggleButton.classList.add(this.classes.show);
      if (!this.navigationManuallyToggled && !this.headerNavigation.classList.contains(this.classes.show)) {
        this.headerNavigation.classList.add(this.classes.hide);
        document.body.classList.add(this.classes.isHideNav);
      }
    }

    // Handle sticky behavior based on configuration
    if (this.isAlwaysSticky) {
      document.body.classList.add(this.classes.pinned);
    } else {
      // Improved sticky on scroll up logic
      const isScrollingUp = this.scrollDirection === 'up';
      const isNearHeader = scrollTop < headerBoundsBottom + 100;
      const hasScrolledEnough = this.scrollDistance >= this.scrollThreshold;

      if (isScrollingUp || isNearHeader) {
        document.body.classList.add(this.classes.pinned);
      } else if (!this.navigationManuallyToggled && hasScrolledEnough) {
        // Only unpin when scrolled down enough and not manually toggled
        document.body.classList.remove(this.classes.pinned);
      }
    }
  }

  // Handle scroll position before the header
  handleScrolledBeforeHeader() {
    this.headerSection.classList.remove(this.classes.headerScrolled);

    if (this.collapseOnScroll) {
      if (!this.navigationManuallyToggled) {
        document.body.classList.remove(this.classes.isHideNav);
        this.headerNavigation.classList.remove(this.classes.hide);
        this.headerNavigation.classList.remove(this.classes.show);
        this.navigationToggleButton.setAttribute('aria-expanded', false);
      }
      this.navigationToggleButton.classList.remove(this.classes.show);
    }

    if (this.isAlwaysSticky) {
      document.body.classList.remove(this.classes.pinned);
    }
  }
}

customElements.define('sticky-header', StickyHeader, { extends: 'header' });

const clearDropdownCount = new WeakMap();
class DetailsDropdown extends HTMLDetailsElement {
  constructor() {
    super();
    // Initialize properties
    this.classes = { bodyClass: 'has-dropdown-menu' };
    this.events = {
      handleAfterHide: 'menu:handleAfterHide',
      handleAfterShow: 'menu:handleAfterShow',
    };

    // Reference to first and last child elements
    this.summaryElement = this.firstElementChild;
    this.contentElement = this.lastElementChild;

    // Initial state based on attributes
    this._open = this.hasAttribute('open');

    // Event listeners for summary element
    this.summaryElement.addEventListener('click', this.handleSummaryClick.bind(this));

    if (this.trigger === 'hover') {
      this.summaryElement.addEventListener('focusin', (event) => {
        if (event.target === this.summaryElement) {
          this.open = true;
        }
      });
      this.summaryElement.addEventListener('focusout', (event) => {
        if (!this.contentElement.contains(event.relatedTarget)) {
          this.open = false;
        }
      });
    }

    // Binding methods to ensure 'this' context is correct when they are called
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.handleEscKeyPress = this.handleEscKeyPress.bind(this);
    this.handleFocusOut = this.handleFocusOut.bind(this);

    // Setup hover detection with debouncing
    this.hoverEnterTimer = null;
    this.hoverLeaveTimer = null;
    this.detectHoverListener = this.detectHover.bind(this);
    // this.addEventListener('mouseenter', this.detectHoverListener.bind(this));
    // this.addEventListener('mouseleave', this.detectHoverListener.bind(this));

    this.addEventListener('mouseenter', (event) => {
      if (this.hoverLeaveTimer) {
        clearTimeout(this.hoverLeaveTimer);
        this.hoverLeaveTimer = null;
      }
      this.hoverEnterTimer = setTimeout(() => {
        this.detectHover({ type: 'mouseenter' });
      }, 100);
    });

    this.addEventListener('mouseleave', (event) => {
      if (this.hoverEnterTimer) {
        clearTimeout(this.hoverEnterTimer);
        this.hoverEnterTimer = null;
      }

      this.hoverLeaveTimer = setTimeout(() => {
        this.detectHover({ type: 'mouseleave' });
      }, 150);
    });
  }

  set open(value) {
    // Check if the new value is different from the current value
    if (value !== this._open) {
      // Update the internal state
      this._open = value;

      // Perform actions based on whether the element is connected to the DOM
      if (this.isConnected) {
        // If connected, perform a transition
        this.transition(value);
      } else {
        // If not connected, directly manipulate the 'open' attribute
        if (value) {
          this.setAttribute('open', '');
        } else {
          this.removeAttribute('open');
        }
      }
    }
  }

  get open() {
    return this._open;
  }

  get trigger() {
    // For touch devices, always use click events
    if (FoxTheme.config.isTouch) {
      return 'click';
    }

    // For non-touch devices, check for custom trigger attribute
    return this.getAttribute('trigger') || 'click';
  }

  get level() {
    if (this.hasAttribute('level')) {
      return this.getAttribute('level');
    } else {
      return 'top';
    }
  }

  handleSummaryClick(event) {
    // Prevent the default action of the event
    event.preventDefault();

    // Check if the device is not touch-enabled and the trigger type is 'hover'
    if (!FoxTheme.config.isTouch && this.trigger === 'hover' && this.summaryElement.hasAttribute('data-link')) {
      // If conditions are met, navigate to the URL specified in 'data-link'
      window.location.href = this.summaryElement.getAttribute('data-link');
    } else {
      // Otherwise, toggle the 'open' state
      this.open = !this.open;
    }
  }

  async transition(value) {
    if (value) {
      // Increment the lock count for dropdowns
      clearDropdownCount.set(DetailsDropdown, clearDropdownCount.get(DetailsDropdown) + 1);

      // Add class to body and set attributes
      document.body.classList.add(this.classes.bodyClass);
      this.setAttribute('open', '');
      this.summaryElement.setAttribute('open', '');
      setTimeout(() => {
        this.contentElement.setAttribute('open', '');
      }, 100);

      // Add event listeners
      document.addEventListener('click', this.handleOutsideClick);
      document.addEventListener('keydown', this.handleEscKeyPress);
      document.addEventListener('focusout', this.handleFocusOut);

      // Perform the transition in animation
      await this.showWithTransition();

      const MenuProductList = this.querySelector('menu-product-list');
      if (MenuProductList && typeof MenuProductList === 'object') {
        MenuProductList.calcNavButtonsPosition();
      }

      // Check for reverse condition (not implemented here for brevity)
      this.needsReverse();

      // Wait for the after show event
      return FoxTheme.utils.waitForEvent(this, this.events.handleAfterShow);
    } else {
      // Decrement the lock count for dropdowns
      clearDropdownCount.set(DetailsDropdown, clearDropdownCount.get(DetailsDropdown) - 1);

      // Toggle class on body based on lock count
      document.body.classList.toggle(this.classes.bodyClass, clearDropdownCount.get(DetailsDropdown) > 0);

      // Remove attributes and event listeners
      this.summaryElement.removeAttribute('open');
      this.contentElement.removeAttribute('open');
      document.removeEventListener('click', this.handleOutsideClick);
      document.removeEventListener('keydown', this.handleEscKeyPress);
      document.removeEventListener('focusout', this.handleFocusOut);

      // Perform the transition out animation
      await this.hideWithTransition();

      // Conditionally remove the 'open' attribute
      if (!this.open) {
        this.removeAttribute('open');
      }

      // Wait for the after hide event
      return FoxTheme.utils.waitForEvent(this, this.events.handleAfterHide);
    }
  }

  async showWithTransition() {
    FoxTheme.Motion.animate(
      this.contentElement,
      { opacity: [0, 1], visibility: 'visible' },
      {
        duration: FoxTheme.config.motionReduced ? 0 : 0.6,
        easing: [0.7, 0, 0.2, 1],
        delay: FoxTheme.config.motionReduced ? 0 : 0.1,
      }
    );
    const translateY = this.level === 'top' ? '-105%' : '2rem';
    return FoxTheme.Motion.animate(
      this.contentElement.firstElementChild,
      { transform: [`translateY(${translateY})`, 'translateY(0)'] },
      {
        duration: FoxTheme.config.motionReduced ? 0 : 0.6,
        easing: [0.7, 0, 0.2, 1],
      }
    ).finished;
  }

  async hideWithTransition() {
    FoxTheme.Motion.animate(
      this.contentElement,
      { opacity: 0, visibility: 'hidden' },
      {
        duration: FoxTheme.config.motionReduced ? 0 : 0.3,
        easing: [0.7, 0, 0.2, 1],
      }
    );
    const translateY = this.level === 'top' ? '-105%' : '2rem';
    return FoxTheme.Motion.animate(
      this.contentElement.firstElementChild,
      { transform: `translateY(${translateY})` },
      {
        duration: FoxTheme.config.motionReduced ? 0 : 0.6,
        easing: [0.7, 0, 0.2, 1],
      }
    ).finished;
  }

  handleOutsideClick(event) {
    const isClickInside = this.contains(event.target);
    const isClickOnDetailsDropdown = event.target.closest('details') instanceof DetailsDropdown;

    if (!isClickInside && !isClickOnDetailsDropdown) {
      this.open = false;
    }
  }

  handleEscKeyPress(event) {
    if (event.code === 'Escape') {
      const targetMenu = event.target.closest('details[open]');
      if (targetMenu) {
        targetMenu.open = false;
      }
    }
  }

  handleFocusOut(event) {
    if (event.relatedTarget && !this.contains(event.relatedTarget)) {
      this.open = false;
    }
  }

  detectHover(event) {
    if (this.trigger === 'hover') {
      this.open = event.type === 'mouseenter';
    }
  }

  needsReverse() {
    const totalWidth = this.contentElement.offsetLeft + this.contentElement.clientWidth * 2;
    if (totalWidth > window.innerWidth) {
      this.contentElement.classList.add('needs-reverse');
    }
  }
}

customElements.define('details-dropdown', DetailsDropdown, { extends: 'details' });
clearDropdownCount.set(DetailsDropdown, 0);

class DetailsMega extends DetailsDropdown {
  constructor() {
    super();
    if (Shopify.designMode) {
      this.addEventListener('shopify:block:select', () => {
        this.open = true;
      });

      this.addEventListener('shopify:block:deselect', () => {
        this.open = false;
      });
    }
  }

  async showWithTransition() {
    // Perform the animation on the first child of the content element
    return FoxTheme.Motion.animate(
      this.contentElement.firstElementChild,
      {
        visibility: 'visible',
        transform: ['translateY(-100%)', 'translateY(0)'],
      },
      {
        duration: FoxTheme.config.motionReduced ? 0 : 0.5,
        easing: [0.39, 0.575, 0.565, 1.0],
      }
    ).finished;
  }

  async hideWithTransition() {
    return FoxTheme.Motion.animate(
      this.contentElement.firstElementChild,
      {
        visibility: 'hidden',
        transform: 'translateY(-100%)',
      },
      {
        duration: FoxTheme.config.motionReduced ? 0 : 0.5,
        easing: [0.39, 0.575, 0.565, 1.0],
      }
    ).finished;
  }
}

customElements.define('details-mega', DetailsMega, { extends: 'details' });

class MenuDrawerDetails extends HTMLDetailsElement {
  constructor() {
    super();

    this.summary.addEventListener('click', this.onSummaryClick.bind(this));
    this.closeButton.addEventListener('click', this.onCloseButtonClick.bind(this));
  }

  get parent() {
    return this.closest('[data-parent]');
  }

  get summary() {
    return this.querySelector('summary');
  }

  get closeButton() {
    return this.querySelector('button');
  }

  onSummaryClick() {
    setTimeout(() => {
      this.parent.classList.add('active');
      this.classList.add('active');
      this.summary.setAttribute('aria-expanded', true);
    }, 100);
  }

  onCloseButtonClick() {
    this.parent.classList.remove('active');
    this.classList.remove('active');
    this.summary.setAttribute('aria-expanded', false);

    this.closeAnimation();
  }

  closeAnimation() {
    let animationStart;

    const handleAnimation = (time) => {
      if (animationStart === undefined) {
        animationStart = time;
      }

      const elapsedTime = time - animationStart;

      if (elapsedTime < 400) {
        window.requestAnimationFrame(handleAnimation);
      } else {
        this.removeAttribute('open');
      }
    };

    window.requestAnimationFrame(handleAnimation);
  }
}
customElements.define('menu-drawer-details', MenuDrawerDetails, { extends: 'details' });

class MenuDrawer extends DrawerComponent {
  constructor() {
    super();
  }

  get header() {
    return this.closest('header');
  }

  // get menuItems() {
  //   if (!this._menuItems) {
  //     this._menuItems = this.querySelectorAll(
  //       '.menu-drawer__menus:not(.active) > ul > li, .menu-drawer__menus:not(.active) > .menu-drawer__footer'
  //     );
  //   }
  //   return this._menuItems;
  // }

  get requiresBodyAppended() {
    return false;
  }

  prepareToShow() {
    super.prepareToShow();
    setTimeout(() => {
      // this.animateMenuItems();
    }, 300);

    document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
    document.documentElement.style.setProperty(
      '--header-bottom-position',
      `${parseInt(this.header.getBoundingClientRect().bottom)}px`
    );

    document.dispatchEvent(new CustomEvent('menu-drawer:open', { bubbles: true }));
  }

  // animateMenuItems() {
  //   FoxTheme.Motion.animate(
  //     this.menuItems,
  //     {
  //       transform: ['translateX(-20px)', 'translateX(0)'],
  //       opacity: [0, 1],
  //     },
  //     {
  //       duration: 0.6,
  //       easing: [0.075, 0.82, 0.165, 1],
  //       delay: FoxTheme.Motion.stagger(0.1),
  //     }
  //   ).finished.then(() => {
  //     this.menuItems.forEach((item) => item.removeAttribute('style'));
  //   });
  // }

  handleAfterHide() {
    super.handleAfterHide();
    setTimeout(() => {
      this.querySelectorAll('details[is=menu-drawer-details]').forEach((menu) => {
        menu.onCloseButtonClick();
      });
    });
  }
}
customElements.define('menu-drawer', MenuDrawer);

class MenuProductList extends HTMLElement {
  constructor() {
    super();
    this.initSlide();
    this.elementToFocus = this.querySelector('button');
  }

  get container() {
    return this.querySelector('.swiper');
  }

  get sliderPagination() {
    return this.querySelector('.swiper-pagination');
  }

  get sliderNext() {
    return this.querySelector('.swiper-button-next');
  }

  get sliderPrev() {
    return this.querySelector('.swiper-button-prev');
  }

  get numberOfColumns() {
    return parseInt(this.dataset.columns);
  }

  initSlide() {
    const slider = new FoxTheme.Carousel(this.container, {
      spaceBetween: 10,
      slidesPerView: this.numberOfColumns,
      loop: false,
      navigation: {
        nextEl: this.sliderNext,
        prevEl: this.sliderPrev,
      },
      focusableElements: 'input, select, option, textarea, button, video, label, a',
    });
    slider.init();

    const focusableElements = FoxTheme.a11y.getFocusableElements(this);

    focusableElements.forEach((element) => {
      element.addEventListener('focusin', function () {
        const slide = element.closest('.swiper-slide');

        slide && slider.slider.slideTo(slider.slider.slides.indexOf(slide));
      });
    });
  }

  calcNavButtonsPosition() {
    if (!this.dataset.calcButtonPosition === 'true') return;

    const firstMedia = this.querySelector('.product-card__image-wrapper');
    if (firstMedia && firstMedia.clientHeight > 0) {
      this.style.setProperty('--swiper-navigation-top-offset', parseInt(firstMedia.clientHeight) / 2 + 'px');
    }
  }
}
customElements.define('menu-product-list', MenuProductList);

class MenuSidebar extends HTMLElement {
  constructor() {
    super();
    this.handleSidenavMenuToggle = this.handleSidenavMenuToggle.bind(this);
    this.updateHeight = this.updateHeight.bind(this);
  }

  get summarys() {
    return this.querySelectorAll('summary');
  }

  connectedCallback() {
    this.setInitialMinHeight();

    const firstSummary = this.summarys[0];
    if (firstSummary) {
      this.setActiveItem(firstSummary, false);
    }

    this.summarys.forEach((summary) => {
      summary.addEventListener('mouseenter', this.handleSidenavMenuToggle);
      summary.addEventListener('click', (e) => e.preventDefault());
    });

    this.setupIntersectionObserver();
  }

  setInitialMinHeight() {
    const container = this.closest('.mega-menu__wrapper');
    if (container) {
      const parentHeight = container.parentElement.offsetHeight;
      container.style.setProperty('--menu-sidebar-height', `${parentHeight}px`);
    }
  }

  setupIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.updateHeight();
        }
      });
    });

    observer.observe(this);
  }

  updateHeight() {
    const activeSummary = this.querySelector('.is-visible');
    if (activeSummary) {
      const container = this.closest('.mega-menu__wrapper');
      const content = activeSummary.nextElementSibling;
      if (container && content) {
        container.style.setProperty('--sidebar-height', `${content.scrollHeight}px`);
      }
    }
  }

  setActiveItem(summaryElem, updateHeight = true) {
    const lastSidenavElem = this.querySelector('.is-visible');
    if (lastSidenavElem) {
      lastSidenavElem.classList.remove('is-visible');
    }

    summaryElem.classList.add('is-visible');

    if (updateHeight) {
      this.updateHeight();
    }
  }

  handleSidenavMenuToggle(evt) {
    const summaryElem = evt.target;
    this.setActiveItem(summaryElem);
  }

  disconnectedCallback() {
    this.summarys.forEach((summary) => {
      summary.removeEventListener('mouseenter', this.handleSidenavMenuToggle);
      summary.removeEventListener('click', this.handleClick);
    });
  }
}

customElements.define('menu-sidebar', MenuSidebar);
