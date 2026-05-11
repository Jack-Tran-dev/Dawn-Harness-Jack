#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
# Bootstrap-time templates that need runtime substitution. Static scaffold files
# (postcss.config.mjs, tailwind.config.js, vite.config.mjs, the kik preview
# placeholder section + template, src/kik-component.js) are no longer rendered
# through bootstrap; they are overlaid directly to their final paths by
# `npx shopify-theme-harness sync` (see scaffold/overlay/ in the harness repo).
TEMPLATE_ROOT = Path(__file__).resolve().parent / "_bootstrap-templates"
DEFAULT_TAILWIND_PREFIX = "kik"
DEFAULT_TOKEN_CSS_PATH = "design-tokens/kik.tokens.css"

THEME_CSS_TAG = "{{ 'kik-theme.css' | asset_url | stylesheet_tag }}"
THEME_JS_TAG = "<script src=\"{{ 'kik-component.js' | asset_url }}\" defer=\"defer\"></script>"

GITIGNORE_ENTRIES = (
    ".shopify",
    "node_modules/",
    "assets/*.map",
    "tmp/storefront-dev.pid",
    "tmp/storefront-dev.port",
    "tmp/storefront-dev.json",
    "tmp/storefront-dev.log",
)

# Static lines appended to the theme's `.shopifyignore`. Previously these were
# read from `templates/kik-theme-init/.shopifyignore`; that template root is gone
# so the list is inlined here. The `templates/kik-theme-init/*` line is kept for
# upgrade safety: consumer projects that bootstrapped against the old layout may
# still have that scaffold directory on disk, and Shopify Theme Dev would
# otherwise try to validate its template-source files as live theme files.
SHOPIFYIGNORE_ENTRIES = (
    "docs/*",
    "node_modules/*",
    "output/*",
    "src/*",
    "tmp/*",
    "package.json",
    "pnpm-lock.yaml",
    "postcss.config.mjs",
    "tailwind.config.js",
    "vite.config.mjs",
    "shopify.theme.toml",
    "templates/kik-theme-init/*",
)

DEFAULT_BROWSER_VERIFICATION_CONFIG = {
    "pagePreviewUrl": "http://127.0.0.1:9292/?view=kik-preview",
    "productPreviewUrl": "http://127.0.0.1:9292/products/example-product?view=kik-preview",
    "cartPreviewUrl": "http://127.0.0.1:9292/cart?view=kik-preview",
    "storefrontPassword": "",
    "desktopViewport": {
        "width": 1440,
        "height": 2200,
    },
    "mobileViewport": {
        "width": 390,
        "height": 1600,
    },
}

TOKEN_GROUPS = (
    ("kik-spacing", "length", ("page-default", "page-semi-full", "page-full", "section-sm", "section-md", "section-lg", "2", "4", "8", "12", "16", "24", "32", "40", "sm", "md", "lg", "xl")),
    ("kik-text/size", "length", ("h1", "h2", "h3", "h4", "h5", "h6", "body-lg", "body-md", "body-sm", "body-xsm")),
    ("kik-color/bg", "color", ("page", "surface", "alt-1", "alt-2", "inverse")),
    ("kik-color/text", "color", ("primary", "secondary", "inverse")),
    ("kik-color/border", "color", ("subtle", "default")),
    ("kik-color/action", "color", ("primary", "primary-hover", "secondary", "secondary-hover")),
    ("kik-radius", "length", ("none", "sm", "md", "lg", "xl", "2xl", "pill")),
)

FALLBACK_TOKENS = {
    "kik-spacing": {
        "page-default": {"desktop": "124", "mobile": "16"},
        "page-semi-full": {"desktop": "20", "mobile": "16"},
        "page-full": {"desktop": "0", "mobile": "0"},
        "section-sm": {"desktop": "48", "mobile": "32"},
        "section-md": {"desktop": "64", "mobile": "48"},
        "section-lg": {"desktop": "96", "mobile": "64"},
        "2": {"desktop": "2", "mobile": "2"},
        "4": {"desktop": "4", "mobile": "4"},
        "8": {"desktop": "8", "mobile": "8"},
        "12": {"desktop": "12", "mobile": "12"},
        "16": {"desktop": "16", "mobile": "16"},
        "24": {"desktop": "24", "mobile": "24"},
        "32": {"desktop": "32", "mobile": "32"},
        "40": {"desktop": "40", "mobile": "40"},
        "sm": {"desktop": "8", "mobile": "4"},
        "md": {"desktop": "16", "mobile": "8"},
        "lg": {"desktop": "24", "mobile": "16"},
        "xl": {"desktop": "32", "mobile": "24"},
    },
    "kik-text/size": {
        "h1": {"desktop": "56", "mobile": "38"},
        "h2": {"desktop": "44", "mobile": "32"},
        "h3": {"desktop": "36", "mobile": "30"},
        "h4": {"desktop": "32", "mobile": "28"},
        "h5": {"desktop": "28", "mobile": "22"},
        "h6": {"desktop": "22", "mobile": "20"},
        "body-lg": {"desktop": "18", "mobile": "16"},
        "body-md": {"desktop": "16", "mobile": "14"},
        "body-sm": {"desktop": "14", "mobile": "12"},
        "body-xsm": {"desktop": "12", "mobile": "11"},
    },
    "kik-color/bg": {
        "page": {"desktop": "#FFFFFF", "mobile": "#FFFFFF"},
        "surface": {"desktop": "#FFFFFF", "mobile": "#FFFFFF"},
        "alt-1": {"desktop": "#F5F5F5", "mobile": "#F5F5F5"},
        "alt-2": {"desktop": "#E8E8E8", "mobile": "#E8E8E8"},
        "inverse": {"desktop": "#000000", "mobile": "#000000"},
    },
    "kik-color/text": {
        "primary": {"desktop": "#000000", "mobile": "#000000"},
        "secondary": {"desktop": "#4D4D4D", "mobile": "#4D4D4D"},
        "inverse": {"desktop": "#FFFFFF", "mobile": "#FFFFFF"},
    },
    "kik-color/border": {
        "subtle": {"desktop": "#E8E8E8", "mobile": "#E8E8E8"},
        "default": {"desktop": "#000000", "mobile": "#000000"},
    },
    "kik-color/action": {
        "primary": {"desktop": "#000000", "mobile": "#000000"},
        "primary-hover": {"desktop": "#000000", "mobile": "#000000"},
        "secondary": {"desktop": "#FFFFFF", "mobile": "#FFFFFF"},
        "secondary-hover": {"desktop": "#FFFFFF", "mobile": "#FFFFFF"},
    },
    "kik-radius": {
        "none": {"desktop": "0", "mobile": "0"},
        "sm": {"desktop": "10", "mobile": "10"},
        "md": {"desktop": "16", "mobile": "16"},
        "lg": {"desktop": "24", "mobile": "24"},
        "xl": {"desktop": "32", "mobile": "32"},
        "2xl": {"desktop": "40", "mobile": "40"},
        "pill": {"desktop": "100", "mobile": "100"},
    },
}

