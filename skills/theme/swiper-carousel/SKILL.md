---
name: swiper-carousel
description: Reference contract for implementing horizontal-scroll carousels with Swiper.js inside a Shopify theme section. Bound by every theme section skill that produces a carousel pattern. Defines required CSS imports, Custom Element mount, loop+region probe interaction, a11y, and the most common production failures.
---

# Swiper Carousel Skill

This skill is a **contract**, not a tutorial. When a section's `implementationPolicy.pattern === "carousel"` and the profile rules favor Swiper.js (the kik default), every choice listed here is mandatory unless the section result records an explicit exception.

`skills/theme/figma-first/SKILL.md` applies in full — the brief still drives all measurements, slide assets, and copy. This skill governs how the carousel runtime gets wired up after the Figma-First step decided the section needs one.

## When to use this skill

- Section task carries `implementationPolicy.pattern: "carousel"` AND `defaultImplementation: "swiper"`.
- The section contains repeating content blocks meant to be navigated horizontally (hero promo carousels, product image carousels, testimonial carousels).
- Each slide is independently authored — distinct images, copy, CTAs.

Don't use this skill for:

- Vertical scroll lists, infinite feeds, or progressive-disclosure UI.
- Single-frame sections with no slide rotation, even if the Figma frame visually shows multiple variants stacked side-by-side. Confirm with `brief.blocks` length and `implementationPolicy.pattern`.
- Sections where `implementationPolicy.allowedImplementationExceptions` permits `scroll-snap` or `custom` and the brief justifies using one.

## Non-negotiable rules

0. **Self-install Swiper before importing.** This skill assumes `swiper` is not in `package.json` by default — `harness/contracts/section-runtime-deps.json#matrix["carousel/swiper"]` lists `swiper@^11` as the runtime dep, and `inspect-bootstrap` will surface `PREVIEW_RUNTIME_DEP_MISSING` if it's absent. Run:
   ```sh
   pnpm add swiper@^11
   ```
   Pin to `^11` because this skill uses `slideToLoop`, the modular module imports (`swiper/modules`), and the `swiper/css` path — all introduced in v11. Record the install in `section-result.commandsRun`. Re-runs of `pnpm add` are no-ops once the dep is present.

1. **Import Swiper's core CSS.** `import Swiper from "swiper"` is not enough. Swiper's runtime depends on `swiper/css` for `.swiper`, `.swiper-wrapper`, `.swiper-slide` baseline styles (notably `transform`, `flex-shrink: 0`, slide width distribution). Without it, slides render as a raw flex row and Swiper's transform never visually lands. Import what the section actually uses:
   ```js
   import Swiper from "swiper";
   import { Pagination, Autoplay, A11y, Keyboard } from "swiper/modules";
   import "swiper/css";
   import "swiper/css/pagination"; // only if pagination module is enabled
   import "swiper/css/a11y";        // only if a11y module is enabled
   ```
   Do NOT hand-copy Swiper's stylesheet rules into the section's `{% stylesheet %}` block. Hand-copies miss attributes Swiper relies on at runtime (`box-sizing: content-box` alone is not enough), and they go stale when Swiper updates.

2. **Mount through a Custom Element, not inline section JS.** Each carousel section gets its own custom element (`<kik-hero-carousel>`, `<kik-product-carousel>`, etc.) defined in `src/kik-component.js`. Custom elements give us deterministic `connectedCallback` / `disconnectedCallback` hooks for Swiper init / destroy, which inline scripts inside Liquid sections cannot guarantee under Shopify's section-rerender lifecycle.

3. **Always destroy on disconnect.** Swiper retains DOM listeners and timers; failing to call `destroy(true, true)` in `disconnectedCallback` leaks memory across section editor re-renders.

4. **Loop mode interacts with the harness region probe.** When `loop: true`, Swiper clones the first/last slides into hidden DOM nodes (`.swiper-slide-duplicate`). Any `data-kik-region="<sourceNodeId>"` attribute on a slide child is duplicated too — the region-presence probe in `verify-section-preview` will then match more elements than the brief declared. This is fine for presence (still matched), but it produces duplicate geometry measurements. **Either** put `data-kik-region` only on elements outside `.swiper-wrapper` (pagination, container chrome) **or** keep `loop: false` for sections whose every slide carries the same `data-kik-region` ids (e.g. all three slides have the same heading id list). Carousels whose slides each carry distinct sourceNodeIds may use `loop: true` safely.

5. **`brief.blocks` drives the slide list, not a literal copy of the first slide.** See `skills/theme/figma-first/SKILL.md` and the implement-section-from-figma skill: per-slide assets come from `brief.blocks[i].imageDesktop` / `imageMobile`. Never render every slide with the same image. Never use `brief.layout.{bp}.preview.path` as a slide background — it is a frame screenshot that bakes in overlay text.

## Template — Liquid section

