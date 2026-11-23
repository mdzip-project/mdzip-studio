// File > Import... with "Conversion notes" on: sources/conversion-notes.md,
// a note beside the document (not part of it) on how it was made. mdz.lua
// writes it with +notes: where the file came from and, from Word, what didn't
// come across (see mdzip-pandoc's README). Studio adds a section of its own:
// the command it ran, the files its options added and the program's
// warnings. A program that writes no notes (markitdown-mdz) gets a file with
// only what Studio knows.
import { MdzArchiveCore } from '@mdzip/core-js';
import type { ImportNotesInfo } from './convert-types';

export const NOTES_PATH = 'sources/conversion-notes.md';

// Warnings past this many are counted, not listed.
const MAX_WARNINGS = 50;

export interface StudioNotes {
  info: ImportNotesInfo;
  studioVersion: string;
  // What the Import options added: [archive path, what it is].
  added: [string, string][];
  // What they couldn't add, and why.
  skipped: string[];
  warnings: string[];
}

/** "2026-11-22 20:23 UTC", as mdz.lua writes it. */
export function notesDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// `text` in a code span, with a fence longer than any backticks in it.
function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return fence + (fence.length > 1 ? ' ' : '') + text + (fence.length > 1 ? ' ' : '') + fence;
}

/** Studio's section: the run, what was added, the warnings. */
export function studioSection(notes: StudioNotes): string {
  const lines = ['## In MDZip Studio', ''];
  lines.push(`- **Imported with:** MDZip Studio ${notes.studioVersion}, which ran ${notes.info.tool}: ${code(notes.info.command)}`);
  for (const [path, what] of notes.added) lines.push(`- **Added:** ${code(path)}, ${what}.`);
  for (const reason of notes.skipped) lines.push(`- **Not added:** ${reason}.`);
  const warnings = notes.warnings;
  if (!warnings.length) {
    lines.push(`- **Warnings:** none from ${notes.info.tool}.`);
  } else {
    lines.push(`- **Warnings:** ${warnings.length} from ${notes.info.tool}${warnings.length > MAX_WARNINGS ? `, the first ${MAX_WARNINGS} here` : ''}:`);
    lines.push('', '  ```text', ...warnings.slice(0, MAX_WARNINGS).map((warning) => `  ${warning.replace(/\r?\n/g, ' ')}`), '  ```');
  }
  return lines.join('\n') + '\n';
}

// The file when the program wrote none: the heading, where it came from.
function newNotes(notes: StudioNotes, date: Date): string {
  return [
    '# Conversion notes',
    '',
    "How this document was made from its original. MDZip Studio wrote it when it imported the file; it isn't part of the document.",
    '',
    '## Where it came from',
    '',
    `- **Original:** ${code(notes.info.source)}`,
    `- **Converted:** ${notesDate(date)}`,
    `- **With:** ${notes.info.tool}`,
    '',
  ].join('\n');
}

/**
 * The imported .mdz with Studio's section added to its conversion notes, or
 * with notes of Studio's own when the program wrote none.
 */
export async function addConversionNotes(mdz: Uint8Array, notes: StudioNotes, date = new Date()): Promise<Uint8Array> {
  const archive = await MdzArchiveCore.open(mdz);
  const exists = archive.listPaths().includes(NOTES_PATH);
  const before = exists ? (await archive.readText(NOTES_PATH)) ?? '' : newNotes(notes, date);
  const text = before.replace(/\s*$/, '\n\n') + studioSection(notes);
  const result = await MdzArchiveCore.updateFiles(mdz, [{ path: NOTES_PATH, content: new TextEncoder().encode(text) }], []);
  return new Uint8Array(await result.blob.arrayBuffer());
}
