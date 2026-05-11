---
name: verify-page-preview
description: Use when the main agent must verify an assembled Shopify page through the fixed Kik preview route, including reading preview credentials from a repo-local config file and handling storefront password gates.
---

# Verify Page Preview

## Purpose

This skill defines the stable browser-verification workflow for Shopify theme page acceptance.

This workflow is Playwright CLI-only by default. Do not use Playwright MCP as the normal acceptance path.

It is a main-agent skill. Section subagents do not use it.

## Required Inputs

- A compiled page task under `starter/theme/agent/page.<page-key>.task.json`
- An assembled preview template at `templates/index.kik-preview.json`
- A browser verification config file at `harness/config/browser-verification.json`

If `harness/config/browser-verification.json` is missing, copy the example at `harness/config/browser-verification.example.json` and fill it before attempting browser verification.

## Browser Verification Config

Read these fields from `harness/config/browser-verification.json`:

- `pagePreviewUrl`
- `productPreviewUrl`
- `cartPreviewUrl`
- `storefrontPassword` when the storefront is gated
- `desktopViewport.width`
- `desktopViewport.height`
- `mobileViewport.width`
- `mobileViewport.height`

Use the `routeKey` from `starter/theme/agent/page.<page-key>.task.json` to choose the right preview URL from config.

Do not hardcode passwords, preview URLs, or viewport sizes in chat or in ad-hoc scripts when this config exists.

## Formal Verification Surface

- Preview template: `templates/index.kik-preview.json`
- Preview route: the configured `previewUrl`

The delivery page template and the preview template should already reflect the full assembled page composition. Do not re-handcraft page composition inside the browser-verification step.

For `global` surfaces such as header and footer, this skill should not treat the shared surface as an isolated route. Verify it through the consuming `page`, `product`, or `cart` route surface instead.

## Workflow

1. Read `starter/theme/agent/page.<page-key>.task.json`.
2. Read `harness/config/browser-verification.json`.
3. Resolve the preview URL from the page task's `preview.routeKey`.
4. Open the configured preview URL.
5. If a storefront password page is present:
   - submit `storefrontPassword` from config
   - fail explicitly if the password is required but missing
6. Verify the assembled preview in both desktop and mobile viewports from config.
7. Record whether preview verification passed and what evidence was checked before moving to page verification.
8. If the page task declares `fidelity.mode: "css-1-to-1"`, record preview evidence but leave final parity acceptance to explicit layout review and final page verification.

## Rules

- Treat the preview URL as environment input, not something the agent invents.
- Treat storefront password handling as config-driven, not chat-driven.
- Verify the full assembled page, not a single isolated section route.
- Do not claim page acceptance if the browser could not reach the preview surface.
- Do not treat a password gate as a transient nuisance. Either unlock it from config or stop explicitly.
- Do not treat a successful preview screenshot as proof of CSS 1:1 parity on a `css-1-to-1` page.

## Evidence To Check

- The expected sections render in the correct page order.
- The assembled preview route loads without a storefront lock after password submission when required.
- Desktop and mobile both render through the configured viewports.
- Obvious missing sections, broken assets, or layout collapse are called out before page verification is marked complete.
- For `css-1-to-1` pages, preview evidence should be framed as support for later layout review, not as the final acceptance signal.
- For `css-1-to-1` pages, section-level automated fidelity evidence belongs in the runtime capture loop, not in this preview step.
