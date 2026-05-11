---
name: implement-section-from-figma
description: Use when a subagent needs to implement exactly one Shopify theme section from a structured section task and return a machine-readable result to the main agent.
---

# Implement Section From Figma

## Goal

Implement one section only, using the provided `section-task`, and return a stable `section-result` to the main agent.

## Required Inputs

Read these first:

- the provided `section-task`
- `section-task.brief`
- any source-manifest section reference attached to the task
- `harness/notes/<page-key>.json` if it exists (see "Section notes" below — this is human-authored override data and must be read before any implementation decision)
- `harness/contracts/section-notes.schema.json`
- `harness/config/agent-tools.json` when shop context or image upload is needed
- `harness/contracts/agent-tools-config.schema.json`
- `harness/contracts/agent-tools-error-codes.json`
- `skills/theme/profiles/kik/SKILL.md`
- `harness/contracts/agent/section-task.schema.json`
- `harness/contracts/agent/section-result.schema.json`
- `skills/theme/verify-section-preview/SKILL.md`

`skills/theme/figma-first/SKILL.md` applies to this entire skill and overrides any softer phrasing below. Read it before deciding what counts as "enough" Figma inspection.

If the `section-task` points at starter or Figma bundle files, read those files directly before changing code.

**Source-manifest flow** (task came from `figma/<page-key>/source-manifest.json`): the brief is agent-authored — treat it as your **output**, not your input. Run `get_metadata` on the section root node id for both desktop and mobile breakpoints, capture the child subtree, and fill `brief.layout.*` from those measurements before writing any markup. Cross-check that the manifest's `pageKey` field, the path segment, and `section-task.pageKey` all agree; mismatch is an openIssue, not something to silently reconcile. Persist every layout, content, data-binding, and asset decision in the section result.

**Legacy bundle flow** (task carries a compiled brief from `harness/compiler`): the brief was machine-produced from exported Figma JSON and is authoritative. Use `inputs.figmaSource` desktop and mobile links with `get_metadata` only when you need extra context the compiled brief did not capture (sub-element geometry, layered fills, nested auto-layout). The exported bundle JSON, `templateContract`, and compiled brief remain the implementation contract.

**Both flows**: visual acceptance is section-scoped. Prefer REST-extracted assets from the manifest path declared by `workflow.evidenceManifestPath` when image or icon evidence is useful, then compare against that section's runtime capture and report the evidence in the section result. Use MCP screenshots only as ad hoc fallback evidence; persistent screenshot transport errors should be reported as evidence gaps, not papered over with intuition.

## Step −1: Environment Self-Check (mandatory)

Before any section work, run:

```sh
node ./scripts/inspect/inspect-bootstrap.mjs --json
```

This is the single deterministic gate that reports whether the project is ready for storefront preview. It returns seven status bits — `bootstrapApplied`, `nodeModulesInstalled`, `buildAssetsFresh`, `sectionRuntimeDeps.missing[]`, `browserConfigPresent`, `themeDevReachable`, `agentToolsServerReachable` — plus an ordered `remediationCommands` array. Match the missing bits against this decision table and act on them, in order, before writing any markup:

| Missing bit                          | Agent action                                                                                  | Stable code                              |
|--------------------------------------|-----------------------------------------------------------------------------------------------|------------------------------------------|
| `bootstrapApplied=false`             | `make bootstrap-kik-theme` (auto-reads STORE from `harness/config/agent-tools.json`)          | `PREVIEW_BROWSER_CONFIG_MISSING`         |
| `nodeModulesInstalled=false`         | `pnpm install --frozen-lockfile`                                                              | `PREVIEW_NODE_MODULES_MISSING`           |
| `sectionRuntimeDeps.missing[].dep`   | `pnpm add <dep>` per `harness/contracts/section-runtime-deps.json`                            | `PREVIEW_RUNTIME_DEP_MISSING`            |
| `buildAssetsFresh=false`             | `pnpm build`                                                                                  | `PREVIEW_BUILD_ASSETS_STALE`             |
| `themeDevReachable=false`            | `node ./scripts/agent/storefront-dev.mjs start`                                               | `PREVIEW_STOREFRONT_NOT_RUNNING`         |
| port held by foreign process         | report — strategy-dependent (see `agent-tools.json#storefront.portFallback`)                  | `PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS` |

All codes flagged `agentFixable: true` in `harness/contracts/preview-blocker-codes.json` (rows 1–5 above) MUST be self-remediated by this skill. Returning a `section-result` whose `status: "blocked"` was caused by any of those is a contract violation; the decision tree in `harness/contracts/agent/section-status-decision.md` rejects it.

