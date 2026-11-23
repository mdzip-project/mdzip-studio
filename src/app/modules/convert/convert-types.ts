// What the main process reports for File > Import... and File > Export...
// (studio#33, studio#41); see electron/lib/convert.js and main.js.

export type ConvertTool = 'pandoc' | 'markitdown-mdz';

// Something went wrong: what happened, and a command that fixes it when
// there is one (markitdown-mdz without MarkItDown's readers).
export interface ConvertFailure {
  error: true;
  message: string;
  fix?: string | null;
}

export interface ImportChoice {
  tool: ConvertTool;
  name: string;
  recommended: boolean;
  installed: boolean;
  usable: boolean;
  version: string | null;
  // The command, as you'd type it in the file's folder.
  commandLine: string;
}

export type ImportPick =
  | { canceled: true }
  | ({ canceled: false } & ConvertFailure)
  | {
      canceled: false;
      error?: undefined;
      fileName: string;
      folder: string;
      formatName: string;
      defaultTool: ConvertTool | null;
      choices: ImportChoice[];
    };

// A Word document's Import options (see imported-word.ts).
export interface ImportWordOptions {
  keepStyles?: boolean;
  keepOriginal?: boolean;
  // Its look as the document's stylesheet (styles/style.css).
  documentStyle?: boolean;
  // What Pandoc's import keeps as HTML (see ImportLook).
  look?: ImportLook;
  // Conversion notes, sources/conversion-notes.md (see conversion-notes.ts):
  // mdz.lua's +notes, and what Studio did. Any file, not only Word.
  notes?: boolean;
}

// What the main process tells the notes about the run (with `notes` on).
export interface ImportNotesInfo {
  // The program's name ("Pandoc", "MarkItDown").
  tool: string;
  // The command as the dialog showed it: file names, no folders.
  command: string;
  // The file it came from: its name, no folder.
  source: string;
}

// What Import keeps as HTML in the Markdown so the .mdz looks like the
// original, each on by default in Studio: off, it's plain Markdown instead.
// These are mdz.lua's writing switches, which are off unless added
// (electron/lib/convert.js importLookSwitches).
export interface ImportLook {
  imageSizes: boolean;
  htmlTables: boolean;
  tableLook: boolean;
  htmlFormatting: boolean;
}

export const DEFAULT_IMPORT_LOOK: ImportLook = { imageSizes: true, htmlTables: true, tableLook: true, htmlFormatting: true };

const LOOK_SWITCHES: [keyof ImportLook, string][] = [
  ['imageSizes', 'image_sizes'],
  ['htmlTables', 'html_tables'],
  ['tableLook', 'table_look'],
  ['htmlFormatting', 'html_formatting'],
];

/** mdz.lua's switches for what `look` keeps, as the main process adds them. */
export function importLookSwitches(look: ImportLook): string {
  return LOOK_SWITCHES.filter(([key]) => look[key]).map(([, name]) => `+${name}`).join('');
}

export type ImportResult =
  | ConvertFailure
  // The .mdz, to open unsaved. `openedInNewWindow`: this window had a
  // document open, so the main process opened it in a new one.
  | {
      error?: undefined;
      bytes?: Uint8Array;
      fileName?: string;
      warnings?: string[];
      openedInNewWindow?: boolean;
      canceled?: boolean;
      // A Word document's options were on: the file it came from.
      original?: { fileName: string; bytes: Uint8Array; keepStyles: boolean; keepOriginal: boolean; documentStyle?: boolean };
      // Conversion notes were on.
      notes?: ImportNotesInfo;
    };

export interface ExportFormatInfo {
  id: string;
  name: string;
  extension: string;
  // 'studio': PDF, made from Studio's own preview.
  tool: 'pandoc' | 'studio';
}

export interface ExportOptions {
  pandoc: { installed: boolean; version: string | null; usable: boolean };
  formats: ExportFormatInfo[];
  // Each format's command, by id, and by `${id}+combine` with linked
  // documents combined.
  commands: Record<string, string>;
}

export type ExportResult =
  | ConvertFailure
  | { canceled: true; error?: undefined }
  | { canceled?: undefined; error?: undefined; filePath: string; warnings: string[] };

export interface ExportChoice {
  format: string;
  combine: boolean;
  // An .mdz's document to export instead of its entry point (the page being
  // viewed), when not combining.
  document: string | null;
}
