import {
  FigmaNode,
  FigmaFile,
  FigmaBoundingBox,
  ParsedDesign,
  ParsedSection,
  ParsedElement,
  ParsedTextNode,
  ParsedAsset,
  ParsedFont,
  AssetType,
} from '../types/index';
import {
  toClassName,
  parseFigmaColor,
  figmaColorToRgba,
  isTransparent,
  getSemanticSectionTag,
  getHeadingTag,
  isButtonNode,
  isLogoNode,
  isIconNode,
  isIllustrationNode,
  toCssTextAlign,
  toCssLineHeight,
  toCssLetterSpacing,
  toCssFontWeight,
  toCssBorderRadius,
  toCssBoxShadow,
  toCssTextTransform,
  generateAltText,
  isGoogleFont,
  getDateSuffix,
  pxOrZero,
  makeAssetName,
} from '../utils/helpers';

export interface ParserContext {
  type: 'desktop' | 'mobile';
  date: string;
  assets: ParsedAsset[];
  fonts: ParsedFont[];
  colors: Map<string, string>;
  imageRefMap: Map<string, string>;
}

// ─────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────

export function parseFigmaFile(
  file: FigmaFile,
  type: 'desktop' | 'mobile',
  targetNodeId?: string
): ParsedDesign {
  const ctx: ParserContext = {
    type,
    date: getDateSuffix(),
    assets: [],
    fonts: [],
    colors: new Map(),
    imageRefMap: new Map(),
  };

  const document = file.document;
  let canvas: FigmaNode | undefined;

  if (targetNodeId) {
    canvas = findNodeById(document, targetNodeId);
  }
  if (!canvas) {
    canvas = document.children?.find((n) => n.type === 'CANVAS');
  }
  if (!canvas) {
    throw new Error('Could not find a valid canvas/page in the Figma file.');
  }

  const topFrames = (canvas.children ?? []).filter(
    (n) =>
      (n.type === 'FRAME' || n.type === 'GROUP' || n.type === 'COMPONENT') &&
      n.visible !== false
  );
  const sectionNodes = topFrames.length > 0 ? topFrames : (canvas.children ?? []);

  const sections: ParsedSection[] = sectionNodes
    .filter((n) => n.visible !== false)
    .map((n) => parseSection(n, ctx));

  const width  = canvas.absoluteBoundingBox?.width  ?? (type === 'desktop' ? 1440 : 390);
  const height = canvas.absoluteBoundingBox?.height ?? 900;
  const bgColor = canvas.backgroundColor ? figmaColorToRgba(canvas.backgroundColor) : '#ffffff';

  return {
    fileName: file.name,
    pageName: canvas.name,
    width,
    height,
    backgroundColor: bgColor,
    sections,
    colors: ctx.colors,
    fonts: deduplicateFonts(ctx.fonts),
    assets: ctx.assets,
    type,
  };
}

// ─────────────────────────────────────────────────────────────
// Section parser
// ─────────────────────────────────────────────────────────────

