import dayjs from 'dayjs';
import { FigmaColor, FigmaUrlInfo, ParsedColor, ParsedFont } from '../types/index';

// ── Date ────────────────────────────────────────────────────

export function getDateSuffix(): string {
  return dayjs().format('DDMMMMYYYY').toLowerCase();
}

// ── String utilities ─────────────────────────────────────────

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function toClassName(name: string): string {
  const kebab = toKebabCase(name);
  return kebab.replace(/^[0-9]/, 'el-$&');
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function titleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Color conversions ────────────────────────────────────────

export function figmaColorToHex(color: FigmaColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function figmaColorToRgba(color: FigmaColor, opacityOverride?: number): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = opacityOverride ?? Number.parseFloat(color.a.toFixed(3));
  if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function parseFigmaColor(color: FigmaColor, opacity?: number): ParsedColor {
  const effectiveAlpha = opacity ?? color.a;
  const colorWithAlpha = { ...color, a: effectiveAlpha };
  return {
    hex: figmaColorToHex(color),
    rgba: figmaColorToRgba(colorWithAlpha),
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
    a: effectiveAlpha,
  };
}

export function isTransparent(color: FigmaColor): boolean {
  return color.a < 0.01;
}

export function hexToColorVarName(hex: string): string {
  return `--color-${hex.replace('#', '')}`;
}

// ── URL parsing ──────────────────────────────────────────────

export function parseFigmaUrl(url: string): FigmaUrlInfo {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);

    // Support /file/{key}/... and /design/{key}/...
    const typeIndex = segments.findIndex((s) => s === 'file' || s === 'design' || s === 'proto');
    if (typeIndex === -1 || !segments[typeIndex + 1]) {
      throw new Error('Could not extract file key from URL.');
    }

    const fileKey = segments[typeIndex + 1];
    const title = segments[typeIndex + 2];

    const rawNodeId =
      parsed.searchParams.get('node-id') ||
      parsed.searchParams.get('node_id') ||
      undefined;

    const nodeId = rawNodeId ? decodeURIComponent(rawNodeId).replace('%3A', ':') : undefined;

    return { fileKey, nodeId, title };
  } catch {
    throw new Error(`Invalid Figma URL: "${url}"`);
  }
}

// ── CSS value helpers ────────────────────────────────────────

export function pxOrZero(value: number | undefined): string {
  if (!value || value === 0) return '0';
  return `${Math.round(value)}px`;
}

export function toCssLineHeight(px: number, fontSize: number): string {
  if (!px || !fontSize) return 'normal';
  const ratio = Number.parseFloat((px / fontSize).toFixed(3));
  return String(ratio);
}

export function toCssLetterSpacing(ls: number, fontSize: number): string {
  if (!ls) return '0';
  const em = Number.parseFloat((ls / fontSize).toFixed(4));
  return `${em}em`;
}

export function toCssTextAlign(figmaAlign: string): string {
  const map: Record<string, string> = {
    LEFT: 'left',
    RIGHT: 'right',
    CENTER: 'center',
    JUSTIFIED: 'justify',
  };
  return map[figmaAlign] ?? 'left';
}

export function toCssTextTransform(figmaCase?: string): string {
  const map: Record<string, string> = {
    UPPER: 'uppercase',
    LOWER: 'lowercase',
    TITLE: 'capitalize',
    SMALL_CAPS: 'none',
    SMALL_CAPS_FORCED: 'none',
    ORIGINAL: 'none',
  };
  return figmaCase ? (map[figmaCase] ?? 'none') : 'none';
}

export function toCssFontWeight(weight: number): number {
  // Round to nearest standard weight
  const standards = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  return standards.reduce((prev, curr) =>
    Math.abs(curr - weight) < Math.abs(prev - weight) ? curr : prev, standards[0]
  );
}

// ── Font detection ───────────────────────────────────────────

