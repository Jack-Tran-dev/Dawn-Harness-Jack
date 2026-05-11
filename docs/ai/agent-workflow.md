# Agent Workflow

## Goal

Keep the starter reusable, deterministic, and inspectable across Shopify theme projects.

## Before You Start

Read:

1. `AGENTS.md`
2. `docs/ai/repo-map.md`
3. `docs/ai/skills.md`
4. the active plan under `docs/plans/*`

## Figma-First Workflow

When a task derives from Figma (page init, section implementation, asset binding, fidelity review), `skills/theme/figma-first/SKILL.md` applies in full and overrides any softer phrasing here or in downstream skills. In short:

- read Figma via MCP (`get_metadata` for measurements, `get_design_context` only as a secondary screenshot/reference signal)
- desktop and mobile are separate sources — never derive one from the other
- `brief.layout.*` measured fields must trace to a real `get_metadata` call; if a measurement is unavailable, raise an `openIssue`, do not estimate
- a passing `verify-section-preview` is mount evidence, not visual fidelity evidence

## Default Workflow

### Structural Work

1. write or update a repo-local plan
2. update docs or contracts first
3. add tests for behavior changes
4. implement the smallest deterministic slice
5. run inspect and verify

### Harness Work

1. keep inputs generic across page bundles
2. treat bundle validation as a contract problem, not a naming-convention problem
3. keep starter compilation deterministic
4. separate inspect surfaces from verify surfaces
5. report missing runtime captures explicitly instead of pretending the restore loop is complete

### Stop Only When

- required external input is missing
- a non-obvious product or architecture choice has material consequences
- the environment blocks deterministic verification

## Verification First

Before any completion claim, state:

- which files changed
- which inspect and verify commands ran
- what remains unverified
