const fs = require('fs');
const os = require('os');
const path = require('path');
const { createExternalEdits, isFileExtension, parseAssocOutput, openWithCommand, openVerbFor, isRunnable } = require('./external-edit');

const bytes = (text) => new Uint8Array(Buffer.from(text));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A watch the test fires by hand: { dir, fire(name), closed }.
function fakeWatch() {
  const watchers = [];
  const watch = (dir, listener) => {
    const watcher = { dir, closed: false, fire: (name) => listener('change', name), close() { this.closed = true; }, on() {} };
    watchers.push(watcher);
    return watcher;
  };
  return { watch, watchers };
}

describe('createExternalEdits', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdzip-edit-test-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function setup() {
    const changes = [];
    const { watch, watchers } = fakeWatch();
    const edits = createExternalEdits({
      root, watch, debounceMs: 10, retryMs: 5, retries: 3,
      onChange: (owner, change) => changes.push({ owner, ...change, text: Buffer.from(change.bytes).toString() }),
    });
    return { edits, changes, watchers };
  }

  it("writes the copy under the window's folder and sends the bytes back when the app saves", async () => {
    const { edits, changes, watchers } = setup();
    const { filePath, reused } = await edits.start(7, { token: 'abc', path: 'styles/reference.docx', bytes: bytes('v1') });
    expect(reused).toBe(false);
    expect(filePath).toBe(path.join(root, '7-abc', 'styles', 'reference.docx'));
    expect(fs.readFileSync(filePath, 'utf8')).toBe('v1');
    expect(watchers[0].dir).toBe(path.dirname(filePath));

    // Word's save: a temp file first (ignored), then ours.
    watchers[0].fire('~WRL0001.tmp');
    fs.writeFileSync(filePath, 'v2');
    watchers[0].fire('reference.docx');
    watchers[0].fire('reference.docx');
    await wait(60);
    expect(changes).toEqual([{ owner: 7, token: 'abc', path: 'styles/reference.docx', bytes: expect.anything(), text: 'v2' }]);

    // A touch that doesn't change the bytes sends nothing.
    watchers[0].fire('reference.docx');
    await wait(40);
    expect(changes).toHaveLength(1);
  });

  it('waits out a file that is briefly gone mid-save', async () => {
    const { edits, changes, watchers } = setup();
    const { filePath } = await edits.start(1, { token: 't', path: 'a.docx', bytes: bytes('one') });
    fs.rmSync(filePath);
    watchers[0].fire('a.docx');
    await wait(15);
    fs.writeFileSync(filePath, 'two');
    await wait(60);
    expect(changes.map((change) => change.text)).toEqual(['two']);
  });

  it('opening it again reuses the copy, refreshing it only when nothing unsent is in it', async () => {
    const { edits, changes, watchers } = setup();
    const { filePath } = await edits.start(1, { token: 't', path: 'a.docx', bytes: bytes('one') });
    // The document's copy changed (Replace…): the file out is refreshed.
    const again = await edits.start(1, { token: 't', path: 'a.docx', bytes: bytes('replaced') });
    expect(again).toEqual({ filePath, reused: true });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('replaced');
    expect(watchers).toHaveLength(1);

    // The app saved something not yet sent: left alone.
    fs.writeFileSync(filePath, 'edited');
    await edits.start(1, { token: 't', path: 'a.docx', bytes: bytes('other') });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('edited');
    watchers[0].fire('a.docx');
    await wait(40);
    expect(changes.map((change) => change.text)).toEqual(['edited']);
  });

  it("without watchChanges (a read-only document) nothing comes back", async () => {
    const { edits, watchers } = setup();
    await edits.start(1, { token: 't', path: 'a.docx', bytes: bytes('one'), watchChanges: false });
    expect(watchers).toHaveLength(0);
  });

  it("another document in the window, or stop(), ends the watches and removes the folder", async () => {
    const { edits, changes, watchers } = setup();
    const first = await edits.start(1, { token: 'doc1', path: 'a.docx', bytes: bytes('one') });
    await edits.start(1, { token: 'doc2', path: 'b.docx', bytes: bytes('two') });
    expect(watchers[0].closed).toBe(true);
    expect(fs.existsSync(path.dirname(first.filePath))).toBe(false);
    expect(edits.pathsOf(1)).toEqual(['b.docx']);

    await edits.stop(1);
    expect(watchers[1].closed).toBe(true);
    expect(fs.existsSync(path.join(root, '1-doc2'))).toBe(false);
    watchers[1].fire('b.docx');
    await wait(30);
    expect(changes).toEqual([]);
  });

  it('refuses paths outside its folder and odd tokens', async () => {
    const { edits } = setup();
    await expect(edits.start(1, { token: 't', path: '../evil.docx', bytes: bytes('x') })).rejects.toThrow(/invalid archive path/i);
    await expect(edits.start(1, { token: '../x', path: 'a.docx', bytes: bytes('x') })).rejects.toThrow(/token/);
  });
});

describe('how a file opens', () => {
  it('a template opens for editing (Open), not as a new document from it (its default, New)', () => {
    expect(openVerbFor('C:\\t\\styles\\company.dotx')).toBe('open');
    expect(openVerbFor('/t/Budget.XLTX')).toBe('open');
    expect(openVerbFor('C:\\t\\styles\\reference.docx')).toBeNull();
    expect(openVerbFor('C:\\t\\notes')).toBeNull();
  });

  it('files that run instead of open are refused', () => {
    expect(isRunnable('tools/setup.EXE')).toBe(true);
    expect(isRunnable('scripts/build.ps1')).toBe(true);
    expect(isRunnable('a.bat')).toBe(true);
    expect(isRunnable('styles/reference.docx')).toBe(false);
    expect(isRunnable('diagrams/flow.drawio')).toBe(false);
  });
});

describe('app names', () => {
  it('takes extensions only', () => {
    expect(isFileExtension('.docx')).toBe(true);
    expect(isFileExtension('.drawio')).toBe(true);
    expect(isFileExtension('docx')).toBe(false);
    expect(isFileExtension('.docx"; calc')).toBe(false);
  });

  it("reads Windows' answer; Pick an app means none", () => {
    expect(parseAssocOutput('0\tWord\t0\tC:\\Program Files\\Microsoft Office\\Root\\Office16\\WINWORD.EXE')).toBe('Word');
    expect(parseAssocOutput('0\tNanaZip\t2147943555\t')).toBe('NanaZip');
    expect(parseAssocOutput('0\tPick an app\t0\tC:\\WINDOWS\\system32\\OpenWith.exe')).toBeNull();
    expect(parseAssocOutput('2147943555\t\t2147943555\t')).toBeNull();
  });

  it("Open With… is Windows' own picker there, and the caller's choice elsewhere", () => {
    expect(openWithCommand('win32', 'C:\\t\\a.docx')).toEqual({ command: 'rundll32.exe', args: ['shell32.dll,OpenAs_RunDLL', 'C:\\t\\a.docx'] });
    expect(openWithCommand('darwin', '/t/a.docx')).toBeNull();
  });
});
