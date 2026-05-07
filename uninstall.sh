#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="typora-mac-readonly"
DEFAULT_APP_PATH="/Applications/Typora.app"
APP_SUPPORT_ROOT="Library/Application Support/abnerworks.Typora"
RESTORE_BACKUP_FLAG="--restore-backup"

print_usage() {
  printf 'Usage: %s [Typora.app path] [--restore-backup]\n' "$(basename "$0")"
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

remove_injection_tags() {
  local index_html="$1"

  if ! grep -Fq "typora-mac-readonly/readonly" "$index_html" && ! grep -Fq "typora-mac-readonly:start" "$index_html"; then
    printf 'No typora-mac-readonly tags found in: %s\n' "$index_html"
    return
  fi

  perl -0pi -e 's{\n?<!-- typora-mac-readonly:start -->.*?<!-- typora-mac-readonly:end -->\n?}{\n}sg; s{[ \t]*<link\b[^>]*typora-mac-readonly/readonly\.css[^>]*>\s*}{}g; s{[ \t]*<script\b[^>]*typora-mac-readonly/readonly\.js[^>]*>\s*</script>\s*}{}g' "$index_html"
  printf 'Removed typora-mac-readonly tags from: %s\n' "$index_html"
}

restore_original_backup() {
  local index_html="$1"
  local backup_path="$index_html.bak.typora-mac-readonly"

  [[ -f "$backup_path" ]] || fail "Backup not found: $backup_path"
  cp -p "$backup_path" "$index_html"
  printf 'Restored index.html from: %s\n' "$backup_path"
}

remove_plugin_files() {
  local plugin_dir="$1"

  if [[ ! -d "$plugin_dir" ]]; then
    printf 'Plugin directory already absent: %s\n' "$plugin_dir"
    return
  fi

  rm -f "$plugin_dir/readonly.js" "$plugin_dir/readonly.css"

  if rmdir "$plugin_dir" 2>/dev/null; then
    printf 'Removed plugin directory: %s\n' "$plugin_dir"
    return
  fi

  printf 'Plugin directory is not empty, left in place: %s\n' "$plugin_dir"
}

app_path="$DEFAULT_APP_PATH"
app_path_set="false"
restore_backup="false"

declare -a arguments=("$@")

for argument in "${arguments[@]}"; do
  case "$argument" in
    -h|--help)
      print_usage
      exit 0
      ;;
    "$RESTORE_BACKUP_FLAG")
      restore_backup="true"
      ;;
    *)
      if [[ "$app_path_set" == "true" ]]; then
        print_usage >&2
        exit 1
      fi

      app_path="$argument"
      app_path_set="true"
      ;;
  esac
done

target_user="${SUDO_USER:-$(id -un)}"
user_home="$(resolve_user_home "$target_user")"
plugin_dir="$user_home/$APP_SUPPORT_ROOT/$PLUGIN_NAME"
index_html=""
index_dir=""

[[ -d "$app_path" ]] || fail "Typora.app not found: $app_path"
index_html="$(find_index_html "$app_path")" || fail "No known Typora index.html candidate found. Please report your Typora version and resource directory layout."
index_dir="$(dirname "$index_html")"

if [[ ! -w "$index_html" || ! -w "$index_dir" ]]; then
  fail "Cannot write to $index_html. Re-run with sudo: sudo $0 '$app_path'"
fi

if [[ "$restore_backup" == "true" ]]; then
  restore_original_backup "$index_html"
else
  remove_injection_tags "$index_html"
fi

remove_plugin_files "$plugin_dir"
printf 'Uninstall finished. Restart Typora if it is currently running.\n'
