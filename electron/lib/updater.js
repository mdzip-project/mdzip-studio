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

// The portable .exe can't install an update (electron-updater installs the
// setup build); it offers the download page instead.
function portableUpdateAvailableDialog(info, currentVersion) {
  return {
    type: 'info',
    buttons: ['Open Download Page', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update available',
    message: `MDZip Studio ${info.version} is available (you have ${currentVersion}).`,
    detail: 'This is the portable version, which doesn’t update itself. Download the new portable .exe and replace this one; your settings stay in the "MDZip Studio Data" folder beside it.',
  };
}

const PORTABLE_DOWNLOAD_URL = 'https://github.com/mdzip-project/mdzip-studio/releases/latest';

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

// --- macOS ---
// Builds are ad-hoc signed, so electron-updater can't install in place. We
// download the universal .dmg and the user drags the new app over the old one.

const HOMEBREW_CASK_DIRS = [
  '/opt/homebrew/Caskroom/mdzip-studio',
  '/usr/local/Caskroom/mdzip-studio',
];
const HOMEBREW_UPGRADE_COMMAND = 'brew upgrade --cask mdzip-studio';

// Pick the *-universal.dmg asset from a GitHub release JSON, or null.
function pickMacDmgAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find(
    (a) => typeof a?.name === 'string' && /-universal\.dmg$/i.test(a.name) && a.browser_download_url,
  );
  return asset ? { name: asset.name, url: asset.browser_download_url } : null;
}

// True when the app was installed by Homebrew (its Caskroom folder exists).
function isHomebrewInstall(existsFn) {
  return HOMEBREW_CASK_DIRS.some((dir) => existsFn(dir));
}

function macUpdateAvailableDialog(info, currentVersion) {
  return {
    type: 'info',
    buttons: ['Download', 'Open Release Page', 'Later'],
    defaultId: 0,
    cancelId: 2,
    title: 'Update available',
    message: `MDZip Studio ${info.version} is available (you have ${currentVersion}).`,
    detail: 'Download the installer now? When it finishes, drag the new MDZip Studio over the old one in Applications.',
  };
}

function homebrewUpdateDialog(info, currentVersion) {
  return {
    type: 'info',
    buttons: ['Copy Command', 'Open Release Page', 'Later'],
    defaultId: 0,
    cancelId: 2,
    title: 'Update available',
    message: `MDZip Studio ${info.version} is available (you have ${currentVersion}).`,
    detail: `You installed MDZip Studio with Homebrew. To update, run this in Terminal:\n\n${HOMEBREW_UPGRADE_COMMAND}`,
  };
}

function macUpdateDownloadedDialog(info) {
  return {
    type: 'question',
    buttons: ['Open Installer and Quit', 'Show in Finder', 'Later'],
    defaultId: 0,
    cancelId: 2,
    title: 'Update ready',
    message: `MDZip Studio ${info.version} has been downloaded.`,
    detail: 'Open the installer, then drag MDZip Studio onto the Applications folder to replace the old version. MDZip Studio quits first.',
  };
}

const MAC_RELEASE_API_URL = 'https://api.github.com/repos/mdzip-project/mdzip-studio/releases/latest';

// "v1.2.3" / "1.2.3-beta.1" -> { nums: [1, 2, 3], pre }, or null if unparseable.
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(text ?? '').trim());
  if (!match) return null;
  return { nums: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}

// True when `candidate` is a newer release than `current`. A prerelease sorts
// below the same x.y.z release; two prereleases compare as strings.
function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i];
  }
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true;
  if (b.pre === null) return false;
  return a.pre > b.pre;
}

// What the mac update flow needs from the latest-release JSON, or null when
// the tag isn't a version. `releaseUrl` is always set so a failed download can
// fall back to the release page.
function macUpdateFromRelease(release, currentVersion) {
  const version = String(release?.tag_name ?? '').replace(/^v/i, '');
  if (!parseVersion(version)) return null;
  return {
    version,
    newer: isNewerVersion(version, currentVersion),
    asset: pickMacDmgAsset(release),
    releaseUrl: typeof release?.html_url === 'string' && release.html_url ? release.html_url : PORTABLE_DOWNLOAD_URL,
  };
}

// Where the .dmg is saved: the downloads folder, using only the asset's base
// name (it comes from the network). Null for anything that isn't a plain .dmg.
function macDownloadPath(downloadsDir, assetName, pathModule = require('path')) {
  const base = pathModule.basename(String(assetName ?? '').replace(/\\/g, '/'));
  if (!/\.dmg$/i.test(base) || base.startsWith('.')) return null;
  return pathModule.join(downloadsDir, base);
}

function macUpdateErrorDialog(error, hasReleasePage = true) {
  return {
    type: 'error',
    buttons: hasReleasePage ? ['Open Release Page', 'Close'] : ['Close'],
    defaultId: 0,
    cancelId: hasReleasePage ? 1 : 0,
    title: 'Update',
    message: 'Could not download the update.',
    detail: `${error?.message ?? 'The download failed.'}\n\nYou can download it from the release page instead.`,
  };
}

module.exports = {
  MAC_RELEASE_API_URL,
  parseVersion,
  isNewerVersion,
  macUpdateFromRelease,
  macDownloadPath,
  macUpdateErrorDialog,
  HOMEBREW_CASK_DIRS,
  HOMEBREW_UPGRADE_COMMAND,
  pickMacDmgAsset,
  isHomebrewInstall,
  macUpdateAvailableDialog,
  homebrewUpdateDialog,
  macUpdateDownloadedDialog,
  PORTABLE_DOWNLOAD_URL,
  portableUpdateAvailableDialog,
  updateAvailableDialog,
  updateNotAvailableDialog,
  updateDownloadedDialog,
  updateErrorDialog,
};
