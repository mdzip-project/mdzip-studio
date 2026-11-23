const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdzipStudio', {
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  },
  isElectron: true,
  // The Windows portable version (no installer), as opposed to an installed one.
  portable: ipcRenderer.sendSync('mdzip:is-portable'),
  // The editor's saved color scheme and page width, read once as the window starts.
  viewSettings: ipcRenderer.sendSync('mdzip:get-view-settings'),
  setViewSetting: (key, value) => ipcRenderer.send('mdzip:set-view-setting', { key, value }),
  openDocument: () => ipcRenderer.invoke('mdzip:open-document'),
  openDocumentByPath: (filePath) => ipcRenderer.invoke('mdzip:open-document-path', { filePath }),
  // Open in a new window instead of this one — used when this window already
  // has a document open, so Open Document / Open Recent don't clobber it.
  openDocumentInNewWindow: () => ipcRenderer.send('mdzip:open-document-in-new-window'),
  openPathInNewWindow: (filePath) => ipcRenderer.send('mdzip:open-path-in-new-window', { filePath }),
  // A help document ('studio-help' | 'known-issues' | 'changelog') in a help window,
  // at a page of studio-help ('system-integration.md') and a heading id.
  openHelpInNewWindow: (doc, page, anchor) => ipcRenderer.send('mdzip:open-help-in-new-window', { doc, page, anchor }),
  // View > Reading View: { bytes, fileName, title } in this window's reader window.
  openReaderWindow: (snapshot) => ipcRenderer.send('mdzip:open-reader-window', snapshot),
  // A help or reader window's Save a Copy: { bytes, fileName } written where
  // the user chooses. Resolves { canceled, filePath }.
  saveCopy: (copy) => ipcRenderer.invoke('mdzip:save-copy', copy),
  // A help or reader window: its document is drawn, so the window can show
  // (it stays hidden until then, rather than flash the start screen).
  readingWindowReady: () => ipcRenderer.send('mdzip:reading-window-ready'),
  // A reader window: the document again ({ bytes, fileName, title, filePath })
  // when its editing window chooses Reading View again.
  onReaderUpdate: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('mdzip:reader-update', listener);
    return () => ipcRenderer.removeListener('mdzip:reader-update', listener);
  },
  // File > Import...: pick a file ({ canceled } or { fileName, formatName,
  // choices: [{ tool, name, usable, recommended, commandLine }], defaultTool }),
  // then convert it with one of the programs ({ bytes, fileName, warnings } or
  // { error: true, message, fix }).
  importPick: () => ipcRenderer.invoke('mdzip:import-pick'),
  importRun: (tool, options) => ipcRenderer.invoke('mdzip:import-run', { tool, ...(options ?? {}) }),
  // File > Export...: whether Pandoc is here and each format's command
  // ({ fileName, sourceFormat, document }); then export with Pandoc ({ format,
  // bytes, fileName, sourceFormat, combine, document }) or as PDF from the preview ({ html,
  // fileName }): { filePath, warnings } | { canceled } | { error: true, message, fix }.
  exportOptions: (payload) => ipcRenderer.invoke('mdzip:export-options', payload),
  exportRun: (payload) => ipcRenderer.invoke('mdzip:export-run', payload),
  wordTemplate: () => ipcRenderer.invoke('mdzip:word-template'),
  exportPdf: (payload) => ipcRenderer.invoke('mdzip:export-pdf', payload),
  // Stops this window's Pandoc or markitdown-mdz run (the dialogs' Cancel).
  cancelConversion: () => ipcRenderer.invoke('mdzip:convert-cancel'),
  // Opens the file this window last exported in its usual app.
  openExport: () => ipcRenderer.invoke('mdzip:open-export'),
  // Opens the file (or folder) this window last extracted to.
  openExtracted: () => ipcRenderer.invoke('mdzip:open-extracted'),
  // Open in <app> / Open With… on a file in the document, with its saves coming back (#29).
  appForFile: (extension) => ipcRenderer.invoke('mdzip:app-for-file', { extension }),
  editExternally: (payload) => ipcRenderer.invoke('mdzip:edit-externally', payload),
  stopExternalEdits: () => ipcRenderer.invoke('mdzip:stop-external-edits'),
  confirmExternalReplace: (payload) => ipcRenderer.invoke('mdzip:confirm-external-replace', payload),
  onExternalFileChanged: (callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on('mdzip:external-file-changed', listener);
    return () => ipcRenderer.removeListener('mdzip:external-file-changed', listener);
  },
  setRecentFiles: (paths) => ipcRenderer.send('mdzip:set-recent-files', { paths }),
  // Tell the main process whether a document is open so it can enable/disable
  // document-only menu items (Save, Save As, Close, Show in File Manager).
  setDocumentOpen: (open) => ipcRenderer.send('mdzip:set-document-open', open),
  setCurrentDocumentPath: (filePath) => ipcRenderer.send('mdzip:set-current-document-path', { filePath }),
  pickFolder: () => ipcRenderer.invoke('mdzip:pick-folder'),
  readFolder: (payload) => ipcRenderer.invoke('mdzip:read-folder', payload),
  pickMdzForUnpack: () => ipcRenderer.invoke('mdzip:pick-mdz-for-unpack'),
  writeUnpackedFolder: (payload) => ipcRenderer.invoke('mdzip:write-unpacked-folder', payload),
  // The contents pane's Extract…: { files: [{ path, bytes }], selection } →
  // { canceled } or { canceled: false, targetPath, fileCount }.
  extractFiles: (payload) => ipcRenderer.invoke('mdzip:extract-files', payload),
  onPackFolderProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mdzip:pack-folder-progress', listener);
    return () => ipcRenderer.removeListener('mdzip:pack-folder-progress', listener);
  },
  takePendingOpenDocument: () => ipcRenderer.invoke('mdzip:take-pending-open-document'),
  onOpenDocumentRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('mdzip:open-document-requested', listener);
    return () => ipcRenderer.removeListener('mdzip:open-document-requested', listener);
  },
  // What a window created for a specific purpose (open dialog, new document)
  // should do once it's up: { kind: 'open-dialog' } | { kind: 'new-document',
  // format } | null. Cleared on read.
  takeStartupAction: () => ipcRenderer.invoke('mdzip:take-startup-action'),
  onDocumentChangedExternally: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mdzip:document-changed-externally', listener);
    return () => ipcRenderer.removeListener('mdzip:document-changed-externally', listener);
  },
  // The main process asks before letting a window close (X button / app quit).
  // The renderer runs its unsaved-changes prompt and answers with allow/deny.
  onWindowCloseRequested: (callback) => {
    const listener = (_event, requestId) => callback(requestId);
    ipcRenderer.on('mdzip:window-close-requested', listener);
    return () => ipcRenderer.removeListener('mdzip:window-close-requested', listener);
  },
  respondWindowClose: (requestId, allow) =>
    ipcRenderer.send('mdzip:window-close-response', { requestId, allow }),
  saveDocument: (payload) => ipcRenderer.invoke('mdzip:save-document', payload),
  getMarkdownDefaultStatus: () => ipcRenderer.invoke('mdzip:get-md-default-status'),
  promptMarkdownDefault: () => ipcRenderer.invoke('mdzip:prompt-md-default'),
  // Help > System Integration...: its cards (at once), each card's state
  // (checked separately, so the slow ones don't hold up the rest), and its
  // actions ({ action: 'markdown-default' | 'outlook-allow' | 'outlook-undo' |
  // 'preview-off' | 'preview-on' | 'install-helper' | 'upgrade-helper' | 'open-page', id }).
  getSystemIntegrationCards: () => ipcRenderer.invoke('mdzip:system-integration-cards'),
  checkSystemIntegration: (id) => ipcRenderer.invoke('mdzip:system-integration-check', id),
  // Each helper program's newest version: { [id]: { latest, upgradeCommand } }.
  getHelperLatestVersions: () => ipcRenderer.invoke('mdzip:system-integration-latest'),
  runSystemIntegrationAction: (payload) => ipcRenderer.invoke('mdzip:system-integration-action', payload),
  // An Install, Update or Uninstall's terminal command finished: { action, id, code }.
  onSystemIntegrationFinished: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mdzip:system-integration-finished', listener);
    return () => ipcRenderer.removeListener('mdzip:system-integration-finished', listener);
  },
  writeMarkdownImage: (payload) => ipcRenderer.invoke('mdzip:write-markdown-image', payload),
  readMarkdownAsset: (payload) => ipcRenderer.invoke('mdzip:read-markdown-asset', payload),
  showInFolder: (filePath) => ipcRenderer.invoke('mdzip:show-in-folder', { filePath }),
  pathAction: (filePath, action) => ipcRenderer.invoke('mdzip:path-action', { filePath, action }),
  printPreview: (payload) => ipcRenderer.invoke('mdzip:print-preview', payload),
});
