const path = require('path');
const {
  HELPER_PROGRAMS,
  MDZ_PREVIEW_CLSID,
  PREVIEW_HANDLER_IID,
  compareVersions,
  createRegistry,
  latestVersion,
  latestVersionUrl,
  upgradeCommandFor,
  extensionList,
  freshPath,
  helperStatus,
  parseMissingReaders,
  requirementFor,
  requirementInstalled,
  uninstallCommandFor,
  terminalScript,
  parseExitCode,
  installCommandFor,
  outlookStatus,
  parseRegValues,
  parseVersion,
  previewHandlerStatus,
  previewOverrideKeys,
  setOutlookAllowed,
  setPreviewForUser,
  STUDIO_PACKAGES,
  studioInstallPaths,
  studioInstallStatus,
  userChoiceProgId,
  withExtension,
  withoutExtension,
} = require('./system-integration');

// An in-memory registry with the same interface as createRegistry().
function fakeRegistry(initial = {}) {
  const keys = new Map(Object.entries(initial).map(([key, values]) => [key.toLowerCase(), { ...values }]));
  return {
    keys,
    async keyExists(key) {
      const lower = key.toLowerCase();
      return [...keys.keys()].some((candidate) => candidate === lower || candidate.startsWith(`${lower}\\`));
    },
    async deleteKey(key) {
      const lower = key.toLowerCase();
      for (const candidate of [...keys.keys()]) {
        if (candidate === lower || candidate.startsWith(`${lower}\\`)) keys.delete(candidate);
      }
    },
    async isEmptyKey(key) {
      const lower = key.toLowerCase();
      const values = keys.get(lower);
      const hasSubkeys = [...keys.keys()].some((candidate) => candidate.startsWith(`${lower}\\`));
      return !hasSubkeys && (!values || Object.keys(values).length === 0);
    },
    async read(key, name) {
      const values = keys.get(key.toLowerCase());
      if (!values) return null;
      const value = values[name === null ? '' : name];
      return value === undefined ? null : value;
    },
    async writeString(key, name, data) {
      const lower = key.toLowerCase();
      keys.set(lower, { ...(keys.get(lower) ?? {}), [name === null ? '' : name]: data });
    },
    async deleteValue(key, name) {
      delete keys.get(key.toLowerCase())?.[name];
    },
  };
}

const OUTLOOK = 'HKCU\\Software\\Microsoft\\Office\\16.0\\Outlook';
const SECURITY = `${OUTLOOK}\\Security`;

describe('parseRegValues / createRegistry', () => {
  const sample = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Office\\16.0\\Outlook\\Security',
    '    OutlookSecureTempFolder    REG_SZ    C:\\Users\\me\\AppData\\Local\\Temp\\',
    '    Level1Remove    REG_SZ    .mdz;.exe',
    '',
  ].join('\r\n');

  it('reads value lines, names with spaces included', () => {
    expect(parseRegValues(sample)).toEqual([
      { name: 'OutlookSecureTempFolder', type: 'REG_SZ', data: 'C:\\Users\\me\\AppData\\Local\\Temp\\' },
      { name: 'Level1Remove', type: 'REG_SZ', data: '.mdz;.exe' },
    ]);
    expect(parseRegValues('    (Standard)    REG_SZ    {CA7A}')[0].data).toBe('{CA7A}');
    expect(parseRegValues('    Empty    REG_SZ')[0].data).toBe('');
  });

  it('runs reg.exe with the expected arguments', async () => {
    const run = vi.fn(async (_file, args) => (args[0] === 'query'
      ? { code: 0, stdout: '    Level1Remove    REG_SZ    .mdz' }
      : { code: 0, stdout: '' }));
    const reg = createRegistry(run);
    expect(await reg.read(SECURITY, 'Level1Remove')).toBe('.mdz');
    expect(run).toHaveBeenLastCalledWith('reg', ['query', SECURITY, '/v', 'Level1Remove']);
    await reg.read('HKLM\\Software\\Classes\\.mdz', null);
    expect(run).toHaveBeenLastCalledWith('reg', ['query', 'HKLM\\Software\\Classes\\.mdz', '/ve']);
    await reg.writeString(SECURITY, 'Level1Remove', '.mdz;.exe');
    expect(run).toHaveBeenLastCalledWith('reg', ['add', SECURITY, '/v', 'Level1Remove', '/t', 'REG_SZ', '/d', '.mdz;.exe', '/f']);
  });

  it('treats a missing key or value as null', async () => {
    const reg = createRegistry(async () => ({ code: 1, stdout: '' }));
    expect(await reg.read(SECURITY, 'Level1Remove')).toBeNull();
    expect(await reg.keyExists(OUTLOOK)).toBe(false);
  });
});

