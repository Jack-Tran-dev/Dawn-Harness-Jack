---
name: figma-first
description: Cross-cutting policy skill. When the source of truth lives in Figma, the agent reads Figma — it does not infer, estimate, or paraphrase. Bound by every theme skill that touches Figma (page init, section implementation, asset binding, fidelity review).
---

# Figma-First Rule

This skill is a **policy contract**, not a workflow. It does not describe steps to perform; it describes a constraint that all Figma-touching skills must satisfy.

It is referenced from `AGENTS.md` and listed in `docs/ai/skills.md`. Downstream skills (`initialize-page-from-figma`, `implement-section-from-figma`, `implement-shopify-data-section-from-figma`, `verify-section-preview`, etc.) may add specifics on top of this rule. They may not weaken it.

## The Rule

When the source of truth lives in Figma (page initialization, section implementation, asset binding, fidelity review), the agent reads Figma. The agent does not infer, estimate, or paraphrase.

This is non-negotiable in every flow that touches Figma — legacy bundle, source-manifest, or one-off MCP.

## What "never guess" means

- **Layout, geometry, typography, spacing, hierarchy** must come from Figma MCP measurements, not from screenshots, not from the React reference code that `get_design_context` returns, not from the section's name, not from a sibling section's prior implementation, not from prior chat context.
- For every section the agent implements, call `get_metadata` on **both** the desktop and mobile section root node ids before writing any markup. The metadata's per-child `x / y / width / height / name / type` is the authoritative measurement. Treat desktop and mobile as separate sources — never derive one from the other.
- `get_design_context` is a **secondary** signal (screenshot + reference code). It can suggest semantic intent but it must not be the sole basis for layout decisions. If `get_metadata` and `get_design_context` disagree, `get_metadata` wins.
- `brief.layout.*.{primaryTextBox, primaryImageBox, readingOrderTextRegions, topImageRegions, topTextRegions}` and equivalent measured fields must trace to a real `get_metadata` call. In source-manifest flow, the brief is the agent's **output**, not its input — fill it from measurements, not from intuition.
- If a measurement isn't available (MCP transport error, expired link, missing node, throttled tool), leave the field empty and raise an `openIssue` quoting the failed call. Do not substitute estimates, screenshots-with-pixel-rulers, or cached values from a prior session.

## When `get_metadata` returns a shallow root frame

A real, recurring third state: `get_metadata(<sectionRootNodeId>)` succeeds and returns the root frame, but the response contains no child subtree — `children` is empty or absent. This is **not** the "transport error" case (the call succeeded) and it is **not** the "no measurement" case (the root has measurements). The agent has the section's outer rect but no per-child x/y/width/height.

Treatment is bounded:

- **Allowed fallback.** The agent **may** derive per-region coordinates from the same breakpoint's `get_design_context` response (the React+Tailwind reference code's positions). This is the only case where `get_design_context` is acceptable as the *primary* coordinate source; everywhere else it remains secondary.
- **Required diagnostic.** Every brief variant whose coordinates were filled this way **must** include a `FIGMA_METADATA_SHALLOW` entry in `brief.layout.{breakpoint}.diagnostics[]` with severity `"info"`, naming the root nodeId and the breakpoint, and stating that `get_design_context` was the secondary signal used. Reviewers must be able to see at a glance that the coordinates are derivative.
- **Required provenance.** `brief.source.mcpInspections[]` must record both the `get_metadata` call (so the brief-provenance gate can see it was attempted) and the `get_design_context` call (so the fallback is auditable).
- **Geometry probe still runs.** The coordinates entered the brief via the documented fallback; they are still claims about Figma. `verify-section-preview` runs presence + geometry on them just like measured coordinates. The font-fallback demotion heuristic continues to apply on top.

What the agent must **not** do under shallow-metadata: silently fill coordinates without the diagnostic; eyeball the screenshot; copy from another section; pretend the metadata returned children when it did not. Each of those is a Figma-First violation regardless of how the data ultimately ends up correct.

## What counts as "guessing" (forbidden)

