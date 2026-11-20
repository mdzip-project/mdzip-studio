import { describe, expect, it } from 'vitest';
import { readerSnapshot, shouldCloseLeftoverReaders } from './reader-window';

describe('readerSnapshot', () => {
  it('takes the bytes, file name and title an editing window sends', () => {
    const snapshot = readerSnapshot({ bytes: new Uint8Array([80, 75, 3, 4]), fileName: 'Report.mdz', title: '  Quarterly Report ' });
    expect(snapshot).toMatchObject({ fileName: 'Report.mdz', title: 'Quarterly Report' });
    expect(Array.from(snapshot.bytes)).toEqual([80, 75, 3, 4]);
  });

  it('names it after the file when there is no title', () => {
    expect(readerSnapshot({ bytes: new Uint8Array([35]), fileName: 'notes.md' }).title).toBe('notes');
    // A new, empty .md document.
    expect(readerSnapshot({ bytes: new Uint8Array(), fileName: 'untitled.md' })).toMatchObject({ fileName: 'untitled.md' });
  });

  it('turns down anything else', () => {
    expect(readerSnapshot(null)).toBeNull();
    expect(readerSnapshot({ bytes: new Uint8Array(), fileName: 'a.mdz' })).toBeNull();
    expect(readerSnapshot({ bytes: 'text', fileName: 'a.mdz' })).toBeNull();
    expect(readerSnapshot({ bytes: new Uint8Array([1]), fileName: '../a.mdz' })).toBeNull();
    expect(readerSnapshot({ bytes: new Uint8Array([1]), fileName: 'a.exe' })).toBeNull();
  });
});

describe('shouldCloseLeftoverReaders', () => {
  it('closes help and reader windows left after the last Studio window closes', () => {
    expect(shouldCloseLeftoverReaders([{ help: true }, { reader: true }], 'win32')).toBe(true);
    expect(shouldCloseLeftoverReaders([{ help: true }], 'linux')).toBe(true);
  });

  it('leaves them while a Studio window is open, and on macOS', () => {
    expect(shouldCloseLeftoverReaders([{ help: true }, {}], 'win32')).toBe(false);
    expect(shouldCloseLeftoverReaders([], 'win32')).toBe(false);
    expect(shouldCloseLeftoverReaders([{ reader: true }], 'darwin')).toBe(false);
  });
});
