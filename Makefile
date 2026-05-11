SHELL := /bin/sh

.PHONY: bootstrap-kik-theme init-kik-theme sync-kik-tokens inspect-project inspect-harness inspect-runtime inspect-bootstrap storefront-dev-start storefront-dev-stop storefront-dev-status storefront-dev-restart assemble-page-templates create-section-preview verify-page-preview verify-section-preview verify-section-preview-offline verify-section-implementation prepare-page-dispatch run-page-dispatch build-page-verification figma-extract-assets sync-runtime-captures verify-harness verify-runtime compile-starter install-git-hooks accept-page notes-init resolve-page-key test

PREFIX_MODE ?= off
TOKENS ?= design-tokens/kik.tokens.css
THEME_ROOT ?= .
OUTPUT_DIR ?= ./starter/theme
PROJECT_ROOT ?= .
PAGE ?= home
PAGE_TASK_PATH ?= $(OUTPUT_DIR)/agent/page.$(PAGE).task.json
SECTION ?= section-01
SECTION_TASK_PATH ?= $(OUTPUT_DIR)/agent/sections/$(PAGE).$(SECTION).task.json
SECTION_RESULT_PATH ?= $(OUTPUT_DIR)/agent/results/$(PAGE).$(SECTION).result.json
SECTION_PREVIEW_HTML_PATH ?= output/section-snapshots/$(PAGE)/$(SECTION)/preview.html
PAGE_DISPATCH_PATH ?= $(OUTPUT_DIR)/agent/page.$(PAGE).dispatch.json
PAGE_DISPATCH_FLAGS ?=
PAGE_VERIFICATION_FLAGS ?=
DESIGN_ASSETS_DIR ?= design-assets
FIGMA_FILE_KEY ?=
FIGMA_TOKEN_ENV ?= FIGMA_ACCESS_TOKEN
FIGMA_API_BASE ?= https://api.figma.com
ACCEPT_PAGE_BUILD_CMD ?= true
ACCEPT_PAGE_THEME_CHECK_CMD ?= shopify theme check
ACCEPT_PAGE_LAYOUT_REVIEW_PASSED ?= false

bootstrap-kik-theme:
	@# STORE is optional; the python script falls back to harness/config/agent-tools.json#shopify.storeDomain when omitted.
	@# STOREFRONT_PASSWORD is optional; the python script falls back to harness/config/agent-tools.json#storefront.password when omitted.
	python3 ./scripts/kik/init_theme_from_templates.py "$(THEME_ROOT)" $(if $(strip $(STORE)),--store "$(STORE)",) $(if $(strip $(VARIABLES_TABLE_HTML)),--variables-table-html "$(VARIABLES_TABLE_HTML)",) $(if $(strip $(STOREFRONT_PASSWORD)),--storefront-password "$(STOREFRONT_PASSWORD)",) --prefix-mode "$(PREFIX_MODE)" $(if $(strip $(THEME_NAME)),--theme-name "$(THEME_NAME)",)

init-kik-theme:
	@echo "Warning: make init-kik-theme is deprecated; use make bootstrap-kik-theme." >&2
	$(MAKE) bootstrap-kik-theme STORE="$(STORE)" VARIABLES_TABLE_HTML="$(VARIABLES_TABLE_HTML)" STOREFRONT_PASSWORD="$(STOREFRONT_PASSWORD)" PREFIX_MODE="$(PREFIX_MODE)" THEME_NAME="$(THEME_NAME)" THEME_ROOT="$(THEME_ROOT)"

sync-kik-tokens:
	python3 ./scripts/kik/init_theme_from_templates.py sync-tokens "$(THEME_ROOT)" --source "$(TOKENS)" --prefix-mode "$(PREFIX_MODE)"

inspect-project:
	node ./scripts/inspect/inspect-project.mjs

inspect-harness:
	node ./scripts/inspect/inspect-harness.mjs

inspect-runtime:
	node ./scripts/inspect/inspect-runtime.mjs

inspect-bootstrap:
	@# Reports bootstrap-applied / node_modules / build-assets-fresh / section-runtime-deps / browser-config / theme-dev / agent-tools-server.
	@# `make inspect-bootstrap PAGE=<key>` scopes the runtime-deps check to one page; otherwise falls back to resolve-page-key.
	node ./scripts/inspect/inspect-bootstrap.mjs --root "$(PROJECT_ROOT)" $(PAGE_FLAG) --text

storefront-dev-start:
	@# Starts `shopify theme dev` in the background using harness/config/agent-tools.json#storefront. Writes tmp/storefront-dev.{pid,port,json,log}.
	@# Override port: STOREFRONT_PORT=9293. Override binary: SHOPIFY_BIN=/path/to/shopify (used by tests).
	node ./scripts/agent/storefront-dev.mjs start --root "$(PROJECT_ROOT)" $(if $(strip $(STOREFRONT_PORT)),--port "$(STOREFRONT_PORT)",) $(if $(strip $(SHOPIFY_BIN)),--cmd "$(SHOPIFY_BIN)",) --text

storefront-dev-stop:
	node ./scripts/agent/storefront-dev.mjs stop --root "$(PROJECT_ROOT)" --text

storefront-dev-status:
	node ./scripts/agent/storefront-dev.mjs status --root "$(PROJECT_ROOT)" --text

storefront-dev-restart:
	node ./scripts/agent/storefront-dev.mjs restart --root "$(PROJECT_ROOT)" $(if $(strip $(STOREFRONT_PORT)),--port "$(STOREFRONT_PORT)",) $(if $(strip $(SHOPIFY_BIN)),--cmd "$(SHOPIFY_BIN)",) --text