function parseSection(node: FigmaNode, ctx: ParserContext): ParsedSection {
  const className   = `${toClassName(node.name)}-section`;
  const semanticTag = getSemanticSectionTag(node.name);
  const bounds      = node.absoluteBoundingBox;
  const isAutoLayout = !!(node.layoutMode && node.layoutMode !== 'NONE');

  let backgroundColor: string | undefined;
  let backgroundImage: string | undefined;
  let backgroundGradient: string | undefined;

  if (node.fills?.length) {
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'SOLID' && fill.color) {
        const c = parseFigmaColor(fill.color, fill.opacity);
        if (!isTransparent(fill.color)) {
          backgroundColor = c.rgba;
          registerColor(ctx, c.hex, toClassName(node.name));
        }
      } else if (
        (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') &&
        fill.gradientStops
      ) {
        backgroundGradient = buildGradientCss(fill);
      } else if (fill.type === 'IMAGE' && fill.imageRef) {
        const asset = createAssetFromNode(node, ctx, 'image', 'png', node.name);
        if (asset) {
          asset.figmaImageRef = fill.imageRef;
          backgroundImage = `url('../${asset.relativePath}')`;
          ctx.assets.push(asset);
        }
      }
    }
  }

  const cssStyles: Record<string, string> = {};
  if (backgroundColor)  cssStyles['background-color'] = backgroundColor;
  if (backgroundImage) {
    cssStyles['background-image']    = backgroundImage;
    cssStyles['background-size']     = 'cover';
    cssStyles['background-position'] = 'center';
    cssStyles['background-repeat']   = 'no-repeat';
  }
  if (backgroundGradient) cssStyles['background'] = backgroundGradient;

  const shadow = node.effects?.length ? toCssBoxShadow(node.effects) : undefined;
  if (shadow) cssStyles['box-shadow'] = shadow;

  // If section itself is auto-layout, emit flex CSS at the section level
  if (isAutoLayout) {
    cssStyles['display']        = 'flex';
    cssStyles['flex-direction'] = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';

    const justifyMap: Record<string, string> = {
      MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center', SPACE_BETWEEN: 'space-between',
    };
    if (node.primaryAxisAlignItems) {
      cssStyles['justify-content'] = justifyMap[node.primaryAxisAlignItems] ?? 'flex-start';
    }
    const alignMap: Record<string, string> = {
      MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center', BASELINE: 'baseline',
    };
    if (node.counterAxisAlignItems) {
      cssStyles['align-items'] = alignMap[node.counterAxisAlignItems] ?? 'flex-start';
    }
    if (node.layoutWrap === 'WRAP') cssStyles['flex-wrap'] = 'wrap';
    if (node.itemSpacing) cssStyles['gap'] = `${node.itemSpacing}px`;

    const hasPadding = node.paddingTop || node.paddingBottom || node.paddingLeft || node.paddingRight;
    if (hasPadding) {
      const pt = pxOrZero(node.paddingTop);
      const pr = pxOrZero(node.paddingRight);
      const pb = pxOrZero(node.paddingBottom);
      const pl = pxOrZero(node.paddingLeft);
      cssStyles['padding'] = `${pt} ${pr} ${pb} ${pl}`;
    }
  }

  // Section-wide unique class name registry (flat scope — all elements share it)
  const sectionClassNames = new Map<string, number>();

  const children = (node.children ?? [])
    .filter((n) => n.visible !== false)
    .map((n) => parseElement(n, ctx, className, node.name, bounds ?? undefined, isAutoLayout, sectionClassNames));

  return {
    id: node.id,
    name: node.name,
    className,
    semanticTag,
    children,
    cssStyles,
    backgroundColor,
    backgroundImage,
    backgroundGradient,
    height: bounds?.height,
    width:  bounds?.width,
    x:      bounds?.x,
    y:      bounds?.y,
    isAutoLayout,
    hasContainer: shouldHaveContainer(node, ctx.type),
  };
}

// ─────────────────────────────────────────────────────────────
// Element parser
// ─────────────────────────────────────────────────────────────

