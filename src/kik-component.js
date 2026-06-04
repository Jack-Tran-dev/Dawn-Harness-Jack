const kikState = window.KikTheme ?? {
  ready: false,
  version: "0.1.0"
};

const markReady = () => {
  kikState.ready = true;
  document.documentElement.dataset.kikTheme = "ready";
};

window.KikTheme = kikState;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", markReady, { once: true });
} else {
  markReady();
}

document.addEventListener("shopify:section:load", markReady);

/**
 * Why Pococo mobile slider — Dawn's SliderComponent can compute slidesPerPage as 0
 * when slide stride ≥ viewport, which yields totalPages = slideCount + 1 (e.g. 5/4).
 */
class KikWhyPococoSlider extends SliderComponent {
  initPages() {
    this.sliderItemsToShow = Array.from(this.sliderItems).filter(
      (element) =>
        element.clientWidth > 0 &&
        !element.classList.contains("kik-why-pococo__item--empty")
    );
    if (this.sliderItemsToShow.length < 2) return;

    this.sliderItemOffset =
      this.sliderItemsToShow[1].offsetLeft - this.sliderItemsToShow[0].offsetLeft;
    if (!this.sliderItemOffset) return;

    const viewport =
      this.slider.clientWidth - this.sliderItemsToShow[0].offsetLeft;
    this.slidesPerPage = Math.max(1, Math.floor(viewport / this.sliderItemOffset));
    this.totalPages =
      this.sliderItemsToShow.length - this.slidesPerPage + 1;
    this.update();
  }
}

if (!customElements.get("kik-why-pococo-slider")) {
  customElements.define("kik-why-pococo-slider", KikWhyPococoSlider);
}
