// A stylesheet with a Word document's look, for File > Import... ("Show it
// with its fonts and colours"): the fonts, sizes, colours and spacing of its
// Normal text, headings, links and quotes, and the lines and header shading
// most of its tables have. Written as if the document were a web page of its
// own (document-style.ts fits it into Studio's preview), with a dark version
// of its colours in a prefers-color-scheme: dark block.
import { strFromU8, unzipSync } from 'fflate';

type Props = Record<string, string>;

interface WordStyle {
  id: string;
  type: string;
  name: string;
  isDefault: boolean;
  basedOn: string | null;
  props: Props;
  // Table styles: their lines, and their header row's shading and text.
  borders: string | null;
  headerFill: string | null;
  headerProps: Props;
}

interface Theme {
  colours: Record<string, string>;
  major: string | null;
  minor: string | null;
}

// ---------------------------------------------------------------------------
// Reading Word's XML

const ON = (value: string | undefined) => value === undefined || !/^(0|false|off|none)$/i.test(value);

function attribute(xml: string, element: string, name: string): string | undefined {
  const tag = new RegExp(`<w:${element}\\b[^>]*?>`).exec(xml)?.[0];
  if (!tag) return undefined;
  return new RegExp(`\\bw:${name}="([^"]*)"`).exec(tag)?.[1];
}

function has(xml: string, element: string): boolean {
  return new RegExp(`<w:${element}(?=[\\s/>])`).test(xml);
}

function block(xml: string, element: string): string | null {
  return new RegExp(`<w:${element}\\b[^>]*>([\\s\\S]*?)</w:${element}>`).exec(xml)?.[1] ?? null;
}

// A run's look (rPr) and a paragraph's (pPr), as flat properties.
function runProps(rPr: string | null, props: Props = {}): Props {
  if (!rPr) return props;
  const font = attribute(rPr, 'rFonts', 'ascii') ?? attribute(rPr, 'rFonts', 'hAnsi');
  const fontTheme = attribute(rPr, 'rFonts', 'asciiTheme') ?? attribute(rPr, 'rFonts', 'hAnsiTheme');
  if (fontTheme) props['fontTheme'] = fontTheme;
  else if (font) props['font'] = font;
  const size = attribute(rPr, 'sz', 'val');
  if (size) props['size'] = size;
  if (has(rPr, 'color')) {
    for (const key of ['val', 'themeColor', 'themeShade', 'themeTint'] as const) {
      const value = attribute(rPr, 'color', key);
      if (value) props[`color.${key}`] = value;
      else delete props[`color.${key}`];
    }
  }
  for (const [element, key] of [['b', 'bold'], ['i', 'italic'], ['caps', 'caps'], ['smallCaps', 'smallCaps'], ['u', 'underline']] as const) {
    if (has(rPr, element)) props[key] = ON(attribute(rPr, element, 'val')) ? 'true' : 'false';
  }
  return props;
}

function paragraphProps(pPr: string | null, props: Props = {}): Props {
  if (!pPr) return props;
  for (const key of ['before', 'after', 'line', 'lineRule'] as const) {
    const value = attribute(pPr, 'spacing', key);
    if (value) props[key] = value;
  }
  const jc = attribute(pPr, 'jc', 'val');
  if (jc) props['jc'] = jc;
  const shd = /<w:shd\b[^>]*\/>/.exec(pPr)?.[0];
  if (shd) props['shd'] = shd;
  if (has(pPr, 'pageBreakBefore')) props['pageBreakBefore'] = ON(attribute(pPr, 'pageBreakBefore', 'val')) ? 'true' : 'false';
  const borders = block(pPr, 'pBdr');
  if (borders !== null) {
    const bottom = /<w:bottom\b[^>]*\/>/.exec(borders)?.[0];
    if (bottom) props['borderBottom'] = bottom;
  }
  return props;
}