function parseElement(
  node: FigmaNode,
  ctx: ParserContext,
  sectionClass: string,
  sectionName: string,
  parentBounds?: FigmaBoundingBox,
  parentIsAutoLayout?: boolean,
  sectionClassNames?: Map<string, number>,
): ParsedElement {
  // ── Unique class name within this section ──────────────────
  const baseClass = toClassName(node.name);
  let className = baseClass;
  if (sectionClassNames) {
    const seen = sectionClassNames.get(baseClass) ?? 0;
    sectionClassNames.set(baseClass, seen + 1);
    if (seen > 0) className = `${baseClass}-${seen}`;
  }

  const isAbsolute = node.layoutPositioning === 'ABSOLUTE';
  const bounds     = node.absoluteBoundingBox;

  let htmlTag  = 'div';
  let textNode: ParsedTextNode | undefined;
  let asset:    ParsedAsset | undefined;
  let isImage   = false;
  let isSvg     = false;
  let isButton  = false;
  let isNav     = false;

  // ── TEXT ──────────────────────────────────────────────────
  if (node.type === 'TEXT' && node.characters !== undefined) {
    textNode = parseTextNode(node, ctx, className);
    htmlTag  = textNode.htmlTag;
  }

  // ── VECTOR / STAR / LINE used as icon ────────────────────
  if (['VECTOR', 'STAR', 'LINE', 'BOOLEAN_OPERATION', 'REGULAR_POLYGON'].includes(node.type)) {
    const w = bounds?.width ?? 24;
    const h = bounds?.height ?? 24;
    if (isIconNode(node.name, w, h) || node.type === 'VECTOR') {
      isSvg = true;
      asset = createAssetFromNode(node, ctx, isLogoNode(node.name) ? 'logo' : 'icon', 'svg', sectionName);
      if (asset) ctx.assets.push(asset);
      htmlTag = 'img';
    }
  }

  // ── RECTANGLE / ELLIPSE with image fill ──────────────────
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') {
    const imageFill = node.fills?.find((f) => f.type === 'IMAGE' && f.visible !== false && f.imageRef);
    if (imageFill?.imageRef) {
      isImage = true;
      const w = bounds?.width ?? 800;
      const h = bounds?.height ?? 600;
      const aType = resolveImageAssetType(node.name, w, h);
      asset = createAssetFromNode(node, ctx, aType, 'png', sectionName);
      if (asset) {
        asset.figmaImageRef = imageFill.imageRef;
        ctx.assets.push(asset);
      }
      htmlTag = 'img';
    }
  }

  // ── FRAME / GROUP / COMPONENT / INSTANCE ─────────────────
  if (['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET'].includes(node.type)) {
    isButton = isButtonNode(node.name);
    isNav    = /\b(nav|menu|navbar)\b/i.test(node.name);

    const frameFill   = node.fills?.find((f) => f.type === 'IMAGE' && f.visible !== false && f.imageRef);
    const visibleKids = (node.children ?? []).filter((c) => c.visible !== false && c.type !== 'VECTOR');

    if (frameFill?.imageRef) {
      const isImgFrame =
        visibleKids.length === 0 ||
        isLogoNode(node.name) ||
        /\b(image|photo|picture|thumbnail|cover|media|img|banner|bg|background)\b/i.test(node.name);

      if (isImgFrame) {
        isImage = true;
        const w = bounds?.width ?? 800;
        const h = bounds?.height ?? 600;
        asset = createAssetFromNode(node, ctx, resolveImageAssetType(node.name, w, h), 'png', sectionName);
        if (asset) {
          asset.figmaImageRef = frameFill.imageRef;
          ctx.assets.push(asset);
        }
        htmlTag = 'img';
      } else {
        // Frame with children: image becomes CSS background
        const bgAsset = createAssetFromNode(node, ctx, 'image', 'png', sectionName);
        if (bgAsset) {
          bgAsset.figmaImageRef = frameFill.imageRef;
          ctx.assets.push(bgAsset);
          // CSS path relative to css/style.css (one level up from css/)
          // handled below in cssStyles
        }
        htmlTag = isButton ? 'button' : isNav ? 'nav' : 'div';
      }
    } else {
      htmlTag = isButton ? 'button' : isNav ? 'nav' : 'div';
    }
  }

  // ── CSS Styles ────────────────────────────────────────────
  const cssStyles:    Record<string, string> = {};
  const inlineStyles: Record<string, string> = {};

  if (node.fills?.length && htmlTag !== 'img') {
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'SOLID' && fill.color && !isTransparent(fill.color)) {
        const c = parseFigmaColor(fill.color, fill.opacity);
        cssStyles['background-color'] = c.rgba;
        registerColor(ctx, c.hex, className);
      } else if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') {
        cssStyles['background'] = buildGradientCss(fill);
      } else if (fill.type === 'IMAGE' && fill.imageRef && !isImage) {
        // Image-fill background on a frame with children
        const bgAsset = findOrCreateBgAsset(node, ctx, sectionName);
        if (bgAsset) {
          cssStyles['background-image']    = `url('../${bgAsset.relativePath}')`;
          cssStyles['background-size']     = 'cover';
          cssStyles['background-position'] = 'center';
          cssStyles['background-repeat']   = 'no-repeat';
        }
      }
    }
  }

  const radius = toCssBorderRadius(node.cornerRadius, node.rectangleCornerRadii);
  if (radius) cssStyles['border-radius'] = radius;

  if (node.effects?.length) {
    const shadow = toCssBoxShadow(node.effects);
    if (shadow) cssStyles['box-shadow'] = shadow;
    const blur = node.effects.find((e) => e.type === 'LAYER_BLUR' && e.visible !== false);
    if (blur) cssStyles['filter'] = `blur(${blur.radius}px)`;
  }

  if (node.opacity !== undefined && node.opacity < 1) {
    cssStyles['opacity'] = String(Number.parseFloat(node.opacity.toFixed(3)));
  }

  // Auto Layout → Flexbox
  const thisIsAutoLayout = !!(node.layoutMode && node.layoutMode !== 'NONE');
  if (thisIsAutoLayout) {
    cssStyles['display']        = 'flex';
    cssStyles['flex-direction'] = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';

    const justifyMap: Record<string, string> = {
      MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center', SPACE_BETWEEN: 'space-between',
    };
    if (node.primaryAxisAlignItems) {
      cssStyles['justify-content'] = justifyMap[node.primaryAxisAlignItems] ?? 'flex-start';
    }
    const alignMap: Record<string, string> = {
      MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center', BASELINE: 'baseline',
    };
    if (node.counterAxisAlignItems) {
      cssStyles['align-items'] = alignMap[node.counterAxisAlignItems] ?? 'flex-start';
    }
    if (node.layoutWrap === 'WRAP') cssStyles['flex-wrap'] = 'wrap';
    if (node.itemSpacing) cssStyles['gap'] = `${node.itemSpacing}px`;

    const hasPadding =
      node.paddingTop || node.paddingBottom || node.paddingLeft || node.paddingRight;
    if (hasPadding) {
      const pt = pxOrZero(node.paddingTop);
      const pr = pxOrZero(node.paddingRight);
      const pb = pxOrZero(node.paddingBottom);
      const pl = pxOrZero(node.paddingLeft);
      cssStyles['padding'] =
        pt === pb && pr === pl && pt === pr && pt !== '0' ? pt : `${pt} ${pr} ${pb} ${pl}`;
    }
  }

  if (node.strokes?.length) {
    const stroke = node.strokes.find((s) => s.visible !== false && s.type === 'SOLID');
    if (stroke?.color) {
      const c = parseFigmaColor(stroke.color);
      cssStyles['border'] = `${node.strokeWeight ?? 1}px solid ${c.rgba}`;
    }
  }

  if (node.layoutGrow === 1)            cssStyles['flex']       = '1 1 auto';
  if (node.layoutAlign === 'STRETCH')   cssStyles['align-self'] = 'stretch';
  if (node.type === 'ELLIPSE' && !isImage) cssStyles['border-radius'] = '50%';

  // ── Positioning: use Figma absoluteBoundingBox coords ─────
  if (bounds && htmlTag !== 'img') {
    // Set dimensions
    cssStyles['width'] = `${Math.round(bounds.width)}px`;
    if (!textNode) {
      // Don't constrain text height — let content determine it
      cssStyles['height'] = `${Math.round(bounds.height)}px`;
    }
  }

  // Position element within its parent
  // Triggered when parent is NOT auto-layout (all Figma coords are absolute within the frame),
  // or when Figma explicitly marks this node as ABSOLUTE within an auto-layout parent.
  if (bounds && parentBounds && (!parentIsAutoLayout || isAbsolute)) {
    const relX = Math.round(bounds.x - parentBounds.x);
    const relY = Math.round(bounds.y - parentBounds.y);
    cssStyles['position'] = 'absolute';
    cssStyles['left']     = `${relX}px`;
    cssStyles['top']      = `${relY}px`;
  }

  // Non-auto-layout frame containers need to be positioned ancestors
  // (so their absolutely-positioned children are relative to them)
  const isFrameContainer = ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET'].includes(node.type);
  if (isFrameContainer && !thisIsAutoLayout && !isImage && htmlTag !== 'img') {
    // position: absolute (set above) already creates a containing block,
    // so only add relative if no position was set yet
    if (!cssStyles['position']) {
      cssStyles['position'] = 'relative';
    }
  }

  let layoutType: ParsedElement['layoutType'] = 'block';
  if (node.layoutMode === 'HORIZONTAL') layoutType = 'flex-row';
  else if (node.layoutMode === 'VERTICAL') layoutType = 'flex-col';

  // Recurse — pass THIS node's bounds and auto-layout status as parent context
  const children = (node.children ?? [])
    .filter((n) => n.visible !== false)
    .map((n) => parseElement(n, ctx, sectionClass, sectionName, bounds ?? undefined, thisIsAutoLayout, sectionClassNames));

  // Build HTML attributes
  const attributes: Record<string, string> = {};
  if ((isImage || isSvg) && asset) {
    attributes['src']      = asset.relativePath;
    attributes['alt']      = asset.altText;
    attributes['width']    = String(Math.round(asset.width));
    attributes['height']   = String(Math.round(asset.height));
    attributes['loading']  = 'lazy';
    attributes['decoding'] = 'async';
  }
  if (isButton) {
    attributes['type']       = 'button';
    attributes['aria-label'] = className.replace(/-/g, ' ');
  }

  return {
    id: node.id,
    name: node.name,
    className,
    htmlTag,
    children,
    textNode,
    asset,
    mobileAsset:        undefined,
    isResponsiveImage:  false,
    attributes,
    inlineStyles,
    cssStyles,
    layoutType,
    isAbsolute,
    bounds,
    backgroundFill: cssStyles['background-color'],
    borderRadius:   radius,
    shadow:         cssStyles['box-shadow'],
    isButton,
    isLink:         false,
    isNav,
    isImage,
    isSvg,
  };
}

