const t = window.KikTheme ?? {
  ready: !1,
  version: "0.1.0"
}, e = () => {
  t.ready = !0, document.documentElement.dataset.kikTheme = "ready";
};
window.KikTheme = t;
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", e, { once: !0 }) : e();
document.addEventListener("shopify:section:load", e);
