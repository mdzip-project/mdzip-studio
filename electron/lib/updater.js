// Pure dialog-option builders for the manual (Help > Check for Updates)
// electron-updater flow. Kept side-effect-free so the exact copy/buttons for
// each outcome are unit-testable without a running Electron main process.

function updateAvailableDialog(info, currentVersion) {
  return {
    type: 'info',
    buttons: ['Download', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update available',
    message: `MDZip Studio ${info.version} is available (you have ${currentVersion}).`,
    detail: 'Download it now? You choose when to install once the download finishes.',
  };
}

function updateNotAvailableDialog(currentVersion) {
  return {
    type: 'info',
    title: 'Check for Updates',
    message: 'You’re up to date.',
    detail: `MDZip Studio ${currentVersion} is the latest version.`,
  };
}

function updateDownloadedDialog(info) {
  return {
    type: 'question',
    buttons: ['Restart and install', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update ready',
    message: `MDZip Studio ${info.version} has been downloaded.`,
    detail: 'Restart now to install it, or it will install the next time you quit.',
  };
}

function updateErrorDialog(error) {
  return {
    type: 'error',
    title: 'Check for Updates',
    message: 'Could not check for updates.',
    detail: error?.message ?? 'Could not reach the update server. Check your connection and try again.',
  };
}

module.exports = {
  updateAvailableDialog,
  updateNotAvailableDialog,
  updateDownloadedDialog,
  updateErrorDialog,
};
