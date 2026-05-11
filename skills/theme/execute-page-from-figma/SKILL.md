---
name: execute-page-from-figma
description: Use when a main agent needs legacy or compatibility orchestration for one Shopify theme page from Figma inputs. For the preferred MCP-first path, initialize figma/<page-key>/source-manifest.json with initialize-page-from-figma and keep delivery/acceptance section-owned.
---

# Execute Page From Figma

## Goal

Provide a stable compatibility workflow for one Shopify theme page:

1. read the page structure
2. generate section tasks
3. dispatch one subagent per section
4. collect structured section results
5. assemble the full page templates
6. complete final page-level verification

This skill owns orchestration only. It does not replace the section implementation workflow.

For new source-manifest work, prefer `skills/theme/initialize-page-from-figma/SKILL.md` first. That skill creates the page source map from desktop and mobile Figma deep links, then section skills own implementation and acceptance. Use this page orchestration skill when the project still needs legacy bundle assembly, route preview evidence, or compatibility page verification.

The same orchestration model also applies to non-page surfaces:

- `page` for ordinary routes
- `product` for product-route ownership
- `cart` for cart-route ownership
- `global` for shared surfaces such as header and footer

## Required Inputs

Read these first:

- `figma/<page-key>/source-manifest.json` when the task starts from a source-manifest export
- `figma/<page-key>/page.json`
- `starter/theme/review/<page-key>.manifest.json`
- `starter/theme/runtime/runtime-profile.json`
- `skills/theme/profiles/kik/SKILL.md`
- `skills/theme/verify-page-preview/SKILL.md`
- `harness/contracts/agent/page-task.schema.json`
- `harness/contracts/agent/section-task.schema.json`
- `harness/contracts/agent/section-result.schema.json`
- `harness/contracts/agent/page-verification.schema.json`
- `harness/contracts/browser-verification-config.schema.json`
- `harness/contracts/figma-source-manifest.schema.json` when using the source-manifest path

## Non-Negotiable Rules

- Main-agent orchestration owns the page and acceptance state.
- In source-manifest workflows, use Figma MCP as the primary design-read path and persist the derived implementation contracts in files.
- In source-manifest workflows, treat page initialization as a separate step owned by `skills/theme/initialize-page-from-figma/SKILL.md`.
- In source-manifest workflows, keep final delivery and visual acceptance section-owned.
- In source-manifest workflows, the agent owns shop-context lookup, data-binding decisions, and image upload decisions.
- In source-manifest workflows, respect `harnessTarget.mode: "installed-theme"` and write final implementation into the real theme files.
- In source-manifest workflows, treat `design-tokens/figma.variables2css.css` as an init-created placeholder for a manual developer handoff file. Run the manifest token sync command when it exists and is non-empty; report the setup gap when it is missing or empty.
- Route `product-data-section`, `collection-data-section`, `article-data-section`, and `metaobject-data-section` sections through `skills/theme/implement-shopify-data-section-from-figma/SKILL.md`.
- Respect `surfaceType` ownership from the page task.
- Respect page-level `fidelity` rules from the page task.
- Preserve `section-task.dataBinding` as an implementation contract whenever a classified export produced it.
- Subagents own one section only.
- Do not let subagents invent their own task boundaries.
- Generate one `section-task` per section before dispatching any subagent.
- Require each subagent to return a machine-readable `section-result`.
- Do not accept a `section-result` whose `verification` payload is null or structurally incomplete.
- Do not accept a prose-only handoff from a subagent.
- Do not let any subagent declare page-level acceptance complete.
- Run the final verify loop only after collecting all section results.
- Treat preview verification as evidence, not proof of parity, when `fidelity.mode` is `css-1-to-1`.
- Do not mark a page accepted until explicit layout review is complete when the page task or collected section results require it.
- Do not create page-level screenshot diff acceptance for the preferred source-manifest path; use REST-extracted asset evidence and runtime captures when available.

## Stable Workflow

### Step 0: Resolve the page-key

Run `node ./scripts/agent/resolve-page-key.mjs --json` before generating any page-task or section-task. The resolver reads the active page-key from the `feat/<page-key>` git branch (or `--page=<key>` / `PAGE=<key>` override) and is the single source of truth for every downstream filename. If a `page-task` already exists, cross-check that `pageKey` matches the resolver and abort if they diverge — the divergence means the task was generated on a different branch.

### Step 1: Build the page task

- If a source manifest is present, read it first, verify its workflow declares section-only delivery, verify its section-tree fingerprint metadata is present, and use its desktop/mobile section deep links for Figma MCP inspection.
- If a source manifest declares a variables2css token source, ensure its raw token file exists and is non-empty before token sync; do not overwrite an existing file.
- If using a legacy bundle, read the page bundle and review manifest.
- Determine the active profile.
- Build one `page-task` object that includes:
  - page key
  - profile
  - fidelity
  - preview route
  - runtime profile path
  - all section task seeds

### Step 2: Generate one section task per section

Each `section-task` should include:

- the target section identifiers
- the section implementation target files
- the desktop and mobile source references, either from source manifest deep links or legacy bundle paths
- the manifest entry relevant to that section
- any compiled `dataBinding` contract and `brief.content.dataBinding`
- the required profile rules
- the page-level fidelity target
- the section-level verification checklist

### Step 3: Dispatch subagents

For each section:

- pass only that section's `section-task`
- explicitly state that the subagent may not claim page completion
- require the subagent to return `section-result` fields only
- keep dispatch prompts thin and task-oriented; stable implementation rules belong in the task JSON and profile skill, not duplicated prose
- keep write scope limited to that section's files and retained section-scoped preview artifacts required by the task

### Step 4: Validate subagent results

Before page-level verification:

- ensure every section returned a `status`
- ensure all required `section-result` fields are present
- check for blocked sections
- check for file-scope drift or missing self-check entries
- prefer completed section results that already include `sectionPreview` evidence from `verify-section-preview`
- for data-bound sections, require the section result to confirm `nativeShopifyDataSourceUsed`

If any result is structurally incomplete, treat that section as blocked.

### Step 5: Run final page verification

Before browser acceptance:

- assemble the delivery page template from collected `templateContribution` values
- assemble the shared preview template from the same ordered page composition
- verify the preview surface against the assembled full page, not a hand-maintained partial preview
- read preview credentials and viewport settings from `harness/config/browser-verification.json`
- if `fidelity.mode` is `css-1-to-1`, treat preview verification as evidence only and require explicit layout review before final acceptance

For `global` surfaces:

- do not treat them as route-owned templates
- verify them indirectly through consuming route surfaces
- do not require runtime-capture ownership for the shared surface itself

Only the main agent performs page acceptance:

- run build and theme checks required by the project
- verify the page preview surface
- run runtime inspect and runtime verify
- write a final `page-verification` summary
- only report page completion after `page.<page-key>.verification.json` exists and has `status: "passed"`

## Acceptance Ownership

The page is accepted only when the main agent can truthfully report all of the following:

- every required section returned a valid `section-result`
- page-level build and theme verification passed
- preview verification passed
- layout review passed whenever the page or any section requires `page_level_layout_review`
- runtime capture verification passed

## Common Failures

- dispatching subagents before defining section tasks
- allowing subagents to choose their own section scope
- accepting prose summaries instead of structured section results
- treating completed section code as equivalent to a passed page verification artifact
- skipping final page-level verification because section work looked complete
- treating a reachable preview route as proof of CSS 1:1 restoration
- mixing project rules into the generic orchestration flow instead of the profile layer
