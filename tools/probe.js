(() => {
  const fileApi = window.File
  const result = {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    typoraVersion: window._options?.appVersion,
    hasFile: !!fileApi,
    fileOwnProperties: fileApi ? Object.getOwnPropertyNames(fileApi).sort() : [],
    filePrototypeProperties: fileApi ? Object.getOwnPropertyNames(Object.getPrototypeOf(fileApi) || {}).sort() : [],
    hasFileLock: typeof fileApi?.lock === 'function',
    hasFileUnlock: typeof fileApi?.unlock === 'function',
    hasFileIsLocked: !!fileApi && 'isLocked' in fileApi,
    hasFileFreshLock: typeof fileApi?.freshLock === 'function',
    hasWriteRoot: !!document.querySelector('#write'),
    hasFooterWordCount: !!document.querySelector('#footer-word-count-label'),
    hasContextMenu: !!document.querySelector('#context-menu'),
    hasSearchReplaceButton: !!document.querySelector('#search-panel-replace-btn'),
  }

  console.table(result)
  return result
})()