describe('userChoiceProgId', () => {
  const fileExts = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md';

  it('follows UserChoiceLatest over a stale UserChoice (current Windows 11)', async () => {
    const reg = fakeRegistry({
      [`${fileExts}\\UserChoice`]: { ProgId: 'ASC.Md', Hash: 'x' },
      [`${fileExts}\\UserChoiceLatest\\ProgId`]: { ProgId: 'MDZip.Studio.Markdown' },
    });
    expect(await userChoiceProgId(reg, '.md')).toBe('MDZip.Studio.Markdown');
  });

  it('falls back to UserChoice, or null when nothing was chosen', async () => {
    expect(await userChoiceProgId(fakeRegistry({ [`${fileExts}\\UserChoice`]: { ProgId: 'ASC.Md' } }), '.md')).toBe('ASC.Md');
    expect(await userChoiceProgId(fakeRegistry(), '.md')).toBeNull();
  });
});

describe('Level1Remove lists', () => {
  it('normalizes separators, case and missing dots', () => {
    expect(extensionList('.MDZ; exe ,.ps1')).toEqual(['.mdz', '.exe', '.ps1']);
    expect(extensionList(null)).toEqual([]);
  });

  it('adds and removes .mdz, keeping the other entries', () => {
    expect(withExtension('', '.mdz')).toBe('.mdz');
    expect(withExtension('.exe', '.mdz')).toBe('.exe;.mdz');
    expect(withExtension('.MDZ;.exe', '.mdz')).toBe('.MDZ;.exe');
    expect(withoutExtension('.exe;.MDZ;mdz', '.mdz')).toBe('.exe');
    expect(withoutExtension('.mdz', '.mdz')).toBe('');
  });
});

describe('Outlook', () => {
  it('reports classic Outlook missing', async () => {
    expect(await outlookStatus(fakeRegistry())).toEqual({ state: 'not-found' });
  });

  it('allows .mdz and undoes it, leaving other extensions alone', async () => {
    const reg = fakeRegistry({ [OUTLOOK]: {}, [SECURITY]: { Level1Remove: '.exe' } });
    expect((await outlookStatus(reg)).state).toBe('blocked');
    await setOutlookAllowed(reg, true);
    expect(await reg.read(SECURITY, 'Level1Remove')).toBe('.exe;.mdz');
    expect((await outlookStatus(reg)).state).toBe('allowed');
    await setOutlookAllowed(reg, false);
    expect(await reg.read(SECURITY, 'Level1Remove')).toBe('.exe');
  });

  it('removes the value when .mdz was the only entry', async () => {
    const reg = fakeRegistry({ [OUTLOOK]: {}, [SECURITY]: { Level1Remove: '.mdz' } });
    await setOutlookAllowed(reg, false);
    expect(await reg.read(SECURITY, 'Level1Remove')).toBeNull();
  });

  it("follows the organization's policy and won't change it", async () => {
    const policy = 'HKCU\\Software\\Policies\\Microsoft\\Office\\16.0\\Outlook\\Security';
    const reg = fakeRegistry({ [OUTLOOK]: {}, [policy]: { Level1Remove: '.exe' } });
    expect(await outlookStatus(reg)).toEqual({ state: 'managed', version: '16.0', managed: true });
    await expect(setOutlookAllowed(reg, true)).rejects.toThrow(/organization/);
  });
});

