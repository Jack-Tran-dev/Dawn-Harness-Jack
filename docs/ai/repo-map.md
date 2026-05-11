# Repository Map

## Inputs

Preferred Figma source-manifest input:

- `figma/<page-key>/source-manifest.json`

This file follows `harness/contracts/figma-source-manifest.schema.json`. The `<page-key>` segment matches the active `feat/<page-key>` git branch and the manifest's required `pageKey` field; this isolation lets multiple pages coexist on `main` without merge conflicts. (A root-level `source-manifest.json` is the legacy singleton location and is rejected by `verify-harness`.) The file carries stable section slots, coarse dimensions, a section-tree fingerprint, and the explicit workflow boundary for section-only delivery. It may also carry Figma page/frame/section deep links when the producer has access to the Figma file key. It intentionally does not carry exported layout trees, token content, or Shopify data-binding decisions. Agents use it with Figma MCP, shop context, and image upload capabilities during implementation.
For the preferred MCP-first path, create or refresh it with `skills/theme/initialize-page-from-figma/SKILL.md` from the desktop and mobile Figma page or frame deep links. The Figma plugin has been removed; the source manifest is agent-owned Figma MCP output.
It also declares `harnessTarget.mode: "installed-theme"` because the harness is generated inside a real Shopify theme project, not into an isolated throwaway theme.
Its `tokenSource.rawPath` is `design-tokens/figma.variables2css.css`; init seeds that path as an empty placeholder and developers fill it manually. Agents should run `make sync-kik-tokens TOKENS=design-tokens/figma.variables2css.css` when it exists and is non-empty, and report a setup gap when it is missing or empty.
Source-manifest sections may declare `sectionType`, `dataSourceKind`, and `skillRouting`. Product, collection, article, and metaobject sections should route to `skills/theme/implement-shopify-data-section-from-figma/SKILL.md`.
Source-manifest visual acceptance is section-scoped. When comparison is needed, use Figma MCP inspection, REST-extracted asset evidence, and that section's retained section-preview runtime capture; page preview evidence is route reachability and upload safety, not the primary visual diff.
Optional REST asset manifests follow `harness/contracts/figma-assets-manifest.schema.json` and are found through `workflow.evidenceManifestPath`, currently `design-assets/manifest.json`. Developers generate them with `make figma-extract-assets PAGE=<page-key>`; see `docs/ai/figma-asset-extraction.md`. Agents consume this manifest but must not run the extractor or request Figma tokens. The manifest contains local image/icon asset candidates. Agents decide whether each candidate is truly static before uploading it through the configured tool server, then map upload results back to the candidate `assetId` or `path`.
Per-page section notes are the human override layer. Authored at `harness/notes/<page-key>.json` against `harness/contracts/section-notes.schema.json`. Section agents must read the file (when present) before deciding `implementationPolicy.pattern`, must mirror each entry's `agentPrompt` verbatim into `section-task.brief`, and must record `notesAcknowledged` on the section result. Bootstrap stubs with `make notes-init PAGE=<page-key>`.

Legacy Figma bundle inputs:

- `figma/<page-key>/page.json`
- `figma/<page-key>/sections/*.json`
- `figma/<page-key>/section-details/*.json`
- `figma/<page-key>/previews/*.png`

Each `page.json` may declare a `surfaceType` of `page`, `product`, `cart`, or `global`, plus `sharedSurfaceKeys` for route surfaces that depend on shared chrome like header and footer.
Each `page.json` may also declare `sectionExecution.excludeSectionIds` when the current acceptance target intentionally excludes specific sections from compile, preview, and runtime ownership.
For Kik-initialized projects, `page.json` may also declare `designSystem` metadata describing the expected token source and optional variables hash.
Source manifests make Figma MCP source-node inspection the primary design-read path. Upgraded legacy exports may include optional `source.figma` references with file, page, node, and URL metadata; agents may use those references with Figma MCP for source-node inspection, but the legacy bundle files remain that path's input contract.
Classified legacy exports may also include embedded `classifications.json` plus section-level `summary.dataBinding`. The harness compiler promotes that into generated section tasks, briefs, and template contracts so implementation agents do not depend on chat-only classification context. For source-manifest workflows, the agent owns shop-context lookup and persists data-binding decisions in generated task/result artifacts.