Only `agentFixable: false` codes (port held by a non-shopify process, storefront password rejected, storefront 5xx, agent-tools server unreachable when shop context is needed) are legitimate `status: "blocked"` reasons.

## Section notes

`harness/notes/<page-key>.json` is the human-authored override layer for everything the source-manifest classifier or the agent might guess wrong. The path is fixed; the file is optional, but reading it is **not**.

Before deciding `implementationPolicy.pattern`, schema shape, or any data-binding:

1. Resolve `<page-key>` from `section-task.pageKey` when present. If invoked outside a page-task pipeline (e.g. direct CLI run), resolve via `node ./scripts/agent/resolve-page-key.mjs --json` (the resolver reads `feat/<page-key>` from the current git branch unless `--page=<key>` / `PAGE=<key>` overrides it). Cross-check the resolved key matches `section-task.pageKey` and abort with an openIssue if they differ — divergence means the task was generated on a different branch.
2. Open `harness/notes/<page-key>.json`. If absent, write one openIssues line in the section result: `"section-notes file not present at harness/notes/<page-key>.json; pattern decision based on figma/<page-key>/source-manifest.json only."`
3. If present and the file lists this section's `id` in `sections[*]`:
   - `implementationPolicy` from the notes wins over source-manifest's same-named fields.
   - `skillRoutingOverride.recommendedSkill` re-routes to the named skill if you weren't already there.
   - `agentPrompt` is the authoritative behavioural brief — copy it verbatim into `section-task.brief.notes` and execute it.
   - `humanNotes[]` is provenance only; read but do not act on individual bullets.
4. Always emit `section-result.notesAcknowledged = { path, sha256, sectionId, agentPrompt, implementationPolicy }` so the harness can verify you actually read the file. The sha256 must equal the on-disk file's sha256 at read time; `agentPrompt` must be the verbatim string. `make build-page-verification` and `make run-page-dispatch` reject section results that fail this check.
5. Never paraphrase, summarise, or rewrite `agentPrompt`. If you think the prompt is wrong, raise it as an openIssue and stop; don't silently override.

## Non-Negotiable Rules

