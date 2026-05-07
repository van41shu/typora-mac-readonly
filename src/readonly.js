(() => {
  const STORAGE_KEY = 'typoraMacReadOnly.config'
  const READY_TIMEOUT_MS = 15000
  const READY_INTERVAL_MS = 100
  const RELOCK_AFTER_FOCUS_DELAYS_MS = [0, 50, 250]
  const INLINE_SELECTOR = '#write span[md-inline="image"], #write span[md-inline="inline_math"]'
  const LINK_SELECTOR = '#write span[md-inline="link"], #write .md-link'
  const FORBIDDEN_EDITING_KEYS = new Set(['Enter', 'Backspace', 'Delete', ' '])

  const defaultConfig = {
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

  let config = loadConfig()
  let writeRoot = null
  let desiredReadOnly = false
  let guardEventsBound = false
  let freshLockSyncPending = false

  const guardEventHandlers = {
    beforeinput: stopEditingEvent,
    keydown: onKeydown,
    compositionstart: stopEditingEvent,
    compositionend: stopEditingEvent,
    paste: stopEditingEvent,
    cut: stopEditingEvent,
    dragover: stopEditingEvent,
    drop: stopEditingEvent,
    input: onUnexpectedInput,
    click: onClick,
    mousedown: onMouseDown,
  }

  bootstrap()

  function bootstrap() {
    waitUntil(hasRequiredStartupShape)
      .then(start)
      .catch(error => console.error('[typora-mac-readonly]', error))
  }

  function hasRequiredStartupShape() {
    return typeof window.File?.lock === 'function' && !!document.querySelector('#write')
  }

  function start() {
    writeRoot = document.querySelector('#write')
    const capabilities = detectCapabilities()

    if (!hasCoreCapabilities(capabilities)) {
      console.error('[typora-mac-readonly] Required Typora read-only capabilities are missing', capabilities)
      return
    }

    patchFreshLock()
    bindHotkey()
    bindFocusStateSync()
    exposeDebugApi(capabilities)

    if (config.readOnlyDefault || isReadOnly()) {
      setReadOnly(true)
    }
  }

  function hasCoreCapabilities(capabilities) {
    return capabilities.hasFileLock && capabilities.hasFileUnlock && capabilities.hasFileIsLocked && capabilities.hasWriteRoot
  }

  function waitUntil(predicate) {
    const startedAt = Date.now()

    return new Promise((resolve, reject) => {
      const check = () => {
        if (predicate()) {
          resolve()
          return
        }

        if (Date.now() - startedAt >= READY_TIMEOUT_MS) {
          reject(new Error('Timed out waiting for Typora read-only runtime'))
          return
        }

        window.setTimeout(check, READY_INTERVAL_MS)
      }

      check()
    })
  }

  function detectCapabilities() {
    const fileApi = window.File

    return {
      isMac: fileApi?.isMac === true || /Mac/i.test(navigator.platform),
      hasFile: !!fileApi,
      hasFileLock: typeof fileApi?.lock === 'function',
      hasFileUnlock: typeof fileApi?.unlock === 'function',
      hasFileIsLocked: !!fileApi && 'isLocked' in fileApi,
      hasFileFreshLock: typeof fileApi?.freshLock === 'function',
      hasWriteRoot: !!document.querySelector('#write'),
      hasFooterWordCount: !!document.querySelector('#footer-word-count-label'),
      hasContextMenu: !!document.querySelector('#context-menu'),
    }
  }

  function bindHotkey() {
    document.addEventListener('keydown', onDocumentKeydown, true)
  }

  function bindFocusStateSync() {
    window.addEventListener('focus', scheduleReadOnlyReassertion, true)
    window.addEventListener('pageshow', scheduleReadOnlyReassertion, true)
    document.addEventListener('visibilitychange', onVisibilityChange, true)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      scheduleReadOnlyReassertion()
    }
  }

  function scheduleReadOnlyReassertion() {
    if (!desiredReadOnly) return

    RELOCK_AFTER_FOCUS_DELAYS_MS.forEach(delay => {
      window.setTimeout(reassertDesiredReadOnly, delay)
    })
  }

  function reassertDesiredReadOnly() {
    if (!desiredReadOnly) return
    if (typeof window.File?.lock !== 'function') return

    applyReadOnlyState(true)
  }

  function onDocumentKeydown(event) {
    if (!matchesConfiguredHotkey(event)) return

    event.preventDefault()
    event.stopPropagation()
    toggle()
  }

  function matchesConfiguredHotkey(event) {
    const normalizedHotkey = String(config.hotkey || defaultConfig.hotkey).toLowerCase().replace(/\s+/g, '')

    if (normalizedHotkey === 'cmd+shift+r' || normalizedHotkey === 'meta+shift+r') {
      return event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey && isKeyR(event)
    }

    const parts = normalizedHotkey.split('+').filter(Boolean)
    const key = parts[parts.length - 1]
    const modifiers = new Set(parts.slice(0, -1))

    const expectsMeta = modifiers.has('cmd') || modifiers.has('meta') || modifiers.has('command')
    const expectsCtrl = modifiers.has('ctrl') || modifiers.has('control')
    const expectsShift = modifiers.has('shift')
    const expectsAlt = modifiers.has('alt') || modifiers.has('option')
    const eventKey = String(event.key || '').toLowerCase()
    const eventCodeKey = String(event.code || '').replace(/^Key/i, '').toLowerCase()

    return event.metaKey === expectsMeta && event.ctrlKey === expectsCtrl && event.shiftKey === expectsShift && event.altKey === expectsAlt && (eventKey === key || eventCodeKey === key)
  }

  function isKeyR(event) {
    return event.code === 'KeyR' || String(event.key || '').toLowerCase() === 'r'
  }

  function setReadOnly(wantToLock) {
    desiredReadOnly = wantToLock
    applyReadOnlyState(wantToLock)
  }

  function applyReadOnlyState(wantToLock) {
    window.File[wantToLock ? 'lock' : 'unlock']()

    if (wantToLock) {
      document.activeElement?.blur?.()
    }

    refreshWriteRoot()
    toggleGuardEvents(wantToLock)
    syncDomState(wantToLock)
    syncStatusIndicator(wantToLock)
    syncContextMenu(wantToLock)
    document.body.classList.toggle('typora-mac-read-only', wantToLock)
  }

  function refreshWriteRoot() {
    const currentWriteRoot = document.querySelector('#write')
    if (!currentWriteRoot || currentWriteRoot === writeRoot) return

    if (guardEventsBound) {
      toggleGuardEvents(false)
      writeRoot = currentWriteRoot
      toggleGuardEvents(true)
      return
    }

    writeRoot = currentWriteRoot
  }

  function toggleGuardEvents(shouldBind) {
    if (!writeRoot || guardEventsBound === shouldBind) return

    const method = shouldBind ? 'addEventListener' : 'removeEventListener'

    Object.entries(guardEventHandlers).forEach(([eventType, handler]) => {
      writeRoot[method](eventType, handler, true)
    })

    guardEventsBound = shouldBind
  }

  function isReadOnly() {
    return !!window.File?.isLocked
  }

  function shouldKeepReadOnlyActive() {
    return desiredReadOnly || isReadOnly()
  }

  function toggle() {
    setReadOnly(!shouldKeepReadOnlyActive())
  }

  function lock() {
    setReadOnly(true)
  }

  function unlock() {
    setReadOnly(false)
  }

  function isWriteInteraction(event) {
    if (!writeRoot) return false

    const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : []
    if (eventPath.includes(writeRoot)) return true

    const targetElement = toElement(event.target)
    if (targetElement && writeRoot.contains(targetElement)) return true

    const activeElement = document.activeElement
    if (activeElement && writeRoot.contains(activeElement)) return true

    const selection = window.getSelection?.()
    const anchorElement = toElement(selection?.anchorNode)
    return !!anchorElement && writeRoot.contains(anchorElement)
  }

  function stopEditingEvent(event) {
    if (!shouldKeepReadOnlyActive()) return
    if (!isWriteInteraction(event)) return

    document.activeElement?.blur?.()

    if (event.cancelable) {
      event.preventDefault()
    } else {
      console.debug('[typora-mac-readonly] non-cancelable editing event', event.type)
    }

    event.stopPropagation()
    window.File.lock()
  }

  function onKeydown(event) {
    if (!shouldKeepReadOnlyActive()) return
    if (!FORBIDDEN_EDITING_KEYS.has(event.key)) return

    stopEditingEvent(event)
  }

  function onUnexpectedInput(event) {
    if (!shouldKeepReadOnlyActive()) return

    console.warn('[typora-mac-readonly] input event occurred while locked', event)
    window.File.lock()
    document.activeElement?.blur?.()
  }

  function onClick(event) {
    if (!shouldKeepReadOnlyActive()) return

    const targetElement = toElement(event.target)
    if (!targetElement) return

    const inlineElement = targetElement.closest(INLINE_SELECTOR)
    if (config.disableExpandWhenReadOnly && inlineElement) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const linkElement = targetElement.closest(LINK_SELECTOR)
    if (config.clickHyperlinkToOpenWhenReadOnly && linkElement && !event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      linkElement.dispatchEvent(new MouseEvent('click', {
        metaKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
    }
  }

  function onMouseDown(event) {
    if (!shouldKeepReadOnlyActive()) return
    if (!config.autoCollapseWhenReadOnly) return

    const targetElement = toElement(event.target)
    if (targetElement?.closest(INLINE_SELECTOR)) return

    document.querySelectorAll('#write .md-expand').forEach(element => {
      element.classList.remove('md-expand')
    })
  }

  function syncDomState(wantToLock) {
    document.querySelectorAll('#write input[type="checkbox"]').forEach(checkbox => {
      checkbox.toggleAttribute('disabled', wantToLock)
    })

    const replaceSelectors = [
      '#search-panel-replace-btn',
      '#search-panel-replaceall-btn',
      '#search-panel-replace-input',
    ]

    replaceSelectors.forEach(selector => {
      document.querySelector(selector)?.toggleAttribute('disabled', wantToLock)
    })
  }

  function syncStatusIndicator(wantToLock) {
    const footerWordCount = document.querySelector('#footer-word-count-label')

    if (footerWordCount) {
      footerWordCount.dataset.typoraMacReadOnlyValue = wantToLock ? `${config.showText}   ` : ''
      syncFloatingBadge(false)
      return
    }

    if (config.useFloatingBadgeFallback) {
      syncFloatingBadge(wantToLock)
      return
    }

    syncFloatingBadge(false)
  }

  function syncFloatingBadge(wantToShow) {
    const existingBadge = document.querySelector('#typora-mac-read-only-badge')

    if (!wantToShow) {
      existingBadge?.remove()
      return
    }

    if (existingBadge) {
      existingBadge.textContent = config.showText
      return
    }

    const badge = document.createElement('div')
    badge.id = 'typora-mac-read-only-badge'
    badge.textContent = config.showText
    document.body.appendChild(badge)
  }

  function syncContextMenu(wantToLock) {
    const contextMenu = document.querySelector('#context-menu')
    if (!contextMenu) return

    getContextMenuItems(contextMenu).forEach(menuItem => {
      const shouldRemainAvailable = config.disableContextMenuWhenReadOnly && config.remainAvailableMenuKey.includes(menuItem.dataset.key)
      const shouldDisableMenuItem = config.disableContextMenuWhenReadOnly && wantToLock && !shouldRemainAvailable
      menuItem.classList.toggle('typora-mac-read-only-disabled-menu', shouldDisableMenuItem)
    })
  }

  function getContextMenuItems(contextMenu) {
    try {
      return Array.from(contextMenu.querySelectorAll(':scope > li[data-key]'))
    } catch (error) {
      return Array.from(contextMenu.querySelectorAll('li[data-key]'))
    }
  }

  function patchFreshLock() {
    if (typeof window.File?.freshLock !== 'function') return
    if (window.File.freshLock.__typoraMacReadOnlyPatched) return

    const originalFreshLock = window.File.freshLock

    function patchedFreshLock(...args) {
      const result = originalFreshLock.apply(this, args)
      scheduleDomStateSync()
      return result
    }

    patchedFreshLock.__typoraMacReadOnlyPatched = true
    patchedFreshLock.__originalFreshLock = originalFreshLock
    window.File.freshLock = patchedFreshLock
  }

  function scheduleDomStateSync() {
    if (freshLockSyncPending) return

    freshLockSyncPending = true

    requestAnimationFrame(() => {
      freshLockSyncPending = false
      const wantToLock = shouldKeepReadOnlyActive()

      if (desiredReadOnly && !isReadOnly()) {
        window.File.lock()
      }

      syncDomState(wantToLock)
      syncStatusIndicator(wantToLock)
      syncContextMenu(wantToLock)
      document.body.classList.toggle('typora-mac-read-only', wantToLock)
    })
  }

  function exposeDebugApi(capabilities) {
    window.typoraMacReadOnly = {
      capabilities,
      toggle,
      lock,
      unlock,
      status,
      getConfig,
      setConfig,
    }
  }

  function status() {
    return {
      isReadOnly: shouldKeepReadOnlyActive(),
      fileIsLocked: isReadOnly(),
      desiredReadOnly,
      guardEventsBound,
      capabilities: detectCapabilities(),
      config: getConfig(),
    }
  }

  function getConfig() {
    return { ...config, remainAvailableMenuKey: [...config.remainAvailableMenuKey] }
  }

  function setConfig(nextConfig) {
    if (!nextConfig || typeof nextConfig !== 'object' || Array.isArray(nextConfig)) {
      throw new TypeError('typoraMacReadOnly.setConfig expects a plain object')
    }

    config = normalizeConfig({ ...config, ...nextConfig })
    saveConfig(config)

    const wantToLock = shouldKeepReadOnlyActive()
    syncDomState(wantToLock)
    syncStatusIndicator(wantToLock)
    syncContextMenu(wantToLock)
    document.body.classList.toggle('typora-mac-read-only', wantToLock)

    return getConfig()
  }

  function loadConfig() {
    try {
      const storedConfig = window.localStorage?.getItem(STORAGE_KEY)
      if (!storedConfig) return normalizeConfig(defaultConfig)

      const parsedConfig = JSON.parse(storedConfig)
      return normalizeConfig({ ...defaultConfig, ...parsedConfig })
    } catch (error) {
      console.warn('[typora-mac-readonly] Failed to load config from localStorage', error)
      return normalizeConfig(defaultConfig)
    }
  }

  function saveConfig(nextConfig) {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(nextConfig))
    } catch (error) {
      console.warn('[typora-mac-readonly] Failed to save config to localStorage', error)
    }
  }

  function normalizeConfig(nextConfig) {
    return {
      ...defaultConfig,
      ...nextConfig,
      hotkey: String(nextConfig.hotkey || defaultConfig.hotkey),
      showText: String(nextConfig.showText || defaultConfig.showText),
      remainAvailableMenuKey: Array.isArray(nextConfig.remainAvailableMenuKey) ? nextConfig.remainAvailableMenuKey.map(String) : [...defaultConfig.remainAvailableMenuKey],
    }
  }

  function toElement(node) {
    if (!node) return null
    if (node.nodeType === Node.ELEMENT_NODE) return node
    return node.parentElement || null
  }
})()
