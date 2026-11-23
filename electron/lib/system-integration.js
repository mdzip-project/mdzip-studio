const fs = require('fs');
const path = require('path');

// Help > System Integration… (studio#11): how MDZip fits into the rest of the
// computer: who opens .md files, Explorer previews of .mdz, classic Outlook's
// attachment block, and helper programs other Studio features can use.
// Electron-free: the registry, file system and process runner are passed in,
// so this is unit-testable; main.js wires the real ones.

const MDZ_PREVIEW_CLSID = '{CA7A244F-7A83-4B5E-9D7A-9F13EF5E8B3A}';
// The file type (ProgID) Studio's installer registers for .mdz.
const MDZ_PROGID = 'MDZip.Studio.Document';
// IPreviewHandler's shell extension key.
const PREVIEW_HANDLER_IID = '{8895b1c6-b41f-4c1c-a562-0d564250836f}';
// The .NET runtime the preview handler runs on (installed by Studio's installer).
const PREVIEW_RUNTIME = { name: 'Microsoft.WindowsDesktop.App', major: 10 };
// Classic Outlook versions (16.0 covers 2016, 2019, 2021, 2024 and Microsoft 365).
const OUTLOOK_VERSIONS = Object.freeze(['16.0', '15.0']);

// ---- reg.exe ---------------------------------------------------------------

// The value lines of `reg query` output: "    Name    REG_SZ    data". The name
// of the default value is localized ("(Default)", "(Standard)", …), so callers
// that query /ve take the first line instead of matching its name.
function parseRegValues(stdout) {
  const values = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const match = /^ {2,}(.*?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (match) values.push({ name: match[1], type: match[2], data: match[3] ?? '' });
  }
  return values;
}

// A small reg.exe wrapper over `run(file, args)`, which resolves to
// { code, stdout } (code 0 = success; reg exits 1 when a key or value is missing).
function createRegistry(run) {
  return {
    async keyExists(key) {
      return (await run('reg', ['query', key])).code === 0;
    },
    // name null → the key's default value.
    async read(key, name) {
      const result = await run('reg', ['query', key, ...(name === null ? ['/ve'] : ['/v', name])]);
      if (result.code !== 0) return null;
      const [value] = parseRegValues(result.stdout);
      return value ? value.data : null;
    },
    // name null → the key's default value.
    async writeString(key, name, data) {
      const result = await run('reg', ['add', key, ...(name === null ? ['/ve'] : ['/v', name]), '/t', 'REG_SZ', '/d', data, '/f']);
      if (result.code !== 0) throw new Error(`Could not write ${key}\\${name ?? ''}`);
    },
    async deleteValue(key, name) {
      const result = await run('reg', ['delete', key, '/v', name, '/f']);
      if (result.code !== 0) throw new Error(`Could not remove ${key}\\${name}`);
    },
    // Deletes a key and everything under it; a missing key is fine.
    async deleteKey(key) {
      if ((await run('reg', ['query', key])).code !== 0) return;
      const result = await run('reg', ['delete', key, '/f']);
      if (result.code !== 0 && (await run('reg', ['query', key])).code === 0) {
        throw new Error(`Could not remove ${key}`);
      }
    },
    // True when the key holds no values and no subkeys (or doesn't exist).
    async isEmptyKey(key) {
      const result = await run('reg', ['query', key]);
      if (result.code !== 0) return true;
      return !String(result.stdout).split(/\r?\n/).some((line) => line.trim() && !/^HKEY_/i.test(line.trim()));
    },
  };
}

// ---- Default app ------------------------------------------------------------

// The ProgID Windows opens `ext` with for this user, or null when none was
// chosen. Windows 11 (24H2 and later updates) records the choice in
// UserChoiceLatest\ProgId and follows it, leaving any older UserChoice
// behind, so that one comes first; earlier Windows only has UserChoice.
async function userChoiceProgId(reg, ext) {
  const base = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}`;
  const latest = await reg.read(`${base}\\UserChoiceLatest\\ProgId`, 'ProgId');
  if (latest && latest.trim()) return latest.trim();
  const legacy = await reg.read(`${base}\\UserChoice`, 'ProgId');
  return legacy && legacy.trim() ? legacy.trim() : null;
}

// ---- Outlook ---------------------------------------------------------------

// Level1Remove is a semicolon-separated list of extensions (".mdz;.exe");
// Outlook also accepts commas and leading-dot-less entries.
function extensionList(value) {
  return String(value ?? '')
    .split(/[;,]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`));
}