function readStyles(xml: string): Map<string, WordStyle> {
  const styles = new Map<string, WordStyle>();
  for (const match of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = /\bw:styleId="([^"]*)"/.exec(match[1])?.[1];
    if (!id) continue;
    const type = /\bw:type="([^"]*)"/.exec(match[1])?.[1] ?? 'paragraph';
    // A table style's own look, apart from its conditional parts.
    const conditional = [...match[2].matchAll(/<w:tblStylePr\b([^>]*)>([\s\S]*?)<\/w:tblStylePr>/g)];
    const own = match[2].replace(/<w:tblStylePr\b[\s\S]*?<\/w:tblStylePr>/g, '');
    const firstRow = conditional.find((part) => /w:type="firstRow"/.test(part[1]))?.[2] ?? '';
    styles.set(id, {
      id,
      type,
      name: attribute(own, 'name', 'val')?.toLowerCase() ?? id.toLowerCase(),
      isDefault: /\bw:default="(1|true|on)"/.test(match[1]),
      basedOn: attribute(own, 'basedOn', 'val') ?? null,
      props: runProps(block(own, 'rPr'), paragraphProps(block(own, 'pPr'))),
      borders: /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(own)?.[0] ?? null,
      headerFill: fill(firstRow),
      headerProps: runProps(block(firstRow, 'rPr')),
    });
  }
  return styles;
}

// A shading's colour (w:shd), or null for none or white. Word draws its
// pattern (w:val: solid, pct20...) in w:color over w:fill; "auto" is black
// for the pattern and white for the fill.
function fill(xml: string | undefined): string | null {
  if (!xml) return null;
  const read = (name: string, auto: string) => {
    const value = attribute(xml, 'shd', name);
    return value && /^[0-9a-f]{6}$/i.test(value) ? value : auto;
  };
  const val = attribute(xml, 'shd', 'val') ?? 'clear';
  if (val === 'nil') return null;
  const front = hexRgb(read('color', '000000'));
  const back = hexRgb(read('fill', 'FFFFFF'));
  const share = val === 'solid' ? 1 : val === 'clear' ? 0 : /^pct(\d+)$/.test(val) ? Number(/^pct(\d+)$/.exec(val)![1]) / 100 : 0;
  const colour = rgbHex(back.map((c, i) => c * (1 - share) + front[i] * share) as Rgb);
  return colour === '#FFFFFF' ? null : colour;
}

function readTheme(xml: string | null): Theme {
  const theme: Theme = { colours: {}, major: null, minor: null };
  if (!xml) return theme;
  const scheme = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml)?.[1] ?? '';
  for (const match of scheme.matchAll(/<a:(\w+)>\s*<a:(?:srgbClr val|sysClr\b[^>]*?lastClr)="([0-9A-Fa-f]{6})"/g)) {
    theme.colours[match[1]] = `#${match[2].toUpperCase()}`;
  }
  theme.major = /<a:majorFont>\s*<a:latin typeface="([^"]*)"/.exec(xml)?.[1] || null;
  theme.minor = /<a:minorFont>\s*<a:latin typeface="([^"]*)"/.exec(xml)?.[1] || null;
  return theme;
}

const THEME_COLOUR_NAMES: Record<string, string> = {
  dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2',
  text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2',
  hyperlink: 'hlink', followedHyperlink: 'folHlink',
};

// A style's look with what it's based on underneath (nearest wins), on top
// of the document's defaults.
function resolve(styles: Map<string, WordStyle>, defaults: Props, id: string | undefined): Props {
  const chain: Props[] = [];
  const seen = new Set<string>();
  for (let style = id ? styles.get(id) : undefined; style && !seen.has(style.id); style = style.basedOn ? styles.get(style.basedOn) : undefined) {
    seen.add(style.id);
    chain.unshift(style.props);
  }
  return Object.assign({}, defaults, ...chain);
}