```liquid
<kik-hero-carousel
  class="block relative w-full"
  data-autoplay-delay="{{ autoplay_value }}"
  data-loop="{% if slides.size > 1 %}true{% else %}false{% endif %}"
>
  <div
    class="swiper kik-hero__swiper relative w-full overflow-hidden"
    data-kik-hero-swiper
    role="region"
    aria-roledescription="carousel"
    aria-label="{{ section.settings.aria_label | default: 'Hero promotions' | escape }}"
  >
    <div class="swiper-wrapper">
      {%- for block in slides -%}
        <div
          class="swiper-slide ..."
          data-kik-hero-slide="{{ forloop.index0 }}"
          aria-roledescription="slide"
          aria-label="{{ block.settings.heading | default: forloop.index | escape }}"
          {{ block.shopify_attributes }}
        >
          {# slide markup — backgroundFill img, content stack, etc. #}
        </div>
      {%- endfor -%}
    </div>
  </div>

  {%- if slides.size > 1 -%}
    <div
      class="kik-hero__pagination ..."
      role="tablist"
      aria-label="Hero slides"
    >
      {%- for block in slides -%}
        <button
          type="button"
          class="kik-hero__dot ..."
          data-kik-hero-dot="{{ forloop.index0 }}"
          data-kik-active="{% if forloop.first %}true{% else %}false{% endif %}"
          aria-label="Go to slide {{ forloop.index }}"
          aria-current="{% if forloop.first %}true{% else %}false{% endif %}"
        ></button>
      {%- endfor -%}
    </div>
  {%- endif -%}
</kik-hero-carousel>
```

Pagination lives **outside** `.swiper-wrapper` so cloned slides in loop mode don't clone the dots.

## Template — Custom Element

```js
import Swiper from "swiper";
import { Pagination, Autoplay, A11y, Keyboard } from "swiper/modules";
import "swiper/css";

class KikHeroCarousel extends HTMLElement {
  connectedCallback() {
    this.root = this.querySelector("[data-kik-hero-swiper]");
    this.dots = Array.from(this.querySelectorAll("[data-kik-hero-dot]"));
    if (!this.root) return;

    const autoplayDelayAttr = Number(this.dataset.autoplayDelay ?? 0);
    const autoplay =
      Number.isFinite(autoplayDelayAttr) && autoplayDelayAttr > 0
        ? { delay: autoplayDelayAttr, disableOnInteraction: false, pauseOnMouseEnter: true }
        : false;

    this.swiper = new Swiper(this.root, {
      modules: [Pagination, Autoplay, A11y, Keyboard],
      slidesPerView: 1,
      spaceBetween: 0,
      loop: this.dataset.loop === "true",
      speed: 600,
      autoplay,
      keyboard: { enabled: true },
      a11y: { enabled: true },
      on: {
        slideChange: (sw) => this.syncDots(sw.realIndex)
      }
    });

    this.dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        const index = Number(dot.dataset.kikHeroDot);
        if (Number.isFinite(index)) {
          this.swiper.slideToLoop(index);
        }
      });
    });

    this.syncDots(this.swiper.realIndex ?? 0);
  }

  disconnectedCallback() {
    this.swiper?.destroy(true, true);
    this.swiper = null;
  }

  syncDots(activeIndex) {
    this.dots.forEach((dot, index) => {
      const isActive = index === activeIndex;
      dot.dataset.kikActive = isActive ? "true" : "false";
      dot.setAttribute("aria-current", isActive ? "true" : "false");
    });
  }
}

if (!customElements.get("kik-hero-carousel")) {
  customElements.define("kik-hero-carousel", KikHeroCarousel);
}
```

## Accessibility

- The swiper container carries `role="region"` and `aria-roledescription="carousel"` with a meaningful `aria-label`.
- Each slide carries `aria-roledescription="slide"` and an `aria-label` derived from its heading (or slide index as fallback).
- Pagination is `role="tablist"` with each dot a `<button>` that has both `aria-label` and `aria-current`.
- Enable Swiper's `A11y` module; do not disable its keyboard navigation.

## Common Failures

- **Slides land in different left positions.** You forgot `import "swiper/css"`. Slides are rendering as plain flex children without Swiper's transform-and-shrink rules. Add the import.
- **`verify-section-preview` reports duplicate region matches in loop mode.** Swiper cloned the slide for loop continuity and the clone carries `data-kik-region`. Either move the region attribute outside `.swiper-wrapper` or disable loop for that section. Do not work around it by changing the brief's region count.
- **Section editor re-renders multiply Swiper instances.** Custom element's `disconnectedCallback` is not destroying the previous instance. Verify `this.swiper?.destroy(true, true)` runs and `this.swiper = null` clears the reference.
- **Autoplay starts even when `data-autoplay-delay="0"`.** Check the `autoplay` config gate uses `Number.isFinite(...) && delay > 0`, not just truthiness — `Number(0)` is `0`, which is falsy, but a missing attribute is `NaN` and `Boolean(NaN) === false` too, so a strict numeric guard is safer.
- **Every slide renders the same image.** You read `brief.layout.{bp}.preview.path` or picked the first `assetPaths[]` entry. Read `brief.blocks[i].imageDesktop` / `imageMobile` instead. If `brief.blocks` is missing on a carousel-pattern brief, that's a brief-author defect — record in `section-result.openIssues`, do not silently fan out one image.
- **`section-task` declares `pattern: "carousel"` but only one block was authored.** Either the brief author misclassified or the design's "carousel" is in fact a static single frame. Verify with the source manifest before changing the pattern.

## Hand-off

This skill governs the carousel runtime; it does not weaken any upstream contract:

- `skills/theme/figma-first/SKILL.md` — measurements, asset roles (preview vs. background fill), font-fallback geometry demotion.
- `skills/theme/implement-section-from-figma/SKILL.md` — overall section workflow; calls into this skill when `pattern === "carousel"`.
- `verify-section-preview.mjs` — region-presence + geometry + brief-provenance gates run regardless of carousel pattern.