const GOOGLE_FONTS_LIST = new Set([
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Raleway', 'Nunito', 'Source Sans Pro', 'Ubuntu', 'Oswald',
  'Merriweather', 'Playfair Display', 'PT Sans', 'Noto Sans',
  'Fira Sans', 'Work Sans', 'DM Sans', 'Plus Jakarta Sans',
  'Outfit', 'Manrope', 'Sora', 'Space Grotesk', 'Bricolage Grotesque',
  'Be Vietnam Pro', 'Lexend', 'Barlow', 'Mulish', 'Karla',
  'IBM Plex Sans', 'Cabinet Grotesk', 'Satoshi',
]);

export function isGoogleFont(family: string): boolean {
  return GOOGLE_FONTS_LIST.has(family);
}

export function buildGoogleFontsUrl(fonts: ParsedFont[]): string | null {
  const googleFonts = fonts.filter((f) => f.isGoogleFont);
  if (googleFonts.length === 0) return null;

  const familyGroups = new Map<string, Set<string>>();

  for (const font of googleFonts) {
    if (!familyGroups.has(font.family)) {
      familyGroups.set(font.family, new Set());
    }
    const variant = `${font.style === 'italic' ? 'italic,' : ''}${font.weight}`;
    familyGroups.get(font.family)!.add(variant);
  }

  const familyParams = Array.from(familyGroups.entries())
    .map(([family, variants]) => {
      const sortedVariants = Array.from(variants).sort((a, b) => a.localeCompare(b));
      return `family=${encodeURIComponent(family)}:ital,wght@${sortedVariants.join(';')}`;
    })
    .join('&');

  return `https://fonts.googleapis.com/css2?${familyParams}&display=swap`;
}

// ── Semantic HTML tag detection ──────────────────────────────

export function getSemanticSectionTag(
  name: string
): 'header' | 'nav' | 'main' | 'section' | 'article' | 'footer' | 'aside' | 'div' {
  const lower = name.toLowerCase();
  if (/\b(header|top|masthead)\b/.test(lower)) return 'header';
  if (/\b(nav|navigation|navbar|menu)\b/.test(lower)) return 'nav';
  if (/\b(footer|bottom)\b/.test(lower)) return 'footer';
  if (/\b(aside|sidebar)\b/.test(lower)) return 'aside';
  if (/\b(main|content|body)\b/.test(lower)) return 'main';
  if (/\b(article|post|blog|card)\b/.test(lower)) return 'article';
  return 'section';
}

export function getHeadingTag(fontSize: number, fontWeight: number): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' {
  if (fontSize >= 48) return 'h1';
  if (fontSize >= 36) return 'h2';
  if (fontSize >= 28) return 'h3';
  if (fontSize >= 22) return 'h4';
  if (fontSize >= 18) return 'h5';
  if (fontSize >= 14 && fontWeight >= 600) return 'h6';
  return 'p';
}

export function isButtonNode(name: string): boolean {
  return /\b(btn|button|cta|action)\b/i.test(name);
}

export function isLogoNode(name: string): boolean {
  return /\b(logo|brand|wordmark)\b/i.test(name);
}

export function isIconNode(name: string, width: number, height: number): boolean {
  return (
    /\b(icon|ico|glyph)\b/i.test(name) ||
    (width <= 64 && height <= 64 && !/\b(logo|avatar|thumbnail)\b/i.test(name))
  );
}

export function isIllustrationNode(name: string, width: number, height: number): boolean {
  return /\b(illustration|illus|graphic|art)\b/i.test(name) || (width > 200 && height > 200);
}

// ── Alt text generation ──────────────────────────────────────

