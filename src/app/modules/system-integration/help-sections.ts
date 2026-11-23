// Each card's section on the System Integration help page (mdzip.org's
// docs/studio-system-integration, system-integration.md in the bundled help).
// A test checks every one is a heading id in the bundled copy.
export const HELP_SECTIONS: Readonly<Record<string, string>> = {
  studio: 'installing-mdzip-studio',
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
