---
name: kik-shopify-theme-init
description: Use when a Shopify theme needs the Kik baseline before any Kik section work, including Tailwind CSS v4 setup, Kik asset entrypoints, development store config, and a reusable alternate index preview template for later section testing.
---

# Kik Shopify Theme Init

## Overview

Initialize a Shopify theme for Kik work. This skill is only for baseline setup. It does not implement Figma sections.

Tailwind utilities are unprefixed by default. Use `--prefix-mode on` only when a project explicitly chooses prefixed utilities.

## Use This Skill For

- Repositories missing Kik build files or Kik asset entrypoints
- Themes that do not yet load `assets/kik-theme.css` and `assets/kik-component.js`
- Projects that need `shopify.theme.toml` pointed at the active dev store
- Themes that need a reusable alternate index preview template for later section testing

## Required Inputs

The only hard-required input is:

- The real development store domain

Preferred additional input:

- A Figma variables table HTML that includes the `Name`, `Desktop`, and `Mobile` columns for the shared Kik token inventory
- Or, after bootstrap, a maintained CSS token source at `design-tokens/kik.tokens.css`
- An optional storefront password for preview verification when the storefront is password-gated

If the user pasted raw HTML into chat instead of giving a file path, write that HTML to a local file first and pass the file path to the bootstrap script.

## Do Not Use This Skill For

- Implementing a section from Figma
- Claiming visual parity with a design
- Schema derivation for a new section

Use `skills/theme/kik-shopify-figma-section/SKILL.md` after initialization is complete.

## Required Outcome

The theme is considered initialized only when all of these are true:

- `package.json` exists with separate CSS and JS build scripts
- `postcss.config.mjs`, `tailwind.config.js`, `vite.config.mjs`, and `shopify.theme.toml` exist
- `src/input.css` exists and was generated from the provided variables table HTML
- or, when the variables table HTML is unavailable, `src/input.css` exists and was generated from the repo-owned fallback Kik token baseline
- after real CSS tokens are available, `make sync-kik-tokens` has generated `src/input.css` and `harness/generated/kik.tokens.json` from `design-tokens/kik.tokens.css`
- `harness/config/kik-token-source.json` exists and records whether the project is using the variables table HTML, CSS token file, or fallback token baseline
- `harness/config/browser-verification.json` exists and contains the local preview URLs plus any optional storefront password
- `src/input.css` reflects the resolved Tailwind prefix mode for the target theme
- `src/kik-component.js` exists
- `sections/kik-preview-placeholder.liquid` exists
- `layout/theme.liquid` loads `kik-theme.css` and `kik-component.js`
- `pnpm build` has generated `assets/kik-theme.css` from `src/input.css` and `assets/kik-component.js` from `src/kik-component.js`
- `templates/index.kik-preview.json` exists
- `pnpm build` succeeds
- `shopify theme check` runs without new initialization-specific errors

Expected local preview route after init:

- `http://127.0.0.1:9292/?view=kik-preview`

## Standard File Set

Create or repair these files when missing:

- `package.json`
- `postcss.config.mjs`
- `tailwind.config.js`
- `vite.config.mjs`
- `shopify.theme.toml`
- `src/input.css`
- `src/kik-component.js`
- `sections/kik-preview-placeholder.liquid`
- `templates/index.kik-preview.json`

`src/input.css` may be seeded from the provided Figma variables table HTML during bootstrap so the shared Kik spacing, text, color, and radius inventory is present before any section work starts. If the variables table is not yet available, use the repo-owned fallback Kik token baseline and treat that as a temporary bootstrap state. For ongoing maintenance, prefer `design-tokens/kik.tokens.css` plus `make sync-kik-tokens`; do not hand-edit generated shared token CSS.

The bootstrap and token sync flows must also write `harness/config/kik-token-source.json`. This file is part of the harness truth and is later compared against bundle `designSystem` metadata during `inspect-harness` and `verify-harness`.
The bootstrap should also write `harness/config/browser-verification.json` so `verify-page-preview` can run without asking the developer to copy the example config by hand.

Expected generated outputs:

- `assets/kik-theme.css`
- `assets/kik-component.js`

## Fast Path

Prefer the vendored bootstrap when the theme is clearly uninitialized.

