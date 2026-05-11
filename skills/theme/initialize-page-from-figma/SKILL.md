---
name: initialize-page-from-figma
description: Use when an agent needs to turn desktop and mobile Figma page or frame deep links into the thin figma/<page-key>/source-manifest.json used to drive section-only Shopify theme implementation.
---

# Initialize Page From Figma

## Goal

Create or update `figma/<page-key>/source-manifest.json` from desktop and mobile Figma deep links.

This skill initializes the page source map only. It does not implement sections, assemble a page, or claim visual acceptance.

## Required Inputs

Read or obtain these first:

- desktop Figma page or frame deep link
- mobile Figma page or frame deep link
- target page key or route context when available
- `harness/contracts/figma-source-manifest.schema.json`
- `harness/config/agent-tools.json` when shop context or image upload is needed
- `harness/contracts/agent-tools-config.schema.json`
- `skills/theme/implement-section-from-figma/SKILL.md`
- `skills/theme/implement-shopify-data-section-from-figma/SKILL.md`
- available shop context for products, collections, blogs, articles, and metaobjects when classification needs it

## Non-Negotiable Rules

- `skills/theme/figma-first/SKILL.md` applies to this skill. The page-init step seeds the contract that section implementers will follow — every section slot recorded here must trace to a real Figma node id captured from MCP, never guessed from naming or screenshot intuition.
- Use Figma MCP as the primary design-read path.
- Do not depend on a Figma plugin; the plugin path has been removed.
- Write a thin `figma/<page-key>/source-manifest.json`; do not export full layout trees, token content, static assets, or page screenshots into the manifest. The manifest must declare `pageKey` equal to the page-key segment of its filesystem path.
- Record desktop and mobile frame/node deep links for the full source scope and for each section slot.
- Keep implementation and acceptance section-owned.
- Do not create a page-level visual-diff acceptance target.
- Prefer REST-extracted asset evidence plus retained section runtime captures when a section needs asset-backed comparison.
- Do not run Figma REST asset extraction or request Figma access tokens; asset extraction is a developer-operated step documented in `docs/ai/figma-asset-extraction.md`.
- Keep product, collection, article, and metaobject content data-backed unless shop context proves it is static.
- Read `harness/config/agent-tools.json` before shop-context lookup or image upload.
- Use `toolServer.routes.shopContext`, `toolServer.routes.syncJobs`, `toolServer.routes.syncJob`, and `toolServer.routes.syncJobEvents`; do not guess tool-server endpoint paths.
- Do not write access tokens into repo files; use the environment variable named by `toolServer.auth.tokenEnv`.
- If a data-backed section needs shop context but agent tool config or the token env var is missing, mark the section routing as needing follow-up instead of guessing.
- Treat `design-tokens/figma.variables2css.css` as an init-created placeholder for a manual developer handoff file. If it exists and is non-empty, run the manifest token sync command; if it is missing or empty, report the setup gap instead of writing token content.

## Stable Workflow

### Step 0: Establish The Page-Key

The page-key is the single identifier that names every artifact for this page (`figma/<page-key>/source-manifest.json`, `harness/notes/<page-key>.json`, `agent/results/<page-key>.<section>.result.json`, `templates/index.kik-section-<page-key>-*.json`). It must be stable across the entire workflow; one page-key per branch. Multiple pages can coexist on `main` because every artifact path embeds `<page-key>`; merging two `feat/<page-key>` branches into `main` does not collide.

Resolve it before any filesystem write:

```sh
node ./scripts/agent/resolve-page-key.mjs --json
```

The resolver reads from, in priority order:

1. an explicit override (`--page=<key>` flag or `PAGE=<key>` env var)
2. the current git branch — must be `feat/<page-key>` (one page per branch)

Do NOT guess a page-key from the Figma file name, the user's prose, or the working directory. If the resolver fails, stop and surface its message verbatim to the user — typical fixes are:

- `git checkout -b feat/<page-key>` if the user is on `main`
- `git branch -m feat/<page-key>` if the branch is misnamed
- pass `--page=<page-key>` for one-off CI / scripted runs

After resolving, echo the resolved page-key back to the user (one line, e.g. `page-key: pococo-home (from feat/pococo-home)`) and proceed without further confirmation. If a previous step in this conversation already resolved the same page-key, do not re-prompt.

When a new page is needed for an existing repo, instruct the user to start a new branch (`git checkout -b feat/<new-page-key>`) before re-running the SKILL.

