const {
  MAC_RELEASE_API_URL,
  isNewerVersion,
  macUpdateFromRelease,
  macDownloadPath,
  macUpdateErrorDialog,
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
} = require('./updater');

describe('updateAvailableDialog', () => {
  it('names the new and current version and offers Download/Not now', () => {
    const options = updateAvailableDialog({ version: '2.0.0' }, '1.9.0');
    expect(options.type).toBe('info');
    expect(options.buttons).toEqual(['Download', 'Not now']);
    expect(options.message).toBe('MDZip Studio 2.0.0 is available (you have 1.9.0).');
  });
});

describe('updateNotAvailableDialog', () => {
  it('reports the current version as up to date', () => {
    const options = updateNotAvailableDialog('1.9.0');
    expect(options.type).toBe('info');
    expect(options.detail).toBe('MDZip Studio 1.9.0 is the latest version.');
  });
});

describe('updateDownloadedDialog', () => {
  it('offers to restart and install', () => {
    const options = updateDownloadedDialog({ version: '2.0.0' });
    expect(options.type).toBe('question');
    expect(options.buttons).toEqual(['Restart and install', 'Later']);
    expect(options.message).toBe('MDZip Studio 2.0.0 has been downloaded.');
  });
});

describe('updateErrorDialog', () => {
  it('surfaces the error message when present', () => {
    const options = updateErrorDialog(new Error('network down'));
    expect(options.type).toBe('error');
    expect(options.detail).toBe('network down');
  });

  it('falls back to a generic message when there is no error message', () => {
    const options = updateErrorDialog(undefined);
    expect(options.detail).toBe('Could not reach the update server. Check your connection and try again.');
  });
});

describe('portableUpdateAvailableDialog', () => {
  it('offers the download page, since the portable .exe cannot install an update', () => {
    const options = portableUpdateAvailableDialog({ version: '2.0.0' }, '1.9.0');
    expect(options.buttons).toEqual(['Open Download Page', 'Not now']);
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(1);
    expect(options.message).toContain('2.0.0');
    expect(options.message).toContain('1.9.0');
    expect(options.detail).toContain('MDZip Studio Data');
    expect(PORTABLE_DOWNLOAD_URL).toBe('https://github.com/mdzip-project/mdzip-studio/releases/latest');
  });
});

describe('pickMacDmgAsset', () => {
  const release = {
    assets: [
      { name: 'MDZip-Studio-2.0.0-universal.zip', browser_download_url: 'https://x/zip' },
      { name: 'MDZip-Studio-Setup-2.0.0.exe', browser_download_url: 'https://x/exe' },
      { name: 'MDZip-Studio-2.0.0-universal.dmg', browser_download_url: 'https://x/dmg' },
    ],
  };

  it('picks the universal dmg', () => {
    expect(pickMacDmgAsset(release)).toEqual({ name: 'MDZip-Studio-2.0.0-universal.dmg', url: 'https://x/dmg' });
  });

  it('returns null when there is no universal dmg or no assets', () => {
    expect(pickMacDmgAsset({ assets: [{ name: 'a.dmg', browser_download_url: 'u' }] })).toBeNull();
    expect(pickMacDmgAsset({ assets: [] })).toBeNull();
    expect(pickMacDmgAsset({})).toBeNull();
    expect(pickMacDmgAsset(null)).toBeNull();
  });
});

describe('isHomebrewInstall', () => {
  it('is true when either Caskroom folder exists', () => {
    expect(isHomebrewInstall((p) => p === '/opt/homebrew/Caskroom/mdzip-studio')).toBe(true);
    expect(isHomebrewInstall((p) => p === '/usr/local/Caskroom/mdzip-studio')).toBe(true);
  });

  it('is false when neither exists', () => {
    expect(isHomebrewInstall(() => false)).toBe(false);
  });
});

describe('macUpdateAvailableDialog', () => {
  it('offers Download / Open Release Page / Later', () => {
    const options = macUpdateAvailableDialog({ version: '2.0.0' }, '1.9.0');
    expect(options.buttons).toEqual(['Download', 'Open Release Page', 'Later']);
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(2);
    expect(options.message).toBe('MDZip Studio 2.0.0 is available (you have 1.9.0).');
  });
});