- Bootstrap script: `scripts/kik/init_theme_from_templates.py`
- Bootstrap-template root: `scripts/kik/_bootstrap-templates/` (the two `.tmpl` files that need runtime substitution; located outside Shopify's theme-asset scan paths so Theme Dev never tries to upload them)
- Runtime-filled values:
  - `shopify.theme.toml` store domain (from `_bootstrap-templates/shopify.theme.toml.tmpl`)
  - `package.json` theme name plus Kik scripts and dev dependencies (merged from `_bootstrap-templates/package.json.tmpl` into any pre-existing `package.json`)
  - `src/input.css` token values from the provided variables table HTML when available, otherwise from the fallback Kik token baseline

Static scaffold (`postcss.config.mjs`, `tailwind.config.js`, `vite.config.mjs`, `src/kik-component.js`, `sections/kik-preview-placeholder.liquid`, `templates/index.kik-preview.json`) is overlaid directly to its final theme paths by `npx shopify-theme-harness sync`; bootstrap no longer copies it. If the legacy `templates/kik-theme-init/` scaffold dir is still present from an older bootstrap run, the script removes it on next invocation.

Use the bootstrap first, then inspect and repair selectively if the repo already had conflicting files.

## Prefix Strategy

- Default mode is `--prefix-mode off`
- `--prefix-mode on` forces `prefix(kik)`
- Keep generated section markup consistent with the selected prefix mode

## Initialization Rules

- Use Tailwind CSS v4 unprefixed utilities by default
- Resolve the final prefix decision before generating `src/input.css`
- Use Tailwind CLI for CSS and Vite for JS only
- Keep `src/kik-component.js` as the single Kik JS entry
- Keep `src/input.css` as the single Kik CSS token/source file
- Seed the shared Kik token inventory during init, not later during section implementation
- Treat `design-tokens/kik.tokens.css` as the default maintained source for later token sync
- Use `kik-` in template, section, and snippet filenames
- Point `shopify.theme.toml` at the real development store for the project
- Create a reusable alternate index preview template for later section work
- Seed a minimal `kik-preview-placeholder` section so `templates/index.kik-preview.json` is valid across themes before any section implementation starts
- Decide the webfont source for every font-family the Kik tokens reference. `src/input.css` typically declares `--kik-text-font-heading` and `--kik-text-font-body` (e.g. Satoshi, Funnel Sans). Either add `@font-face` declarations to `src/input.css` or a sibling stylesheet that `layout/theme.liquid` loads, bind those families to Shopify `font_picker` settings, or document that the host theme is expected to provide the webfont chain. Without that handoff, custom families silently fall back to system sans and offline section-preview snapshots will visually drift from the storefront render. `inspect-harness` reports the resolved font sources so this gap is visible before section work.

## Preferred Commands

Project-local make entrypoint:

```bash
make bootstrap-kik-theme STORE="<store-domain>" [VARIABLES_TABLE_HTML="<variables-table-html-path>"]

make bootstrap-kik-theme STORE="<store-domain>" [VARIABLES_TABLE_HTML="<variables-table-html-path>"] [STOREFRONT_PASSWORD="<password>"]

make sync-kik-tokens [TOKENS="design-tokens/kik.tokens.css"]
```

Direct bootstrap entrypoint:

```bash
python3 scripts/kik/init_theme_from_templates.py . --store "<store-domain>" [--variables-table-html "<variables-table-html-path>"] --prefix-mode off

python3 scripts/kik/init_theme_from_templates.py . --store "<store-domain>" [--variables-table-html "<variables-table-html-path>"] [--storefront-password "<password>"] --prefix-mode off

python3 scripts/kik/init_theme_from_templates.py sync-tokens . --source "design-tokens/kik.tokens.css" --prefix-mode off
```

## Workflow

1. Inspect whether the theme is already initialized.
2. If the theme is clearly uninitialized, run the bootstrap.
3. Review the reported prefix decision. If `auto` resolved to unprefixed, make sure the audit scope and result are believable for this theme.
4. If files already exist or the repo is partially customized, inspect the bootstrap result and repair selectively instead of rewriting standard files from scratch.
5. Confirm `src/input.css` contains either:
   - the shared Kik token inventory derived from the variables table HTML, or
   - the fallback Kik token baseline if the variables table HTML was unavailable
6. When real CSS tokens are available, run `make sync-kik-tokens` and confirm `harness/generated/kik.tokens.json` exists.
7. Confirm `harness/config/kik-token-source.json` records the same source mode that generated `src/input.css`.
8. Confirm `harness/config/browser-verification.json` exists and includes the optional storefront password when one was provided.
9. Confirm `layout/theme.liquid` loads Kik CSS and JS.
10. Confirm `sections/kik-preview-placeholder.liquid` exists.
11. Confirm `templates/index.kik-preview.json` exists and loads on `/?view=kik-preview`.
12. Run `pnpm install` if dependencies are not present.
13. Run `pnpm build`.
14. Run `shopify theme check`.

## Hard Stops

- Do not start implementing a Figma section inside this skill.
- Do not synthesize the shared Kik token inventory from section nodes, screenshots, or hand-entered guesses when the variables table HTML is missing.
- Do not claim real project token parity if initialization used the fallback Kik token baseline instead of the variables table HTML.
- Do not let `make sync-kik-tokens` silently fall back when `design-tokens/kik.tokens.css` is missing.
- Do not leave `harness/config/kik-token-source.json` stale relative to the generated `src/input.css`.
- Do not confuse the optional storefront password with Shopify CLI login state; it only unlocks password-gated preview pages.
- Do not call init complete if `src/input.css` was not generated from the variables table HTML, CSS token file, or fallback Kik token baseline.
- Do not call the work complete if `pnpm build` has not been run fresh.
- Do not claim the theme is ready if Kik assets are not loaded in `layout/theme.liquid`.

## Handoff

After this skill completes, use `skills/theme/kik-shopify-figma-section/SKILL.md` for actual section implementation.