describe('previewHandlerStatus', () => {
  const handlerKey = `HKLM\\Software\\Classes\\.mdz\\ShellEx\\${PREVIEW_HANDLER_IID}`;
  const serverKey = `HKLM\\Software\\Classes\\CLSID\\${MDZ_PREVIEW_CLSID}\\InprocServer32`;
  const dll = 'C:\\Program Files\\MDZip Studio\\resources\\preview-handler\\mdz.WinPrev.comhost.dll';
  const base = (reg, overrides = {}) => previewHandlerStatus({
    reg,
    isPortable: false,
    fileExists: (file) => file === dll,
    listDir: () => ['8.0.11', '10.0.2'],
    programFiles: 'C:\\Program Files',
    ...overrides,
  });

  it('is installed when registered, present and its runtime is there', async () => {
    const reg = fakeRegistry({ [handlerKey]: { '': MDZ_PREVIEW_CLSID.toLowerCase() }, [serverKey]: { '': dll } });
    expect(await base(reg)).toEqual({ state: 'installed', other: null });
  });

  it('turns off for this user only, and back on without a trace', async () => {
    const reg = fakeRegistry({
      [handlerKey]: { '': MDZ_PREVIEW_CLSID },
      [serverKey]: { '': dll },
      // A per-user setting that was already there and must survive.
      'HKCU\\Software\\Classes\\.mdz\\OpenWithProgids': { 'MDZip.Studio.Document': '' },
    });
    expect((await base(reg)).state).toBe('installed');

    await setPreviewForUser(reg, false);
    expect(await base(reg)).toEqual({ state: 'off-for-user', other: null });
    for (const key of previewOverrideKeys()) expect(await reg.read(key, null)).toBe('');
    // The machine-wide registration is untouched.
    expect(await reg.read(handlerKey, null)).toBe(MDZ_PREVIEW_CLSID);

    await setPreviewForUser(reg, true);
    expect((await base(reg)).state).toBe('installed');
    expect(await reg.keyExists('HKCU\\Software\\Classes\\MDZip.Studio.Document')).toBe(false);
    expect(await reg.keyExists('HKCU\\Software\\Classes\\.mdz\\ShellEx')).toBe(false);
    expect(await reg.read('HKCU\\Software\\Classes\\.mdz\\OpenWithProgids', 'MDZip.Studio.Document')).toBe('');
  });

  it("names another program's .mdz preview, which shows when Studio's is off", async () => {
    const reg = fakeRegistry({
      [handlerKey]: { '': MDZ_PREVIEW_CLSID },
      [serverKey]: { '': dll },
      [`HKLM\\Software\\Classes\\SystemFileAssociations\\.mdz\\shellex\\${PREVIEW_HANDLER_IID}`]: { '': '{6F3A5A7E-9B2C-4D1E-8F0A-2B3C4D5E6F7A}' },
      'HKLM\\Software\\Classes\\CLSID\\{6F3A5A7E-9B2C-4D1E-8F0A-2B3C4D5E6F7A}': { '': 'MarkdownZip Preview Handler' },
    });
    expect(await base(reg)).toEqual({
      state: 'installed',
      other: { clsid: '{6F3A5A7E-9B2C-4D1E-8F0A-2B3C4D5E6F7A}', name: 'MarkdownZip Preview Handler' },
    });
  });

  it('explains why it is not working', async () => {
    expect(await base(fakeRegistry(), { isPortable: true })).toEqual({ state: 'portable' });
    expect(await base(fakeRegistry())).toEqual({ state: 'not-installed' });
    expect(await base(fakeRegistry({ [handlerKey]: { '': '{OTHER}' } }))).toEqual({ state: 'other', handler: '{OTHER}' });
    const registered = fakeRegistry({ [handlerKey]: { '': MDZ_PREVIEW_CLSID }, [serverKey]: { '': 'C:\\gone.dll' } });
    expect(await base(registered)).toEqual({ state: 'broken', reason: 'files' });
    const noRuntime = fakeRegistry({ [handlerKey]: { '': MDZ_PREVIEW_CLSID }, [serverKey]: { '': dll } });
    expect(await base(noRuntime, { listDir: () => ['8.0.11'] })).toEqual({ state: 'broken', reason: 'runtime' });
    expect(await base(noRuntime, { listDir: () => { throw new Error('ENOENT'); } })).toEqual({ state: 'broken', reason: 'runtime' });
  });
});

