const s = window.KikTheme ?? {
  ready: !1,
  version: "0.1.0"
}, e = () => {
  s.ready = !0, document.documentElement.dataset.kikTheme = "ready";
};
window.KikTheme = s;
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", e, { once: !0 }) : e();
document.addEventListener("shopify:section:load", e);
class o extends SliderComponent {
  initPages() {
    if (this.sliderItemsToShow = Array.from(this.sliderItems).filter(
      (t) => t.clientWidth > 0 && !t.classList.contains("kik-why-pococo__item--empty")
    ), this.sliderItemsToShow.length < 2 || (this.sliderItemOffset = this.sliderItemsToShow[1].offsetLeft - this.sliderItemsToShow[0].offsetLeft, !this.sliderItemOffset)) return;
    const i = this.slider.clientWidth - this.sliderItemsToShow[0].offsetLeft;
    this.slidesPerPage = Math.max(1, Math.floor(i / this.sliderItemOffset)), this.totalPages = this.sliderItemsToShow.length - this.slidesPerPage + 1, this.update();
  }
}
customElements.get("kik-why-pococo-slider") || customElements.define("kik-why-pococo-slider", o);
