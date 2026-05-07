# typora-mac-readonly

[English](README.md) | [中文](README.zh-CN.md)

独立 macOS Typora Read-Only 插件。安装后可在 Typora for Mac 中通过快捷键切换只读模式。

## 功能

- 文档不可编辑。
- 可以浏览、滚动、选择、复制、搜索。
- 进入只读后禁用文档 checkbox 和搜索替换入口。
- 可配置只读状态下链接单击打开、图片/公式展开控制、右键菜单白名单。
- 参考 [typora_plugin](https://github.com/obgnail/typora_plugin) 项目实现。

## 文件结构

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

## 安装

默认安装到 `/Applications/Typora.app`：

```bash
./install.sh
```

也可以显式指定 Typora.app：

```bash
./install.sh /Applications/Typora.app
```

如果脚本提示目标 `index.html` 不可写，按提示使用 sudo 重新执行：

```bash
sudo ./install.sh /Applications/Typora.app
```

安装器会：

1. 拒绝 Mac App Store 版本 Typora。
2. 在已知候选路径中查找第一个 `index.html`，优先使用 `Contents/Resources/TypeMark/index.html`。
3. 把插件文件复制到：

```text
~/Library/Application Support/abnerworks.Typora/typora-mac-readonly/readonly.js
~/Library/Application Support/abnerworks.Typora/typora-mac-readonly/readonly.css
```

4. 备份命中的 `index.html`。
5. 向 `index.html` 注入本插件的 `file://` CSS 和 JS 标签。

重复安装会更新插件文件，但不会重复注入相同标签。

## 卸载

```bash
./uninstall.sh /Applications/Typora.app
```

默认卸载只移除本插件注入标签和插件文件，不恢复整份备份，避免覆盖其他插件或用户后续改动。

如果确认要恢复首次安装前的 `index.html` 备份，可以显式执行：

```bash
./uninstall.sh /Applications/Typora.app --restore-backup
```

`--restore-backup` 会覆盖当前 `index.html`，可能移除安装本插件之后其他工具写入的改动。

## 使用

重启 Typora 后，使用：

```text
Command + R
```

切换只读模式。

插件就绪后会暴露调试 API：

```js
window.typoraMacReadOnly.status()
window.typoraMacReadOnly.lock()
window.typoraMacReadOnly.unlock()
window.typoraMacReadOnly.toggle()
```

## 配置

配置保存在 Typora 渲染层的 `localStorage`：

```js
window.typoraMacReadOnly.setConfig({
  clickHyperlinkToOpenWhenReadOnly: true,
  disableExpandWhenReadOnly: true,
})
```

默认配置：

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

## 环境探测

可在 Typora DevTools 中粘贴 `tools/probe.js` 的内容执行。

它会输出当前 Mac Typora 暴露的 `File.lock()`、`File.unlock()`、`File.isLocked`、`#write`、状态栏和右键菜单能力。

插件运行时要求：

- `window.File` 存在。
- `File.lock` 是函数。
- `File.unlock` 是函数。
- `File.isLocked` 可读取。
- `#write` 编辑区存在。

如果核心能力缺失，插件只打印错误，不进入伪只读模式。

## 签名与 Gatekeeper 风险

安装脚本会修改 Typora.app 内部的 `index.html`。这可能破坏 Typora 原有代码签名，导致 Gatekeeper 提示应用已损坏、无法验证，或启动时出现 `code signature invalid` 类错误。

优先使用卸载脚本恢复注入改动。如果你确认接受风险并仍要继续使用修改后的非 App Store 版本，可以自行尝试：

```bash
xattr -cr /Applications/Typora.app
sudo codesign --force --deep -s - /Applications/Typora.app
```

安装脚本不会自动执行这些命令。

## 已知限制

- 仅支持 macOS Typora 非 App Store 版本。
- 依赖 Typora 渲染层的 `File.lock()` / `File.unlock()` / `File.isLocked`。
- 如果 Typora 更新覆盖 `index.html`，需要重新执行安装脚本。
- 如果 Typora 更新改变资源目录结构，安装器会安全失败并要求反馈版本和资源目录结构。
- 如果 Typora 使用原生右键菜单或 DOM 结构变化，右键菜单禁用功能会自动降级。
