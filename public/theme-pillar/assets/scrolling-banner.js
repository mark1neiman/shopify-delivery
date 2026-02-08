if ( !customElements.get('scrolling-banner') ) {
  customElements.define('scrolling-banner', class ScrollingBanner extends HTMLElement {
    constructor() {
      super();

      const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
      mql.onchange = this.init.bind(this);
      this.init();
    }

    get items() {
      return this.querySelectorAll('.slide');
    }

    init() {
      this.zoom = this.dataset.zoom === 'true';
      this.parallax = this.dataset.parallax === 'true';
      this.header = document.querySelector('header');
      this.headerHeight = Math.round(this.header.offsetHeight);
      this.isHeaderSticky = this.header.isAlwaysSticky;
      this.borderRadius = this.dataset.borderRadius;

      this.slideRequestAnimationFrame = true;

      this.onScrollHandler = (() => {
        if (this.slideRequestAnimationFrame) {
          this.slideRequestAnimationFrame = false;
          requestAnimationFrame(this.handleSlideAnimation.bind(this));
        }
      }).bind(this);

      window.addEventListener("resize", this.onScrollHandler, { passive: true });

      this.onScrollHandler();
    }
    handleSlideAnimation() {
      const segmentLength = 1 / this.items.length;
      const itemHeight = this.items[0].offsetHeight;
      const windowHeight = this.isHeaderSticky ? window.innerHeight - this.headerHeight : window.innerHeight;
      const translateY = Math.min(250, (itemHeight * 0.3));
      const endpoint = Math.min((itemHeight / windowHeight), 1);
      const cardZoom = 4;

      [...this.items].forEach((item, i) => {
        const index = i + 1;
        const content = item.querySelector('.slide__content');
        const product = item.querySelector('.slide__product');
        const card = item.querySelector('.slide__card');
        const cardMedia = card.querySelector('.media');
        const cardMediaChild = cardMedia.children[0];

        // Zoom
        if (this.zoom) {
          FoxTheme.Motion.scroll(
            FoxTheme.Motion.animate(
              card,
              {
                clipPath: [`inset(0 round ${this.borderRadius}px)`, `inset(0 ${cardZoom}% round ${this.borderRadius}px)`],
              }
            ),
            { 
              target: this, 
              offset: [
                [(index * segmentLength) + 0.012, endpoint],
                [(index + 1) * segmentLength, endpoint]
              ] 
            }
          );

          FoxTheme.Motion.scroll(
            FoxTheme.Motion.animate(
              content,
              {
                transform: [`scale(1)`, `scale(${100 - cardZoom * 2 }%)`],
              }
            ),
            { 
              target: this, 
              offset: [
                [(index * segmentLength) + 0.012, endpoint],
                [(index + 1) * segmentLength, endpoint]
              ] 
            }
          );

          if (product) {
            FoxTheme.Motion.scroll(
              FoxTheme.Motion.animate(
                product,
                {
                  transform: [`translateY(0)`, `translateY(${itemHeight / 100 * 4}px)`],
                }
              ),
              { 
                target: this, 
                offset: [
                  [(index * segmentLength) + 0.012, endpoint],
                  [(index + 1) * segmentLength, endpoint]
                ] 
              }
            );
          }
        }

        // Parallax
        if (this.parallax) {
          if ( i == 0 ) {
            FoxTheme.Motion.scroll(
              FoxTheme.Motion.animate(
                cardMedia,
                { transform: [`translateY(0)`, `translateY(${-translateY}px)`], transformOrigin: ['top', 'top'] },
                { easing: "ease-out" }
              ),
              { 
                target: this, 
                offset: [
                  [(index * segmentLength), endpoint],
                  [(index + 1) * segmentLength, endpoint]
                ] 
              }
            );
          } else {
            FoxTheme.Motion.scroll(
              FoxTheme.Motion.animate(
                cardMedia,
                { transform: [`translateY(${-translateY}px)`, `translateY(0)`], transformOrigin: ['bottom', 'bottom'] },
                { easing: "ease-out" }
              ),
              { 
                target: this, 
                offset: [
                  [i * segmentLength, 1],
                  [index * segmentLength, 1]
                ] 
              }
            );

            if (i < this.items.length - 1 ) {
              FoxTheme.Motion.scroll(
                FoxTheme.Motion.animate(
                  cardMediaChild,
                  { transform: [`translateY(0)`, `translateY(${-translateY}px)`], transformOrigin: ['top', 'top'] },
                  { easing: "ease-out" }
                ),
                { 
                  target: this, 
                  offset: [
                    [i * segmentLength, this.isHeaderSticky ? this.headerHeight/window.innerHeight : 0],
                    [index * segmentLength, this.isHeaderSticky ? this.headerHeight/window.innerHeight : 0]
                  ] 
                }
              );
            }
          }
        }
      });

      this.slideRequestAnimationFrame = true;
    }
  });
}