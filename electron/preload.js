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
  openDocument: () => ipcRenderer.invoke('mdzip:open-document'),
  takePendingOpenDocument: () => ipcRenderer.invoke('mdzip:take-pending-open-document'),
  onOpenDocumentRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('mdzip:open-document-requested', listener);
    return () => ipcRenderer.removeListener('mdzip:open-document-requested', listener);
  },
  saveDocument: (payload) => ipcRenderer.invoke('mdzip:save-document', payload),
  getMarkdownDefaultStatus: () => ipcRenderer.invoke('mdzip:get-md-default-status'),
  promptMarkdownDefault: () => ipcRenderer.invoke('mdzip:prompt-md-default'),
  writeMarkdownImage: (payload) => ipcRenderer.invoke('mdzip:write-markdown-image', payload),
});