export function generateAltText(nodeName: string): string {
  return toKebabCase(nodeName)
    .replace(/-+/g, ' ')
    .replace(/\b(img|image|photo|pic|picture|asset|icon|svg|illustration)\b/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase() || nodeName.toLowerCase();
}

// ── CSS border-radius helper ─────────────────────────────────

export function toCssBorderRadius(
  cornerRadius?: number,
  radii?: [number, number, number, number]
): string | undefined {
  if (radii?.some((r) => r !== 0)) {
    if (radii.every((r) => r === radii[0])) {
      return radii[0] ? `${radii[0]}px` : undefined;
    }
    return radii.map((r) => `${r}px`).join(' ');
  }
  if (cornerRadius && cornerRadius > 0) return `${cornerRadius}px`;
  return undefined;
}

// ── CSS shadow helper ────────────────────────────────────────

export function toCssBoxShadow(effects: import('../types/index.js').FigmaEffect[]): string | undefined {
  const shadows = effects
    .filter((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map((e) => {
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      const x = pxOrZero(e.offset?.x);
      const y = pxOrZero(e.offset?.y);
      const blur = pxOrZero(e.radius);
      const spread = pxOrZero(e.spread);
      const color = e.color ? figmaColorToRgba(e.color) : 'rgba(0,0,0,0.1)';
      return `${inset}${x} ${y} ${blur} ${spread} ${color}`;
    });

  return shadows.length ? shadows.join(', ') : undefined;
}

// ── Misc ─────────────────────────────────────────────────────

export function slugify(str: string): string {
  return toKebabCase(str).slice(0, 60);
}

// ── Asset naming helpers ──────────────────────────────────────

/**
 * Returns true when a kebab-cased name looks like a Figma auto-generated ID
 * (e.g. "ab6axu-a07sslkfo-ts35ald") rather than a human-readable label.
 * Heuristic: ≥2 segments that mix letters with embedded digits.
 */
// Common Figma layer-name words — segments matching these are NOT garbled
const KNOWN_LAYER_WORDS = new Set([
  'h1','h2','h3','h4','h5','h6','nav','hero','card','banner','section','content',
  'wrapper','footer','header','logo','icon','button','btn','cta','bg','row','col',
  'grid','list','item','image','photo','text','title','desc','subtitle','primary',
  'secondary','rectangle','frame','group','ellipse','vector','line','polygon',
  'path','layer','auto','mask','clip','stroke','fill','border','shadow','overlay',
  'divider','badge','tag','chip','avatar','thumbnail','cover','media','gallery',
  'slider','tab','panel','modal','dialog','drawer','tooltip','input','field',
  'label','checkbox','radio','toggle','switch','select','search','filter','table',
  'body',
]);

export function isGarbledName(name: string): boolean {
  if (!name || name.length <= 2) return true;
  const segs = name.split('-').filter((s) => s.length >= 3);
  const garbled = segs.filter(
    (s) => /\d/.test(s) && /[a-z]/.test(s) && !KNOWN_LAYER_WORDS.has(s.toLowerCase())
  ).length;
  return garbled >= 2;
}

/**
 * Builds a human-readable asset filename base from section + node context.
 * Format: {section}-{node}-{viewport}-{date}.{ext}
 * Falls back to section+type+nodeId-suffix when the node name is garbled.
 */
export function makeAssetName(
  sectionName: string,
  nodeName:    string,
  nodeId:      string,
  type:        string,
  viewport:    'desktop' | 'mobile' | 'shared',
  date:        string,
  ext:         'webp' | 'svg'
): string {
  const cleanSection    = toClassName(sectionName).slice(0, 18);
  const cleanNode       = toClassName(nodeName);
  const viewportSuffix  = viewport === 'shared' ? '' : `-${viewport}`;

  let base: string;
  if (!cleanNode || isGarbledName(cleanNode)) {
    // Use node-ID digits as a short disambiguator so names stay unique
    const idDigits = nodeId.replace(/\D/g, '');
    const idSuffix = (idDigits.slice(-6) || nodeId.replace(/[^a-zA-Z\d]/g, '').slice(-6) || '0').toLowerCase();
    base = cleanSection ? `${cleanSection}-${type}-${idSuffix}` : `${type}-${idSuffix}`;
  } else {
    const nodeTrimmed = cleanNode.slice(0, 22);
    const addSection  = cleanSection && !nodeTrimmed.startsWith(cleanSection.slice(0, 5));
    base = addSection ? `${cleanSection}-${nodeTrimmed}`.slice(0, 48) : nodeTrimmed;
  }

  return `${base}${viewportSuffix}-${date}.${ext}`;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
}

export function deduplicateFonts(fonts: ParsedFont[]): ParsedFont[] {
  const seen = new Set<string>();
  return fonts.filter((f) => {
    const key = `${f.family}-${f.weight}-${f.style}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cssVarName(name: string): string {
  return `--${toKebabCase(name)}`;
}

export function indentLines(str: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return str.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');
}

