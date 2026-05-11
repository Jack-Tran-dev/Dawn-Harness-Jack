# Figma Agent Prompts

Use these English prompts when asking an agent to initialize or implement Figma-driven Shopify theme sections.

The developer should usually fill only Figma links and, when continuing section work, the section id. The developer should not choose static versus data-backed section prompts; the agent must resolve the active `<page-key>` first, then read `figma/<page-key>/source-manifest.json`, `section.skillRouting`, and the repo contracts to choose the correct skills and acceptance path. Paths such as `harness/config/agent-tools.json`, `design-tokens/figma.variables2css.css`, `design-assets/manifest.json`, and skill paths are repo conventions. Tool-server setup and Figma asset extraction are manual developer prerequisites; agents should report missing config or missing extracted assets as blockers rather than trying to configure or download them.

The page-key isolates per-page artifacts so multiple pages can coexist on `main`. The active page-key comes from the git branch name (`feat/<page-key>`) and propagates to:

- `figma/<page-key>/source-manifest.json` — the page source map
- `harness/notes/<page-key>.json` — human overrides
- `agent/results/<page-key>.<section>.result.json` — section results
- `templates/index.kik-section-<page-key>-*.json` — preview templates

Resolve it via `node ./scripts/agent/resolve-page-key.mjs --json` before any filesystem write. Do not guess from the Figma file name or the working directory.

## Developer Step-By-Step

Use this order when starting a new Figma-driven section workflow:

1. Install or update the harness inside the real Shopify theme project.
2. Manually configure the Shopify tool server and `harness/config/agent-tools.json` if shop context or image upload will be needed.
3. Manually place the Figma variables2css export at `design-tokens/figma.variables2css.css` when token parity matters.
4. Ask the agent to run the Page Initialization prompt below with the desktop and mobile Figma page/frame deep links.
5. Review the generated `figma/<page-key>/source-manifest.json`, especially section order, section ids, `sectionType`, `dataSourceKind`, and `skillRouting`.
6. If static images or icons are needed, run the human-operated extraction command from `docs/ai/figma-asset-extraction.md`. This should create `design-assets/manifest.json` and local files under `design-assets/images/`.
7. Ask the agent to run the Section Implementation prompt below for one section id at a time.
8. Review the retained section preview template and runtime screenshots produced by the section workflow.

Do not paste Figma access tokens into agent prompts. Do not ask the agent to download Figma assets. If `design-assets/manifest.json` is missing, the expected fix is a developer extraction step, not an agent retry.

## Page Initialization

Use this first when starting from desktop and mobile Figma page or frame links.

```text
Use `skills/theme/initialize-page-from-figma/SKILL.md` to initialize the MCP-first section workflow for this Shopify theme project.

Inputs:

- Desktop Figma page/frame deep link: https://www.figma.com/design/8ZeaG0uv832dg4Gn7HonGC/Pococo?node-id=11944-1933&m=dev
- Mobile Figma page/frame deep link: https://www.figma.com/design/8ZeaG0uv832dg4Gn7HonGC/Pococo?node-id=11944-1934&m=dev

Requirements:

0. Resolve the active `<page-key>` first. Run `node ./scripts/agent/resolve-page-key.mjs --json` from the project root. The resolver reads `feat/<page-key>` from the current git branch unless `--page=<key>` / `PAGE=<key>` overrides it. Echo the resolved value back (one line) and use it verbatim in every page-keyed path below. If it errors, surface the message and stop.
1. Read `AGENTS.md`, `docs/ai/README.md`, `docs/ai/repo-map.md`, `docs/ai/skills.md`, and `skills/theme/initialize-page-from-figma/SKILL.md` before writing files.
2. Use Figma MCP as the primary design-read path. Do not require or invoke a Figma plugin.
3. Read `harness/config/agent-tools.json` when shop context or image upload is needed. Use `harness/config/agent-tools.example.json` as the setup template if the real config is missing.
4. Do not ask for or write raw access keys in repo files. The tool server bearer token must come from the environment variable named by `toolServer.auth.tokenEnv`, for example `SHOPIFY_AGENT_TOOL_TOKEN`.
5. Inspect the full desktop and mobile page/frame context before pairing sections, so repeated sections can be treated as reusable variants only when the design metadata supports it.
6. Create or update `figma/<page-key>/source-manifest.json` as a thin source map only. Do not export full layout trees, static assets, or page screenshots into the manifest. Do not write a root-level `source-manifest.json`; that path is legacy.
7. The manifest must declare `pageKey: "<page-key>"` (matching the path segment), `workflow.deliveryScope: "section-only"`, `workflow.acceptanceScope: "section"`, `workflow.visualBaselineSource: "figma-rest-asset-manifest"`, `workflow.evidenceManifestPath: "design-assets/manifest.json"`, `harnessTarget.mode: "installed-theme"`, `tokenSource.rawPath: "design-tokens/figma.variables2css.css"`, `tokenSource.writePolicy: "manual-if-missing"`, and `agentCapabilities.assetExtractionDeveloperOwned: true`.
8. For every section, record desktop and mobile Figma node refs, section order, slot index, dimensions, `sectionType`, `dataSourceKind`, and `skillRouting`.
9. Route static sections to `skills/theme/implement-section-from-figma/SKILL.md`.
10. Route product, collection, article, and metaobject backed sections to `skills/theme/implement-shopify-data-section-from-figma/SKILL.md`.
11. If `design-tokens/figma.variables2css.css` exists and is non-empty, run `make sync-kik-tokens TOKENS=design-tokens/figma.variables2css.css`. If it is missing or empty, report that the manual Figma variables2css handoff file has not been filled; do not ask me to paste token content into the prompt or reconstruct it from Figma.
12. Validate the resulting manifest against `harness/contracts/figma-source-manifest.schema.json`.
13. Report the ordered section implementation list after initialization. Do not claim page-level visual acceptance; visual acceptance is section-scoped.
```

