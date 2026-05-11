---
name: kik-profile
description: Project profile for Shopify theme work that follows the Kik baseline, including file naming, preview routing, Tailwind prefixing, token use, and section implementation rules.
---

# Kik Profile

## Purpose

This file is the project-rule profile for Kik Shopify theme work.

It does not define the main-agent or subagent orchestration flow. It defines the rules those workflows must apply when the active profile is `kik`.

## Preview Contract

- Formal acceptance template: `templates/index.kik-preview.json`
- Formal acceptance URL: `http://127.0.0.1:9292/?view=kik-preview`
- Main agents must require preview verification through that route.
- Main agents should assemble that preview template from collected section results in final page order.
- Section subagents may not claim page acceptance from it.
- Section subagents should use retained `templates/index.kik-section-*.json` templates for isolated section visual review.
- Section-scoped preview templates are review artifacts and should not be deleted automatically.
- Shared `global` surfaces such as header and footer are accepted through the route surfaces that consume them.

## File And Naming Rules

- Section file: `sections/kik-<feature-name>.liquid`
- Snippet file: `snippets/kik-<feature-name>.liquid`
- Section preset category: `Kik Components`
- Shared behavior entry: `src/kik-component.js`

## Tailwind Rules

- Use Tailwind v4 syntax only.
- `src/input.css` is the Tailwind source; `assets/kik-theme.css` is the generated browser asset loaded by `layout/theme.liquid`.
- Run the project build, normally `pnpm build`, before browser preview verification after changing Liquid classes, shared tokens, or `src/input.css`.
- Respect the resolved Kik prefix strategy.
- Prefer `kik:` prefixed utilities in initialized Kik themes.
- Use `kik:md:` ordering, not `md:kik:`.
- Keep markup utility-first.
- Tailwind utilities in Liquid are the primary styling surface for section work.
- Do not make a section-private BEM/class system the primary styling path.
- Prefer `data-kik-*` attributes for stable verification hooks when needed.

## Token Rules

- Shared token inventory is generated into `src/input.css`.
- Raw Figma variables2css token export belongs at `design-tokens/figma.variables2css.css`; init creates that file as an empty placeholder.
- If `design-tokens/figma.variables2css.css` is missing or empty, report the manual token handoff gap instead of reconstructing it from Figma MCP or generated asset manifests.
- If `design-tokens/figma.variables2css.css` already exists, do not overwrite it during agent setup.
- When raw variables2css tokens are available, run `make sync-kik-tokens TOKENS=design-tokens/figma.variables2css.css` to generate Tailwind-consumable outputs.
- The default maintained token source is `design-tokens/kik.tokens.css`; run `make sync-kik-tokens` to regenerate token outputs.
- Agents should read `harness/generated/kik.tokens.json` and `src/input.css`, not scrape raw token CSS as an implementation workspace.
- `src/input.css` is for generated shared tokens, base rules, and shared utilities.
- Use the initialized Kik spacing, text, color, and radius inventory first.
- Do not create section-private `--kik-*` tokens just because Figma shows a value.
- Do not move section-private CSS into `src/input.css` unless you are returning an explicit shared-style exception.
- Keep mobile values in `:root`.
- Put desktop overrides in `@media (min-width: 768px)`.
- Use concise theme aliases instead of arbitrary `var(...)` utilities.

## Schema Rules

- Derive merchant schema from content structure.
- One-off content becomes section settings.
- Repeated content becomes blocks.
- Do not expose design-token internals as merchant controls unless explicitly required.

## Section Rules

- Treat desktop and mobile as separate sources.
- Use `px` for Figma-derived size tokens.
- Put behavior in `src/kik-component.js` when interaction is real.
- Carousel, slider, and slideshow interactions should mount through Custom Elements defined in `src/kik-component.js`.
- Avoid inline section scripts unless unavoidable.
- Prefer Shopify placeholders over invented fake media.

## Verification Rules

Main-agent verification should require:

- the delivery page template is assembled from section results
- the section is mounted through `templates/index.kik-preview.json`
- the preview route renders through `/?view=kik-preview`
- completed sections have section-scoped preview evidence when browser config is available
- runtime verification remains page-owned, not section-owned
- shared `global` surfaces are validated through page, product, or cart routes rather than isolated route templates

## Common Failures

- treating Kik as a second orchestration system instead of a profile
- letting section work bypass the main-agent page assembly contract
- ignoring the initialized token inventory
- introducing project-specific CSS patterns that bypass the Kik utility model
- treating `src/input.css` as a default dumping ground for section-private CSS