UTILITY_TEXT_TOKENS = (
    ("h1", "heading"),
    ("h2", "heading"),
    ("h3", "heading"),
    ("h4", "heading"),
    ("h5", "heading"),
    ("h6", "heading"),
    ("body-lg", "body"),
    ("body-md", "body"),
    ("body-sm", "body"),
    ("body-xsm", "body"),
)

UTILITY_COLOR_MAP = (
    ("page", "kik-color-bg-page"),
    ("surface", "kik-color-bg-surface"),
    ("alt-1", "kik-color-bg-alt-1"),
    ("alt-2", "kik-color-bg-alt-2"),
    ("surface-inverse", "kik-color-bg-inverse"),
    ("primary", "kik-color-text-primary"),
    ("secondary", "kik-color-text-secondary"),
    ("inverse", "kik-color-text-inverse"),
    ("border-subtle", "kik-color-border-subtle"),
    ("border-default", "kik-color-border-default"),
    ("action-primary", "kik-color-action-primary"),
    ("action-primary-hover", "kik-color-action-primary-hover"),
    ("action-secondary", "kik-color-action-secondary"),
    ("action-secondary-hover", "kik-color-action-secondary-hover"),
    ("semantic-error", "kik-color-semantic-error"),
    ("semantic-success", "kik-color-semantic-success"),
    ("semantic-warning", "kik-color-semantic-warning"),
)

UTILITY_SPACING_MAP = (
    ("0", None),
    ("page", "kik-spacing-page-default"),
    ("page-default", "kik-spacing-page-default"),
    ("page-semi-full", "kik-spacing-page-semi-full"),
    ("page-full", "kik-spacing-page-full"),
    ("section-sm", "kik-spacing-section-sm"),
    ("section-md", "kik-spacing-section-md"),
    ("section-lg", "kik-spacing-section-lg"),
    ("sm", "kik-spacing-sm"),
    ("md", "kik-spacing-md"),
    ("lg", "kik-spacing-lg"),
    ("xl", "kik-spacing-xl"),
    ("2", "kik-spacing-2"),
    ("4", "kik-spacing-4"),
    ("8", "kik-spacing-8"),
    ("12", "kik-spacing-12"),
    ("16", "kik-spacing-16"),
    ("24", "kik-spacing-24"),
    ("32", "kik-spacing-32"),
    ("40", "kik-spacing-40"),
    ("48", "kik-spacing-section-sm"),
    ("64", "kik-spacing-section-md"),
    ("96", "kik-spacing-section-lg"),
)

UTILITY_RADIUS_MAP = (
    ("0", "kik-radius-none"),
    ("none", "kik-radius-none"),
    ("xsm", "kik-radius-xsm"),
    ("sm", "kik-radius-sm"),
    ("md", "kik-radius-md"),
    ("lg", "kik-radius-lg"),
    ("xl", "kik-radius-xl"),
    ("2xl", "kik-radius-2xl"),
    ("pill", "kik-radius-pill"),
    ("10", "kik-radius-sm"),
    ("16", "kik-radius-md"),
    ("24", "kik-radius-lg"),
    ("32", "kik-radius-xl"),
    ("40", "kik-radius-2xl"),
    ("100", "kik-radius-pill"),
)

RISKY_TAILWIND_CLASSES = frozenset({
    "absolute",
    "block",
    "container",
    "fixed",
    "flex",
    "grid",
    "h-full",
    "hidden",
    "inline",
    "inline-block",
    "inline-flex",
    "overflow-hidden",
    "relative",
    "sr-only",
    "sticky",
    "text-center",
    "text-left",
    "text-right",
    "w-full",
})

CSS_AUDIT_GLOBS = ("assets/**/*.css",)
MARKUP_AUDIT_GLOBS = (
    "layout/**/*.liquid",
    "sections/**/*.liquid",
    "snippets/**/*.liquid",
    "templates/**/*.liquid",
    "templates/**/*.json",
)

CSS_CLASS_PATTERN = re.compile(r"\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)")
HTML_CLASS_ATTR_PATTERN = re.compile(r'class\s*=\s*["\']([^"\']+)["\']')


@dataclass(frozen=True)
class PrefixDecision:
    requested_mode: str
    mode: str
    prefix: str | None
    reason: str
    collisions: list[str]
    scanned_files: list[Path]


def normalize_text(value: str) -> str:
    return " ".join(html.unescape(value).split())


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", value.lower().replace("/", "-")).strip("-")


def raw_var_name(group: str, token_name: str) -> str:
    return f"--{slugify(group)}-{slugify(token_name)}"


def raw_var_ref(group: str, token_name: str) -> str:
    return f"var({raw_var_name(group, token_name)})"


def normalize_raw_value(value: str) -> str:
    normalized = normalize_text(value)
    if normalized.startswith("#"):
        return normalized.upper()
    if re.fullmatch(r"-?\d+(?:\.0+)?", normalized):
        return str(int(float(normalized)))
    return normalized