describe('homebrewUpdateDialog', () => {
  it('tells the user the brew command and offers to copy it', () => {
    const options = homebrewUpdateDialog({ version: '2.0.0' }, '1.9.0');
    expect(options.buttons).toEqual(['Copy Command', 'Open Release Page', 'Later']);
    expect(options.cancelId).toBe(2);
    expect(options.detail).toContain('brew upgrade --cask mdzip-studio');
    expect(HOMEBREW_UPGRADE_COMMAND).toBe('brew upgrade --cask mdzip-studio');
  });
});

describe('macUpdateDownloadedDialog', () => {
  it('offers to open the installer and quit, show it in Finder, or wait', () => {
    const options = macUpdateDownloadedDialog({ version: '2.0.0' });
    expect(options.buttons).toEqual(['Open Installer and Quit', 'Show in Finder', 'Later']);
    expect(options.cancelId).toBe(2);
    expect(options.message).toBe('MDZip Studio 2.0.0 has been downloaded.');
  });
});

describe('isNewerVersion', () => {
  it('compares numerically, not as strings', () => {
    expect(isNewerVersion('1.3.10', '1.3.9')).toBe(true);
    expect(isNewerVersion('v2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('1.3.9', '1.3.9')).toBe(false);
    expect(isNewerVersion('1.3.8', '1.3.9')).toBe(false);
  });
  it('ranks a prerelease below its release and rejects junk', () => {
    expect(isNewerVersion('1.4.0', '1.4.0-beta.1')).toBe(true);
    expect(isNewerVersion('1.4.0-beta.1', '1.4.0')).toBe(false);
    expect(isNewerVersion('nonsense', '1.0.0')).toBe(false);
    expect(isNewerVersion(undefined, '1.0.0')).toBe(false);
  });
});

describe('macUpdateFromRelease', () => {
  const release = {
    tag_name: 'v1.4.0',
    html_url: 'https://github.com/mdzip-project/mdzip-studio/releases/tag/v1.4.0',
    assets: [{ name: 'MDZip-Studio-1.4.0-universal.dmg', browser_download_url: 'https://example.test/a.dmg' }],
  };
  it('reports version, newer flag, dmg asset and release page', () => {
    expect(macUpdateFromRelease(release, '1.3.0')).toEqual({
      version: '1.4.0', newer: true,
      asset: { name: 'MDZip-Studio-1.4.0-universal.dmg', url: 'https://example.test/a.dmg' },
      releaseUrl: release.html_url,
    });
    expect(macUpdateFromRelease(release, '1.4.0').newer).toBe(false);
  });
  it('tolerates a missing dmg or html_url, and rejects a bad tag', () => {
    const bare = macUpdateFromRelease({ tag_name: '1.5.0', assets: [] }, '1.4.0');
    expect(bare.asset).toBeNull();
    expect(bare.releaseUrl).toBe(PORTABLE_DOWNLOAD_URL);
    expect(macUpdateFromRelease({ tag_name: 'latest' }, '1.4.0')).toBeNull();
    expect(macUpdateFromRelease(null, '1.4.0')).toBeNull();
  });
  it('points at the GitHub latest-release API', () => {
    expect(MAC_RELEASE_API_URL).toBe('https://api.github.com/repos/mdzip-project/mdzip-studio/releases/latest');
  });
});

describe('macDownloadPath', () => {
  const posix = require('path').posix;
  it('puts the dmg in the downloads folder', () => {
    expect(macDownloadPath('/Users/a/Downloads', 'MDZip-Studio-1.4.0-universal.dmg', posix))
      .toBe('/Users/a/Downloads/MDZip-Studio-1.4.0-universal.dmg');
  });
  it('strips directories and refuses non-dmg or hidden names', () => {
    expect(macDownloadPath('/d', '../../etc/x.dmg', posix)).toBe('/d/x.dmg');
    expect(macDownloadPath('/d', 'evil.sh', posix)).toBeNull();
    expect(macDownloadPath('/d', '.hidden.dmg', posix)).toBeNull();
    expect(macDownloadPath('/d', undefined, posix)).toBeNull();
  });
});

describe('macUpdateErrorDialog', () => {
  it('offers the release page as the fallback', () => {
    const options = macUpdateErrorDialog(new Error('offline'));
    expect(options.buttons).toEqual(['Open Release Page', 'Close']);
    expect(options.cancelId).toBe(1);
    expect(options.detail).toContain('offline');
    expect(macUpdateErrorDialog(null, false).buttons).toEqual(['Close']);
  });
});
