import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AllowedMedia,
  isTrustedFolder,
  isTrustedOutsideFile,
  mediaResponse,
  outsideVideoFile,
  parseRange,
  toggleTrustedFolder,
} from './outside-media';

const folder = mkdtempSync(path.join(tmpdir(), 'mdzip-media-'));
const mdz = path.join(folder, 'films', 'family.mdz');
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('outsideVideoFile', () => {
  it('resolves a relative path from the folder that holds the .mdz', () => {
    expect(outsideVideoFile(mdz, 'reel.mp4')).toBe(path.join(folder, 'films', 'reel.mp4'));
    expect(outsideVideoFile(mdz, '../videos/reel one.webm')).toBe(path.join(folder, 'videos', 'reel one.webm'));
  });

  it('takes only video files, by relative path, for a .mdz', () => {
    expect(outsideVideoFile(mdz, 'notes.txt')).toBeNull();
    expect(outsideVideoFile(mdz, '../app.exe')).toBeNull();
    expect(outsideVideoFile(mdz, path.join(folder, 'reel.mp4'))).toBeNull();
    expect(outsideVideoFile(mdz, '/reel.mp4')).toBeNull();
    expect(outsideVideoFile(mdz, 'file:///C:/reel.mp4')).toBeNull();
    expect(outsideVideoFile(mdz, '')).toBeNull();
    expect(outsideVideoFile(path.join(folder, 'notes.md'), 'reel.mp4')).toBeNull();
    expect(outsideVideoFile(null, 'reel.mp4')).toBeNull();
  });
});

describe('trusted folders', () => {
  const films = path.join(folder, 'films');

  it('trusts a folder and the folders inside it', () => {
    expect(isTrustedFolder([films], films)).toBe(true);
    expect(isTrustedFolder([folder], films)).toBe(true);
    expect(isTrustedFolder([films], folder)).toBe(false);
    expect(isTrustedFolder([path.join(folder, 'film')], films)).toBe(false, 'a name that starts the same is another folder');
    expect(isTrustedFolder([], films)).toBe(false);
    expect(isTrustedFolder(undefined, films)).toBe(false);
  });

  it('loads a file without a click only in the .mdz\'s folder or below it', () => {
    expect(isTrustedOutsideFile([films], mdz, path.join(films, 'reel.mp4'))).toBe(true);
    expect(isTrustedOutsideFile([films], mdz, path.join(films, 'reels', 'one.mp4'))).toBe(true);
    expect(isTrustedOutsideFile([folder], mdz, path.join(folder, 'other', 'reel.mp4'))).toBe(false, 'above the .mdz\'s folder');
    expect(isTrustedOutsideFile([], mdz, path.join(films, 'reel.mp4'))).toBe(false);
  });

  it('toggles: adds a folder, and removes it with any trusted folder it is inside', () => {
    expect(toggleTrustedFolder([], films)).toEqual([films]);
    expect(toggleTrustedFolder([path.join(films, 'a')], films)).toEqual([films], 'replaces folders inside it');
    expect(toggleTrustedFolder([films, path.join(folder, 'other')], films)).toEqual([path.join(folder, 'other')]);
    expect(toggleTrustedFolder([folder], films)).toEqual([]);
  });
});

describe('parseRange', () => {
  it('reads one byte range', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-9, 20-29', 100)).toEqual({ start: 0, end: 9 });
  });

  it('refuses ranges past the end', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=20-10', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});

describe('mediaResponse', () => {
  const file = path.join(folder, 'clip.mp4');
  writeFileSync(file, Buffer.from('0123456789'));

  it('serves the whole file, saying it takes ranges', async () => {
    const response = await mediaResponse(file);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await response.text()).toBe('0123456789');
  });

  it('serves a range as 206', async () => {
    const response = await mediaResponse(file, 'bytes=2-5');
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(await response.text()).toBe('2345');
  });

  it('answers 416 and 404', async () => {
    expect((await mediaResponse(file, 'bytes=50-')).status).toBe(416);
    expect((await mediaResponse(path.join(folder, 'gone.mp4'))).status).toBe(404);
  });
});

describe('AllowedMedia', () => {
  it('gives an unguessable URL per file and window, forgotten with the window', () => {
    const allowed = new AllowedMedia();
    const file = path.join(folder, 'reel one.mp4');
    const url = allowed.allow(1, file);
    expect(url).toMatch(/^mdzip-media:\/\/video\/[0-9a-f]{32}\/reel%20one\.mp4$/);
    expect(allowed.allow(1, file)).toBe(url);
    expect(allowed.allow(2, file)).not.toBe(url);
    expect(allowed.fileFor(url)).toBe(file);
    expect(allowed.fileFor('mdzip-media://video/0123/reel.mp4')).toBeNull();
    expect(allowed.fileFor('not a url')).toBeNull();
    allowed.forget(1);
    expect(allowed.fileFor(url)).toBeNull();
  });
});
