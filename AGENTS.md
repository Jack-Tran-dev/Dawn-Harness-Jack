# Repository Agent Guide

This is a Shopify theme project initialized from `shopify-theme-harness`. Theme work — Figma-driven page initialization, section implementation, preview verification — follows the harness skills under `skills/`.

This file is an entry index, not a rule body. Rules live in the skills it points to.

## Read in order

0. `node ./scripts/inspect/inspect-bootstrap.mjs --json` — the environment gate. Runs in <2s and reports `bootstrapApplied / nodeModulesInstalled / buildAssetsFresh / sectionRuntimeDeps / browserConfigPresent / themeDevReachable / agentToolsServerReachable` plus exact `remediationCommands`. Self-remediate every `agentFixable: true` code from `harness/contracts/preview-blocker-codes.json` BEFORE writing any markup.
1. `docs/ai/README.md`
2. `docs/ai/agent-workflow.md`
3. `docs/ai/repo-map.md`
4. `docs/ai/skills.md`
5. **`skills/theme/figma-first/SKILL.md`** — applies to every Figma-touching skill below
6. The skill named in your task (typically one of):
   - `skills/theme/initialize-page-from-figma/SKILL.md`
   - `skills/theme/implement-section-from-figma/SKILL.md`
   - `skills/theme/implement-shopify-data-section-from-figma/SKILL.md`
   - `skills/theme/verify-section-preview/SKILL.md`
7. `harness/notes/<page-key>.json` if present (human-authored overrides)
8. The active profile under `skills/theme/profiles/`

## Top Rules

- **Figma-first, never guess** — see `skills/theme/figma-first/SKILL.md`. This rule overrides any softer phrasing in downstream skills. The agent reads Figma via MCP; layout, geometry, typography, spacing, and hierarchy are measured, not estimated.
- **One page-key per branch.** Resolve via `node ./scripts/agent/resolve-page-key.mjs --json`; the resolver reads `feat/<page-key>` from the current git branch unless `--page=<key>` overrides it. Every page-keyed artifact path embeds `<page-key>`; do not invent or shorten it.
- **Plans are repo artifacts.** Write structural decisions into `docs/plans/<date>-<slug>-implementation-plan.md`, not into chat.
- **Build before preview.** Run the project build (Kik default: `pnpm build`) before `make verify-section-preview`. `assets/kik-theme.css` and `assets/kik-component.js` must be current; preview drift is not a Figma issue until the build has run.
- **`verify-section-preview` is mount evidence, not visual fidelity proof.** When `fidelity.mode` is `css-1-to-1`, the agent must still compare DOM regions against measured Figma regions and surface gaps in `needsMainAgentVerification`.
- **Treat exported Figma bundles and source manifests as the standard input contract.** Fail explicitly when they are incomplete, mismatched, or structurally invalid; do not silently reconcile.
- **Self-bootstrap before delivery.** `agentFixable: true` codes in `harness/contracts/preview-blocker-codes.json` (missing bootstrap, missing deps, stale build, missing runtime dep, storefront not running) are NOT legitimate `status: "blocked"` reasons. Run the printed remediation command instead. The decision tree in `harness/contracts/agent/section-status-decision.md` is normative.
- **Storefront dev is agent-driven.** `node ./scripts/agent/storefront-dev.mjs start` brings up `shopify theme dev` using `harness/config/agent-tools.json#storefront`. The session writes `tmp/storefront-dev.{pid,port,json,log}`; `verify-section-preview` reads `tmp/storefront-dev.port` to bind the preview URL to whatever port the session actually got (handles the `portFallback.strategy=increment` case automatically).

## Theme Build Rule

- `src/input.css` is the Tailwind v4 source and shared token entry; it builds to `assets/kik-theme.css`, which `layout/theme.liquid` loads.
- `src/kik-component.js` is the shared behaviour entry; it builds to `assets/kik-component.js`, also loaded by `layout/theme.liquid`.
- If `assets/kik-theme.css` or `assets/kik-component.js` is missing or stale, run `pnpm build` before treating preview drift as a Figma / layout issue.

## Close-Out Minimum

Before any completion claim, state:

- which files changed
- which commands verified the work
- what remains unverified

## How this guide relates to the harness

This file (and everything under `docs/ai/` and `skills/`) was placed here by `npx shopify-theme-harness sync`. The source lives under `scaffold/overlay/` in the harness repo. Local edits will be respected by `sync --upgrade` (the renderer skips files whose hash diverged from its last write); if you need a permanent change, raise it upstream against the harness repo so future projects benefit too.
