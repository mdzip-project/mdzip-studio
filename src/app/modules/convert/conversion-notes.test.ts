import { MdzArchiveCore, MdzPackagerCore } from '@mdzip/core-js';
import { addConversionNotes, NOTES_PATH, notesDate, StudioNotes, studioSection } from './conversion-notes';

const NOTES: StudioNotes = {
  info: { tool: 'Pandoc', command: 'pandoc "Plan.docx" -t mdz.lua+notes -o "Plan.mdz"', source: 'Plan.docx' },
  studioVersion: '1.2.3',
  added: [['styles/reference.docx', 'a Word template']],
  skipped: [],
  warnings: ['[WARNING] Could not convert TeX math', 'Second\nline'],
};

async function mdzWith(files: { path: string; text: string }[]): Promise<Uint8Array> {
  const built = await MdzPackagerCore.buildArchive(
    [{ path: 'index.md', text: '# Plan\n' }, ...files],
    'plan',
    { createIndex: false, mapFiles: false, filters: ['**/*'], title: 'Plan', mode: 'document', entryPoint: 'index.md' },
  );
  return new Uint8Array(await built.blob.arrayBuffer());
}

describe('conversion notes', () => {
  it("adds Studio's section after mdz.lua's notes", async () => {
    const mdz = await mdzWith([{ path: NOTES_PATH, text: '# Conversion notes\n\n## Where it came from\n\n- **Original:** `Plan.docx`\n' }]);
    const text = await (await MdzArchiveCore.open(await addConversionNotes(mdz, NOTES))).readText(NOTES_PATH);
    expect(text).toContain('- **Original:** `Plan.docx`\n\n## In MDZip Studio\n');
    expect(text).toContain('MDZip Studio 1.2.3, which ran Pandoc: `pandoc "Plan.docx" -t mdz.lua+notes -o "Plan.mdz"`');
    expect(text).toContain('- **Added:** `styles/reference.docx`, a Word template.');
    expect(text).toContain('- **Warnings:** 2 from Pandoc:');
    expect(text).toContain('  [WARNING] Could not convert TeX math\n  Second line\n');
    expect(text!.match(/# Conversion notes/g)).toHaveLength(1);
  });

  it('writes notes of its own when the program wrote none', async () => {
    const info = { tool: 'markitdown-mdz', command: 'markitdown-mdz deck.pptx -o deck.mdz', source: 'deck.pptx' };
    const out = await addConversionNotes(await mdzWith([]), { ...NOTES, info, added: [], warnings: [] }, new Date('2026-11-22T20:23:45Z'));
    const archive = await MdzArchiveCore.open(out);
    const text = await archive.readText(NOTES_PATH);
    expect(text).toMatch(/^# Conversion notes\n/);
    expect(text).toContain('- **Original:** `deck.pptx`\n- **Converted:** 2026-11-22 20:23 UTC\n- **With:** markitdown-mdz\n');
    expect(text).toContain('- **Warnings:** none from markitdown-mdz.');
    expect(await archive.readText('index.md')).toBe('# Plan\n');
  });

  it('says what it could not add, and lists only so many warnings', () => {
    const many = Array.from({ length: 60 }, (_, i) => `warning ${i}`);
    const section = studioSection({ ...NOTES, added: [], skipped: ["its Word styles: it couldn't be read"], warnings: many });
    expect(section).toContain("- **Not added:** its Word styles: it couldn't be read.");
    expect(section).toContain('60 from Pandoc, the first 50 here:');
    expect(section).toContain('warning 49');
    expect(section).not.toContain('warning 50');
  });

  it('keeps a command with backticks in one code span', () => {
    expect(studioSection({ ...NOTES, info: { ...NOTES.info, command: 'a `b` c' } })).toContain(': `` a `b` c ``');
  });

  it('dates as mdz.lua does', () => {
    expect(notesDate(new Date('2026-01-02T03:04:59Z'))).toBe('2026-01-02 03:04 UTC');
  });
});