// ─────────────────────────────────────────────────────────────
// Text node parser
// ─────────────────────────────────────────────────────────────

function parseTextNode(node: FigmaNode, ctx: ParserContext, className: string): ParsedTextNode {
  const style      = node.style;
  const fontSize   = style?.fontSize ?? 16;
  const fontWeight = toCssFontWeight(style?.fontWeight ?? 400);
  const tag        = getHeadingTag(fontSize, fontWeight);
  const fontFamily = style?.fontFamily ?? 'inherit';
  const fontStyle  = style?.italic ? 'italic' : 'normal';

  if (!ctx.fonts.some((f) => f.family === fontFamily && f.weight === fontWeight && f.style === fontStyle)) {
    ctx.fonts.push({
      family:       fontFamily,
      weight:       fontWeight,
      style:        fontStyle as 'normal' | 'italic',
      isGoogleFont: isGoogleFont(fontFamily),
    });
  }

  let color = '#000000';
  const textFills  = style?.fills ?? node.fills ?? [];
  const solidFill  = textFills.find((f) => f.type === 'SOLID' && f.visible !== false && f.color);
  if (solidFill?.color) {
    const c = parseFigmaColor(solidFill.color, solidFill.opacity);
    color = c.rgba;
    registerColor(ctx, c.hex, className);
  }

  return {
    id:             node.id,
    name:           node.name,
    text:           node.characters ?? '',
    htmlTag:        tag,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight:     style ? toCssLineHeight(style.lineHeightPx, fontSize) : 'normal',
    letterSpacing:  style ? toCssLetterSpacing(style.letterSpacing, fontSize) : '0',
    color,
    textAlign:      toCssTextAlign(style?.textAlignHorizontal ?? 'LEFT'),
    textTransform:  toCssTextTransform(style?.textCase),
    textDecoration:
      style?.textDecoration === 'UNDERLINE' ? 'underline'
      : style?.textDecoration === 'STRIKETHROUGH' ? 'line-through'
      : 'none',
    className,
  };
}

