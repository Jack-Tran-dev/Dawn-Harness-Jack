---
name: kik-shopify-figma-section
description: Use when implementing or extending a reusable Kik Shopify section from Figma in a theme that is already Kik-initialized, especially when desktop and mobile nodes must be translated into schema, tokens, Liquid, and verified section-level output.
---

# Kik Shopify Figma Section

## Overview

Implement one reusable Kik Shopify section from Figma in an already initialized theme. This skill is for section work only, not project setup.

Section visual review must happen in a real browser render through a retained section-scoped preview template:

- template file example: `templates/index.kik-section-home-section-01.json`
- preview URL example: `http://127.0.0.1:9292/?view=kik-section-home-section-01`

The shared `templates/index.kik-preview.json` remains the final full-page preview surface assembled by the main flow.

## Prerequisite

The theme must already satisfy Kik initialization. If any baseline file is missing, stop and use `skills/theme/kik-shopify-theme-init/SKILL.md` first.

That initialization is expected to have seeded the shared Kik token inventory, and ongoing token maintenance should run through `make sync-kik-tokens` from `design-tokens/kik.tokens.css`. Section work consumes that inventory. It does not establish the core system inventory from scratch.

When work starts from `figma/<page-key>/source-manifest.json`, use its desktop and mobile links as the primary Figma MCP targets and persist any derived structure, data-binding, and image-upload decisions in the section result. When a generated legacy section task provides `inputs.figmaSource`, use those desktop and mobile links as the preferred Figma MCP targets. The exported bundle JSON, compiled brief, and `templateContract` remain the implementation contract for legacy bundle tasks.

## Non-Negotiable Rules

- Use Figma MCP for every implementation:
  - `get_design_context`
  - `get_screenshot`
  - `get_variable_defs`
  - `get_metadata` only when structure is unclear
- Treat desktop and mobile as separate sources.
- Use `px` for Figma-derived size tokens.
- Put responsive value changes in token values, not typography-only `md:` overrides.
- Use Tailwind v4 official prefix syntax only:
  - `kik:text-h2`
  - `kik:flex`
  - `kik:md:grid-cols-2`
- Keep rendered markup utility-first.
- If verification needs stable selectors, prefer `data-kik-*` hooks.
- Use `md:` only for layout changes.
- If one section uses one font family throughout, apply it once on a shared container instead of repeating `kik:font-*` on every node.
- Put any behavior in `src/kik-component.js` using Custom Elements.
- Do not use inline section scripts unless unavoidable.
- Respect any page-level `fidelity` contract in the generated task payload.
- For carousel-capable repeated-content sections, default to `Swiper.js`.
- Use `scroll-snap` only as an explicit implementation exception recorded in the section result.
- Do not reuse Dawn or other theme slider code as the implementation base.
- When `fidelity.mode` is `css-1-to-1`, restore layout, spacing, borders, radii, and typography 1:1 even if the section still uses placeholder imagery.

## Acceptance Preview

Use a section-scoped preview template for section visual review:

- build first with `pnpm build` so `src/input.css` produces the `assets/kik-theme.css` loaded by `layout/theme.liquid`
- create with `make create-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.`
- verify with `make verify-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.`

Rules:

- Do not make `section_id` preview a required step in this skill.
- Do not depend on preview-proxy asset injection for formal acceptance.
- Do not add section-local preview bootstraps or query-param scripts.
- Do not hand-maintain `templates/index.kik-preview.json` inside section implementation.
- Keep generated `templates/index.kik-section-*.json` files for human review.
- Every completed section must return enough template contribution data for both section preview generation and final page assembly.
- If `assets/kik-theme.css` is missing or stale, rerun the project build before judging visual mismatch.

## Images

Do not block implementation on real image assets.

Use this rule:

- Section schema should expose `image_picker` where merchants own media.
- When no real asset is provided, use a Shopify placeholder first, typically `placeholder_svg_tag`.
- Do not simulate image content with hand-drawn `div` backgrounds, gradients, or decorative CSS when a Shopify placeholder is available.
- Verification focuses on image container size, crop, radius, object-fit, and layout placement.
- Placeholder imagery is not a reason to loosen CSS parity on a `css-1-to-1` page.