function styleNamed(styles: Map<string, WordStyle>, type: string, ...names: string[]): WordStyle | undefined {
  for (const name of names) {
    for (const style of styles.values()) if (style.type === type && style.name === name) return style;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Colours

type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
  const value = parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function rgbHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Rgb): Rgb | null {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (rgb.some((c) => c < -0.0005 || c > 1.0005)) return null;
  return rgb.map(fromLinear) as Rgb;
}

// The nearest displayable colour at lightness L: less saturated until it fits.
function oklabColour(L: number, a: number, b: number): string {
  for (let k = 1; k > 0.01; k *= 0.9) {
    const rgb = fromOklab([L, a * k, b * k]);
    if (rgb) return rgbHex(rgb);
  }
  return rgbHex(fromOklab([L, 0, 0]) ?? [L, L, L]);
}

function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(one: string, two: string): number {
  const [a, b] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Studio's dark page, which the dark colours are checked against. */
export const DARK_PAGE = '#1E1E1E';

// A colour for the dark theme: the same hue, its lightness turned over
// (within `min`..`max`), then lightened until it stands out from the dark
// page by `needed` (4.5:1 for text, 3:1 for lines).
function turnedOver(hex: string, min: number, max: number, needed: number): string {
  const [L, a, b] = toOklab(hexRgb(hex));
  let lightness = Math.min(max, Math.max(min, 1 - L));
  let colour = oklabColour(lightness, a, b);
  while (contrast(colour, DARK_PAGE) < needed && lightness < 0.99) {
    lightness = Math.min(0.99, lightness + 0.02);
    colour = oklabColour(lightness, a, b);
  }
  return colour;
}

/** Text in the dark theme: readable on the dark page (4.5:1). */
export function darkText(hex: string): string {
  return turnedOver(hex, 0.62, 0.93, 4.5);
}

/** A table line in the dark theme: visible on the dark page (3:1). */
export function darkLine(hex: string): string {
  return turnedOver(hex, 0.45, 0.8, 3);
}

/** A shaded background in the dark theme: dark, with the same hue, under light text. */
export function darkFill(hex: string): string {
  const [L, a, b] = toOklab(hexRgb(hex));
  return oklabColour(Math.min(0.4, Math.max(0.27, 1 - L)), a * 0.8, b * 0.8);
}

// Word's theme shade (darker) and tint (lighter), 0..255.
function shadeTint(hex: string, shade?: string, tint?: string): string {
  let [r, g, b] = hexRgb(hex);
  if (shade) {
    const k = parseInt(shade, 16) / 255;
    [r, g, b] = [r * k, g * k, b * k];
  }
  if (tint) {
    const k = parseInt(tint, 16) / 255;
    [r, g, b] = [r * k + (1 - k), g * k + (1 - k), b * k + (1 - k)];
  }
  return rgbHex([r, g, b]);
}

// Word saves a theme colour's value as well (w:val), worked out as Word
// does; the theme is only needed when it didn't.
function colourOf(props: Props, theme: Theme): string | null {
  const value = props['color.val'];
  if (value && /^[0-9a-f]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
  const themeColour = props['color.themeColor'];
  if (themeColour) {
    const base = theme.colours[THEME_COLOUR_NAMES[themeColour] ?? themeColour];
    if (base) return shadeTint(base, props['color.themeShade'], props['color.themeTint']);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fonts

const SERIF = /serif|roman|times|georgia|cambria|garamond|book|palatino|minion|caslon|baskerville|didot|bodoni|constantia|century|caladea|merriweather|charter/i;
const MONO = /mono|courier|consolas|menlo|code/i;
const FALLBACKS: Record<string, string[]> = {
  calibri: ['Carlito'],
  'calibri light': ['Calibri', 'Carlito'],
  cambria: ['Caladea', 'Georgia'],
  aptos: ['Calibri', 'Carlito'],
  'aptos display': ['Aptos', 'Calibri', 'Carlito'],
  arial: ['Liberation Sans', 'Helvetica'],
  'times new roman': ['Liberation Serif', 'Times'],
  'courier new': ['Liberation Mono', 'Courier'],
};

function fontStack(name: string): string {
  const generic = MONO.test(name) && !/serif/i.test(name) ? 'monospace' : SERIF.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif';
  const families = [name, ...(FALLBACKS[name.toLowerCase()] ?? [])];
  if (generic === 'sans-serif') families.push('Segoe UI', 'Helvetica Neue', 'Arial');
  if (generic === 'serif') families.push('Georgia');
  return [...new Set(families)].map((family) => `"${family.replace(/["\\]/g, '')}"`).join(', ') + `, ${generic}`;
}

function fontOf(props: Props, theme: Theme): string | null {
  const themed = props['fontTheme'];
  if (themed) {
    const name = /^major/.test(themed) ? theme.major : /^minor/.test(themed) ? theme.minor : null;
    if (name) return name;
  }
  return props['font'] ?? null;
}

// ---------------------------------------------------------------------------
// Tables

const BORDER_STYLES: Record<string, string> = {
  single: 'solid', thick: 'solid', double: 'double', dotted: 'dotted', dashed: 'dashed',
  dotDash: 'dashed', dotDotDash: 'dotted', triple: 'double', wave: 'solid', none: 'none', nil: 'none',
};

interface Line { css: string; colour: string | null }

// A Word border (w:top, w:insideH...) as a CSS border; colour null for "auto".
function line(xml: string | undefined): Line | null {
  if (!xml) return null;
  const val = /\bw:val="([^"]*)"/.exec(xml)?.[1] ?? 'single';
  const style = BORDER_STYLES[val] ?? 'solid';
  if (style === 'none') return { css: 'none', colour: null };
  const size = Math.max(0.5, Number(/\bw:sz="(\d+)"/.exec(xml)?.[1] ?? '4') / 8);
  const value = /\bw:color="([0-9A-Fa-f]{6})"/.exec(xml)?.[1];
  const colour = value ? `#${value.toUpperCase()}` : null;
  return { css: `${size}pt ${style} ${colour ?? 'currentColor'}`, colour };
}

function edges(borders: string | null): Record<string, Line | null> {
  const result: Record<string, Line | null> = {};
  for (const edge of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    const alias = edge === 'left' ? 'start' : edge === 'right' ? 'end' : edge;
    result[edge] = line(borders ? new RegExp(`<w:(?:${edge}|${alias})\\b[^>]*/>`).exec(borders)?.[0] : undefined);
  }
  return result;
}

// The look most of the document's tables have: their table style and/or
// their own borders (as Studio's reference document's "Table" style).
function usualTable(documentXml: string): { style: string | null; borders: string | null } | null {
  const looks = new Map<string, { count: number; style: string | null; borders: string | null }>();
  for (const match of documentXml.matchAll(/<w:tbl>\s*<w:tblPr>([\s\S]*?)<\/w:tblPr>/g)) {
    const style = /<w:tblStyle w:val="([^"]+)"/.exec(match[1])?.[1] ?? null;
    const borders = /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(match[1])?.[0] ?? null;
    const key = `${style}|${borders}`;
    const look = looks.get(key) ?? { count: 0, style, borders };
    look.count++;
    looks.set(key, look);
  }
  return [...looks.values()].sort((a, b) => b.count - a.count)[0] ?? null;
}

// ---------------------------------------------------------------------------
// The stylesheet

const pt = (twentieths: string | undefined) => (twentieths === undefined ? undefined : `${Math.round(Number(twentieths) / 2) / 10}pt`);

class Sheet {
  private readonly light: string[] = [];
  private readonly dark: string[] = [];

  rule(selector: string, declarations: Record<string, string | null | undefined>, dark: Record<string, string | null | undefined> = {}): void {
    const body = (entries: Record<string, string | null | undefined>) =>
      Object.entries(entries).filter(([, value]) => value !== undefined && value !== null).map(([name, value]) => `  ${name}: ${value};`);
    const lines = body(declarations);
    if (lines.length) this.light.push(`${selector} {\n${lines.join('\n')}\n}`);
    const darkLines = body(dark);
    if (darkLines.length) this.dark.push(`  ${selector} {\n${darkLines.map((l) => `  ${l}`).join('\n')}\n  }`);
  }

  css(header: string): string {
    const dark = this.dark.length ? `\n\n/* The same colours for a dark page. */\n@media (prefers-color-scheme: dark) {\n${this.dark.join('\n')}\n}` : '';
    return `${header}\n\n${this.light.join('\n\n')}${dark}\n`;
  }
}

// A paragraph style's text: font, size, weight, colour and spacing.
function textRule(sheet: Sheet, selector: string, props: Props, theme: Theme, base: Props | null): void {
  const font = fontOf(props, theme);
  const colour = colourOf(props, theme);
  const same = (key: string) => base !== null && props[key] === base[key];
  const declarations: Record<string, string | undefined> = {
    'font-family': font && !(base && font === fontOf(base, theme)) ? fontStack(font) : undefined,
    'font-size': props['size'] && !same('size') ? `${Number(props['size']) / 2}pt` : base ? (base['size'] ? `${Number(base['size']) / 2}pt` : undefined) : undefined,
    'font-weight': base ? (props['bold'] === 'true' ? 'bold' : 'normal') : props['bold'] === 'true' ? 'bold' : undefined,
    'font-style': props['italic'] === 'true' ? 'italic' : base ? 'normal' : undefined,
    'text-transform': props['caps'] === 'true' ? 'uppercase' : undefined,
    'font-variant': props['smallCaps'] === 'true' ? 'small-caps' : undefined,
    color: colour ?? undefined,
  };
  if (props['jc'] === 'center') declarations['text-align'] = 'center';
  if (props['jc'] === 'both' || props['jc'] === 'distribute') declarations['text-align'] = 'justify';
  if (props['jc'] === 'right' || props['jc'] === 'end') declarations['text-align'] = 'right';
  const dark: Record<string, string | undefined> = { color: colour ? darkText(colour) : undefined };
  // A paragraph shaded as a band (white text on black, say): in the dark
  // theme a light band turns dark, and its text changes only if it must.
  const band = fill(props['shd']);
  if (band) {
    declarations['background'] = band;
    declarations['padding-left'] = '4pt';
    declarations['padding-right'] = '4pt';
    const darkBand = luminance(band) > 0.18 ? darkFill(band) : band;
    if (darkBand !== band) dark['background'] = darkBand;
    const onBand = colour ?? '#000000';
    dark['color'] = contrast(onBand, darkBand) >= 4.5 ? (colour ? colour : undefined) : contrast('#F0F0F0', darkBand) >= 4.5 ? '#F0F0F0' : '#1A1A1A';
  }
  if (props['pageBreakBefore'] === 'true') declarations['break-before'] = 'page';
  if (base) {
    // A heading: Word's spacing, and no rule under it unless the style has one.
    declarations['margin-top'] = pt(props['before']) ?? '0';
    declarations['margin-bottom'] = pt(props['after']) ?? '0';
    const bottom = line(props['borderBottom']);
    declarations['border-bottom'] = bottom?.css ?? 'none';
    declarations['padding-bottom'] = bottom && bottom.css !== 'none' ? '1pt' : '0';
    if (bottom?.colour) dark['border-bottom-color'] = darkLine(bottom.colour);
  }
  sheet.rule(selector, declarations, dark);
}

/**
 * The stylesheet for a Word document (or template), or null when it can't be
 * read as one or has no styles. `source` names it in the stylesheet's first
 * comment.
 */
export function wordStylesheet(docx: Uint8Array, source = 'a Word document'): string | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(docx);
  } catch {
    return null;
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : null);
  const stylesXml = text('word/styles.xml');
  if (!stylesXml) return null;
  const theme = readTheme(text('word/theme/theme1.xml'));
  const styles = readStyles(stylesXml);
  const defaultsXml = block(stylesXml, 'docDefaults') ?? '';
  // Word's own defaults (10pt) under the document's.
  const defaults = runProps(block(block(defaultsXml, 'rPrDefault') ?? '', 'rPr'), paragraphProps(block(block(defaultsXml, 'pPrDefault') ?? '', 'pPr'), { size: '20' }));

  const normalStyle = [...styles.values()].find((style) => style.type === 'paragraph' && style.isDefault)
    ?? styleNamed(styles, 'paragraph', 'normal');
  const normal = resolve(styles, defaults, normalStyle?.id);
  const sheet = new Sheet();

  // The page: Normal text.
  const body: Record<string, string | undefined> = {};
  const font = fontOf(normal, theme);
  if (font) body['font-family'] = fontStack(font);
  if (normal['size']) body['font-size'] = `${Number(normal['size']) / 2}pt`;
  // Word's "multiple" spacing (240 = single) is a multiple of the font's own
  // line height, a little more than the font size.
  if (normal['line'] && (normal['lineRule'] ?? 'auto') === 'auto') {
    body['line-height'] = `${Math.round((Number(normal['line']) / 240) * 1.15 * 100) / 100}`;
  } else if (normal['line']) {
    body['line-height'] = pt(normal['line']);
  }
  const textColour = colourOf(normal, theme);
  if (textColour) body['color'] = textColour;
  sheet.rule('body', body, { color: textColour ? darkText(textColour) : undefined });
  sheet.rule('p', {
    'margin-top': pt(normal['before']) ?? '0',
    'margin-bottom': pt(normal['after']) ?? '0',
    'text-align': normal['jc'] === 'both' ? 'justify' : undefined,
  });

  // Headings.
  for (let level = 1; level <= 6; level++) {
    const style = styleNamed(styles, 'paragraph', `heading ${level}`);
    if (style) textRule(sheet, `h${level}`, resolve(styles, defaults, style.id), theme, normal);
  }

  // Links and quotes.
  const link = styleNamed(styles, 'character', 'hyperlink');
  if (link) {
    const props = resolve(styles, {}, link.id);
    const colour = colourOf(props, theme) ?? theme.colours['hlink'] ?? null;
    if (colour) sheet.rule('a', { color: colour }, { color: darkText(colour) });
  }
  const quote = styleNamed(styles, 'paragraph', 'quote', 'block text');
  if (quote) {
    const props = resolve(styles, defaults, quote.id);
    const colour = colourOf(props, theme);
    sheet.rule('blockquote', {
      'font-style': props['italic'] === 'true' ? 'italic' : undefined,
      color: colour ?? undefined,
    }, { color: colour ? darkText(colour) : undefined });
  }

  // Tables: the usual table's lines and header row.
  const usual = usualTable(text('word/document.xml') ?? '');
  const tableStyle = usual?.style ? styles.get(usual.style) : undefined;
  let borders = usual?.borders ?? null;
  const seen = new Set<string>();
  for (let style = tableStyle; !borders && style && !seen.has(style.id); style = style.basedOn ? styles.get(style.basedOn) : undefined) {
    seen.add(style.id);
    borders = style.borders;
  }
  if (borders) {
    const edge = edges(borders);
    const css = (l: Line | null) => l?.css ?? 'none';
    const dark = (l: Line | null) => (l?.colour ? darkLine(l.colour) : undefined);
    sheet.rule('table', {
      'border-collapse': 'collapse',
      'border-top': css(edge['top']),
      'border-bottom': css(edge['bottom']),
      'border-left': css(edge['left']),
      'border-right': css(edge['right']),
    }, {
      'border-top-color': dark(edge['top']),
      'border-bottom-color': dark(edge['bottom']),
      'border-left-color': dark(edge['left']),
      'border-right-color': dark(edge['right']),
    });
    sheet.rule('th, td', {
      'border-top': css(edge['insideH']),
      'border-bottom': css(edge['insideH']),
      'border-left': css(edge['insideV']),
      'border-right': css(edge['insideV']),
      padding: '2pt 5.4pt',
    }, {
      'border-top-color': dark(edge['insideH']),
      'border-bottom-color': dark(edge['insideH']),
      'border-left-color': dark(edge['insideV']),
      'border-right-color': dark(edge['insideV']),
    });
  }
  // Header cells. Pandoc makes a table's first row its header whenever Word's
  // table settings tick "header row", which they do by default, whether or
  // not the table's style makes that row look any different. So a header
  // cell looks as the usual table's style makes it (plain, unless the style
  // shades it or makes it bold), and wraps like any other cell: a long
  // paragraph in it would otherwise run off the page.
  const header = tableStyle?.headerFill ?? null;
  const headerColour = tableStyle ? colourOf(tableStyle.headerProps, theme) : null;
  sheet.rule('th', {
    'white-space': 'normal',
    background: header ?? 'transparent',
    color: headerColour ?? undefined,
    'font-weight': tableStyle?.headerProps['bold'] === 'true' ? 'bold' : 'normal',
  }, {
    background: header ? darkFill(header) : undefined,
    color: headerColour ? darkText(headerColour) : undefined,
  });
  // Shaded cells keep their colour (it's in the document, on the cell) and
  // get dark text, so they stay readable on a dark page.
  sheet.rule('td[style*="background"], th[style*="background"]', {}, { color: '#1A1A1A' });
  sheet.rule('td[style*="background"] *, th[style*="background"] *', {}, { color: 'inherit' });

  const name = source.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
  return sheet.css(`/* The look of ${name}: its fonts, colours, spacing and table lines,\n   made by MDZip Studio's Import. Edit it to change how the document looks. */`);
}