- Work on one section only.
- Do not broaden scope into neighboring sections.
- Do not declare page-level completion.
- Follow the active profile rules exactly.
- Run `node ./scripts/inspect/inspect-bootstrap.mjs --json` BEFORE writing markup. Self-remediate every code flagged `agentFixable: true` in `harness/contracts/preview-blocker-codes.json` (missing bootstrap, missing deps, stale build, missing runtime dep, storefront not running). Returning `status: "blocked"` for any of those is a contract violation; see `harness/contracts/agent/section-status-decision.md` and Step −1 above.
- Self-install per-section runtime npm dependencies before importing them. Look up the required packages in `harness/contracts/section-runtime-deps.json` by `<pattern>/<defaultImplementation>` (e.g. `carousel/swiper` → `swiper@^11`) and run `pnpm add <dep>`. Skill files don't restate the package list; the contract file is the source of truth.
- Treat desktop and mobile as separate sources.
- Return a full `section-result`, not an informal summary.
- Respect `section-task.implementationPolicy` exactly.
- Respect `section-task.fidelity` exactly.
- If `section-task.dataBinding` is present, implement the section from the native Shopify data source before using static text or image hints.
- If no `dataBinding` is present because the task came from a source manifest, inspect shop context before freezing repeated product, collection, article, or metaobject content as static markup.
- Upload static imagery only after deciding it is not backed by Shopify product, collection, article, or metaobject data.
- Prefer REST-extracted asset candidates when static imagery must be uploaded. Use stable `assetId` or `path` values from `design-assets/manifest.json` to locate files, and map upload results back to those identifiers in the section result. If the manifest or referenced file is missing, report the developer extraction step as a blocker; do not run `make figma-extract-assets`, request `FIGMA_ACCESS_TOKEN`, or download Figma files yourself.
- For every Shopify Files upload, append a row to `section-result.assetUploads` carrying `assetId`, `sha256`, `shopifyFileId` (MediaImage GID), `shopifyUrl` (CDN URL), `settingId`, `settingValue`, and the `syncJobId` from `POST /v1/sync-jobs`. Retain skipped REST asset candidates with `skippedReason` so the next agent does not re-evaluate them from scratch.
- Write image_picker setting values in `templateContribution.settings` as `shopify://files/<filename.ext>`. Do not embed CDN URLs or MediaImage GIDs directly into the contribution; the GID is recorded in `section-result.assetUploads[*].shopifyFileId` for page assembly to translate if it needs a different reference shape.
- Read `harness/config/agent-tools.json` before shop-context lookup or static image upload.
- Use only the routes declared by `toolServer.routes`: `shopContext` for context, `syncJobs` for multipart upload, `syncJob` for polling, and `syncJobEvents` for SSE updates. Do not try guessed routes such as `/files/upload`, `/shop`, `/tools`, or `/api/shop`.
- Do not write bearer tokens or Shopify Admin tokens into repo files; read the token from the environment variable named by `toolServer.auth.tokenEnv`.
- Treat a `401` from the tool server as a missing, expired, or unregistered export token. Report that configuration issue instead of changing endpoint paths.
- Map server errors to stable codes from `harness/contracts/agent-tools-error-codes.json` and quote the matching `code` in `section-result.openIssues`. The contract covers `AGENT_TOOLS_INVALID_EXPORT_TOKEN` (the "tokenHash vs plaintext" trap), `AGENT_TOOLS_SHOPIFY_SCOPE_NOT_APPROVED`, `AGENT_TOOLS_MULTIPART_MANIFEST_INVALID`, `AGENT_TOOLS_MULTIPART_FIELD_NOT_VALID_JSON`, `AGENT_TOOLS_ASSET_TOO_LARGE`, and `AGENT_TOOLS_ROUTE_NOT_FOUND`. Do not paraphrase the server message; quote the code.
- If shop context or image upload is required but agent tool config is missing, mark the section blocked instead of guessing.
- Do not rely on a full-page screenshot diff as the section's visual acceptance proof.
- Do not edit or restore `templates/index.kik-preview.json` during section work.
- Run the project build command before section preview verification when the theme has generated assets. For Kik themes, `src/input.css` builds to `assets/kik-theme.css`, and `layout/theme.liquid` loads that generated asset.
- After writing a completed section result, run the section-scoped preview workflow and keep the generated preview template for human review.
- The contract supports two preview modes, and they are NOT interchangeable for acceptance:
  - **`make verify-section-preview PAGE=<page> SECTION=<section> PROJECT_ROOT=.`** is the only path that produces an acceptance proof. `section-result.sectionPreview.mode` must be `storefront-render` for the section to be declared `status: "completed"`.
  - **`make verify-section-preview-offline PAGE=<page> SECTION=<section> PROJECT_ROOT=.`** is triage evidence only. It runs Playwright against a static `output/section-snapshots/<page>/<section>/preview.html` you authored and writes `section-result.sectionPreview.mode: "offline-snapshot"`. When the only available run is offline, the section must be delivered with `status: "partial"` and an openIssue describing the storefront blocker (storefront password missing, export token unregistered, harness module missing, etc.). Page assembly will reject offline-only sections that claim completed.
- Brief priority depends on the flow:
  - **Legacy bundle flow**: use `section-task.brief` as the starting restore brief; the brief's semantic fields (primary message, CTA labels, layout pattern, placement hints, reading-order text regions) are compiler-measured and should anchor the first implementation pass before drilling into raw Figma JSON.
  - **Source-manifest flow**: the brief is agent-authored. Do NOT anchor on its `layout.*` fields until you have populated them from `get_metadata` — otherwise you anchor on your own estimates. In this flow the correct order is `get_metadata` → fill brief → implement.
- Treat desktop and mobile as separate sources at every step. A single `get_metadata` call cannot cover both — call it twice.
- `get_design_context` is a secondary signal (screenshot + reference React code). Never let it be the sole basis for spacing, typography, or layout decisions; if it disagrees with `get_metadata`, `get_metadata` wins.
- If a Figma measurement is missing or MCP is unreachable, leave the corresponding `brief.layout.*` field empty and raise an `openIssue` quoting the failed call. Do not estimate from screenshots, sibling sections, or prior commits.
- Ad-hoc layout offsets that exist only to make the live render visually click into place (e.g. negative margins, z-index hacks, opacity nudges) are forbidden when the underlying Figma metadata describes a clean layout. If the metadata says a node is an in-flow flex child, implement it as an in-flow flex child.
- If `implementationPolicy.pattern` is `carousel`, default to `Swiper.js`. See `skills/theme/swiper-carousel/SKILL.md` for the contract — required CSS imports, custom-element mount, loop+region probe interaction, common failures.
- If `implementationPolicy.pattern` is `carousel` and the profile rules point at `src/kik-component.js`, mount the interaction through a Custom Element instead of inline section JavaScript.
- For `carousel` sections, **never** render every slide with the same image. Per-slide assets come from `brief.blocks[i].imageDesktop` / `brief.blocks[i].imageMobile`. If `brief.blocks` is missing or carries null asset paths, that is itself a brief-author defect (source-manifest could not recover per-slide assets); the implementing agent must record the limitation in `section-result.openIssues` rather than picking the first asset and reusing it. Choosing `brief.layout.{breakpoint}.preview.path` as a slide background is forbidden — it is a frame screenshot and bakes overlay text in (see `skills/theme/figma-first/SKILL.md`).
- Use `scroll-snap` only when returning an explicit exception reason in `implementationDecision`.
- Do not reuse old theme slider code as the implementation base when the task policy says theme code reuse must be avoided.
- When `fidelity.mode` is `css-1-to-1`, restore layout, spacing, typography, borders, radii, and alignment 1:1 to the Figma references.
- When `fidelity.ignoreImageContent` is true, do not let missing final image content justify CSS drift.
- When the task rules say Tailwind utility-first is the primary style surface, write the section's styling primarily in Liquid utility classes.
- Do not treat section-private BEM classes or `src/input.css` edits as the default styling path.
- If you must touch the shared style entry, return it as an explicit shared-style exception in `implementationDecision`.

