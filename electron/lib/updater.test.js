const {
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