describe('helper programs', () => {
  it('reads version numbers from typical --version output', () => {
    expect(parseVersion('pandoc 3.1.9\nFeatures: +server')).toBe('3.1.9');
    expect(parseVersion('typst 0.12.0 (737895d7)')).toBe('0.12.0');
    expect(parseVersion('rsvg-convert version 2.58.0')).toBe('2.58.0');
    expect(parseVersion('11.4.2')).toBe('11.4.2');
    expect(parseVersion('no version here')).toBeNull();
  });

  it('builds an install command per platform, or none', () => {
    const byId = Object.fromEntries(HELPER_PROGRAMS.map((helper) => [helper.id, helper]));
    expect(installCommandFor(byId['pandoc'], 'win32')).toBe('winget install --id JohnMacFarlane.Pandoc --exact --source winget');
    expect(installCommandFor(byId['pandoc'], 'darwin')).toBe('brew install pandoc');
    expect(installCommandFor(byId['pandoc'], 'linux')).toBeNull();
    expect(installCommandFor(byId['rsvg-convert'], 'win32')).toBeNull();
    expect(installCommandFor(byId['mmdc'], 'linux')).toBe('npm install -g @mermaid-js/mermaid-cli');
    expect(installCommandFor(byId['markitdown-mdz'], 'win32')).toBe('py -m pip install --user "markitdown-mdzip[all]"');
    expect(installCommandFor(byId['mdz'], 'win32')).toBe('winget install --id MDZip.Cli --exact --source winget');
  });

  it('builds an update command per platform', () => {
    const byId = Object.fromEntries(HELPER_PROGRAMS.map((helper) => [helper.id, helper]));
    expect(upgradeCommandFor(byId['mdz'], 'win32')).toBe('winget upgrade --id MDZip.Cli --exact --source winget');
    expect(upgradeCommandFor(byId['typst'], 'darwin')).toBe('brew upgrade typst');
    expect(upgradeCommandFor(byId['mmdc'], 'linux')).toBe('npm install -g @mermaid-js/mermaid-cli@latest');
    expect(upgradeCommandFor(byId['markitdown-mdz'], 'darwin')).toBe('python3 -m pip install --user --upgrade "markitdown-mdzip[all]"');
    expect(upgradeCommandFor(byId['rsvg-convert'], 'win32')).toBeNull();
  });

  it("reads each publisher's newest version, and gives up quietly", async () => {
    const byId = Object.fromEntries(HELPER_PROGRAMS.map((helper) => [helper.id, helper]));
    const answers = {
      'https://api.github.com/repos/typst/typst/releases/latest': { tag_name: 'v0.15.1' },
      'https://api.github.com/repos/jgm/pandoc/releases/latest': { tag_name: '3.14' },
      'https://registry.npmjs.org/@mermaid-js%2Fmermaid-cli/latest': { version: '12.2.0', scripts: { version: 'node x.js' } },
      'https://pypi.org/pypi/markitdown-mdzip/json': { info: { version: '0.1.0' } },
    };
    const fetchJson = vi.fn(async (url) => {
      if (!(url in answers)) throw new Error('HTTP 403');
      return answers[url];
    });
    expect(await latestVersion(byId['typst'], fetchJson)).toBe('0.15.1');
    expect(await latestVersion(byId['pandoc'], fetchJson)).toBe('3.14');
    expect(await latestVersion(byId['mmdc'], fetchJson)).toBe('12.2.0');
    expect(await latestVersion(byId['markitdown-mdz'], fetchJson)).toBe('0.1.0');
    expect(await latestVersion(byId['mdz'], fetchJson)).toBeNull();
    expect(await latestVersion(byId['rsvg-convert'], fetchJson)).toBeNull();
    expect(latestVersionUrl(byId['rsvg-convert'])).toBeNull();
  });

  it('compares versions as numbers, not text', () => {
    expect(compareVersions('2.0.0', '2.1.0')).toBeLessThan(0);
    expect(compareVersions('3.14', '3.6.4')).toBeGreaterThan(0);
    expect(compareVersions('3.14', '3.14.0')).toBe(0);
  });

  it('checks a program with --version', async () => {
    const helper = HELPER_PROGRAMS[0];
    expect(await helperStatus(helper, async () => ({ code: 0, stdout: 'pandoc 3.14', stderr: '' })))
      .toEqual({ id: 'pandoc', installed: true, version: '3.14', missingReaders: [] });
    expect(await helperStatus(helper, async () => ({ code: 1, stdout: '', stderr: 'not recognized' })))
      .toEqual({ id: 'pandoc', installed: false, version: null, missingReaders: [] });
    expect(await helperStatus(helper, async () => { throw new Error('ENOENT'); }))
      .toEqual({ id: 'pandoc', installed: false, version: null, missingReaders: [] });
  });

  it('knows what installs each program, and checks it is there', async () => {
    const find = (id) => HELPER_PROGRAMS.find((h) => h.id === id);
    expect(requirementFor(find('markitdown-mdz'), 'win32')).toMatchObject({ name: 'Python', always: true, command: 'py' });
    expect(requirementFor(find('markitdown-mdz'), 'darwin')).toMatchObject({ name: 'Python', command: 'python3' });
    expect(requirementFor(find('mmdc'), 'linux')).toMatchObject({ name: 'Node.js', always: true, command: 'npm' });
    expect(requirementFor(find('pandoc'), 'win32')).toMatchObject({ name: 'winget', always: false });
    expect(requirementFor(find('pandoc'), 'darwin')).toMatchObject({ name: 'Homebrew' });
    expect(requirementFor(find('mdz'), 'darwin')).toBeNull(); // no package here: a download page
    // Every program with an installer says what installing it costs, except rsvg-convert (Homebrew's libraries vary).
    expect(HELPER_PROGRAMS.filter((h) => !h.size).map((h) => h.id)).toEqual(['rsvg-convert']);

    const calls = [];
    const run = async (command, args) => { calls.push([command, ...args]); return { code: command === 'py' ? 0 : 1, stdout: '', stderr: '' }; };
    expect(await requirementInstalled(find('markitdown-mdz'), 'win32', run)).toBe(true);
    expect(await requirementInstalled(find('mmdc'), 'win32', run)).toBe(false);
    expect(await requirementInstalled(find('mdz'), 'darwin', run)).toBe(true);
    expect(calls).toEqual([['py', '--version'], ['npm', '--version']]);
    expect(await requirementInstalled(find('mmdc'), 'win32', async () => { throw new Error('ENOENT'); })).toBe(false);
  });

  it('uninstalls with the same tool that installed, without its own question for pip', () => {
    const find = (id) => HELPER_PROGRAMS.find((h) => h.id === id);
    expect(uninstallCommandFor(find('pandoc'), 'win32')).toBe('winget uninstall --id JohnMacFarlane.Pandoc --exact --source winget');
    expect(uninstallCommandFor(find('pandoc'), 'darwin')).toBe('brew uninstall pandoc');
    expect(uninstallCommandFor(find('mmdc'), 'linux')).toBe('npm uninstall -g @mermaid-js/mermaid-cli');
    expect(uninstallCommandFor(find('markitdown-mdz'), 'win32')).toBe('py -m pip uninstall -y markitdown-mdzip');
    expect(uninstallCommandFor(find('markitdown-mdz'), 'darwin')).toBe('python3 -m pip uninstall -y markitdown-mdzip');
    expect(uninstallCommandFor(find('mdz'), 'darwin')).toBeNull();
    expect(find('mmdc').uninstallNote).toMatch(/puppeteer/);
  });

  it('ends a terminal command by writing its exit code where Studio watches', () => {
    expect(terminalScript('npm uninstall -g x', 'Uninstalling X', 'win32', 'C:/Temp/m.done'))
      .toBe('title Uninstalling X && call npm uninstall -g x & >"C:/Temp/m.done" echo !errorlevel!');
    expect(terminalScript('brew uninstall pandoc', 'Uninstalling Pandoc', 'darwin', '/tmp/m.done'))
      .toBe("brew uninstall pandoc; echo $? > '/tmp/m.done'");
    expect(parseExitCode('0 \r\n')).toBe(0);
    expect(parseExitCode('3')).toBe(3);
    expect(parseExitCode('')).toBeNull();
  });

  it('reads the readers markitdown-mdz says it is missing', async () => {
    const helper = HELPER_PROGRAMS.find((h) => h.id === 'markitdown-mdz');
    const stdout = 'markitdown-mdz 0.1.1\nMarkItDown 0.1.9\nMissing readers: docx, pptx, xlsx, xls (pip install "markitdown-mdzip[all]" adds them)\n';
    expect(await helperStatus(helper, async () => ({ code: 0, stdout, stderr: '' })))
      .toEqual({ id: 'markitdown-mdz', installed: true, version: '0.1.1', missingReaders: ['docx', 'pptx', 'xlsx', 'xls'] });
    // All there, or 0.1.0, which doesn't say.
    expect(parseMissingReaders('markitdown-mdz 0.1.1\nMarkItDown 0.1.9\n')).toEqual([]);
    expect(parseMissingReaders('markitdown-mdz 0.1.0')).toEqual([]);
  });

  it('builds a fresh PATH so programs installed since Studio started are found', async () => {
    const reg = fakeRegistry({
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment': { Path: '%SystemRoot%\\system32;C:\\Program Files\\Pandoc' },
      'HKCU\\Environment': { Path: '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links' },
    });
    const env = { Path: 'C:\\Windows\\system32;C:\\old', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    expect(await freshPath({ platform: 'win32', reg, env })).toBe(
      'C:\\Windows\\system32;C:\\Program Files\\Pandoc;C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links;C:\\old'
    );
    expect(await freshPath({ platform: 'darwin', reg, env: { PATH: '/usr/bin', HOME: '/Users/me' }, listDir: () => [] }))
      .toBe(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin', '/Users/me/.local/bin'].join(path.posix.delimiter));
  });

  it("adds the folders pip install --user puts programs in, which aren't on PATH", async () => {
    const reg = fakeRegistry({});
    const folders = {
      'C:\\Users\\me\\AppData\\Roaming\\Python': ['Python39', 'Python314', 'Python313', 'site-packages'],
      '/Users/me/Library/Python': ['3.9', '3.14', '3.13', '.DS_Store'],
    };
    const listDir = (folder) => folders[folder] ?? [];
    expect(await freshPath({ platform: 'win32', reg, env: { Path: 'C:\\old', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, listDir })).toBe([
      'C:\\old',
      'C:\\Users\\me\\AppData\\Roaming\\Python\\Python314\\Scripts',
      'C:\\Users\\me\\AppData\\Roaming\\Python\\Python313\\Scripts',
      'C:\\Users\\me\\AppData\\Roaming\\Python\\Python39\\Scripts',
    ].join(';'));
    expect(await freshPath({ platform: 'darwin', reg, env: { PATH: '/usr/bin', HOME: '/Users/me' }, listDir }))
      .toBe(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin', '/Users/me/.local/bin',
        '/Users/me/Library/Python/3.14/bin', '/Users/me/Library/Python/3.13/bin', '/Users/me/Library/Python/3.9/bin'].join(':'));
    expect(await freshPath({ platform: 'linux', reg, env: { PATH: '/usr/bin', HOME: '/home/me' }, listDir }))
      .toBe('/usr/bin:/home/me/.local/bin');
  });
});

describe('installing Studio from the portable version', () => {
  const places = { programFiles: 'C:/Program Files', localAppData: 'C:/Users/me/AppData/Local' };
  const paths = studioInstallPaths(places);
  const runWith = (present) => vi.fn(async (command) => {
    if (!present.includes(command)) throw new Error('not found');
    return { code: 0, stdout: '1.0', stderr: '' };
  });

  it('finds an installed Studio for all users or for one, without asking package managers', async () => {
    expect(paths.machine).toBe(path.join('C:/Program Files', 'MDZip Studio', 'MDZip Studio.exe'));
    expect(paths.user).toBe(path.join('C:/Users/me/AppData/Local', 'Programs', 'MDZip Studio', 'MDZip Studio.exe'));
    const run = runWith(['winget']);
    expect(await studioInstallStatus({ ...places, run, fileExists: (file) => file === paths.machine }))
      .toEqual({ installed: 'machine', via: null, command: null });
    expect(await studioInstallStatus({ ...places, run, fileExists: (file) => file === paths.user }))
      .toEqual({ installed: 'user', via: null, command: null });
    expect(run).not.toHaveBeenCalled();
  });

  it('installs with winget first, then Chocolatey, else neither', async () => {
    const none = () => false;
    expect(await studioInstallStatus({ ...places, run: runWith(['winget', 'choco']), fileExists: none }))
      .toEqual({ installed: null, via: 'winget', command: STUDIO_PACKAGES.winget.shown });
    expect(await studioInstallStatus({ ...places, run: runWith(['choco']), fileExists: none }))
      .toEqual({ installed: null, via: 'choco', command: 'choco install mdzip-studio -y' });
    expect(await studioInstallStatus({ ...places, run: runWith([]), fileExists: none }))
      .toEqual({ installed: null, via: null, command: null });
  });

  it('installs for all users: winget with machine scope, Chocolatey as administrator', () => {
    expect(STUDIO_PACKAGES.winget.run).toBe('winget install --id MDZip.Studio --exact --source winget --scope machine');
    expect(STUDIO_PACKAGES.choco.run).toMatch(/Start-Process choco -ArgumentList 'install mdzip-studio -y' -Verb RunAs -Wait -PassThru/);
  });
});