## Stable Workflow

### Step 0: Measure with Figma MCP (Figma-First gate)

Mandatory in source-manifest flow, recommended whenever `inputs.figmaSource` is present. The goal of this step is to make every later decision traceable to a real Figma measurement instead of an estimate.

1. **Resolve both root node ids** — desktop and mobile — from `inputs.figmaSource.{desktop,mobile}.nodeId` (or, in source-manifest flow, from `figma/<page-key>/source-manifest.json#sections/<id>/source/{desktop,mobile}/nodeId`).
2. **Call `get_metadata` once per breakpoint** on those root ids, with `clientFrameworks="liquid,shopify"`. Capture the full child subtree; do not stop at the section root.
3. From the returned XML, extract for every relevant child node:
   - `nodeId`, `name`, `type`
   - absolute `x / y / width / height`
   - parent-relative position (compute by subtracting the parent node's `x / y`)
   - any auto-layout / gap / padding hints visible in the metadata
4. **Reading-order text regions**: walk the metadata sorted by `(y, x)` and emit one entry per text node into `brief.layout.{desktop,mobile}.readingOrderTextRegions`. Each entry must carry `name`, `x`, `y`, `width`, `height` from the metadata, plus a `sourceNodeId` linking back to the Figma node.
5. **Primary text/image boxes**: pick the largest text node and the largest image fill node; copy their bounding boxes into `brief.layout.{desktop,mobile}.{primaryTextBox,primaryImageBox}` with the same `sourceNodeId` provenance.
6. **`get_design_context` as a secondary check**: call it for the same root id, scan the returned reference code for variant cues (`flex-col` vs `flex-row`, `items-start` vs `items-center`, `justify-end` vs `justify-center`, fixed vs absolute pagination dot positions). If a cue disagrees with the metadata, `get_metadata` wins; record the disagreement in `brief.diagnostics`.
7. **Mobile is a separate source.** Do not derive mobile geometry from the desktop measurements. Pagination location, content alignment, padding scale, type ramp, and image cropping all change between breakpoints — measure each separately.
8. **Record provenance in `brief.source.mcpInspections`** (one entry per call). Each entry: `{ breakpoint, rootNodeId, callType: "get_metadata" | "get_design_context", capturedAt: <ISO timestamp>, childNodeIds: [<ids whose measurements you used>] }`. Every `sourceNodeId` you assigned in steps 4–5 must appear in some inspection's `childNodeIds`. Also list the calls in `section-result.commandsRun` for human-readable review.
9. **If a measurement is unavailable**, leave the corresponding brief field empty (do not fill in a guess) and emit an `openIssue` quoting the failed call. Do not proceed to Step 2 if the unavailable measurement is load-bearing for layout (e.g. the section root itself, or every text node on a breakpoint).

The output of Step 0 is the populated brief, including `source.mcpInspections`. Steps 1–4 below treat that brief as the contract.

### Step 0b: Carry the measurement contract into markup

For every brief region that has a `sourceNodeId` (set in Step 0), the corresponding rendered DOM element must carry `data-kik-region="<sourceNodeId>"`. This is what lets `verify-section-preview` confirm that the implementation honored the measurement instead of overriding it ad-hoc.

- The annotation goes on the **outermost element** that owns the region's content (e.g. `<h1>` for a heading region, `<div>` wrapping an image fill for an image region).
- Use the `sourceNodeId` value verbatim — colon and all (e.g. `data-kik-region="11928:7876"`).
- For responsive markup where the same DOM element represents the same logical region across breakpoints, list every breakpoint's `sourceNodeId` as a whitespace-separated value, e.g. `data-kik-region="11928:8845 11928:7876"` (desktop + mobile heading on one `<h1>`). The probe matches with CSS `~=` semantics — each token is checked independently, so both breakpoints' presence/geometry checks resolve to the same element.
- When `fidelity.mode === "css-1-to-1"`, `verify-section-preview` will fail the run if any brief region's `sourceNodeId` has no matching `[data-kik-region="<id>"]` element under any mounted Shopify section.

### Step 1: Read the section task carefully

Confirm:

- the section identifiers
- the target implementation files
- the desktop and mobile inputs
- any optional `inputs.figmaSource` desktop and mobile node references
- the compiled brief
- any `section-task.dataBinding` and `brief.content.dataBinding`
- whether `harness/config/agent-tools.json` is configured when native shop context or image upload is needed
- the page-level fidelity contract
- the required profile rules
- the verification checks you will need to report

### Step 2: Implement the section

- use the task's implementation target paths
- preserve task-defined runtime slot names
- for a product binding, define a `product` setting and render product fields from `section.settings.product`
- for a collection binding, define `collection` and `limit` settings and loop `section.settings.collection.products` up to the limit
- for an article binding, define `blog` and `limit` settings and loop `section.settings.blog.articles` up to the limit
- for a metaobject binding, use the compiled type setting or fixed type and loop `shop.metaobjects[type].values`
- do not replace a data-bound subtree with exported static image markup when a native Shopify source is declared
- prepare a `templateContribution` payload for the main agent to assemble into the full page template
- report the implementation choice in `implementationDecision`
- if the page is in `css-1-to-1` mode, assume the main agent will perform explicit layout review later and do not claim the preview route itself proves parity

### Step 3: Run section-level self-checks

Confirm and report:

- desktop input reviewed
- mobile input reviewed
- schema derived from content structure
- runtime slot names preserved
- utility-first markup used when the active profile requires it
- shared CSS policy respected unless you declare an explicit exception
- interaction wiring checks for carousel sections
- retained section-scoped preview template generation
- section preview route render and screenshot capture
- native Shopify data source usage when `section-task.dataBinding` is present
- any remaining layout-review need is surfaced through `needsMainAgentVerification`

### Step 4: Return a structured section result

Always return:

- `sectionId`
- `status`
- `changedFiles`
- `summary`
- `verification`
- `templateContribution`
- `implementationDecision`
- `commandsRun`
- `openIssues`
- `needsMainAgentVerification`

If blocked, say so explicitly in `status` and `openIssues`.

A completed `section-result` must include a non-null `verification` object. Use it to record:

- whether the section passed its own self-checks
- the machine-readable `verification.checks` booleans the harness will validate
- whether the section is still waiting on main-agent page acceptance
- whether utility-first markup was actually used
- whether the shared CSS policy was respected or an explicit exception was declared
- whether native Shopify data source usage was actually implemented for data-bound sections
- whether `verification.checks.sectionPreviewRendered` was set by `verify-section-preview`
- `sectionPreview` evidence when the section-scoped preview route was rendered

## Things The Subagent Must Not Do

- run page-level acceptance and declare success
- edit the shared `templates/index.kik-preview.json` for isolated section review
- silently change unrelated sections
- return only prose
- invent new profile rules outside the active profile
- restate workflow guidance from the referenced skills as if it were a new task-specific protocol rule

## Common Failures

- implementing from desktop only
- returning “done” without a structured result
- changing preview or runtime surfaces without reporting them
- claiming a section is accepted without filling `verification.checks`
- returning `verification: null` or omitting structured section verification
- using image placeholders as a reason to change spacing, typography, or geometry on `css-1-to-1` pages
- defaulting to BEM plus global CSS when the task rules require Tailwind utility-first Liquid markup
- satisfying a data-bound section by adding schema settings while still rendering exported static product, collection, article, or metaobject imagery
- **Figma-First violations** (each one alone is enough to fail the section):
  - skipping `get_metadata` and writing markup from a `get_design_context` screenshot + reference code only
  - filling `brief.layout.*` with eyeballed numbers and presenting the brief as authoritative
  - calling MCP only on the desktop frame and inferring mobile from desktop proportions
  - using `-mt-[…]`, negative offsets, or other ad-hoc nudges to pin the live render into place when the metadata describes a clean in-flow layout
  - claiming `status: "completed"` on a `css-1-to-1` section without recording which `get_metadata` calls produced the brief geometry
