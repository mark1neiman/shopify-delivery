if (!customElements.get('image-comparison')) {
  customElements.define(
    'image-comparison',
    class ImageComparison extends HTMLElement {
      constructor() {
        super();

        this.button = this.querySelector('button');
        this.isHorizontal = this.dataset.direction === 'horizontal';

        this.startDrag = this.onStartDrag.bind(this);
        this.drag = this.onDrag.bind(this);
        this.stopDrag = this.onStopDrag.bind(this);

        this.init();

        if (!FoxTheme.config.motionReduced) {
          FoxTheme.Motion.inView(this.querySelector('.image-comparison__animation-trigger'), this.animation.bind(this));
        }
      }

      init() {
        this.buttonIcon = this.button.querySelector('span');
        this.offset = this.buttonIcon ? this.buttonIcon.offsetWidth / 2 : 20;

        this.button.addEventListener('touchstart', this.startDrag);
        this.button.addEventListener('mousedown', this.startDrag);
      }

      animation() {
        this.setAttribute('is-visible', '');
        this.classList.add('is-animating');
        setTimeout(() => {
          this.classList.remove('is-animating');
        }, 1e3);
      }

      onStartDrag(e) {
        e.preventDefault();
        document.body.classList.add('body-no-scrollbar');
        this.classList.add('is-dragging');

        if (e.type === 'mousedown') {
          document.addEventListener('mousemove', this.drag);
          document.addEventListener('mouseup', this.stopDrag);
        } else if (e.type === 'touchstart') {
          document.addEventListener('touchmove', this.drag);
          document.addEventListener('touchend', this.stopDrag);
        }
      }

      onStopDrag() {
        document.body.classList.remove('body-no-scrollbar');
        this.classList.remove('is-dragging');

        document.removeEventListener('mousemove', this.drag);
        document.removeEventListener('mouseup', this.stopDrag);

        document.removeEventListener('touchmove', this.drag);
        document.removeEventListener('touchend', this.stopDrag);
      }

      onDrag(e) {
        const event = (e.touches && e.touches[0]) || e;
        let x, distance;
        if (this.isHorizontal) {
          x = event.pageX - this.offsetLeft;
          distance = this.clientWidth;

          if (FoxTheme.config.isRTL) {
            x = distance - x; // Reverse the x position for RTL
          }
        } else {
          x = event.pageY - this.offsetTop;
          distance = this.clientHeight;
        }

        const max = distance - this.offset;
        const min = this.offset;
        const mouseX = Math.max(min, Math.min(x, max));
        const mousePercent = (mouseX * 100) / distance;
        this.style.setProperty('--percent', mousePercent + '%');
      }
    }
  );
}
