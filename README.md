# typora-mac-readonly

[English](README.md) | [中文](README.zh-CN.md)

Standalone read-only plugin for Typora on macOS. After installation, you can toggle read-only mode in Typora for Mac with a keyboard shortcut.

## Features

- Prevents document editing.
- Keeps browsing, scrolling, selecting, copying, and searching available.
- Disables document checkboxes and the search-and-replace entry after entering read-only mode.
- Supports configurable link opening on single click, image/formula expansion control, and context menu allowlists while read-only.
- Inspired by the [typora_plugin](https://github.com/obgnail/typora_plugin) project.

## Project structure

```text
typora-mac-readonly/
  README.md
  README.zh-CN.md
  install.sh
  uninstall.sh
  src/
    readonly.js
  assets/
    readonly.css
  tools/
    probe.js
```

## Installation

Install to `/Applications/Typora.app` by default:

```bash
./install.sh
```

You can also specify `Typora.app` explicitly:

```bash
./install.sh /Applications/Typora.app
```

If the script reports that the target `index.html` is not writable, rerun it with `sudo` as prompted:

```bash
sudo ./install.sh /Applications/Typora.app
```

The installer will:

1. Reject the Mac App Store version of Typora.
2. Find the first `index.html` from known candidate paths, preferring `Contents/Resources/TypeMark/index.html`.
3. Copy plugin files to:

```text
~/Library/Application Support/abnerworks.Typora/typora-mac-readonly/readonly.js
~/Library/Application Support/abnerworks.Typora/typora-mac-readonly/readonly.css
```

4. Back up the matched `index.html`.
5. Inject this plugin's `file://` CSS and JS tags into `index.html`.

Repeated installation updates the plugin files without injecting duplicate tags.

## Uninstallation

```bash
./uninstall.sh /Applications/Typora.app
```

By default, uninstalling only removes this plugin's injected tags and plugin files. It does not restore the full backup, which avoids overwriting other plugins or later user changes.

If you are sure you want to restore the `index.html` backup from before the first installation, run:

```bash
./uninstall.sh /Applications/Typora.app --restore-backup
```

`--restore-backup` overwrites the current `index.html`, which may remove changes written by other tools after this plugin was installed.

## Usage

Restart Typora, then press:

```text
Command + R
```

This toggles read-only mode.

After the plugin is ready, it exposes a debugging API:

```js
window.typoraMacReadOnly.status()
window.typoraMacReadOnly.lock()
window.typoraMacReadOnly.unlock()
window.typoraMacReadOnly.toggle()
```

## Configuration

Configuration is stored in Typora renderer `localStorage`:

```js
window.typoraMacReadOnly.setConfig({
  clickHyperlinkToOpenWhenReadOnly: true,
  disableExpandWhenReadOnly: true,
})
```

Default configuration:

```js
{
  hotkey: 'cmd+r',
  readOnlyDefault: false,
  showText: 'ReadOnly',
  disableExpandWhenReadOnly: true,
  autoCollapseWhenReadOnly: true,
  clickHyperlinkToOpenWhenReadOnly: false,
  disableContextMenuWhenReadOnly: true,
  remainAvailableMenuKey: ['copy-img'],
  useFloatingBadgeFallback: true,
}
```

## Environment probing

Paste the contents of `tools/probe.js` into Typora DevTools to inspect the current environment.

It reports the Mac Typora capabilities for `File.lock()`, `File.unlock()`, `File.isLocked`, `#write`, the status bar, and context menus.

The plugin requires these runtime capabilities:

- `window.File` exists.
- `File.lock` is a function.
- `File.unlock` is a function.
- `File.isLocked` is readable.
- The `#write` editor area exists.

If a core capability is missing, the plugin only prints an error and does not enter a pseudo read-only mode.

## Code signing and Gatekeeper risks

The installer modifies `index.html` inside `Typora.app`. This may break Typora's original code signature and cause Gatekeeper warnings such as the app being damaged, unverifiable, or failing to launch with `code signature invalid` errors.

Prefer using the uninstall script to restore the injected changes. If you understand and accept the risk and still want to use the modified non-App-Store version, you can try:

```bash
xattr -cr /Applications/Typora.app
sudo codesign --force --deep -s - /Applications/Typora.app
```

The installer never runs these commands automatically.

## Known limitations

- Only supports the non-App-Store macOS version of Typora.
- Depends on Typora renderer APIs: `File.lock()` / `File.unlock()` / `File.isLocked`.
- If a Typora update overwrites `index.html`, run the installer again.
- If a Typora update changes the resource directory structure, the installer fails safely and asks you to report the version and resource directory structure.
- If Typora changes its native context menu or DOM structure, context-menu disabling degrades automatically.