// ─────────────────────────────────────────────────────────────
// Asset creation
// ─────────────────────────────────────────────────────────────

function createAssetFromNode(
  node: FigmaNode,
  ctx: ParserContext,
  type: AssetType,
  format: 'png' | 'svg',
  sectionName: string
): ParsedAsset | undefined {
  const bounds = node.absoluteBoundingBox;
  if (!bounds) return undefined;

  const targetFormat: 'webp' | 'svg' = format === 'svg' ? 'svg' : 'webp';
  const viewport = ctx.type;

  const fileName = makeAssetName(
    sectionName,
    node.name,
    node.id,
    type,
    viewport,
    ctx.date,
    targetFormat
  );

  const isIcon   = type === 'icon' || type === 'logo';
  const subDir   = isIcon ? 'assets/icons' : 'assets/images';
  const relativePath = `${subDir}/${fileName}`;

  return {
    nodeId:         node.id,
    nodeName:       node.name,
    type,
    originalFormat: format,
    targetFormat,
    fileName,
    relativePath,
    width:          Math.round(bounds.width),
    height:         Math.round(bounds.height),
    altText:        generateAltText(node.name),
    figmaImageRef:  undefined,
    scale:          format === 'svg' ? 1 : 2,
  };
}

// Find an already-registered background asset for a node, or create+register it
function findOrCreateBgAsset(
  node: FigmaNode,
  ctx: ParserContext,
  sectionName: string
): ParsedAsset | undefined {
  const existing = ctx.assets.find((a) => a.nodeId === node.id);
  if (existing) return existing;
  const asset = createAssetFromNode(node, ctx, 'image', 'png', sectionName);
  if (asset) ctx.assets.push(asset);
  return asset;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function resolveImageAssetType(name: string, w: number, h: number): AssetType {
  if (isLogoNode(name))               return 'logo';
  if (isIconNode(name, w, h))         return 'icon';
  if (isIllustrationNode(name, w, h)) return 'illustration';
  return 'image';
}

function findNodeById(node: FigmaNode, id: string): FigmaNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return undefined;
}

