// Open in <app> / Open With… for a file inside a document (#29): the file is
// copied to a folder of its own under the temp folder, opened there, and each
// time the app saves it the new bytes go back to the window that opened it.
//
// One folder per window and document: <root>/<owner>-<token>/<archive path>.
// The window's document changing (another opened, or closed) or the window
// closing stops the watches and removes the folder; Studio sweeps <root> at
// start for anything left behind (an app still had a file open).
const crypto = require('crypto');
const fs = require('fs/promises');
const { watch: watchFs } = require('fs');
const path = require('path');
const { resolveInsideFolder } = require('./extract-files');

const hashOf = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const RETRY_CODES = new Set(['ENOENT', 'EBUSY', 'EPERM', 'EACCES']);

function safeToken(token) {
  const text = String(token ?? '');
  if (!/^[A-Za-z0-9-]{1,64}$/.test(text)) throw new Error(`Invalid edit token: "${token}".`);
  return text;
}

/**
 * @param {object} options
 * @param {string} options.root  Folder that holds every window's copies.
 * @param {(owner: number, change: { token: string, path: string, bytes: Buffer }) => void} options.onChange
 * @param {typeof watchFs} [options.watch]
 * @param {number} [options.debounceMs]  Apps save in steps (write a temp file, rename): wait for quiet.
 * @param {number} [options.retryMs]
 * @param {number} [options.retries]  Reads while the app still has the file locked or mid-rename.
 */
function createExternalEdits({ root, onChange, watch = watchFs, debounceMs = 500, retryMs = 250, retries = 8 }) {
  /** owner → { token, folder, files: Map<path, { filePath, hash, watcher, timer, watchChanges }> } */
  const sessions = new Map();

  async function readSettled(filePath) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fs.readFile(filePath);
      } catch (error) {
        if (attempt >= retries || !RETRY_CODES.has(error?.code)) return null;
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
  }

  async function check(owner, session, archivePath, file) {
    if (sessions.get(owner) !== session || session.files.get(archivePath) !== file) return;
    const bytes = await readSettled(file.filePath);
    if (!bytes || sessions.get(owner) !== session) return;
    const hash = hashOf(bytes);
    if (hash === file.hash) return;
    file.hash = hash;
    onChange(owner, { token: session.token, path: archivePath, bytes });
  }

  function startWatching(owner, session, archivePath, file) {
    const name = path.basename(file.filePath);
    file.watcher = watch(path.dirname(file.filePath), (_event, changed) => {
      // Word and others save as "write ~WRL0001.tmp, rename over": only our
      // file's name matters (some platforms don't say which file changed).
      if (changed && String(changed) !== name) return;
      clearTimeout(file.timer);
      file.timer = setTimeout(() => void check(owner, session, archivePath, file), debounceMs);
    });
    file.watcher.on?.('error', () => {});
  }

  async function stop(owner) {
    const session = sessions.get(owner);
    if (!session) return;
    sessions.delete(owner);
    for (const file of session.files.values()) {
      clearTimeout(file.timer);
      try { file.watcher?.close(); } catch { /* already closed */ }
    }
    // An app may still have a file open (Windows won't delete it); the sweep at
    // the next start gets it.
    await fs.rm(session.folder, { recursive: true, force: true }).catch(() => {});
  }

  return {
    /**
     * Writes the file's copy (or reuses the one already out for this
     * document) and starts watching it. Returns the copy's path to open.
     */
    async start(owner, { token, path: archivePath, bytes, watchChanges = true }) {
      const cleanToken = safeToken(token);
      let session = sessions.get(owner);
      if (session && session.token !== cleanToken) {
        await stop(owner);
        session = undefined;
      }
      if (!session) {
        session = { token: cleanToken, folder: path.join(root, `${owner}-${cleanToken}`), files: new Map() };
        sessions.set(owner, session);
      }
      const filePath = resolveInsideFolder(session.folder, archivePath);
      const data = Buffer.from(bytes ?? []);
      const hash = hashOf(data);
      const existing = session.files.get(archivePath);
      if (existing) {
        // Out already: refresh the copy only when nothing unsent is in it
        // (it still holds what the document last had) and the document's
        // version has changed since, e.g. by Replace….
        if (existing.hash !== hash) {
          const onDisk = await fs.readFile(filePath).catch(() => null);
          if (onDisk && hashOf(onDisk) === existing.hash) {
            existing.hash = hash;
            await fs.writeFile(filePath, data).catch(() => { existing.hash = hashOf(onDisk); });
          }
        }
        if (watchChanges && !existing.watcher) startWatching(owner, session, archivePath, existing);
        return { filePath, reused: true };
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, data);
      const file = { filePath, hash, watcher: null, timer: null };
      session.files.set(archivePath, file);
      if (watchChanges) startWatching(owner, session, archivePath, file);
      return { filePath, reused: false };
    },

    stop,

    async stopAll() {
      await Promise.all([...sessions.keys()].map((owner) => stop(owner)));
    },

    /** Removes everything under root: what an earlier run left behind. */
    async sweep() {
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    },

    /** The archive paths this owner has out, for tests and diagnostics. */
    pathsOf(owner) {
      return [...(sessions.get(owner)?.files.keys() ?? [])];
    },
  };
}

