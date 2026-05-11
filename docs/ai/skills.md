# Repository Skills

## Goal

Keep the starter's workflow portable across sessions and future theme projects.

## Priority

1. explicit user request
2. `AGENTS.md`
3. `skills/theme/figma-first/SKILL.md` — cross-cutting policy that overrides any softer phrasing in downstream skills whenever the task touches Figma
4. formal contracts
5. repo-local `skills/*`
6. default model behavior

## Environment self-check (Step 0 of every theme skill)

Run `node ./scripts/inspect/inspect-bootstrap.mjs --json` (or `make inspect-bootstrap`) before any other theme work. The decision table in `skills/theme/implement-section-from-figma/SKILL.md#Step-1-Environment-Self-Check-mandatory` maps each missing bit to its remediation:

- `bootstrapApplied=false` → `make bootstrap-kik-theme`
- `nodeModulesInstalled=false` → `pnpm install --frozen-lockfile`
- `sectionRuntimeDeps.missing[]` → `pnpm add <dep>` per `harness/contracts/section-runtime-deps.json`
- `buildAssetsFresh=false` → `pnpm build`
- `themeDevReachable=false` → `node ./scripts/agent/storefront-dev.mjs start`

These are the codes flagged `agentFixable: true` in `harness/contracts/preview-blocker-codes.json`; they are NOT legitimate `status: "blocked"` reasons. The decision tree in `harness/contracts/agent/section-status-decision.md` is normative.

## Figma-First Rule (cross-reference)

The Figma-First Rule lives in `AGENTS.md`. It applies to every theme skill that touches Figma — page initialization, section implementation, asset binding, fidelity review. Skills below may not weaken it; they may only add specifics on top of it.

## Required Process Skills

- `skills/process/write-plan/SKILL.md`
- `skills/process/execute-plan/SKILL.md`
- `skills/process/tdd-loop/SKILL.md`
- `skills/process/verify-before-complete/SKILL.md`

## Theme Skills

- `skills/theme/execute-page-from-figma/SKILL.md`
- `skills/theme/initialize-page-from-figma/SKILL.md`
- `skills/theme/implement-section-from-figma/SKILL.md`
- `skills/theme/implement-shopify-data-section-from-figma/SKILL.md`
- `skills/theme/implement-figma-section/SKILL.md`
- `skills/theme/swiper-carousel/SKILL.md`
- `skills/theme/verify-page-preview/SKILL.md`
- `skills/theme/verify-section-preview/SKILL.md`
- `skills/theme/figma-classify/SKILL.md`
- `skills/theme/kik-shopify-theme-init/SKILL.md`
- `skills/theme/kik-shopify-figma-section/SKILL.md`
- `skills/theme/profiles/kik/SKILL.md`

This skill is the harness-owned generic section implementation workflow. Project-specific conventions should layer on top of it, not replace it.

The Kik skills are repo-local overlays for projects that intentionally adopt the Kik baseline. They should live alongside the generic harness workflow instead of depending on external global skill paths.
Kik bootstrap and token sync are separate workflows: `bootstrap-kik-theme` is for one-time theme setup, while `sync-kik-tokens` is the repeatable token maintenance path from `design-tokens/kik.tokens.css`.

The generic page and section protocol should stay reusable across Shopify theme projects. The active project rules belong in the profile layer, with `kik` as the current supported profile.
For source-manifest workflows, use `skills/theme/initialize-page-from-figma/SKILL.md` to turn desktop and mobile Figma deep links into the thin `figma/<page-key>/source-manifest.json` entry contract. Then use Figma MCP, shop context, and image upload capabilities to create durable section task/result artifacts. For legacy bundle workflows, when generated section tasks include `inputs.figmaSource`, agents may use those links with Figma MCP for source-node inspection while the exported bundle and compiled task contract remain the source of truth.
When a source-manifest section routes to `product-data-section`, `collection-data-section`, `article-data-section`, or `metaobject-data-section`, use `skills/theme/implement-shopify-data-section-from-figma/SKILL.md` together with the generic section skill.
Use `skills/theme/figma-classify/SKILL.md` to create or update repo-local classification documents before classified legacy exports. When generated section tasks include `dataBinding`, implementation agents must render from the declared native Shopify source and report `nativeShopifyDataSourceUsed`. In source-manifest flows, the agent owns this binding decision and must persist it before final acceptance.
For source-manifest token setup, treat `design-tokens/figma.variables2css.css` as an init-created placeholder for a manual developer handoff file. Run `make sync-kik-tokens TOKENS=design-tokens/figma.variables2css.css` only when it exists and is non-empty; if it is missing or empty, report the setup gap instead of reconstructing token content.
For shop-context lookup and image upload, agents should read `harness/config/agent-tools.json`, validate it against `harness/contracts/agent-tools-config.schema.json`, and use the exact paths in `toolServer.routes`. Take the bearer token from the environment variable named by `toolServer.auth.tokenEnv` such as `SHOPIFY_AGENT_TOOL_TOKEN`. Do not write access tokens into repo files. Use `routes.shopContext` for context, `routes.syncJobs` for multipart file upload, `routes.syncJob` for polling, and `routes.syncJobEvents` for SSE job updates. A `401` means the token is missing, expired, or not registered server-side; do not guess alternate paths.
For source-manifest visual acceptance, use Figma MCP inspection, optional REST-extracted assets from `workflow.evidenceManifestPath`, and runtime section captures. Developers generate REST assets manually using `docs/ai/figma-asset-extraction.md`; agents must not run the extractor or request Figma tokens. Generate retained section-scoped preview templates and screenshots with `verify-section-preview`; do not mutate `templates/index.kik-preview.json` for section-only work. REST asset candidates are local file sources only; agents still decide whether each asset is static before uploading and must map upload results back to `assetId` or `path`. Page preview verification remains useful for reachability and upload safety, but it is not the primary visual acceptance proof.

The preview-verification surface is Playwright CLI-first. Do not use Playwright MCP as the default acceptance path for this repo.

## Rules

- plans are repo artifacts, not chat-only artifacts
- do not rely on external workflow names inside repo docs or plans
- use repo-relative paths only in plans and contracts
- keep verification commands stable and runnable from repo root