## Harness

- `harness/contracts/*` formal input and starter-output contracts
- `harness/contracts/agent/*` agent orchestration, section handoff, and acceptance contracts
- `harness/contracts/agent-tools-config.schema.json` agent-callable Shopify tool server config contract
- `harness/config/agent-tools.example.json` safe template for `harness/config/agent-tools.json`; it declares `toolServer.routes` for `/v1/export-tokens/resolve`, `/v1/shop-context`, `/v1/sync-jobs`, `/v1/sync-jobs/:jobId`, and `/v1/sync-jobs/:jobId/events`; real bearer tokens must live in the env var named by `toolServer.auth.tokenEnv`
- `harness/contracts/figma-assets-manifest.schema.json` optional REST asset contract for local Figma image/icon candidates
- `harness/contracts/figma-source-manifest.schema.json` preferred thin Figma source-entry contract for agent-owned implementation
- `design-tokens/figma.variables2css.css` init-created empty placeholder for the manually supplied raw Figma variables2css token handoff file consumed by agent token sync
- `harness/config/browser-verification.example.json` fixed browser-verification config example for preview acceptance
- `harness/config/kik-token-source.example.json` fixed metadata example describing whether the project is using real Figma variables, a CSS token source file, or fallback Kik tokens
- `harness/generated/kik.tokens.json` generated token manifest for agent-readable Kik Tailwind aliases after `make sync-kik-tokens`
- `harness/compiler/*` bundle loading and starter generation
- `harness/runtime/*` restore-loop helpers and runtime manifests

## Stable Surfaces

- `scripts/agent/*` machine-readable agent orchestration and acceptance helpers
- `scripts/inspect/*` machine-readable repo inspection
- `scripts/verify/*` deterministic verification entrypoints

The preview verifier is a Playwright CLI-only helper under `scripts/agent/*`, not an MCP-driven browser workflow.
It also serves as the harness upload-safety gate for route previews, failing on Shopify upload-error pages or when too few sections mount.
It is necessary preview evidence, but not sufficient fidelity evidence for route-owned one-shot acceptance.
`scripts/verify/verify-section-implementation.mjs` is the route-owned authenticity gate. It rejects sections whose implementation body collapses into a screenshot baseline, hardcodes remote image URLs, omits the schema surface implied by the compiled template contract, adds extra merchant-editable schema surface outside that contract, or falls back to static image markup when `section-task.dataBinding` requires native Shopify data.
`inspect-runtime` emits capture-level diagnosis categories so fidelity mismatches explain likely causes instead of only reporting counts.
The page runner and page verification surfaces treat `starter/theme/agent/page.*.preview.json` as the default preview evidence artifact for route-owned surfaces.
`scripts/agent/assert-page-acceptance.mjs` is the final artifact gate. It verifies that preview and page-verification artifacts both exist, both passed, and both are fresh relative to the page-task dependency graph.
`bundleQuality` is the route-owned one-shot eligibility gate; ambiguous bundles or bundles with weak section identity stay inspectable but should fail before dispatch or acceptance starts.
`bundleConsistency` is the route-owned input-reliability diagnosis; route bundles with missing detail/layout data, preview/detail ratio drift, out-of-bounds layout boxes, or missing referenced asset files should not be trusted for one-shot acceptance even if section identity quality is otherwise high.
For Kik initialization, Tailwind utilities are unprefixed by default; `.kik-component` remains the containment namespace when host-theme conflicts need to be isolated locally.

## Generated Starter Output

