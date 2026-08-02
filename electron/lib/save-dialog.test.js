const { saveDialogFilters } = require('./save-dialog');

describe('saveDialogFilters', () => {
  it('leads with Markdown filters for an .md default name', () => {
    expect(saveDialogFilters('notes.md')).toEqual([
      { name: 'Markdown Files', extensions: ['md'] },
      { name: 'MDZip Documents', extensions: ['mdz'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
  });

  it('is case-insensitive on the .md extension', () => {
    expect(saveDialogFilters('NOTES.MD')[0]).toEqual({ name: 'Markdown Files', extensions: ['md'] });
  });

  it('leads with MDZip filters for any other default name', () => {
    expect(saveDialogFilters('archive.mdz')).toEqual([
      { name: 'MDZip Documents', extensions: ['mdz'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
  });
});