// The name Windows shows for the app that opens files with this extension
// ("Word", "draw.io"), from AssocQueryString — the same association
// shell.openPath uses. The extension comes in through the environment, never
// the command line.
const ASSOC_SCRIPT = [
  '$sig = \'[DllImport("Shlwapi.dll", CharSet = CharSet.Unicode)] public static extern uint AssocQueryString(uint flags, uint str, string pszAssoc, string pszExtra, System.Text.StringBuilder pszOut, ref uint pcchOut);\'',
  'Add-Type -MemberDefinition $sig -Namespace MdzipStudio -Name Assoc',
  '$name = New-Object System.Text.StringBuilder 512; [uint32]$n = 512',
  '$exe = New-Object System.Text.StringBuilder 1024; [uint32]$m = 1024',
  '$r1 = [MdzipStudio.Assoc]::AssocQueryString(0, 4, $env:MDZ_EXT, "open", $name, [ref]$n)',
  '$r2 = [MdzipStudio.Assoc]::AssocQueryString(0, 2, $env:MDZ_EXT, "open", $exe, [ref]$m)',
  '[Console]::Out.Write("$r1`t$($name.ToString())`t$r2`t$($exe.ToString())")',
].join('\n');

// Opens a file the way double-clicking it does, waiting until the app has it.
// Not shell.openPath: Word (and other Office apps) take the file over DDE,
// which needs the asking thread to wait and pump messages; Electron's
// openPath asks from a worker thread that doesn't, so Word started and quit.
// .NET's Process.Start with UseShellExecute waits (SEE_MASK_FLAG_DDEWAIT).
// The path (and verb, if any) come in through the environment; a failure is
// written out.
const SHELL_OPEN_SCRIPT = [
  'try {',
  '  $info = New-Object System.Diagnostics.ProcessStartInfo $env:MDZ_OPEN_PATH',
  '  $info.UseShellExecute = $true',
  '  if ($env:MDZ_OPEN_VERB) { $info.Verb = $env:MDZ_OPEN_VERB }',
  '  [void][System.Diagnostics.Process]::Start($info)',
  '} catch {',
  '  $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }',
  '  [Console]::Out.Write($e.Message); exit 1',
  '}',
].join('\n');

// Office templates open as a new document based on them (their default verb
// is New), so a save would never come back: ask for Open, which edits the
// template itself, as "Open" on its right-click menu in Explorer does.
const TEMPLATE_EXTENSIONS = new Set(['.dotx', '.dotm', '.dot', '.xltx', '.xltm', '.xlt', '.potx', '.potm', '.pot']);

function openVerbFor(filePath) {
  const match = /\.[^.\\/]+$/.exec(String(filePath ?? ''));
  return match && TEMPLATE_EXTENSIONS.has(match[0].toLowerCase()) ? 'open' : null;
}

// Files that run rather than open: Studio won't start one from a document.
const RUNNABLE_EXTENSIONS = new Set([
  '.exe', '.com', '.scr', '.pif', '.msi', '.msp', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.hta', '.cpl', '.lnk', '.url', '.reg', '.jar', '.appref-ms',
  '.sh', '.command', '.app', '.desktop',
]);

function isRunnable(filePath) {
  const match = /\.[^.\\/]+$/.exec(String(filePath ?? ''));
  return !!match && RUNNABLE_EXTENSIONS.has(match[0].toLowerCase());
}

function isFileExtension(ext) {
  return /^\.[A-Za-z0-9_+-]{1,16}$/.test(String(ext ?? ''));
}

/**
 * The app name from the script's output, or null when nothing is registered
 * (Windows offers "Pick an app", which runs OpenWith.exe).
 */
function parseAssocOutput(output) {
  const [nameResult, name, exeResult, exe] = String(output ?? '').trim().split('\t');
  if (nameResult !== '0' || !name) return null;
  if (exeResult === '0' && /(^|[\\/])openwith\.exe$/i.test(exe ?? '')) return null;
  return name.trim() || null;
}

/** Windows' Open With picker for a file; null elsewhere (the caller asks for an app). */
function openWithCommand(platform, filePath) {
  if (platform !== 'win32') return null;
  return { command: 'rundll32.exe', args: ['shell32.dll,OpenAs_RunDLL', filePath] };
}

module.exports = {
  createExternalEdits,
  ASSOC_SCRIPT,
  SHELL_OPEN_SCRIPT,
  openVerbFor,
  isRunnable,
  isFileExtension,
  parseAssocOutput,
  openWithCommand,
};