assemble-page-templates:
	node ./scripts/agent/assemble-page-templates.mjs "$(OUTPUT_DIR)" "$(PAGE_TASK_PATH)" "$(PROJECT_ROOT)"

create-section-preview:
	node ./scripts/agent/create-section-preview.mjs "$(OUTPUT_DIR)" "$(SECTION_TASK_PATH)" "$(PROJECT_ROOT)" "$(SECTION_RESULT_PATH)"

verify-page-preview:
	node ./scripts/agent/verify-page-preview.mjs "$(PROJECT_ROOT)" "$(OUTPUT_DIR)" "$(PAGE_TASK_PATH)"

verify-section-preview:
	node ./scripts/agent/verify-section-preview.mjs "$(PROJECT_ROOT)" "$(OUTPUT_DIR)" "$(SECTION_TASK_PATH)" "$(SECTION_RESULT_PATH)"

verify-section-preview-offline:
	node ./scripts/agent/verify-section-preview-offline.mjs "$(PROJECT_ROOT)" "$(OUTPUT_DIR)" "$(SECTION_TASK_PATH)" "$(SECTION_RESULT_PATH)" "$(SECTION_PREVIEW_HTML_PATH)"

verify-section-implementation:
	node ./scripts/verify/verify-section-implementation.mjs "$(PROJECT_ROOT)" "$(OUTPUT_DIR)" "$(PAGE_TASK_PATH)"

prepare-page-dispatch:
	node ./scripts/agent/prepare-page-dispatch.mjs "$(OUTPUT_DIR)" "$(PAGE_TASK_PATH)"

run-page-dispatch:
	node ./scripts/agent/run-page-dispatch.mjs "$(OUTPUT_DIR)" "$(PAGE_DISPATCH_PATH)" $(PAGE_DISPATCH_FLAGS)

build-page-verification:
	node ./scripts/agent/build-page-verification.mjs "$(OUTPUT_DIR)" "$(PAGE_TASK_PATH)" $(PAGE_VERIFICATION_FLAGS)

figma-extract-assets:
	node ./scripts/figma/extract-assets.mjs --root "$(PROJECT_ROOT)" $(PAGE_FLAG) --output-dir "$(DESIGN_ASSETS_DIR)" --token-env "$(FIGMA_TOKEN_ENV)" --api-base "$(FIGMA_API_BASE)" $(if $(strip $(FIGMA_FILE_KEY)),--file-key "$(FIGMA_FILE_KEY)",)

sync-runtime-captures:
	node ./scripts/runtime/sync-runtime-captures.mjs

verify-harness:
	node ./scripts/verify/verify-harness.mjs

verify-runtime:
	node ./scripts/verify/verify-runtime.mjs

compile-starter:
	node ./harness/compiler/compile-theme-starter.mjs

install-git-hooks:
	git config core.hooksPath .githooks

PAGE_ORIGIN := $(origin PAGE)
ifneq (,$(filter command line,$(PAGE_ORIGIN)))
PAGE_FLAG := --page "$(PAGE)"
else ifeq (environment,$(PAGE_ORIGIN))
PAGE_FLAG := --page "$(PAGE)"
else ifeq (environment override,$(PAGE_ORIGIN))
PAGE_FLAG := --page "$(PAGE)"
else
PAGE_FLAG :=
endif

notes-init:
	node ./scripts/agent/init-section-notes.mjs --root "$(PROJECT_ROOT)" $(PAGE_FLAG)

resolve-page-key:
	@node ./scripts/agent/resolve-page-key.mjs --root "$(PROJECT_ROOT)" $(PAGE_FLAG) --json

accept-page:
	@test -n "$(PAGE)" || (echo "Usage: make accept-page PAGE=<page-key> [OUTPUT_DIR=./starter/theme] [PROJECT_ROOT=.]" >&2; exit 1)
	$(ACCEPT_PAGE_BUILD_CMD)
	$(MAKE) verify-harness
	$(MAKE) assemble-page-templates PAGE="$(PAGE)" OUTPUT_DIR="$(OUTPUT_DIR)" PROJECT_ROOT="$(PROJECT_ROOT)"
	$(MAKE) verify-page-preview PAGE="$(PAGE)" OUTPUT_DIR="$(OUTPUT_DIR)" PROJECT_ROOT="$(PROJECT_ROOT)"
	$(ACCEPT_PAGE_THEME_CHECK_CMD)
	$(MAKE) inspect-runtime
	$(MAKE) verify-runtime
	$(MAKE) verify-section-implementation PAGE="$(PAGE)" OUTPUT_DIR="$(OUTPUT_DIR)" PROJECT_ROOT="$(PROJECT_ROOT)"
	node ./scripts/agent/build-page-verification.mjs "$(OUTPUT_DIR)" "$(PAGE_TASK_PATH)" --preview-verified --theme-check-passed --runtime-inspect-passed --runtime-verify-passed $(PAGE_VERIFICATION_FLAGS) $(if $(filter true TRUE 1 yes YES,$(ACCEPT_PAGE_LAYOUT_REVIEW_PASSED)),--layout-review-passed,)
	node ./scripts/agent/assert-page-acceptance.mjs "$(PROJECT_ROOT)" "$(OUTPUT_DIR)" "$(PAGE_TASK_PATH)"

test:
	@if [ -d tests ] && [ -n "$$(find tests -name '*.test.mjs' -print 2>/dev/null)" ]; then \
		node --test $$(find tests -name '*.test.mjs' -print | sort); \
	else \
		echo "No tests found under tests/ — the harness's own tests run only inside the harness CLI repo."; \
	fi
