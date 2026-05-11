---
name: implement-shopify-data-section-from-figma
description: Use when a Figma source-manifest or section task is marked as product, collection, article, or metaobject backed and the Shopify Liquid implementation must render from native store data instead of freezing Figma text or images.
---

# Implement Shopify Data Section From Figma

## Goal

Implement one data-backed Shopify theme section from Figma while preserving native Shopify data ownership.

This is a section implementation overlay. Use it together with `skills/theme/implement-section-from-figma/SKILL.md`; that skill owns the common section task/result workflow, while this skill owns product, collection, article, and metaobject data rules.

## Use This Skill When

- `figma/<page-key>/source-manifest.json` marks a section with:
  - `sectionType: "product-data-section"`
  - `sectionType: "collection-data-section"`
  - `sectionType: "article-data-section"`
  - `sectionType: "metaobject-data-section"`
- or a generated `section-task` includes `dataBinding`
- or the Figma section clearly represents Shopify product, collection, article, or metaobject content

## Required Inputs

Read these first:

- the source-manifest section entry or generated `section-task`
- desktop and mobile Figma source links
- `harness/config/agent-tools.json`
- `harness/contracts/agent-tools-config.schema.json`
- available shop context for products, collections, blogs, articles, and metaobjects
- `skills/theme/implement-section-from-figma/SKILL.md`
- `harness/contracts/agent/section-result.schema.json`

## Non-Negotiable Rules

- Resolve `<page-key>` once at the start via `node ./scripts/agent/resolve-page-key.mjs --json` (or trust `section-task.pageKey` when invoked through the dispatch pipeline). Use that value for every artifact path; do not infer it from filenames or prose.
- Do not freeze product, collection, article, or metaobject imagery as static uploaded assets.
- Treat REST-extracted uploadable assets as static candidates only; do not use them for product, collection, article, or metaobject imagery unless native data ownership has been ruled out.
- Do not upload static imagery until you have ruled out a native Shopify data source.
- Do not use Figma text snippets as final product price, title, availability, variant, article, or metaobject data.
- Choose a native Liquid source before implementing markup.
- Read shop context through the configured agent tool server in `harness/config/agent-tools.json`, using `toolServer.routes.shopContext`.
- Use the bearer token from the environment variable named by `toolServer.auth.tokenEnv`; do not write it into files or section results.
- Treat a `401` as an unregistered, missing, or expired export token rather than a route discovery problem.
- Record the chosen binding in the section result summary or task artifact.
- Return `verification.checks.nativeShopifyDataSourceUsed: true` when completed.
- If shop context config, token environment, or returned context is missing or insufficient, mark the section blocked instead of guessing.

## Binding Rules

For product sections:

- expose or use a `product` setting
- render from `section.settings.product`
- use product fields such as title, media, price, variants, url, availability, and metafields

For collection sections:

- expose or use a `collection` setting plus optional `limit`
- loop `section.settings.collection.products`
- use native product card data, not exported card screenshots

For article sections:

- expose or use a `blog` setting plus optional `limit`
- loop `section.settings.blog.articles`
- render article title, excerpt, image, author, date, and url from Shopify data

For metaobject sections:

- use the declared metaobject type
- loop `shop.metaobjects[type].values`
- map fields explicitly and report missing fields as open issues

## Handoff

The completed `section-result` must make the data decision auditable:

- identify the source kind
- identify the handle, type, or setting id used
- confirm native Shopify data usage
- list any static imagery that was uploaded only after data ownership was ruled out