## Naming Rules

- Section filename: `sections/kik-<feature-name>.liquid`
- Snippet filename: `snippets/kik-<feature-name>.liquid`
- Section preview template filename: `templates/index.kik-section-<page-key>-<section-id>.json`
- Preset category: `Kik Components`

## Schema Derivation

Infer schema from content structure, not design tokens.

- One-off intro content becomes section settings.
- Repeated cards, slides, or feature items become blocks.
- Fixed-count repeated structures should set `limit` or `max_blocks`.
- Do not expose spacing, radii, widths, or typography sizes as merchant settings.
- Carousel-capable repeated-content sections should stay block-based and follow the repo default `Swiper.js` implementation policy unless an explicit `scroll-snap` exception is justified.

## Token Rules

Implement against the existing Kik token inventory first. Do not create section-private design tokens just because Figma shows a value.

- Keep shared design tokens in `design-tokens/kik.tokens.css` and generated outputs
- Use mobile values in `:root`
- Put desktop overrides in `@media (min-width: 768px)`
- Treat the synced spacing, text, color, and radius inventory as the source of truth for core system tokens
- Add a new shared `--kik-*` token only when it belongs to the system, not one section
- Map those shared raw tokens into concise Tailwind-consumable theme variables in `@theme inline`
- Keep final utility names short and direct
- Consume tokens through theme utilities, not arbitrary value classes
- If a Figma value is outside the current token inventory:
  - do not invent a section token
  - first see whether an existing token can absorb it without changing the intended hierarchy or rhythm
  - if not, raise it as a design-system gap before adding any new shared token
- Do not backfill the base Kik spacing/text/color/radius inventory from section nodes. If that inventory is missing, the repo is not initialized or token-synced correctly and must go back through the Kik init/token sync workflow.

## Workflow

0. Resolve `<page-key>` once via `node ./scripts/agent/resolve-page-key.mjs --json`. The resolver reads `feat/<page-key>` from the current git branch (or `--page=<key>` / `PAGE=<key>` override). Use the resolved value verbatim in every `templates/index.kik-section-<page-key>-<section-id>.json` and `make ... PAGE=<page-key>` invocation below; do not paraphrase or substitute.
1. Confirm the theme is Kik-initialized. If not, stop and use the Kik init skill.
2. Read desktop and mobile Figma nodes with MCP.
3. Extract exact structure and values before coding.
4. If a true shared design-system token is missing, update `design-tokens/kik.tokens.css` and run `make sync-kik-tokens`; do not hand-edit generated token CSS.
5. Implement the reusable section in `sections/kik-<feature-name>.liquid`.
6. Add a snippet only when it meaningfully reduces repeated markup.
7. Add JS in `src/kik-component.js` only if the design has real interaction.
8. Return a `templateContribution` in the section result so the agent can generate the section preview and the main agent can assemble the page template.
9. Generate and verify the section-scoped preview, then leave final full-page assembly and layout-review gating to the main agent.

## Verification

Before claiming completion:

- Run `pnpm build`
- Run `shopify theme check`
- Confirm the section returns the right template contribution for full-page assembly
- Run `make create-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.`
- Run `make verify-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.`
- If the task carries `fidelity.mode: "css-1-to-1"`, do not report the section as visually accepted just because the preview route is reachable

## Common Failures

- Starting section work in a repo that is not initialized
- Inferring mobile from desktop instead of reading both nodes
- Using `md:kik:` ordering instead of `kik:md:`
- Treating `section_id` preview as a required or preferred acceptance path
- Editing the shared preview template by hand instead of returning template contribution data
- Exposing design tokens as merchant schema controls
- Treating raw Figma values as permission to mint new section tokens
- Creating component-private styling classes instead of composing Kik utilities
- Claiming 1:1 without a real browser check on the retained section-scoped preview URL
