#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="typora-mac-readonly"
DEFAULT_APP_PATH="/Applications/Typora.app"
APP_SUPPORT_ROOT="Library/Application Support/abnerworks.Typora"
INJECTION_START="<!-- typora-mac-readonly:start -->"
INJECTION_END="<!-- typora-mac-readonly:end -->"

print_usage() {
  printf 'Usage: %s [Typora.app path]\n' "$(basename "$0")"
  printf 'Example: %s /Applications/Typora.app\n' "$(basename "$0")"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

resolve_user_home() {
  local user_name="$1"
  local home_output=""
  local home_directory=""

  home_output="$(dscl . -read "/Users/$user_name" NFSHomeDirectory 2>/dev/null || true)"
  home_directory="${home_output#NFSHomeDirectory: }"

  if [[ -n "$home_directory" && "$home_directory" != "$home_output" ]]; then
    printf '%s\n' "$home_directory"
    return
  fi

  if [[ -n "${HOME:-}" && "$(id -un)" == "$user_name" ]]; then
    printf '%s\n' "$HOME"
    return
  fi

  fail "Unable to resolve home directory for user: $user_name"
}

find_index_html() {
  local app_path="$1"
  local candidates=(
    "$app_path/Contents/Resources/TypeMark/index.html"
    "$app_path/Contents/Resources/app/index.html"
    "$app_path/Contents/Resources/appsrc/index.html"
    "$app_path/resources/app/index.html"
    "$app_path/resources/appsrc/index.html"
    "$app_path/resources/TypeMark/index.html"
    "$app_path/resources/index.html"
  )
  local candidate=""

  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

path_to_file_url() {
  local path="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" <<'PY'
from pathlib import Path
import sys

print(Path(sys.argv[1]).resolve().as_uri())
PY
    return
  fi

  printf 'file://%s\n' "${path// /%20}"
}

create_backup() {
  local index_html="$1"
  local backup_base="$index_html.bak.typora-mac-readonly"
  local backup_path="$backup_base"
  local timestamp=""

  if [[ -e "$backup_path" ]]; then
    timestamp="$(date +%Y%m%d-%H%M%S)"
    backup_path="$backup_base.$timestamp"
  fi

  while [[ -e "$backup_path" ]]; do
    backup_path="$backup_base.$timestamp.$RANDOM"
  done

  cp -p "$index_html" "$backup_path"
  printf '%s\n' "$backup_path"
}

build_missing_injection() {
  local index_html="$1"
  local css_url="$2"
  local js_url="$3"
  local has_css="false"
  local has_js="false"

  if grep -Fq "typora-mac-readonly/readonly.css" "$index_html"; then
    has_css="true"
  fi

  if grep -Fq "typora-mac-readonly/readonly.js" "$index_html"; then
    has_js="true"
  fi

  if [[ "$has_css" == "true" && "$has_js" == "true" ]]; then
    return 0
  fi

  printf '%s\n' "$INJECTION_START"

  if [[ "$has_css" == "false" ]]; then
    printf '<link rel="stylesheet" href="%s">\n' "$css_url"
  fi

  if [[ "$has_js" == "false" ]]; then
    printf '<script src="%s" defer="defer"></script>\n' "$js_url"
  fi

  printf '%s\n' "$INJECTION_END"
}

copy_plugin_files() {
  local source_js="$1"
  local source_css="$2"
  local plugin_dir="$3"
  local target_user="$4"
  local plugin_parent=""
  local created_plugin_parent="false"
  local target_group=""

  plugin_parent="$(dirname "$plugin_dir")"

  if [[ ! -d "$plugin_parent" ]]; then
    created_plugin_parent="true"
  fi

  mkdir -p "$plugin_dir"
  cp "$source_js" "$plugin_dir/readonly.js"
  cp "$source_css" "$plugin_dir/readonly.css"
  chmod 0644 "$plugin_dir/readonly.js" "$plugin_dir/readonly.css"

  if [[ "$(id -u)" == "0" && "$target_user" != "root" ]]; then
    target_group="$(id -gn "$target_user" 2>/dev/null || printf 'staff')"
    chown -R "$target_user:$target_group" "$plugin_dir"

    if [[ "$created_plugin_parent" == "true" ]]; then
      chown "$target_user:$target_group" "$plugin_parent"
    fi
  fi
}

inject_into_index() {
  local index_html="$1"
  local css_url="$2"
  local js_url="$3"
  local injection=""
  local backup_path=""

  injection="$(build_missing_injection "$index_html" "$css_url" "$js_url")"

  if [[ -z "$injection" ]]; then
    printf 'Index already contains typora-mac-readonly tags; skipped HTML injection.\n'
    return
  fi

  backup_path="$(create_backup "$index_html")"

  if grep -iq '</body>' "$index_html"; then
    TYPORA_MAC_READONLY_INJECTION="$injection" perl -0pi -e 's{</body>}{$ENV{TYPORA_MAC_READONLY_INJECTION} . "\n</body>"}ie' "$index_html"
  elif grep -iq '</html>' "$index_html"; then
    TYPORA_MAC_READONLY_INJECTION="$injection" perl -0pi -e 's{</html>}{$ENV{TYPORA_MAC_READONLY_INJECTION} . "\n</html>"}ie' "$index_html"
  else
    fail "No safe injection point found in: $index_html"
  fi

  printf 'Backed up index.html to: %s\n' "$backup_path"
  printf 'Injected typora-mac-readonly tags into: %s\n' "$index_html"
}

app_path="$DEFAULT_APP_PATH"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

if [[ $# -gt 1 ]]; then
  print_usage >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  app_path="$1"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_js="$script_dir/src/readonly.js"
source_css="$script_dir/assets/readonly.css"
target_user="${SUDO_USER:-$(id -un)}"
user_home="$(resolve_user_home "$target_user")"
plugin_dir="$user_home/$APP_SUPPORT_ROOT/$PLUGIN_NAME"
index_html=""
index_dir=""
css_url=""
js_url=""

[[ -d "$app_path" ]] || fail "Typora.app not found: $app_path"
[[ -f "$source_js" ]] || fail "Missing runtime file: $source_js"
[[ -f "$source_css" ]] || fail "Missing stylesheet file: $source_css"

if [[ -f "$app_path/Contents/_MASReceipt/receipt" ]]; then
  fail "Mac App Store Typora builds are not supported. Please use the non-App Store version."
fi

index_html="$(find_index_html "$app_path")" || fail "No known Typora index.html candidate found. Please report your Typora version and resource directory layout."
index_dir="$(dirname "$index_html")"

if [[ ! -w "$index_html" || ! -w "$index_dir" ]]; then
  fail "Cannot write to $index_html. Re-run with sudo: sudo $0 '$app_path'"
fi

if ! grep -Eiq '</body>|</html>' "$index_html"; then
  fail "No safe injection point found in: $index_html"
fi

copy_plugin_files "$source_js" "$source_css" "$plugin_dir" "$target_user"

css_url="$(path_to_file_url "$plugin_dir/readonly.css")"
js_url="$(path_to_file_url "$plugin_dir/readonly.js")"
inject_into_index "$index_html" "$css_url" "$js_url"

printf 'Installed plugin files to: %s\n' "$plugin_dir"
printf 'Restart Typora to load typora-mac-readonly.\n'