function registerColor(ctx: ParserContext, hex: string, name: string): void {
  if (!ctx.colors.has(hex)) ctx.colors.set(hex, name);
}

function buildGradientCss(fill: import('../types/index').FigmaFill): string {
  if (!fill.gradientStops?.length) return 'none';

  const stops = fill.gradientStops
    .map((s) => {
      const c = parseFigmaColor(s.color);
      return `${c.rgba} ${Math.round(s.position * 100)}%`;
    })
    .join(', ');

  if (fill.type === 'GRADIENT_LINEAR') {
    let angle = 180;
    if (fill.gradientHandlePositions && fill.gradientHandlePositions.length >= 2) {
      const [p0, p1] = fill.gradientHandlePositions;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 90;
    }
    return `linear-gradient(${angle}deg, ${stops})`;
  }

  return `radial-gradient(circle, ${stops})`;
}

function shouldHaveContainer(node: FigmaNode, type: 'desktop' | 'mobile'): boolean {
  const lower = node.name.toLowerCase();
  if (/\b(hero|banner|full|splash)\b/.test(lower)) return true;
  if (type === 'mobile') return false;
  return true;
}

function deduplicateFonts(fonts: ParsedFont[]): ParsedFont[] {
  const seen = new Set<string>();
  return fonts.filter((f) => {
    const key = `${f.family}|${f.weight}|${f.style}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
