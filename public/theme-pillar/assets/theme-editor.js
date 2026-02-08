document.addEventListener('shopify:section:load', (evt) => {
  const { target } = evt;

  // Load and evaluate section specific scripts immediately.
  target.querySelectorAll('script[src]').forEach((script) => {
    const s = document.createElement('script');
    s.src = script.src;
    document.body.appendChild(s);
  });
});

document.addEventListener('shopify:block:select', (evt) => {
  const { target } = evt;

  const blockSelectedIsTab = target.classList.contains('tabs__tab');
  if (blockSelectedIsTab) {
    const tabs = target.closest('tabs-component');
    tabs.setActiveTab(target.dataset.index);
  }

  const blockSelectedIsSlide = target.classList.contains('swiper-slide');
  if (blockSelectedIsSlide) {
    const sliderComponent = target.closest('slideshow-component');
    if (sliderComponent && sliderComponent.sliderInstance.slider) {
      const index = target.dataset.swiperSlideIndex;
      if (sliderComponent.sliderInstance.slider.params.loop) {
        sliderComponent.sliderInstance.slider.slideToLoop(index);
      } else {
        sliderComponent.sliderInstance.slider.slideTo(index);
      }
    }
  }
});
