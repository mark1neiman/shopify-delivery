if (!customElements.get('highlight-text-image')) {
  class HighLightTextImage extends HTMLElement {
    constructor() {
      super();

      this.sectionId = this.dataset.sectionId;
      this.section = this.closest(`.section-${this.sectionId}`);
      this.templates = this.section.querySelector("template").content.cloneNode(true);
      this.images = {};
      this.init();
    }

    init() {
      let contentHTML = this.innerHTML
      const images = this.templates.querySelectorAll("[data-id]");
      
      images.forEach(image => {
        const key = image.dataset.id;
        this.images[key] = image;
      });

      contentHTML = contentHTML.replace(/\[img(\d+)\]/g, (match, p1) => {
        const imgIndex = `img${p1}`;
        const imageWrapper = this.images[imgIndex];
        if (imageWrapper) {
          return imageWrapper.innerHTML;
        }
        return match;
      });

      this.innerHTML = contentHTML
    }
  }
  customElements.define('highlight-text-image', HighLightTextImage);
}