## Section Implementation

Use this for any single section. The agent must decide whether the section is static or data-backed from `figma/<page-key>/source-manifest.json` and `section.skillRouting`.

```text
Implement exactly one Shopify theme section from the initialized Figma source manifest.

Target section:

- Section id: why-pococo-section

Requirements:

0. Resolve `<page-key>` first. Run `node ./scripts/agent/resolve-page-key.mjs --json` from the project root. If `section-task.pageKey` is supplied, cross-check it matches and abort with an openIssue if not (divergence means the task was generated on a different branch). Use the resolved value verbatim in every page-keyed path below.
1. Read `AGENTS.md`, `docs/ai/README.md`, `docs/ai/repo-map.md`, `docs/ai/skills.md`, `figma/<page-key>/source-manifest.json`, `harness/notes/<page-key>.json` (if present), `harness/contracts/agent/section-result.schema.json`, and `skills/theme/implement-section-from-figma/SKILL.md`.
2. Find the matching section in `figma/<page-key>/source-manifest.json` by `section.id`. Confirm the manifest's `pageKey` field equals the path segment and the resolved `<page-key>`.
3. Use `section.skillRouting` and `section.sectionType` to decide whether to also load `skills/theme/implement-shopify-data-section-from-figma/SKILL.md`. Do not ask me to choose the section type.
4. Work on this section only. Do not broaden scope into neighboring sections and do not claim page-level completion.
5. Use the section's desktop and mobile Figma deep links with Figma MCP as the primary design reference.
6. If shop context or image upload is needed, read `harness/config/agent-tools.json`, validate it against `harness/contracts/agent-tools-config.schema.json`, and use the exact paths under `toolServer.routes`. Use `routes.shopContext` for context, `routes.syncJobs` for multipart file upload, `routes.syncJob` for polling, and `routes.syncJobEvents` for SSE updates. Use the bearer token from the environment variable named by `toolServer.auth.tokenEnv`. Do not write tokens into files and do not guess alternate endpoint paths.
7. If the section is product, collection, article, or metaobject backed, render from native Shopify Liquid data and do not freeze that content as static text or uploaded screenshots.
8. If static imagery is needed, prefer REST-extracted asset candidates from the manifest path declared by `workflow.evidenceManifestPath`. If the manifest is missing or incomplete, report that the developer must run `make figma-extract-assets PAGE=<page-key>`; do not run the extractor, request `FIGMA_ACCESS_TOKEN`, or download Figma files yourself. Verify the asset is not owned by Shopify product, collection, article, or metaobject data before upload, then map the upload result back to the candidate `assetId` or `path`.
9. Implement the section in the real theme files using the repo profile rules. Preserve the section slot and schema contract implied by the manifest/task.
10. Use the acceptance and result contracts already defined in the repo. Do not invent a separate acceptance checklist in chat.
11. Return a structured `section-result` matching `harness/contracts/agent/section-result.schema.json`, including verification checks, changed files, commands run, open issues, and template contribution data.
12. Before section preview verification, run the project build command so generated assets are current. In Kik-initialized themes, `src/input.css` builds to `assets/kik-theme.css`, which `layout/theme.liquid` loads; the default command is `pnpm build`.
13. After writing a completed section result and running the build, derive `PAGE` from the section task or manifest and run `make create-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.` followed by `make verify-section-preview PAGE=<page-key> SECTION=<section-id> PROJECT_ROOT=.`. Keep the generated section preview template for human review.
14. Do not edit or restore `templates/index.kik-preview.json` during section work; it belongs to final page assembly.
15. If blocked, report the exact missing config, source, shop context, build, or runtime evidence instead of guessing.
```
