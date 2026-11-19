// Each card's section on the System Integration help page (mdzip.org's
// docs/system-integration, bundled as assets/help/system-integration.mdz).
// A test checks every one is a heading id in the bundled copy.
export const HELP_SECTIONS: Readonly<Record<string, string>> = {
  markdown: 'opening-md-files',
  preview: 'explorer-previews',
  outlook: 'outlook-attachments',
  helpers: 'helper-programs',
  pandoc: 'pandoc',
  typst: 'typst',
  'rsvg-convert': 'rsvg-convert',
  mmdc: 'mermaid-cli',
  'markitdown-mdz': 'markitdown-mdz',
  mdz: 'mdz-command-line',
};
