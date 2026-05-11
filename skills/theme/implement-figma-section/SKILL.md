---
name: implement-figma-section
description: Use when implementing or extending one reusable Shopify theme section from a Figma bundle or Figma nodes inside a harness-initialized theme project, especially when desktop and mobile variants must be translated into schema, Liquid, and runtime capture verification.
---

# Implement Figma Section

## Goal

Implement one reusable Shopify theme section using the harness contracts and verify it through the runtime capture loop.

This skill belongs to the reusable harness layer. It must stay generic across theme projects.

## Use This Skill When

- a section needs to be implemented from `figma/<page-key>/source-manifest.json` and Figma MCP source nodes
- a section needs to be implemented from `figma/<page-key>` bundle inputs
- a generated starter section stub needs to be turned into real theme markup
- desktop and mobile variants must both be honored
- runtime capture verification is part of acceptance

## Required Inputs

Read these first:

- `figma/<page-key>/source-manifest.json` when present
- `starter/theme/review/<page-key>.manifest.json`
- `starter/theme/runtime/runtime-profile.json`
- `figma/<page-key>/page.json`
- `figma/<page-key>/sections/<section-id>.desktop.json`
- `figma/<page-key>/sections/<section-id>.mobile.json`

If a source manifest is present, use Figma MCP against its desktop and mobile section links as the primary design source. If a legacy bundle is not enough to resolve structure or styling intent, then use Figma MCP against the original nodes.

## Non-Negotiable Rules

- Treat desktop and mobile as separate sources.
- Do not infer mobile behavior from desktop alone.
- Keep the skill generic:
  - do not assume one CSS framework
  - do not assume one token naming scheme
  - do not assume one preview template filename
  - do not assume one project prefix like `kik-`
- Keep merchant schema derived from content structure, not from design-token controls.
- Do not expose spacing, typography, radii, or layout mechanics as merchant settings unless the product explicitly requires them.
- Put acceptance on real runtime captures, not on a synthetic one-off preview mode.
- Respect any section-level implementation hints carried through the harness contracts.
- Respect any page-level `fidelity` rules carried through the harness contracts.
- For carousel-capable repeated-content sections, default to `Swiper.js`.
- In Kik-initialized themes, wire carousel-capable repeated-content sections through Custom Elements defined in `src/kik-component.js`.
- Allow `scroll-snap` only as an explicit exception, not as a silent substitution.
- Do not reuse old theme slider code as the implementation base when building reusable carousel sections.
- When `fidelity.mode` is `css-1-to-1`, restore CSS layout and typography 1:1 even when real image content is still placeholder-only.

## Preferred Workflow

0. Resolve `<page-key>` first. If you were invoked with a `section-task`, trust `section-task.pageKey`. Otherwise run `node ./scripts/agent/resolve-page-key.mjs --json` (reads `feat/<page-key>` from the current git branch unless `--page=<key>` / `PAGE=<key>` overrides). Use this value for every `figma/<page-key>/...`, `starter/theme/review/<page-key>...`, and `harness/notes/<page-key>.json` path; do not paraphrase.
1. Read the review manifest entry for the target section.
2. If using a source manifest, inspect the desktop and mobile Figma nodes with MCP and persist derived structure in the section result.
3. If using a legacy bundle, read both desktop and mobile section JSON files.
4. Inspect the source previews when legacy bundle previews are available.
5. If structure is unclear, read the original Figma nodes with MCP.
6. Implement or replace the generated starter stub in the real theme project.
7. Keep the generated runtime capture slot names unchanged.
8. Produce real captures in the external theme project.
9. Sync captures into `starter/theme/runtime/captures/*`.
10. Run `make inspect-runtime` and `make verify-runtime`.

## Schema Derivation

- one-off intro content becomes section settings
- repeated cards, slides, logos, or feature items become blocks
- fixed-count repeated structures should use `limit` or `max_blocks`
- media should use Shopify-native schema fields such as `image_picker` where appropriate
- carousel-capable repeated-content sections should compile to block-based sections with a default `Swiper.js` implementation policy
- `css-1-to-1` pages should preserve Figma geometry in code instead of broadening the section into a looser reusable abstraction

## Images

- Do not block implementation on final imagery.
- Favor Shopify placeholders when real merchant media is absent.
- Verification focuses on container sizing, crop, position, and layout placement.
- For `css-1-to-1` pages, missing final image content does not relax spacing, sizing, or type fidelity.

## Runtime Acceptance

Formal acceptance is the runtime capture loop:

1. the section renders in a real theme page
2. the external theme project exports captures
3. captures are synced through `theme-project.binding.json`
4. `make inspect-runtime` reports capture presence
5. for `css-1-to-1` pages, runtime inspect also compares capture structure back to the Figma preview
6. `make verify-runtime` passes

Section implementation completion is not page acceptance. A finished section handoff must still carry a non-null structured verification payload, and the page is not complete until the main agent writes a passed `page.<page-key>.verification.json`.

## Common Failures

- implementing from desktop only
- treating generated starter stubs as final production code
- hardcoding project-specific preview assumptions into the generic harness
- exposing design-token internals as merchant controls
- skipping runtime capture sync and still claiming parity
- claiming completion from static code inspection without runtime verification
- treating placeholder imagery as permission to drift from the Figma layout on a `css-1-to-1` page