def css_value(value: str, kind: str) -> str:
    normalized = normalize_raw_value(value)
    if kind == "length" and re.fullmatch(r"-?\d+(?:\.\d+)?", normalized):
        if float(normalized) == 0:
            return "0"
        return f"{normalized}px"
    return normalized


def normalize_css_token_value(value: str) -> str:
    return normalize_text(value).strip()


def relpath_for_metadata(path_value: Path, theme_root: Path) -> str:
    try:
        return path_value.resolve().relative_to(theme_root.resolve()).as_posix()
    except ValueError:
        return str(path_value)


def iter_matching_files(theme_root: Path, globs: tuple[str, ...]) -> list[Path]:
    matched: list[Path] = []
    seen: set[Path] = set()
    for pattern in globs:
        for path in sorted(theme_root.glob(pattern)):
            if path.is_file() and path not in seen:
                matched.append(path)
                seen.add(path)
    return matched


def extract_css_class_names(content: str) -> set[str]:
    return {match.group(1) for match in CSS_CLASS_PATTERN.finditer(content)}


def extract_markup_class_names(content: str) -> set[str]:
    class_names: set[str] = set()
    for match in HTML_CLASS_ATTR_PATTERN.finditer(content):
        raw_value = match.group(1)
        if "{{" in raw_value or "{%" in raw_value:
            continue
        for token in raw_value.split():
            normalized = token.strip()
            if not normalized or ":" in normalized:
                continue
            class_names.add(normalized)
    return class_names


def resolve_tailwind_prefix(theme_root: Path, requested_mode: str = "off", prefix_name: str = DEFAULT_TAILWIND_PREFIX) -> PrefixDecision:
    if requested_mode == "on":
        return PrefixDecision(requested_mode, "on", prefix_name, f"Prefix mode was forced on; using prefix({prefix_name}).", [], [])
    return PrefixDecision(
        requested_mode,
        "off",
        None,
        "Prefix mode defaults to off; generating unprefixed Tailwind utilities and relying on .kik-component containment plus section-local overrides when needed.",
        [],
        [],
    )


def derive_theme_name(store_domain: str) -> str:
    base = slugify(store_domain.split(".", 1)[0]) or "kik"
    return f"{base}-kik-theme"


def render_template(template_path: Path, replacements: dict[str, str]) -> str:
    content = template_path.read_text(encoding="utf-8")
    for placeholder, value in replacements.items():
        content = content.replace(placeholder, value)
    return content


class CaptureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.capture: dict[str, str | list[str]] | None = None

    def start_capture(self, kind: str, tag: str, **meta: str) -> None:
        if self.capture is None:
            payload: dict[str, str | list[str]] = {"kind": kind, "tag": tag, "buffer": []}
            payload.update(meta)
            self.capture = payload

    def handle_data(self, data: str) -> None:
        if self.capture is not None:
            buffer = self.capture["buffer"]
            assert isinstance(buffer, list)
            buffer.append(data)

    def finish_capture(self, tag: str) -> tuple[dict[str, str | list[str]] | None, str]:
        if self.capture is None or self.capture["tag"] != tag:
            return None, ""
        payload = self.capture
        buffer = payload["buffer"]
        assert isinstance(buffer, list)
        text = normalize_text("".join(buffer))
        self.capture = None
        return payload, text


class HeaderRowParser(CaptureParser):
    def __init__(self) -> None:
        super().__init__()
        self.mode_labels: dict[str, str] = {}
        self.current_mode_id: str | None = None

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}
        classes = attrs.get("class", "")
        if tag == "th" and attrs.get("data-mode-id"):
            self.current_mode_id = attrs["data-mode-id"]
            return
        if self.current_mode_id and "truncated_text" in classes and self.current_mode_id not in self.mode_labels:
            if attrs.get("aria-label"):
                self.mode_labels[self.current_mode_id] = normalize_text(attrs["aria-label"])
            else:
                self.start_capture("mode-label", tag, mode_id=self.current_mode_id)

    def handle_endtag(self, tag: str) -> None:
        payload, text = self.finish_capture(tag)
        if payload and payload["kind"] == "mode-label" and text:
            self.mode_labels[str(payload["mode_id"])] = text
        if tag == "th":
            self.current_mode_id = None


class GroupRowParser(CaptureParser):
    def __init__(self) -> None:
        super().__init__()
        self.parent: str | None = None
        self.leaf: str | None = None

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}
        classes = attrs.get("class", "")
        if "variables_modal_table_group_name--parentGroupName" in classes and self.parent is None:
            if attrs.get("aria-label"):
                self.parent = normalize_text(attrs["aria-label"])
            else:
                self.start_capture("group-parent", tag)
            return
        if "variables_modal_table_group_name--leafGroupName" in classes and self.leaf is None:
            if attrs.get("aria-label"):
                self.leaf = normalize_text(attrs["aria-label"])
            else:
                self.start_capture("group-leaf", tag)

    def handle_endtag(self, tag: str) -> None:
        payload, text = self.finish_capture(tag)
        if not payload or not text:
            return
        if payload["kind"] == "group-parent" and self.parent is None:
            self.parent = text
        if payload["kind"] == "group-leaf" and self.leaf is None:
            self.leaf = text


class ItemRowParser(CaptureParser):
    def __init__(self) -> None:
        super().__init__()
        self.variable_name: str | None = None
        self.current_mode_id: str | None = None
        self.values: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}
        classes = attrs.get("class", "")
        if tag == "td" and attrs.get("data-mode-id"):
            self.current_mode_id = attrs["data-mode-id"]
            return
        if self.current_mode_id is None and self.variable_name is None and "variable_name--truncatedText" in classes:
            if attrs.get("aria-label"):
                self.variable_name = normalize_text(attrs["aria-label"])
            else:
                self.start_capture("variable-name", tag)
            return
        if self.current_mode_id and self.current_mode_id not in self.values and "truncated_text" in classes:
            if attrs.get("aria-label"):
                self.values[self.current_mode_id] = normalize_text(attrs["aria-label"])
            else:
                self.start_capture("cell-value", tag, mode_id=self.current_mode_id)

    def handle_endtag(self, tag: str) -> None:
        payload, text = self.finish_capture(tag)
        if payload and text:
            if payload["kind"] == "variable-name" and self.variable_name is None:
                self.variable_name = text
            if payload["kind"] == "cell-value":
                self.values[str(payload["mode_id"])] = text
        if tag == "td":
            self.current_mode_id = None


