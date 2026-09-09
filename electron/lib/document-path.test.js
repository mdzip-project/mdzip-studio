const path = require('path');
const { documentPathFromArgs } = require('./document-path');

describe('documentPathFromArgs', () => {
  it('finds an .mdz argument and resolves it to an absolute path', () => {
    expect(documentPathFromArgs(['electron.exe', 'notes.mdz'])).toBe(path.resolve('notes.mdz'));
  });

  it('finds an .md argument', () => {
    expect(documentPathFromArgs(['electron.exe', 'notes.md'])).toBe(path.resolve('notes.md'));
  });

  it('is case-insensitive on the extension', () => {
    expect(documentPathFromArgs(['NOTES.MDZ'])).toBe(path.resolve('NOTES.MDZ'));
  });

  it('ignores flags even if they end in .md-like text', () => {
    expect(documentPathFromArgs(['--flag.md', 'notes.mdz'])).toBe(path.resolve('notes.mdz'));
  });

  it('converts a file:// URI argument to a path (Linux .desktop %U)', () => {
    expect(documentPathFromArgs(['mdzip-studio', 'file:///home/kyle/My%20Notes.mdz']))
      .toBe('/home/kyle/My Notes.mdz');
  });

  it('converts a Windows drive-letter file:// URI to a backslash path', () => {
    expect(documentPathFromArgs(['mdzip-studio', 'file:///C:/Users/kyle/My%20Notes.mdz']))
      .toBe('C:\\Users\\kyle\\My Notes.mdz');
  });

  it('returns null when no candidate is present', () => {
    expect(documentPathFromArgs(['electron.exe', '--dev'])).toBeNull();
  });

  it('returns null for an empty argv', () => {
    expect(documentPathFromArgs([])).toBeNull();
  });

  it('ignores non-string entries', () => {
    expect(documentPathFromArgs([42, null, undefined, 'notes.md'])).toBe(path.resolve('notes.md'));
  });
});