function hasExtension(value, ext) {
  return extensionList(value).includes(ext.toLowerCase());
}

// The value with `ext` added, keeping the other entries as written.
function withExtension(value, ext) {
  if (hasExtension(value, ext)) return String(value);
  const entries = String(value ?? '').split(/[;,]/).map((entry) => entry.trim()).filter(Boolean);
  return [...entries, ext].join(';');
}

// The value with `ext` removed ('' when nothing is left).
function withoutExtension(value, ext) {
  return String(value ?? '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && extensionList(entry)[0] !== ext.toLowerCase())
    .join(';');
}

const outlookSecurityKey = (version) => `HKCU\\Software\\Microsoft\\Office\\${version}\\Outlook\\Security`;
const outlookPolicyKey = (version) => `HKCU\\Software\\Policies\\Microsoft\\Office\\${version}\\Outlook\\Security`;

// Classic Outlook blocks .mdz attachments (Level 1). Adding .mdz to the user's
// Level1Remove lets them through as normal attachments after Outlook restarts.
// The new Outlook ignores this setting. An organization's policy value, when
// set, wins over the user's.
async function outlookStatus(reg) {
  let version = null;
  for (const candidate of OUTLOOK_VERSIONS) {
    if (await reg.keyExists(`HKCU\\Software\\Microsoft\\Office\\${candidate}\\Outlook`)) {
      version = candidate;
      break;
    }
  }
  if (!version) return { state: 'not-found' };
  const policy = await reg.read(outlookPolicyKey(version), 'Level1Remove');
  if (policy !== null) {
    return { state: hasExtension(policy, '.mdz') ? 'allowed' : 'managed', version, managed: true };
  }
  const value = await reg.read(outlookSecurityKey(version), 'Level1Remove');
  return { state: hasExtension(value, '.mdz') ? 'allowed' : 'blocked', version, managed: false };
}

async function setOutlookAllowed(reg, allow) {
  const status = await outlookStatus(reg);
  if (status.state === 'not-found') throw new Error('Classic Outlook was not found for this user.');
  if (status.managed) throw new Error('Your organization manages this Outlook setting.');
  const key = outlookSecurityKey(status.version);
  const current = (await reg.read(key, 'Level1Remove')) ?? '';
  const next = allow ? withExtension(current, '.mdz') : withoutExtension(current, '.mdz');
  if (next === current) return;
  if (next) {
    await reg.writeString(key, 'Level1Remove', next);
  } else {
    await reg.deleteValue(key, 'Level1Remove');
  }
}

// ---- Explorer preview handler ---------------------------------------------

// Whether Explorer can preview .mdz with Studio's handler. Only an all-users
// install registers it (preview handlers live under HKLM); a per-user install
// or the portable .exe can't. `fileExists(path)` and `listDir(path)` are sync.
async function previewHandlerStatus({ reg, isPortable, fileExists, listDir, programFiles }) {
  if (isPortable) return { state: 'portable' };
  const handler = await reg.read(`HKLM\\Software\\Classes\\.mdz\\ShellEx\\${PREVIEW_HANDLER_IID}`, null);
  if (!handler) return { state: 'not-installed' };
  if (handler.trim().toUpperCase() !== MDZ_PREVIEW_CLSID.toUpperCase()) {
    return { state: 'other', handler: handler.trim() };
  }
  const other = await otherPreviewHandler(reg);
  if (await previewOffForUser(reg)) return { state: 'off-for-user', other };
  const dll = await reg.read(`HKLM\\Software\\Classes\\CLSID\\${MDZ_PREVIEW_CLSID}\\InprocServer32`, null);
  if (!dll || !fileExists(dll.trim())) return { state: 'broken', reason: 'files' };
  const runtimeDir = path.join(programFiles || 'C:\\Program Files', 'dotnet', 'shared', PREVIEW_RUNTIME.name);
  let versions = [];
  try {
    versions = listDir(runtimeDir);
  } catch {
    versions = [];
  }
  if (!versions.some((version) => Number.parseInt(version, 10) === PREVIEW_RUNTIME.major)) {
    return { state: 'broken', reason: 'runtime' };
  }
  return { state: 'installed', other };
}

const isClsid = (value) => /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i.test(String(value ?? '').trim());

// Turning the preview off for one user: a blank per-user entry for the
// extension and for Studio's file type hides the machine-wide handler from
// that user only (HKCU\Software\Classes outranks HKLM; no admin rights). The
// file type and open command stay as they are, so .mdz still opens in Studio.
function previewOverrideKeys() {
  return [
    `HKCU\\Software\\Classes\\.mdz\\ShellEx\\${PREVIEW_HANDLER_IID}`,
    `HKCU\\Software\\Classes\\${MDZ_PROGID}\\ShellEx\\${PREVIEW_HANDLER_IID}`,
  ];
}

// Off when a per-user entry is there and names no handler. (A per-user entry
// naming a handler is another program's, not this switch.)
async function previewOffForUser(reg) {
  for (const key of previewOverrideKeys()) {
    if ((await reg.keyExists(key)) && !isClsid(await reg.read(key, null))) return true;
  }
  return false;
}

async function setPreviewForUser(reg, on) {
  for (const key of previewOverrideKeys()) {
    if (on) {
      await reg.deleteKey(key);
      // Remove the ShellEx and extension/file-type keys too when this left
      // them empty, so turning it back on leaves no trace.
      const shellEx = key.slice(0, key.lastIndexOf('\\'));
      const parent = shellEx.slice(0, shellEx.lastIndexOf('\\'));
      if (await reg.isEmptyKey(shellEx)) await reg.deleteKey(shellEx);
      if (await reg.isEmptyKey(parent)) await reg.deleteKey(parent);
    } else {
      await reg.writeString(key, null, '');
    }
  }
}

// Another program's .mdz preview handler, registered where Windows looks when
// the file type and extension name none (SystemFileAssociations): it shows
// when Studio's is turned off. { clsid, name } or null.
async function otherPreviewHandler(reg) {
  for (const root of ['HKCU\\Software\\Classes', 'HKLM\\Software\\Classes']) {
    const value = await reg.read(`${root}\\SystemFileAssociations\\.mdz\\shellex\\${PREVIEW_HANDLER_IID}`, null);
    if (isClsid(value) && value.trim().toUpperCase() !== MDZ_PREVIEW_CLSID.toUpperCase()) {
      const clsid = value.trim();
      const name = (await reg.read(`HKCU\\Software\\Classes\\CLSID\\${clsid}`, null))
        ?? (await reg.read(`HKLM\\Software\\Classes\\CLSID\\${clsid}`, null));
      return { clsid, name: name && name.trim() && !name.trim().startsWith('(') ? name.trim() : null };
    }
  }
  return null;
}

// ---- Helper programs ------------------------------------------------------

// Programs other Studio features can use when they're installed: Export
// (studio#41) and Import (studio#33). Each is checked with `<command> --version`.
// `install` maps a platform (or `all`) to a package manager and package;
// `latest` names where its newest release is published (GitHub releases, the
// npm registry or PyPI), when there's somewhere to ask. `size`: what installing
// it costs, shown on its card (measured 2026-11-23; round, as it changes).
const HELPER_PROGRAMS = Object.freeze([
  {
    id: 'pandoc',
    name: 'Pandoc',
    purpose: 'Converts documents to Word, EPUB, LaTeX and many other formats.',
    command: 'pandoc',
    install: { win32: { winget: 'JohnMacFarlane.Pandoc' }, darwin: { brew: 'pandoc' } },
    size: 'About 45 MB to download.',
    url: 'https://pandoc.org/installing.html',
    latest: { github: 'jgm/pandoc' },
  },
  {
    id: 'typst',
    name: 'Typst',
    purpose: 'Typesets PDFs from what Pandoc produces.',
    command: 'typst',
    install: { win32: { winget: 'Typst.Typst' }, darwin: { brew: 'typst' } },
    size: 'About 20 MB to download.',
    url: 'https://github.com/typst/typst#installation',
    latest: { github: 'typst/typst' },
  },
  {
    id: 'rsvg-convert',
    name: 'rsvg-convert',
    purpose: 'Turns SVG pictures into images Word documents can show.',
    command: 'rsvg-convert',
    install: { darwin: { brew: 'librsvg' } },
    url: 'https://gitlab.gnome.org/GNOME/librsvg',
  },
  {
    id: 'mmdc',
    name: 'Mermaid CLI',
    purpose: 'Draws Mermaid diagrams as pictures for exported files.',
    command: 'mmdc',
    install: { all: { npm: '@mermaid-js/mermaid-cli' } },
    // Puppeteer's Chrome and Chrome Headless Shell, 443 + 283 MB on Windows.
    size: 'Takes about 750 MB of disk space: it downloads two copies of Chrome to draw with.',
    uninstallNote: 'Its copies of Chrome (about 730 MB) stay, in %USERPROFILE%\\.cache\\puppeteer (~/.cache/puppeteer on a Mac). Delete that folder too, unless another program that uses Puppeteer needs it.',
    url: 'https://github.com/mermaid-js/mermaid-cli',
    latest: { npm: '@mermaid-js/mermaid-cli' },
  },
  {
    id: 'markitdown-mdz',
    name: 'markitdown-mdz',
    purpose: 'Imports Word, PowerPoint and PDF files as MDZip documents.',
    command: 'markitdown-mdz',
    // [all]: MarkItDown's readers for Word, PowerPoint, Excel and PDF, which
    // plain markitdown-mdzip leaves out.
    install: { all: { pip: 'markitdown-mdzip', extras: 'all' } },
    // 53 packages with [all]; speech recognition (32 MB) and onnxruntime the biggest.
    size: "About 115 MB to download, with MarkItDown's readers.",
    uninstallNote: "MarkItDown and its readers stay: other Python programs may use them.",
    url: 'https://pypi.org/project/markitdown-mdzip/',
    latest: { pypi: 'markitdown-mdzip' },
  },
  {
    id: 'mdz',
    name: 'mdz command line',
    purpose: 'Validates, creates and compares .mdz files from a terminal.',
    command: 'mdz',
    install: { win32: { winget: 'MDZip.Cli' } },
    size: 'About 7 MB to download.',
    url: 'https://github.com/mdzip-project/mdzip-cli/releases/latest',
    latest: { github: 'mdzip-project/mdzip-cli' },
  },
]);

// What installing a helper needs first, by how it installs: the program the
// install command starts, how to check it's there, and where to get it.
// `always`: the card names it even when it's there (Python and Node.js, which
// many don't have; winget comes with Windows, and Homebrew users know).
const REQUIREMENTS = Object.freeze({
  pip: { name: 'Python', always: true, command: { win32: 'py', other: 'python3' }, url: 'https://www.python.org/downloads/' },
  npm: { name: 'Node.js', always: true, command: { win32: 'npm', other: 'npm' }, url: 'https://nodejs.org/en/download' },
  winget: { name: 'winget', always: false, command: { win32: 'winget', other: 'winget' }, url: 'https://learn.microsoft.com/windows/package-manager/winget/' },
  brew: { name: 'Homebrew', always: false, command: { win32: 'brew', other: 'brew' }, url: 'https://brew.sh' },
});

// `helper`'s requirement on `platform`: { name, always, command, url }, or
// null when it doesn't install from a package manager here.
function requirementFor(helper, platform) {
  const spec = helper.install[platform] ?? helper.install.all;
  const kind = spec && Object.keys(REQUIREMENTS).find((key) => spec[key]);
  if (!kind) return null;
  const requirement = REQUIREMENTS[kind];
  return { name: requirement.name, always: requirement.always, command: requirement.command[platform] ?? requirement.command.other, url: requirement.url };
}

// Whether `helper`'s requirement is there: `run(command, ['--version'])` as
// for helperStatus. True when there's nothing to check.
async function requirementInstalled(helper, platform, run) {
  const requirement = requirementFor(helper, platform);
  if (!requirement) return true;
  try {
    return (await run(requirement.command, ['--version'])).code === 0;
  } catch {
    return false;
  }
}

// Installing MDZip Studio from its portable version (Windows). Both package
// managers install for all users with Windows Explorer integration: winget's
// machine scope (its manifest adds /allusers /mdzipExplorerIntegration and the
// .NET 10 Desktop Runtime), and the Chocolatey package by default.
const STUDIO_PACKAGES = Object.freeze({
  winget: {
    shown: 'winget install --id MDZip.Studio --exact --source winget --scope machine',
    // winget asks for administrator rights itself.
    run: 'winget install --id MDZip.Studio --exact --source winget --scope machine',
  },
  choco: {
    shown: 'choco install mdzip-studio -y',
    // Chocolatey needs an administrator terminal: ask for one (UAC) and wait,
    // so this window reports its exit code.
    run: 'powershell -NoProfile -Command "exit (Start-Process choco -ArgumentList \'install mdzip-studio -y\' -Verb RunAs -Wait -PassThru).ExitCode"',
  },
});

// Where the installer puts Studio: Program Files for all users,
// %LOCALAPPDATA%\Programs for one.
function studioInstallPaths({ programFiles, localAppData }) {
  return {
    machine: programFiles ? path.join(programFiles, 'MDZip Studio', 'MDZip Studio.exe') : null,
    user: localAppData ? path.join(localAppData, 'Programs', 'MDZip Studio', 'MDZip Studio.exe') : null,
  };
}

// Whether Studio is installed ('machine', 'user' or null) and, when it
// isn't, which package manager can install it (winget first: it comes with
// Windows and has the newest version) and the command it runs.
async function studioInstallStatus({ run, fileExists, programFiles, localAppData }) {
  const paths = studioInstallPaths({ programFiles, localAppData });
  const installed = paths.machine && fileExists(paths.machine) ? 'machine'
    : paths.user && fileExists(paths.user) ? 'user'
      : null;
  if (installed) return { installed, via: null, command: null };
  const has = async (command) => {
    try {
      return (await run(command, ['--version'])).code === 0;
    } catch {
      return false;
    }
  };
  const [winget, choco] = await Promise.all([has('winget'), has('choco')]);
  const via = winget ? 'winget' : choco ? 'choco' : null;
  return { installed, via, command: via ? STUDIO_PACKAGES[via].shown : null };
}

// What a terminal window runs for Install, Update or Uninstall: `command`,
// then its exit code written to `marker`, so Studio knows when it's done and
// can check the card again. The window stays open to read.
//
// Windows: cmd.exe's arguments after /v:on /k. `call` brings control back
// from a .cmd (npm is one); !errorlevel! is read after the command runs
// (%errorlevel% would be read when the line is), which /v:on allows; and the
// redirection comes first, so a code like 1 isn't read as "1>".
// macOS: a shell line for Terminal.
function terminalScript(command, title, platform, marker) {
  if (platform === 'win32') return `title ${title} && call ${command} & >"${marker}" echo !errorlevel!`;
  return `${command}; echo $? > '${marker}'`;
}

// The exit code a terminal script wrote ("0\r\n" -> 0); null if unreadable.
function parseExitCode(text) {
  const code = Number.parseInt(String(text ?? '').trim(), 10);
  return Number.isFinite(code) ? code : null;
}

// A pip package with its extras, quoted so zsh doesn't read the brackets as a
// file pattern: "markitdown-mdzip[all]".
function pipPackage(spec) {
  return spec.extras ? `"${spec.pip}[${spec.extras}]"` : spec.pip;
}

// The terminal command that installs `helper` on `platform`, or null when
// there's no package to install (the row links to the download page instead).
function installCommandFor(helper, platform) {
  const spec = helper.install[platform] ?? helper.install.all;
  if (!spec) return null;
  if (spec.winget) return `winget install --id ${spec.winget} --exact --source winget`;
  if (spec.brew) return `brew install ${spec.brew}`;
  if (spec.npm) return `npm install -g ${spec.npm}`;
  if (spec.pip) return platform === 'win32' ? `py -m pip install --user ${pipPackage(spec)}` : `python3 -m pip install --user ${pipPackage(spec)}`;
  return null;
}

// The terminal command that updates `helper` to its newest release on `platform`.
function upgradeCommandFor(helper, platform) {
  const spec = helper.install[platform] ?? helper.install.all;
  if (!spec) return null;
  if (spec.winget) return `winget upgrade --id ${spec.winget} --exact --source winget`;
  if (spec.brew) return `brew upgrade ${spec.brew}`;
  if (spec.npm) return `npm install -g ${spec.npm}@latest`;
  if (spec.pip) return platform === 'win32' ? `py -m pip install --user --upgrade ${pipPackage(spec)}` : `python3 -m pip install --user --upgrade ${pipPackage(spec)}`;
  return null;
}

// The terminal command that removes `helper` on `platform`. pip's own
// "Proceed?" is answered (-y): Studio asks first. Only the program itself:
// what it brought along stays (see `uninstallNote`).
function uninstallCommandFor(helper, platform) {
  const spec = helper.install[platform] ?? helper.install.all;
  if (!spec) return null;
  if (spec.winget) return `winget uninstall --id ${spec.winget} --exact --source winget`;
  if (spec.brew) return `brew uninstall ${spec.brew}`;
  if (spec.npm) return `npm uninstall -g ${spec.npm}`;
  if (spec.pip) return platform === 'win32' ? `py -m pip uninstall -y ${spec.pip}` : `python3 -m pip uninstall -y ${spec.pip}`;
  return null;
}

// Where `helper`'s newest version is published, as a JSON URL, or null.
function latestVersionUrl(helper) {
  const latest = helper.latest;
  if (!latest) return null;
  if (latest.github) return `https://api.github.com/repos/${latest.github}/releases/latest`;
  if (latest.npm) return `https://registry.npmjs.org/${latest.npm.replace('/', '%2F')}/latest`;
  if (latest.pypi) return `https://pypi.org/pypi/${encodeURIComponent(latest.pypi)}/json`;
  return null;
}

// The version number in that JSON: a GitHub release's tag ("v0.15.1", "3.14"),
// the npm package's version, or PyPI's info.version.
function latestVersionFrom(helper, json) {
  const latest = helper.latest ?? {};
  const raw = latest.github ? json?.tag_name : latest.npm ? json?.version : latest.pypi ? json?.info?.version : null;
  return typeof raw === 'string' ? parseVersion(raw) : null;
}

// Asks `helper`'s publisher for its newest version: `fetchJson(url)` resolves
// to the parsed JSON. Null when there's nowhere to ask, or the answer didn't
// come (offline, rate-limited, a changed format): the row then just doesn't
// say whether it's the latest.
async function latestVersion(helper, fetchJson) {
  const url = latestVersionUrl(helper);
  if (!url) return null;
  try {
    return latestVersionFrom(helper, await fetchJson(url));
  } catch {
    return null;
  }
}

// Compares dotted version numbers ("3.6.4" vs "3.14"): negative, 0 or positive.
// Missing parts count as 0, so "3.14" equals "3.14.0".
function compareVersions(a, b) {
  const left = String(a ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// "pandoc 3.1.9", "typst 0.12.0 (abc)", "rsvg-convert version 2.58.0", "11.4.2" → the first version number.
function parseVersion(text) {
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(String(text ?? ''));
  return match ? match[1] : null;
}

// The kinds of file a program says it can't read for want of a package:
// markitdown-mdz 0.1.1 and later end --version with "Missing readers: docx,
// pptx (...)" when MarkItDown was installed without its extras. [] when it
// doesn't say (all there, or an older version that doesn't check).
function parseMissingReaders(text) {
  const match = /^Missing readers: ([a-z0-9]+(?:, *[a-z0-9]+)*)/im.exec(String(text ?? ''));
  return match ? match[1].split(',').map((kind) => kind.trim().toLowerCase()).filter(Boolean) : [];
}

// `run(command, ['--version'])` resolves to { code, stdout, stderr } (code
// null/negative when the program isn't there).
async function helperStatus(helper, run) {
  try {
    const result = await run(helper.command, ['--version']);
    if (result.code !== 0) return { id: helper.id, installed: false, version: null, missingReaders: [] };
    const text = `${result.stdout}\n${result.stderr ?? ''}`;
    return { id: helper.id, installed: true, version: parseVersion(text), missingReaders: parseMissingReaders(text) };
  } catch {
    return { id: helper.id, installed: false, version: null, missingReaders: [] };
  }
}

// PATH as a newly started program would see it. Studio's own PATH was fixed
// when it started, so a program installed since (winget, npm -g) wouldn't be
// found with it. Windows: the machine and user Path values from the registry,
// with %VARIABLES% expanded. macOS: GUI apps get a minimal PATH, so add
// Homebrew's and the user's usual bin folders.
//
// Everywhere: the folders `pip install --user` puts programs in
// (markitdown-mdz), which pip doesn't add to PATH; it only warns, in a
// terminal window that has usually closed. One per Python version, newest
// first; `listDir(folder)` names a folder's entries ([] when it's missing).
async function freshPath({ platform, reg, env, listDir = listDirectory }) {
  const current = env.PATH ?? env.Path ?? '';
  if (platform === 'win32') {
    const machine = await reg.read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path');
    const user = await reg.read('HKCU\\Environment', 'Path');
    const expand = (value) => String(value ?? '').replace(/%([^%]+)%/g, (whole, name) => {
      const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
      return key ? env[key] : whole;
    });
    return uniquePathList([expand(machine), expand(user), current, ...pipUserFolders(platform, env, listDir)], ';');
  }
  if (platform === 'darwin') {
    const home = env.HOME ?? '';
    return uniquePathList([
      current,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      home ? `${home}/.local/bin` : '',
      ...pipUserFolders(platform, env, listDir),
    ], ':');
  }
  return uniquePathList([current, ...pipUserFolders(platform, env, listDir)], ':');
}

// Where `pip install --user` puts programs: Windows
// %APPDATA%\Python\Python314\Scripts, macOS ~/Library/Python/3.14/bin
// (one per Python version that has any, newest first), Linux ~/.local/bin.
function pipUserFolders(platform, env, listDir) {
  const newestFirst = (names, pattern) => names
    .map((name) => ({ name, version: pattern.exec(name) }))
    .filter((entry) => entry.version)
    .sort((a, b) => Number(b.version[2]) - Number(a.version[2]) || Number(b.version[1]) - Number(a.version[1]))
    .map((entry) => entry.name);
  if (platform === 'win32') {
    const appData = env.APPDATA;
    if (!appData) return [];
    const base = path.win32.join(appData, 'Python');
    return newestFirst(listDir(base), /^Python(\d)(\d+)$/i).map((name) => path.win32.join(base, name, 'Scripts'));
  }
  const home = env.HOME;
  if (!home) return [];
  if (platform === 'darwin') {
    const base = `${home}/Library/Python`;
    return newestFirst(listDir(base), /^(\d+)\.(\d+)$/).map((name) => `${base}/${name}/bin`);
  }
  return [`${home}/.local/bin`];
}

function listDirectory(folder) {
  try {
    return fs.readdirSync(folder);
  } catch {
    return [];
  }
}

function uniquePathList(parts, separator) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    for (const entry of String(part ?? '').split(separator)) {
      const trimmed = entry.trim();
      const key = separator === ';' ? trimmed.toLowerCase() : trimmed;
      if (trimmed && !seen.has(key)) {
        seen.add(key);
        out.push(trimmed);
      }
    }
  }
  return out.join(separator);
}

module.exports = {
  HELPER_PROGRAMS,
  MDZ_PREVIEW_CLSID,
  PREVIEW_HANDLER_IID,
  compareVersions,
  createRegistry,
  extensionList,
  freshPath,
  helperStatus,
  parseMissingReaders,
  requirementFor,
  requirementInstalled,
  installCommandFor,
  latestVersion,
  latestVersionUrl,
  outlookStatus,
  parseRegValues,
  parseVersion,
  previewHandlerStatus,
  previewOverrideKeys,
  setPreviewForUser,
  setOutlookAllowed,
  STUDIO_PACKAGES,
  studioInstallPaths,
  studioInstallStatus,
  upgradeCommandFor,
  uninstallCommandFor,
  terminalScript,
  parseExitCode,
  userChoiceProgId,
  withExtension,
  withoutExtension,
};