def parse_header_mode_labels(rows: list[str]) -> dict[str, str]:
    for row in rows:
        if "variables-modal-header" not in row:
            continue
        parser = HeaderRowParser()
        parser.feed(row)
        parser.close()
        labels = {mode_id: label.lower() for mode_id, label in parser.mode_labels.items()}
        if "desktop" in labels.values() and "mobile" in labels.values():
            return labels
    raise ValueError("Could not find Desktop and Mobile columns in the variables table HTML.")


def parse_group_name(row_html: str) -> str | None:
    parser = GroupRowParser()
    parser.feed(row_html)
    parser.close()
    if parser.parent and parser.leaf:
        return f"{parser.parent}/{parser.leaf}"
    return parser.leaf or parser.parent


def parse_item_row(row_html: str, mode_labels: dict[str, str]) -> tuple[str, dict[str, str]]:
    parser = ItemRowParser()
    parser.feed(row_html)
    parser.close()
    if not parser.variable_name:
        raise ValueError("Found a variable row without a variable name.")
    values_by_label = {
        mode_labels[mode_id]: normalize_raw_value(value)
        for mode_id, value in parser.values.items()
        if mode_id in mode_labels
    }
    if "desktop" not in values_by_label or "mobile" not in values_by_label:
        raise ValueError(f"Variable row '{parser.variable_name}' is missing Desktop or Mobile values.")
    return parser.variable_name, {"desktop": values_by_label["desktop"], "mobile": values_by_label["mobile"]}


def parse_variables_table(html_text: str) -> dict[str, dict[str, dict[str, str]]]:
    rows = re.findall(r"<tr\b.*?</tr>", html_text, flags=re.IGNORECASE | re.DOTALL)
    if not rows:
        raise ValueError("The variables table HTML does not contain any table rows.")

    mode_labels = parse_header_mode_labels(rows)
    tokens: dict[str, dict[str, dict[str, str]]] = {}
    current_group: str | None = None

    for row in rows:
        if "variables_spreadsheet--fullWidthRow" in row:
            current_group = parse_group_name(row)
            continue
        if "variables_modal_table_item--row" not in row:
            continue
        if current_group is None:
            raise ValueError("Found a variable row before any group header in the variables table HTML.")
        variable_name, values = parse_item_row(row, mode_labels)
        tokens.setdefault(current_group, {})
        if variable_name in tokens[current_group]:
            raise ValueError(f"Duplicate variable '{current_group}/{variable_name}' in the variables table HTML.")
        tokens[current_group][variable_name] = values
    return tokens


