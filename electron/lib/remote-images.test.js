const fs = require('fs');
const os = require('os');
const path = require('path');
const { allowImageRequest, loadSettings, saveSettings } = require('./remote-images');

describe('allowImageRequest', () => {
  it('loads https images only while remote images are on', () => {
    expect(allowImageRequest('https://example.com/logo.png', { remoteImages: true })).toBe(true);
    expect(allowImageRequest('https://example.com/logo.png', { remoteImages: false })).toBe(false);
  });

  it('never loads plain http images (spec §9.2)', () => {
    expect(allowImageRequest('http://example.com/logo.png', { remoteImages: true })).toBe(false);
  });

  it("always allows the app's own origin, so the dev server keeps working", () => {
    const appOrigin = 'http://localhost:4300';
    expect(allowImageRequest('http://localhost:4300/assets/icon.png', { remoteImages: false, appOrigin })).toBe(true);
    expect(allowImageRequest('http://localhost:9999/x.png', { remoteImages: true, appOrigin })).toBe(false);
  });

  it('leaves local schemes alone and refuses unparseable URLs', () => {
    expect(allowImageRequest('file:///C:/app/icon.png', { remoteImages: false })).toBe(true);
    expect(allowImageRequest('data:image/png;base64,AAAA', { remoteImages: false })).toBe(true);
    expect(allowImageRequest('not a url', { remoteImages: true })).toBe(false);
  });
});

describe('settings file', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-settings-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to remote images on when there is no file', () => {
    expect(loadSettings(path.join(dir, 'missing.json'))).toEqual({ remoteImages: true });
  });

  it('round-trips and keeps unknown keys', () => {
    const file = path.join(dir, 'settings.json');
    saveSettings(file, { remoteImages: false, theme: 'dark' });
    expect(loadSettings(file)).toEqual({ remoteImages: false, theme: 'dark' });
  });

  it('ignores a corrupt file or a wrong type', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{ nope');
    expect(loadSettings(file)).toEqual({ remoteImages: true });
    fs.writeFileSync(file, '{"remoteImages": "no"}');
    expect(loadSettings(file).remoteImages).toBe(true);
  });
});
