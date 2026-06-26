import {
  ParsedDesign,
  ParsedSection,
  ParsedElement,
} from '../types/index';
import {
  toClassName,
  titleCase,
} from '../utils/helpers';

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

export interface HtmlGeneratorOptions {
  desktopDesign: ParsedDesign;
  mobileDesign: ParsedDesign;
  projectName: string;
  googleFontsUrl?: string | null;
  hasJs: boolean;
}

export function generateHTML(opts: HtmlGeneratorOptions): string {
  const { desktopDesign, mobileDesign, projectName, googleFontsUrl } = opts;

  const title    = titleCase(projectName.replace(/-/g, ' '));
  const sections = mergeSections(desktopDesign.sections, mobileDesign.sections);

  const head = buildHead(title, googleFontsUrl);
  const body = buildBody(sections);

  return `<!DOCTYPE html>
<html lang="en">
${head}
${body}
</html>`;
}

// ─────────────────────────────────────────────────────────────
// <head>
// ─────────────────────────────────────────────────────────────

function buildHead(title: string, googleFontsUrl: string | null | undefined): string {
  const fontLinks = googleFontsUrl
    ? `\n  <!-- Google Fonts -->\n  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link href="${googleFontsUrl}" rel="stylesheet">`
    : '';

  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">

  <title>${title}</title>
  <meta name="description" content="TODO: Add page description">
  <meta name="robots" content="index, follow">

  <!-- Open Graph -->
  <meta property="og:title" content="${title}">
  <meta property="og:type" content="website">

  <!-- Favicon -->
  <link rel="icon" type="image/png" href="assets/icons/favicon.png">
${fontLinks}
  <!-- Custom CSS -->
  <link rel="stylesheet" href="css/style.css">
</head>`;
}

// ─────────────────────────────────────────────────────────────
// <body>
// ─────────────────────────────────────────────────────────────

function buildBody(sections: MergedSection[]): string {
  const html = sections.map((s) => renderSection(s)).join('\n\n');

  return `<body>

${html}

  <!-- Viewport scaling & interactions -->
  <script src="js/script.js"></script>

</body>`;
}

// ─────────────────────────────────────────────────────────────
// Section merging
// ─────────────────────────────────────────────────────────────

interface MergedSection {
  desktop: ParsedSection;
  mobile?: ParsedSection;
}

function mergeSections(
  desktopSections: ParsedSection[],
  mobileSections: ParsedSection[]
): MergedSection[] {
  return desktopSections.map((d) => {
    const m = mobileSections.find(
      (ms) => toClassName(ms.name) === toClassName(d.name)
    );
    return { desktop: d, mobile: m };
  });
}

// ─────────────────────────────────────────────────────────────
// Section renderer
// ─────────────────────────────────────────────────────────────

function renderSection(merged: MergedSection): string {
  const { desktop } = merged;
  const tag  = desktop.semanticTag;
  const cls  = desktop.className;
  const w    = Math.round(desktop.width ?? 1440);
  const h    = Math.round(desktop.height ?? 900);

  let ariaAttr = '';
  if (tag === 'header') ariaAttr = ' role="banner"';
  else if (tag === 'footer') ariaAttr = ' role="contentinfo"';
  else if (tag === 'nav') ariaAttr = ` aria-label="${escapeAttr(desktop.name)} Navigation"`;

  const children = desktop.children
    .map((el) => renderElement(el, cls, 4))
    .join('\n');

  if (desktop.isAutoLayout) {
    // Auto-layout: section is itself the flex container; children flow naturally
    return `  <${tag} class="${cls}"${ariaAttr}>
${children}
  </${tag}>`;
  }

  // Non-auto-layout: use __inner wrapper so JS can scale the pixel canvas
  return `  <${tag} class="${cls}"${ariaAttr}>
    <div class="${cls}__inner" data-figma-width="${w}" data-figma-height="${h}">
${children}
    </div>
  </${tag}>`;
}

// ─────────────────────────────────────────────────────────────
// Element renderer (recursive)
// ─────────────────────────────────────────────────────────────

function renderElement(el: ParsedElement, sectionCls: string, indent: number): string {
  const pad   = ' '.repeat(indent);
  const cls   = `${sectionCls}__${el.className}`;

  // ── IMAGE ──────────────────────────────────────────────────
  if (el.isImage && el.asset) {
    const a = el.asset;
    return `${pad}<img class="${cls}" src="${a.relativePath}" alt="${escapeAttr(a.altText)}" width="${a.width}" height="${a.height}" loading="lazy" decoding="async">`;
  }

  // ── SVG / ICON ────────────────────────────────────────────
  if (el.isSvg && el.asset) {
    const a = el.asset;
    return `${pad}<img class="${cls}" src="${a.relativePath}" alt="${escapeAttr(a.altText)}" width="${a.width}" height="${a.height}" loading="lazy" decoding="async">`;
  }

  // ── TEXT (leaf) ───────────────────────────────────────────
  if (el.textNode && el.children.length === 0) {
    const tn = el.textNode;
    const text = escapeHtml(tn.text);
    if (el.isLink) {
      return `${pad}<a href="#" class="${cls}">${text}</a>`;
    }
    return `${pad}<${tn.htmlTag} class="${cls}">${text}</${tn.htmlTag}>`;
  }

  // ── BUTTON ────────────────────────────────────────────────
  if (el.isButton) {
    const labelText = getElementText(el);
    if (el.children.length > 0) {
      const inner = el.children.map((c) => renderElement(c, sectionCls, indent + 2)).join('\n');
      return `${pad}<button type="button" class="${cls}" aria-label="${escapeAttr(labelText)}">
${inner}
${pad}</button>`;
    }
    return `${pad}<button type="button" class="${cls}">${escapeHtml(labelText)}</button>`;
  }

  // ── CONTAINER WITH CHILDREN ───────────────────────────────
  if (el.children.length > 0) {
    const tag      = sanitizeTag(el.htmlTag);
    const children = el.children.map((c) => renderElement(c, sectionCls, indent + 2)).join('\n');
    return `${pad}<${tag} class="${cls}">
${children}
${pad}</${tag}>`;
  }

  // ── TEXT WITH CHILDREN (mixed-style text — flatten to text) ─
  if (el.textNode) {
    const tn = el.textNode;
    return `${pad}<${tn.htmlTag} class="${cls}">${escapeHtml(tn.text)}</${tn.htmlTag}>`;
  }

  // ── EMPTY CONTAINER ───────────────────────────────────────
  const tag = sanitizeTag(el.htmlTag);
  return `${pad}<${tag} class="${cls}"></${tag}>`;
}

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function getElementText(el: ParsedElement): string {
  if (el.textNode?.text) return el.textNode.text;
  for (const child of el.children) {
    const t = getElementText(child);
    if (t) return t;
  }
  return toClassName(el.name).replace(/-/g, ' ');
}

function sanitizeTag(tag: string): string {
  const allowed = new Set(['div', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'span', 'p', 'ul', 'ol', 'li', 'figure', 'figcaption', 'form', 'label']);
  return allowed.has(tag) ? tag : 'div';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