### Step 1: Inspect The Source Frames

- Open the desktop and mobile deep links through Figma MCP. Call `get_metadata` on each root frame node id (separately) — do not infer the mobile tree from desktop or vice versa.
- Identify the source document, page, desktop frame, and mobile frame from the metadata, not from the URL or the Figma file name.
- Record each frame's Figma source ref and canvas dimensions from the metadata's actual `width / height`.
- Walk the metadata's top-level children to enumerate section slots. Each slot's section id, breakpoint dimensions, and declared section id (if any) come from the metadata, not from naming intuition.
- Repeated-looking sections are merged into one `implementationFamily` **only** when an explicit Figma signal proves it (a shared component instance reference, a shared declared section id, or matching node names with matching child trees verified via metadata). Same display name alone is not proof.

### Step 2: Resolve Agent Tool Config

- Read `harness/config/agent-tools.json` if it exists.
- If it is missing, use `harness/config/agent-tools.example.json` only as setup guidance and report that shop context and image upload are not configured yet.
- Confirm `shopify.storeDomain`, `toolServer.baseUrl`, and `toolServer.auth.tokenEnv`.
- Confirm `toolServer.routes` includes `/v1/shop-context` and `/v1/sync-jobs` before telling section agents image upload or shop context is configured.
- Read the bearer token from the named environment variable only when an actual tool call is needed.

### Step 3: Build Section Slots

For each paired section:

- assign a stable section id and slot index
- record desktop and mobile node ids, node names, declared section ids, Figma node URLs, and dimensions
- record `implementationFamily` only when Figma naming or explicit metadata proves reuse
- avoid merging repeated sections solely because their names match

### Step 4: Route Section Skills

Default static sections to:

- `sectionType: "theme-section"`
- `dataSourceKind: "none"`
- `skillRouting.recommendedSkill: "skills/theme/implement-section-from-figma/SKILL.md"`

Route native Shopify data sections to `skills/theme/implement-shopify-data-section-from-figma/SKILL.md` when the section is product, collection, article, or metaobject backed.

If shop context is unavailable and the section appears data-backed, keep the section explicit and mark the classification as needing follow-up instead of freezing the content as static.

### Step 5: Write The Manifest

Write `figma/<page-key>/source-manifest.json` with:

- `manifestType: "figma-source-manifest"`
- `pageKey: "<page-key>"` — must equal the path segment between `figma/` and `/source-manifest.json`
- `workflow.pageInitializationSkill: "skills/theme/initialize-page-from-figma/SKILL.md"`
- `workflow.deliveryScope: "section-only"`
- `workflow.acceptanceScope: "section"`
- `workflow.visualBaselineSource: "figma-rest-asset-manifest"`
- `workflow.evidenceManifestPath: "design-assets/manifest.json"`
- `harnessTarget.mode: "installed-theme"`
- `tokenSource.rawPath: "design-tokens/figma.variables2css.css"`
- `tokenSource.writePolicy: "manual-if-missing"`
- `agentCapabilities.assetExtractionDeveloperOwned: true`
- ordered section entries with desktop and mobile source refs

Validate the manifest against `harness/contracts/figma-source-manifest.schema.json` before using it for section work.

### Step 6: Bootstrap Section Notes

Section implementation skills declare `harness/notes/<page-key>.json` as a required input. Bootstrap it now so it exists before section dispatch:

```sh
node ./scripts/agent/init-section-notes.mjs --page <page-key>
```

This writes a minimal valid `harness/notes/<page-key>.json` (one entry per section, populated only with `id` and pointer-style `humanNotes`) and a sibling `harness/notes/<page-key>.example.json` showing every override field on a single example section. The runtime only loads `<page-key>.json`; the example is documentation. Both files are skipped if they already exist; pass `--force` if you want to overwrite.

Do not ask the user to fill in the notes file at this point — the human override layer is filled in lazily as section work surfaces concrete needs. Just confirm both files were written and continue to handoff.

## Handoff

After initialization, dispatch section work only through the section skills selected in `section.skillRouting`.

Each section implementer should prefer REST-extracted asset evidence, runtime section capture, and any dynamic-image masking decision in the section result. If asset evidence is absent, report that the developer must run the extraction step; if MCP screenshots are unstable, report the evidence gap instead of guessing. Page-level preview can still prove route reachability, but it is not the primary visual acceptance proof.