- "It probably looks like X" based on the screenshot
- "Mobile is just the desktop with smaller paddings"
- "The dots are roughly bottom-right" without measuring
- Reusing a coordinate from a prior section because the names match
- Writing `-mt-[64px]` (or any other ad-hoc offset) to make the live render visually click into place when the Figma metadata says the node is a clean in-flow flex child

## `preview.path` is **not** a section asset

`brief.layout.{breakpoint}.preview.path` is the Figma frame's full-canvas export — a flat PNG of the entire mock. It typically bakes every visible layer in: heading text, body copy, CTA labels, decorative watermarks (e.g. `POCOCO`), shadow effects. It exists for one purpose: a human reviewer can hold it next to a runtime screenshot and judge visual parity.

It is **not** the section's image-fill asset. Using it as a `<img>` src or CSS `background-image` produces double-rendered text (the `<h1>` overlays the same words baked into the PNG) and accidentally ships the design watermark to production.

The asset the agent should actually render is one of:

- `brief.layout.{breakpoint}.backgroundFillPath` — single image-fill section. The asset is exactly the Figma image layer (clean background, no text).
- `brief.blocks[i].imageDesktop` / `brief.blocks[i].imageMobile` — carousel / multi-slide section. Each block's per-breakpoint asset is independent.

If both are absent or null, the section has no image fill; render with placeholder svg or brand color, not with `preview.path`.

`brief.layout.{breakpoint}.assetPaths` is a flat catch-all listing every asset source-manifest tagged for this variant (preview + fills + decorations). Do **not** pick a background by array index; that produces brittle, role-blind selection. Always go through `backgroundFillPath` or `brief.blocks`.

## Font wiring is **not** the agent's job

Webfont acquisition (Satoshi, Funnel Sans, etc. — anything beyond `system-ui` / `sans-serif`) is the developer's deferred responsibility. The agent's job is to write the correct `font-family` token from the design system; it does **not** acquire font files, wire up `@font-face`, or block delivery on missing fonts.

A practical consequence: when a section's design declares a webfont the project hasn't loaded yet, the system fallback may render text on a different number of lines than Figma did. That changes the heading's height, which cascades into the position of every bottom-anchored element below it. **`verify-section-preview` recognizes this case** — when a measured text region's observed height differs from its Figma height by ≥ 1.6×, the geometry probe demotes that viewport's position violations from `failureReasons` to `geometryWarnings` (still recorded in the `*.preview.json` artifact for review). Presence violations and absolute-positioned regions still hard-fail; only matched-but-shifted text regions are demoted.

This is a deliberate scope boundary: the harness flags geometry drift, but it does not punish the agent for an environment problem the agent has no authority to fix.

## Why "verify-section-preview passing" is not enough

A passing `verify-section-preview` proves the section mounts and a screenshot was captured. It is **not** visual fidelity proof. When `fidelity.mode` is `css-1-to-1`, the agent must still:

1. record the `get_metadata` calls used (node ids, breakpoints, capture timestamps) somewhere reviewable — the section result's `commandsRun` or `verification.summary` is acceptable until the section-task schema carries a dedicated provenance field
2. compare the rendered DOM regions against the measured Figma regions, node by node
3. surface every unresolved mismatch in `needsMainAgentVerification` and `openIssues`

Until the harness ships a geometric / computed-style verifier, this comparison is on the agent. Do not delegate it to "main agent will catch it later".

## Failure mode this rule prevents

The dominant failure pattern that motivated this rule: the agent calls `get_design_context` once for the screenshot and reference React code, then writes Tailwind by eyeballing the screenshot, then `verify-section-preview` passes because it only counts mounts, then the live preview is shipped with wrong typography, fabricated spacing, and made-up `brief.layout` coordinates that look authoritative but trace to nothing. This is dishonesty disguised as engineering. The Figma-First Rule exists to make that path harder than the right path.

## How downstream skills bind to this rule

Each Figma-touching skill must include a line near the top of its `## Non-Negotiable Rules` (or equivalent) section that reads:

> `skills/theme/figma-first/SKILL.md` applies to this skill in full and overrides any softer phrasing below.

Skills are free to add measurement workflow specifics (e.g. the `Step 0: Measure with Figma MCP` step in `implement-section-from-figma/SKILL.md`) on top of this contract. They are not free to introduce flows that bypass it.
