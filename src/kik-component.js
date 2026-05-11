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
