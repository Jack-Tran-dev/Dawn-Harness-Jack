---
name: verify-section-preview
description: Use after a Shopify theme section has a completed section-result and needs an isolated browser preview artifact for visual review without editing the shared full-page Kik preview template.
---

# Verify Section Preview

## Goal

Create and verify a retained section-scoped Shopify preview template for one completed section.

This skill is section-owned. It does not assemble the final page and does not edit `templates/index.kik-preview.json`.

## Required Inputs

Read these first:

- the target section task under `starter/theme/agent/sections/*.task.json`
- the matching section result under `starter/theme/agent/results/*.result.json`
- `harness/config/browser-verification.json`
- `scripts/agent/create-section-preview.mjs`
- `scripts/agent/verify-section-preview.mjs`
- `scripts/agent/verify-section-preview-offline.mjs` (for the offline fallback path)

## Non-Negotiable Rules

- Do not hand-edit `templates/index.kik-preview.json`.
- Generate a retained section-scoped template with `create-section-preview`.
- Verify the retained section route with `verify-section-preview`.
- Keep the generated section template for human review.
- Record runtime screenshots and Figma baseline paths in `section-result.sectionPreview`.
- Treat `sectionPreview.status: "pending-human-review"` as the normal state after machine render verification; human or main-agent visual review may later mark it passed or failed.
- If the route does not mount at least one Shopify section, treat the section preview as failed.
- The `verify-section-preview` script runs an automatic preflight before opening Playwright. When preflight fails it returns a structured blocker code from `harness/contracts/preview-blocker-codes.json` (exit 2 = `agentFixable: true`, exit 3 = real blocker). Do NOT paper over an exit-2 with a stack trace — match the code and run the printed `remediation` (`pnpm install`, `pnpm build`, `pnpm add <dep>`, `node ./scripts/agent/storefront-dev.mjs start`, etc.) before retrying. Only exit-3 codes are legitimate `status: "blocked"` reasons.
- The previewUrl is dynamically rebound to the live storefront-dev port via `tmp/storefront-dev.port`. If `storefront-dev` landed on a fallback port (strategy=increment), the agent does NOT need to edit `harness/config/browser-verification.json` — `verify-section-preview` rewrites the host:port automatically.

## Storefront dev session

`scripts/agent/storefront-dev.mjs` is the agent-driven path for `shopify theme dev`. The agent owns its lifecycle:

```sh
node ./scripts/agent/storefront-dev.mjs start    # spawns shopify theme dev in the background
node ./scripts/agent/storefront-dev.mjs status   # running / running-but-unreachable / stale-pidfile / port-in-use-by-foreign / stopped
node ./scripts/agent/storefront-dev.mjs stop     # SIGTERM, then SIGKILL after 5s, clears tmp state files
```

The session reads `harness/config/agent-tools.json#storefront`:
- `devUrl` (default `http://127.0.0.1:9292`)
- `password` plaintext storefront preview password (optional)
- `themeId` optional theme id; null lets shopify cli create an unpublished dev theme each session
- `portFallback.strategy` — `kill-shopify-only` (default; kills the port holder only when its `ps` command line contains `shopify`), `increment` (scans up to `incrementMax` next ports), or `fail` (never auto-resolve)

State files in `tmp/storefront-dev.{pid,port,json,log}` are gitignored and shopifyignored automatically.

## Commands

For a generated page task, derive `PAGE` and `SECTION` from the section task instead of asking the developer for extra prompt inputs:

```bash
make create-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.
make verify-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.
```

Equivalent direct scripts:

```bash
node scripts/agent/create-section-preview.mjs ./starter/theme ./starter/theme/agent/sections/<page-key>.<section-id>.task.json . ./starter/theme/agent/results/<page-key>.<section-id>.result.json
node scripts/agent/verify-section-preview.mjs . ./starter/theme ./starter/theme/agent/sections/<page-key>.<section-id>.task.json ./starter/theme/agent/results/<page-key>.<section-id>.result.json
```

### Offline triage (not acceptance)

`verify-section-preview-offline` is **not** an acceptance path; it is a triage tool for cases where the storefront render is unreachable (no `shopify theme dev`, missing storefront password, unregistered export token, incomplete overlay). It writes `section-result.sectionPreview.mode: "offline-snapshot"`.

Sections delivered with offline-snapshot must carry `status: "partial"` and an openIssue describing the storefront blocker. `make build-page-verification` and `make run-page-dispatch` reject section results that claim `status: "completed"` while pointing at an offline-snapshot.

Convention path for the static HTML: `output/section-snapshots/<page-key>/<section-id>/preview.html`. The HTML must `<link>` `assets/kik-theme.css` and embed the section markup with sample data (typically `templateContribution.settings`).

```bash
pnpm build:css                                # generate assets/kik-theme.css
make verify-section-preview-offline PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.
```

Requires `playwright` in the project's `devDependencies` (`pnpm add -D playwright && npx playwright install chromium`); the harness package itself does not bundle Chromium.

## Handoff

After verification, the section result should include:

- `verification.checks.sectionPreviewRendered: true`
- `sectionPreview.mode` (`storefront-render` or `offline-snapshot`)
- `sectionPreview.templatePath`
- `sectionPreview.previewUrl`
- `sectionPreview.figmaBaselines.desktop`
- `sectionPreview.figmaBaselines.mobile`
- `sectionPreview.runtimeScreenshots.desktop`
- `sectionPreview.runtimeScreenshots.mobile`

The final page assembly still owns `templates/index.kik-preview.json`.