def parse_token_css(css_text: str) -> dict[str, dict[str, str]]:
    mode_blocks: dict[str, str] = {}
    block_pattern = re.compile(
        r"\[data-theme\s*=\s*[\"'](?P<label>Desktop|Mobile)[\"']\]\s*\{(?P<body>.*?)\}",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in block_pattern.finditer(css_text):
        mode_blocks[match.group("label").lower()] = match.group("body")

    missing_modes = [mode for mode in ("mobile", "desktop") if mode not in mode_blocks]
    if missing_modes:
        raise ValueError(
            "The token CSS must include [data-theme=\"Mobile\"] and [data-theme=\"Desktop\"] blocks; missing "
            + ", ".join(missing_modes)
            + "."
        )

    modes: dict[str, dict[str, str]] = {"mobile": {}, "desktop": {}}
    var_pattern = re.compile(r"(?P<name>--kik-[A-Za-z0-9_-]+)\s*:\s*(?P<value>[^;]+);")
    for mode, body in mode_blocks.items():
        for match in var_pattern.finditer(body):
            name = match.group("name")
            value = normalize_css_token_value(match.group("value"))
            if name in modes[mode]:
                raise ValueError(f"Duplicate token '{name}' in {mode} token CSS block.")
            modes[mode][name] = value

    mobile_names = set(modes["mobile"])
    desktop_names = set(modes["desktop"])
    if mobile_names != desktop_names:
        missing_desktop = sorted(mobile_names - desktop_names)
        missing_mobile = sorted(desktop_names - mobile_names)
        messages = []
        if missing_desktop:
            messages.append("missing desktop values for " + ", ".join(missing_desktop))
        if missing_mobile:
            messages.append("missing mobile values for " + ", ".join(missing_mobile))
        raise ValueError("The token CSS has mismatched Desktop and Mobile token sets: " + "; ".join(messages))

    if not mobile_names:
        raise ValueError("The token CSS did not contain any --kik-* custom properties.")

    return modes


def validate_required_tokens(tokens: dict[str, dict[str, dict[str, str]]]) -> None:
    missing: list[str] = []
    for group, _, names in TOKEN_GROUPS:
        group_tokens = tokens.get(group, {})
        for name in names:
            if name not in group_tokens:
                missing.append(f"{group}/{name}")
    if missing:
        raise ValueError("The variables table HTML is missing required Kik tokens:\n- " + "\n- ".join(missing))


def fallback_tokens() -> dict[str, dict[str, dict[str, str]]]:
    return json.loads(json.dumps(FALLBACK_TOKENS))


def render_root_vars(tokens: dict[str, dict[str, dict[str, str]]], mode: str) -> list[str]:
    lines = []
    for group, kind, names in TOKEN_GROUPS:
        lines.append("")
        lines.append(f"  /* {group} */")
        for name in names:
            lines.append(f"  {raw_var_name(group, name)}: {css_value(tokens[group][name][mode], kind)};")
    return lines


def token_dict_to_raw_modes(tokens: dict[str, dict[str, dict[str, str]]]) -> dict[str, dict[str, str]]:
    raw_modes: dict[str, dict[str, str]] = {"mobile": {}, "desktop": {}}
    for group, kind, names in TOKEN_GROUPS:
        group_tokens = tokens.get(group, {})
        for name in names:
            if name not in group_tokens:
                continue
            for mode in ("mobile", "desktop"):
                raw_modes[mode][raw_var_name(group, name)] = css_value(group_tokens[name][mode], kind)
    return raw_modes


def render_base_vars() -> list[str]:
    return [
        '  --kik-font-family-sans: "Montserrat", "Helvetica Neue", Arial, sans-serif;',
        "  --kik-text-line-height-tight: 1.2;",
        "  --kik-text-line-height-body: 1.6;",
        "  --kik-text-weight-semibold: 600;",
        "  --kik-text-weight-regular: 400;",
        "  --kik-container-max-width: 1600px;",
    ]


def render_raw_root_vars(raw_modes: dict[str, dict[str, str]], mode: str) -> list[str]:
    lines = render_base_vars()
    lines.append("")
    lines.append("  /* design tokens */")
    for name in sorted(raw_modes[mode]):
        lines.append(f"  {name}: {raw_modes[mode][name]};")
    return lines


def render_raw_desktop_overrides(raw_modes: dict[str, dict[str, str]]) -> list[str]:
    lines: list[str] = []
    for name in sorted(raw_modes["desktop"]):
        mobile = raw_modes["mobile"].get(name)
        desktop = raw_modes["desktop"][name]
        if desktop != mobile:
            lines.append(f"    {name}: {desktop};")
    return lines


def raw_modes_have(raw_modes: dict[str, dict[str, str]], raw_token: str) -> bool:
    return f"--{raw_token}" in raw_modes["mobile"]


def build_tailwind_alias_manifest(raw_modes: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    return {
        "color": {
            alias: f"--{raw_token}"
            for alias, raw_token in UTILITY_COLOR_MAP
            if raw_modes_have(raw_modes, raw_token)
        },
        "spacing": {
            alias: f"--{raw_token}"
            for alias, raw_token in UTILITY_SPACING_MAP
            if raw_token is not None and raw_modes_have(raw_modes, raw_token)
        },
        "radius": {
            alias: f"--{raw_token}"
            for alias, raw_token in UTILITY_RADIUS_MAP
            if raw_modes_have(raw_modes, raw_token)
        },
        "font": {
            "sans": "--kik-text-font-body" if raw_modes_have(raw_modes, "kik-text-font-body") else "--kik-font-family-sans",
            **({"heading": "--kik-text-font-heading"} if raw_modes_have(raw_modes, "kik-text-font-heading") else {}),
        },
        "text": {
            slugify(token_name): f"--kik-text-size-{slugify(token_name)}"
            for token_name, _ in UTILITY_TEXT_TOKENS
            if raw_modes_have(raw_modes, f"kik-text-size-{slugify(token_name)}")
        },
    }


def render_tailwind_import(path_value: str, layer: str, prefix: str | None) -> str:
    if prefix:
        return f'@import "{path_value}" layer({layer}) prefix({prefix});'
    return f'@import "{path_value}" layer({layer});'


def build_input_css_from_raw_modes(raw_modes: dict[str, dict[str, str]], prefix: str | None) -> str:
    font_sans_ref = "var(--kik-text-font-body)" if raw_modes_have(raw_modes, "kik-text-font-body") else "var(--kik-font-family-sans)"
    font_heading_ref = "var(--kik-text-font-heading)" if raw_modes_have(raw_modes, "kik-text-font-heading") else font_sans_ref
    lines = [
        '@import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap");',
        "",
        "@layer theme, base, components, utilities;",
        "",
        render_tailwind_import("tailwindcss/theme.css", "theme", prefix),
        render_tailwind_import("tailwindcss/utilities.css", "utilities", prefix),
        "",
        '@source "../layout";',
        '@source "../sections";',
        '@source "../snippets";',
        '@source "../templates";',
        '@source "../src";',
        "",
        "@layer base {",
        "  body {",
        "    margin: 0;",
        "  }",
        "}",
        "",
        ":root {",
    ]
    lines.extend(render_raw_root_vars(raw_modes, "mobile"))
    lines.extend(["}", ""])

    desktop_overrides = render_raw_desktop_overrides(raw_modes)
    if desktop_overrides:
        lines.extend(["@media (min-width: 768px) {", "  :root {"])
        lines.extend(desktop_overrides)
        lines.extend(["  }", "}", ""])

    lines.extend([
        "@theme inline {",
        f"  --font-sans: {font_sans_ref};",
        f"  --font-heading: {font_heading_ref};",
        "",
        "  --text-body: var(--kik-text-size-body-md);",
        "  --text-body--line-height: var(--kik-text-line-height-body);",
        "  --text-body--font-weight: var(--kik-text-weight-regular);",
    ])

    for token_name, kind in UTILITY_TEXT_TOKENS:
        alias = slugify(token_name)
        line_height = "tight" if kind == "heading" else "body"
        weight = "semibold" if kind == "heading" else "regular"
        raw_text_token = f"kik-text-size-{slugify(token_name)}"
        if not raw_modes_have(raw_modes, raw_text_token):
            continue
        lines.extend([
            "",
            f"  --text-{alias}: var(--{raw_text_token});",
            f"  --text-{alias}--line-height: var(--kik-text-line-height-{line_height});",
            f"  --text-{alias}--font-weight: var(--kik-text-weight-{weight});",
        ])

    lines.append("")
    for alias, raw_token in UTILITY_COLOR_MAP:
        if raw_modes_have(raw_modes, raw_token):
            lines.append(f"  --color-{alias}: var(--{raw_token});")

    lines.extend(["", "  --spacing-0: 0;"])
    for alias, raw_token in UTILITY_SPACING_MAP:
        if raw_token is None:
            continue
        if raw_modes_have(raw_modes, raw_token):
            lines.append(f"  --spacing-{alias}: var(--{raw_token});")

    lines.append("")
    for alias, raw_token in UTILITY_RADIUS_MAP:
        if raw_modes_have(raw_modes, raw_token):
            lines.append(f"  --radius-{alias}: var(--{raw_token});")

    lines.extend([
        "}",
        "",
        "@layer components {",
        "  .kik-component {",
        f"    font-family: {font_sans_ref};",
        "  }",
        "",
        "  .kik-container {",
        "    box-sizing: border-box;",
        "    width: min(100%, var(--kik-container-max-width));",
        "    margin-inline: auto;",
        "    padding-inline: var(--kik-spacing-page-default);",
        "  }",
        "}",
        "",
    ])
    return "\n".join(lines)


def build_input_css(tokens: dict[str, dict[str, dict[str, str]]], prefix: str | None) -> str:
    return build_input_css_from_raw_modes(token_dict_to_raw_modes(tokens), prefix)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_if_missing(path: Path, content: str, created: list[Path], skipped: list[Path]) -> None:
    if path.exists():
        skipped.append(path)
        return
    ensure_parent(path)
    path.write_text(content, encoding="utf-8")
    created.append(path)


def write_if_changed(path: Path, content: str, created: list[Path], patched: list[Path]) -> None:
    if path.exists():
        current = path.read_text(encoding="utf-8")
        if current == content:
            return
        path.write_text(content, encoding="utf-8")
        patched.append(path)
        return
    ensure_parent(path)
    path.write_text(content, encoding="utf-8")
    created.append(path)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_existing_token_source_type(theme_root: Path) -> str | None:
    """Return harness/config/kik-token-source.json#sourceType if the file exists and parses;
    otherwise None. Used to detect the css-token-file maintenance state, in which case
    bootstrap must NOT overwrite src/input.css with fallback or html-derived tokens."""
    cfg_path = theme_root / "harness/config/kik-token-source.json"
    if not cfg_path.exists():
        return None
    try:
        payload = json.loads(cfg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload.get("sourceType") if isinstance(payload, dict) else None


def write_token_source_metadata(
    theme_root: Path,
    *,
    source_type: str,
    variables_table_html_path: Path | None,
    created: list[Path],
    patched: list[Path],
    token_css_path: Path | None = None,
) -> None:
    payload: dict[str, str] = {
        "tokenSet": "kik",
        "sourceType": source_type,
    }
    if source_type == "figma-variables-html" and variables_table_html_path is not None:
        payload["variablesHash"] = file_sha256(variables_table_html_path)
        payload["variablesTableHtmlPath"] = str(variables_table_html_path)
    if source_type == "css-token-file" and token_css_path is not None:
        payload["tokenCssHash"] = file_sha256(token_css_path)
        payload["tokenCssPath"] = relpath_for_metadata(token_css_path, theme_root)

    write_if_changed(
        theme_root / "harness/config/kik-token-source.json",
        f"{json.dumps(payload, indent=2)}\n",
        created,
        patched,
    )


def build_token_manifest(raw_modes: dict[str, dict[str, str]], source_path: Path, theme_root: Path) -> dict:
    return {
        "source": {
            "type": "css-token-file",
            "path": relpath_for_metadata(source_path, theme_root),
            "hash": file_sha256(source_path),
        },
        "modes": {
            "mobile": "default",
            "desktop": "@media (min-width: 768px)",
        },
        "tokens": {
            name: {
                "mobile": raw_modes["mobile"][name],
                "desktop": raw_modes["desktop"][name],
            }
            for name in sorted(raw_modes["mobile"])
        },
        "tailwind": build_tailwind_alias_manifest(raw_modes),
    }


def sync_kik_tokens(theme_root: Path, token_css_path: Path, prefix_mode: str) -> tuple[list[Path], list[Path], PrefixDecision]:
    if not theme_root.exists():
        raise ValueError(f"Theme root does not exist: {theme_root}")
    if not token_css_path.exists():
        raise ValueError(
            f"Token CSS file is missing: {token_css_path}. Add {DEFAULT_TOKEN_CSS_PATH} or pass TOKENS=<path>."
        )

    prefix_decision = resolve_tailwind_prefix(theme_root, requested_mode=prefix_mode)
    raw_modes = parse_token_css(token_css_path.read_text(encoding="utf-8"))
    created: list[Path] = []
    patched: list[Path] = []

    write_if_changed(
        theme_root / "src/input.css",
        build_input_css_from_raw_modes(raw_modes, prefix_decision.prefix),
        created,
        patched,
    )
    write_if_changed(
        theme_root / "harness/generated/kik.tokens.json",
        f"{json.dumps(build_token_manifest(raw_modes, token_css_path, theme_root), indent=2)}\n",
        created,
        patched,
    )
    write_token_source_metadata(
        theme_root,
        source_type="css-token-file",
        variables_table_html_path=None,
        token_css_path=token_css_path,
        created=created,
        patched=patched,
    )

    return created, patched, prefix_decision


def read_optional_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def browser_verification_defaults(theme_root: Path) -> dict:
    example_path = theme_root / "harness/config/browser-verification.example.json"
    example = read_optional_json(example_path)
    if example is None:
        return json.loads(json.dumps(DEFAULT_BROWSER_VERIFICATION_CONFIG))
    return example


def write_browser_verification_config(
    theme_root: Path,
    *,
    storefront_password: str | None,
    created: list[Path],
    patched: list[Path],
) -> None:
    config_path = theme_root / "harness/config/browser-verification.json"
    payload = read_optional_json(config_path) or browser_verification_defaults(theme_root)

    payload.setdefault("pagePreviewUrl", DEFAULT_BROWSER_VERIFICATION_CONFIG["pagePreviewUrl"])
    payload.setdefault("productPreviewUrl", DEFAULT_BROWSER_VERIFICATION_CONFIG["productPreviewUrl"])
    payload.setdefault("cartPreviewUrl", DEFAULT_BROWSER_VERIFICATION_CONFIG["cartPreviewUrl"])
    payload.setdefault("desktopViewport", DEFAULT_BROWSER_VERIFICATION_CONFIG["desktopViewport"])
    payload.setdefault("mobileViewport", DEFAULT_BROWSER_VERIFICATION_CONFIG["mobileViewport"])
    payload.setdefault("storefrontPassword", "")

    if storefront_password is not None:
        payload["storefrontPassword"] = storefront_password

    write_if_changed(
        config_path,
        f"{json.dumps(payload, indent=2)}\n",
        created,
        patched,
    )


def ensure_lines(path: Path, entries: tuple[str, ...] | list[str], created: list[Path], patched: list[Path]) -> None:
    if path.exists():
        content = path.read_text(encoding="utf-8")
        existing_lines = {line.strip() for line in content.splitlines()}
    else:
        content = ""
        existing_lines = set()

    missing = [entry for entry in entries if entry.strip() and entry.strip() not in existing_lines]
    if not missing:
        return

    new_content = content.rstrip("\n")
    if new_content:
        new_content += "\n"
    new_content += "\n".join(missing) + "\n"
    ensure_parent(path)
    path.write_text(new_content, encoding="utf-8")
    (created if not content else patched).append(path)


def ensure_theme_assets(theme_liquid_path: Path, patched: list[Path]) -> None:
    content = theme_liquid_path.read_text(encoding="utf-8")
    updated = content
    if THEME_CSS_TAG not in updated:
        if "</head>" not in updated:
            raise ValueError(f"Could not find </head> in {theme_liquid_path}")
        updated = updated.replace("</head>", f"    {THEME_CSS_TAG}\n  </head>", 1)
    if THEME_JS_TAG not in updated:
        if "</body>" not in updated:
            raise ValueError(f"Could not find </body> in {theme_liquid_path}")
        updated = updated.replace("</body>", f"    {THEME_JS_TAG}\n  </body>", 1)
    if updated != content:
        theme_liquid_path.write_text(updated, encoding="utf-8")
        patched.append(theme_liquid_path)


def cleanup_legacy_template_root(theme_root: Path, patched: list[Path]) -> None:
    """Remove the deprecated `templates/kik-theme-init/` scaffold dir.

    Older harness releases overlaid the bootstrap template root verbatim into
    each consumer project, which placed `{% schema %}`-bearing Liquid and JSON
    template files inside `templates/`. Shopify Theme Dev scans that directory,
    so the leftover scaffold consistently breaks `theme dev` validation. This
    is purely a deletion of harness-emitted scaffold (no consumer-authored
    section files live here), so it is safe to remove on bootstrap.
    """
    legacy_dir = theme_root / "templates" / "kik-theme-init"
    if not legacy_dir.exists():
        return

    import shutil

    shutil.rmtree(legacy_dir)
    patched.append(legacy_dir)


def merge_package_json(theme_root: Path, theme_name: str, created: list[Path], patched: list[Path]) -> None:
    package_path = theme_root / "package.json"
    package_template = json.loads(render_template(TEMPLATE_ROOT / "package.json.tmpl", {"__THEME_NAME__": theme_name}))
    if package_path.exists():
        package_json = json.loads(package_path.read_text(encoding="utf-8"))
    else:
        package_json = {}

    package_json["name"] = package_json.get("name") or package_template["name"]
    package_json["private"] = package_json.get("private", package_template["private"])
    package_json["version"] = package_json.get("version") or package_template["version"]
    package_json["scripts"] = {
        **(package_json.get("scripts") or {}),
        **package_template["scripts"],
    }
    package_json["devDependencies"] = {
        **(package_json.get("devDependencies") or {}),
        **package_template["devDependencies"],
    }

    write_if_changed(package_path, f"{json.dumps(package_json, indent=2)}\n", created, patched)


def bootstrap_theme(
    theme_root: Path,
    store_domain: str,
    theme_name: str,
    variables_table_html_path: Path | None,
    prefix_mode: str,
    storefront_password: str | None,
) -> tuple[list[Path], list[Path], list[Path], PrefixDecision, str]:
    if not theme_root.exists():
        raise ValueError(f"Theme root does not exist: {theme_root}")

    theme_liquid_path = theme_root / "layout/theme.liquid"
    if not theme_liquid_path.exists():
        raise ValueError(f"Required file is missing: {theme_liquid_path}")

    prefix_decision = resolve_tailwind_prefix(theme_root, requested_mode=prefix_mode)
    if variables_table_html_path is None:
        tokens = fallback_tokens()
        token_source = "fallback tokens"
        token_source_type = "fallback"
    else:
        if not variables_table_html_path.exists():
            raise ValueError(f"Variables table HTML file does not exist: {variables_table_html_path}")
        tokens = parse_variables_table(variables_table_html_path.read_text(encoding="utf-8"))
        validate_required_tokens(tokens)
        token_source = f"variables table HTML ({variables_table_html_path})"
        token_source_type = "figma-variables-html"

    replacements = {
        "__THEME_NAME__": theme_name,
        "__STORE__": store_domain,
    }

    created: list[Path] = []
    patched: list[Path] = []
    skipped: list[Path] = []

    merge_package_json(theme_root, theme_name, created, patched)

    # shopify.theme.toml carries the dev-store binding (__STORE__) and is the
    # only theme-root file that still requires runtime substitution. Static
    # scaffold files (postcss.config.mjs, tailwind.config.js, vite.config.mjs,
    # src/kik-component.js, sections/kik-preview-placeholder.liquid,
    # templates/index.kik-preview.json) are placed by `npx shopify-theme-harness
    # sync` directly to their final paths via scaffold/overlay/, so bootstrap no
    # longer copies them.
    write_if_missing(
        theme_root / "shopify.theme.toml",
        render_template(TEMPLATE_ROOT / "shopify.theme.toml.tmpl", replacements),
        created,
        skipped,
    )

    cleanup_legacy_template_root(theme_root, patched)

    # Skip src/input.css when the project is already maintaining tokens via
    # `make sync-kik-tokens` (sourceType=css-token-file). Otherwise re-running
    # bootstrap on a token-synced project would clobber real Figma tokens with
    # the bootstrap-time fallback. The token-source metadata is only updated
    # when we actually rewrite input.css, to keep the two consistent.
    existing_token_source_type = _read_existing_token_source_type(theme_root)
    if existing_token_source_type == "css-token-file":
        skipped.append(theme_root / "src/input.css")
    else:
        write_if_changed(theme_root / "src/input.css", build_input_css(tokens, prefix_decision.prefix), created, patched)
        write_token_source_metadata(
            theme_root,
            source_type=token_source_type,
            variables_table_html_path=variables_table_html_path,
            created=created,
            patched=patched,
        )
    write_browser_verification_config(
        theme_root,
        storefront_password=storefront_password,
        created=created,
        patched=patched,
    )
    ensure_lines(theme_root / ".shopifyignore", list(SHOPIFYIGNORE_ENTRIES), created, patched)
    ensure_lines(theme_root / ".gitignore", list(GITIGNORE_ENTRIES), created, patched)
    ensure_theme_assets(theme_liquid_path, patched)

    return created, patched, skipped, prefix_decision, token_source


def print_summary(created: list[Path], patched: list[Path], skipped: list[Path], prefix_decision: PrefixDecision, token_source: str) -> None:
    print("Prefix decision:")
    print(f"- requested mode: {prefix_decision.requested_mode}")
    print(f"- resolved mode: {prefix_decision.mode}")
    print(f"- reason: {prefix_decision.reason}")
    print(f"Token source: {token_source}")
    if prefix_decision.collisions:
        print(f"- collisions: {', '.join(prefix_decision.collisions)}")
    if created:
        print("Created:")
        for path in created:
            print(f"- {path}")
    if patched:
        print("Patched:")
        for path in patched:
            print(f"- {path}")
    if skipped:
        print("Skipped:")
        for path in skipped:
            print(f"- {path}")


def parse_bootstrap_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap a Shopify theme with the Kik baseline using a Figma variables table HTML export when available, or a fallback Kik token baseline when it is not.")
    parser.add_argument("theme_root", help="Path to the Shopify theme root.")
    parser.add_argument("--store", default=None, help="Development store domain, for example hikemoon.myshopify.com. Optional when harness/config/agent-tools.json exists; falls back to shopify.storeDomain in that file.")
    parser.add_argument("--variables-table-html", help="Optional path to a local HTML file containing the Figma variables table with Name, Desktop, and Mobile columns.")
    parser.add_argument("--storefront-password", default=None, help="Optional storefront password used by preview verification for password-gated themes. Falls back to harness/config/agent-tools.json#storefront.password when omitted.")
    parser.add_argument("--theme-name", help="Optional package.json name. Defaults to '<store-prefix>-kik-theme'.")
    parser.add_argument("--prefix-mode", choices=("on", "off"), default="off", help="Tailwind utility prefix strategy. Default is unprefixed utilities; use 'on' only when a project explicitly wants prefix(kik).")
    return parser.parse_args(argv)


def load_agent_tools_config(theme_root: Path) -> dict | None:
    """Read harness/config/agent-tools.json if present. Returns None when missing or invalid;
    callers fall back to CLI arguments. Bootstrap intentionally does not error on a missing
    file because brand-new theme roots may not have it yet."""
    cfg_path = theme_root / "harness/config/agent-tools.json"
    if not cfg_path.exists():
        return None
    try:
        return json.loads(cfg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def resolve_bootstrap_inputs(args: argparse.Namespace, theme_root: Path) -> tuple[str, str | None]:
    """Resolve --store and --storefront-password from CLI args first, falling back to
    harness/config/agent-tools.json when present. Returns (store_domain, storefront_password|None)."""
    cfg = load_agent_tools_config(theme_root)
    store = args.store
    if not store and cfg:
        store = (cfg.get("shopify") or {}).get("storeDomain")
    if not store:
        raise ValueError(
            "Missing --store and no fallback found at harness/config/agent-tools.json#shopify.storeDomain. "
            "Pass --store on the command line or copy harness/config/agent-tools.example.json to "
            "harness/config/agent-tools.json and fill the storeDomain field."
        )

    password = args.storefront_password
    if password is None and cfg:
        password = (cfg.get("storefront") or {}).get("password")
    if password == "":
        password = None
    return store, password


def parse_sync_tokens_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize Kik design tokens from a CSS custom-property export into Tailwind v4 inputs.")
    parser.add_argument("theme_root", help="Path to the Shopify theme root.")
    parser.add_argument("--source", default=DEFAULT_TOKEN_CSS_PATH, help=f"Token CSS source file. Defaults to {DEFAULT_TOKEN_CSS_PATH}.")
    parser.add_argument("--prefix-mode", choices=("on", "off"), default="off", help="Tailwind utility prefix strategy. Default is unprefixed utilities.")
    return parser.parse_args(argv)


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "sync-tokens":
        args = parse_sync_tokens_args(sys.argv[2:])
        theme_root = Path(args.theme_root).expanduser().resolve()
        token_css_path = Path(args.source).expanduser()
        if not token_css_path.is_absolute():
            token_css_path = theme_root / token_css_path

        try:
            created, patched, prefix_decision = sync_kik_tokens(
                theme_root,
                token_css_path.resolve(),
                args.prefix_mode,
            )
        except ValueError as error:
            print(f"Error: {error}", file=sys.stderr)
            return 1

        print_summary(created, patched, [], prefix_decision, f"token CSS ({relpath_for_metadata(token_css_path.resolve(), theme_root)})")
        return 0

    args = parse_bootstrap_args()
    theme_root = Path(args.theme_root).expanduser().resolve()

    try:
        store, storefront_password = resolve_bootstrap_inputs(args, theme_root)
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    theme_name = args.theme_name or derive_theme_name(store)
    variables_table_html_path = Path(args.variables_table_html).expanduser().resolve() if args.variables_table_html else None

    try:
        created, patched, skipped, prefix_decision, token_source = bootstrap_theme(
            theme_root,
            store,
            theme_name,
            variables_table_html_path,
            args.prefix_mode,
            storefront_password,
        )
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print_summary(created, patched, skipped, prefix_decision, token_source)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
