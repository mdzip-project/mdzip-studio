const path = require('path');
const { runPathAction } = require('./path-actions');

function deps({ accessFails = false } = {}) {
  const written = [];
  return {
    written,
    clipboard: { writeText: (t) => written.push(t) },
    access: async () => { if (accessFails) throw new Error('ENOENT'); },
  };
}

const file = path.resolve('docs', 'notes.mdz');
const folder = path.dirname(file);

describe('runPathAction', () => {
  it('copies the full file path', async () => {
    const d = deps();
    expect(await runPathAction({ filePath: file, action: 'copy-path' }, d)).toEqual({ ok: true, text: file });
    expect(d.written).toEqual([file]);
  });

  it('copies the containing folder path', async () => {
    const d = deps();
    expect(await runPathAction({ filePath: file, action: 'copy-folder' }, d)).toEqual({ ok: true, text: folder });
    expect(d.written).toEqual([folder]);
  });

  it('reports failures without touching the clipboard', async () => {
    expect(await runPathAction({ filePath: '', action: 'copy-path' }, deps())).toEqual({ error: 'no-path' });
    expect(await runPathAction({ filePath: file, action: 'nope' }, deps())).toEqual({ error: 'unknown-action' });
    const missing = deps({ accessFails: true });
    expect(await runPathAction({ filePath: file, action: 'copy-path' }, missing)).toEqual({ error: 'not-found' });
    expect(missing.written).toEqual([]);
  });
});