- `starter/theme/agent/page.*.dispatch.json`
- `starter/theme/agent/page.*.assembly.json`
- `starter/theme/agent/page.*.preview.json`
- `starter/theme/agent/page.*.retry-ledger.json`
- `starter/theme/agent/page.*.run.json`
- `starter/theme/agent/page.*.task.json`
- `starter/theme/agent/page.*.verification.json`
- `starter/theme/agent/section-previews/*.preview-template.json`
- `starter/theme/agent/section-previews/*.preview.json`
- `starter/theme/agent/sections/*.task.json`
- `starter/theme/sections/generated-*.liquid`
- `starter/theme/templates/index.kik-preview.json`
- `templates/index.kik-section-*.json` in the real theme project for retained section-scoped human review
- `starter/theme/templates/page.*.json`
- `starter/theme/templates/product.*.json`
- `starter/theme/templates/cart.*.json`
- `starter/theme/review/*.manifest.json`
- `starter/theme/review/*.capture-plan.json`
- `starter/theme/runtime/runtime-profile.json`
- `starter/theme/runtime/theme-project.binding.example.json`
- `starter/theme/runtime/theme-project.binding.json`
- `starter/theme/runtime/captures/*`

Starter template section ids are Shopify-safe and hyphenated; they remain deterministic across compile, assembly, and verification outputs.
Starter section-task implementation targets are slot-scoped by default. Repeated section names or repeated `suggestedHandle` values do not imply shared implementation ownership unless a later contract says so explicitly.
For upgraded legacy bundles, `summary.implementationFamily` is the preferred reusable-boundary signal. For older bundles, the harness keeps slot-scoped isolation instead of guessing from names alone.
Section tasks also carry a compiled `templateContract` that page assembly and page verification enforce. Unexpected section types, unexpected setting keys, and forbidden block payloads should fail before the page is accepted.
Section tasks now also carry a compiled `brief` that summarizes content, layout, and input diagnostics. Workflow guidance belongs in the repo skills, not in duplicated task JSON rule fields.
Section tasks may also carry `inputs.figmaSource` and `brief.source.figma` when the bundle has source-node metadata.
Section tasks may carry `dataBinding` and `brief.content.dataBinding` for classified product, collection, article, and metaobject sections. Agents should treat the task field as the source of truth and report `nativeShopifyDataSourceUsed` in section-result checks when it is present.
Section results report structured verification through `verification.checks`; the harness no longer relies on duplicated `selfCheck + evidence` payloads.
Retry exhaustion is persisted in `page.*.retry-ledger.json`, and dispatch should stop offering a section again once the ledger marks it `exhausted`. Repeated blocked verification cycles without a valid section-result artifact still count toward that budget so no-result loops terminate deterministically.
The installable acceptance guardrails now live in three fixed surfaces:

- `make accept-page PAGE=<page-key>` for the single-command acceptance workflow
- `.githooks/pre-push` for local push-time artifact enforcement after `make install-git-hooks`
- `.github/workflows/validate-page-acceptance.yml` for CI enforcement in installed projects

## Workflow

- `docs/plans/*` execution artifacts
- `skills/process/*` repo-local agent workflow
- `skills/theme/*` repo-local theme implementation workflow
- `skills/theme/profiles/*` project rule profiles layered onto the generic workflow

Shared `global` surfaces are orchestrated like other surfaces, but they are verified through the consuming `page`, `product`, or `cart` routes rather than owning a route template themselves.

For Kik projects, token parity is part of the inspect and verify loop:

- `figma/<page-key>/page.json` may declare `designSystem`
- `harness/config/kik-token-source.json` records the current project token source
- `design-tokens/kik.tokens.css` is the default maintained token source for daily work
- `make sync-kik-tokens` regenerates `src/input.css`, `harness/generated/kik.tokens.json`, and token-source metadata
- `inspect-harness` reports parity status
- `verify-harness` fails when bundle design-system requirements and project token-source metadata drift apart
