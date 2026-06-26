import { FigmaNode, FigmaFile, ParsedAsset, ParsedFont, AssetType } from '../types/index';
import {
  isIconNode,
  isLogoNode,
  isIllustrationNode,
  isGoogleFont,
  generateAltText,
  toCssFontWeight,
  makeAssetName,
} from '../utils/helpers';

// ─────────────────────────────────────────────────────────────
// Extracted types
// ─────────────────────────────────────────────────────────────

export interface ExtractedImageFill {
  nodeId:      string;
  nodeName:    string;
  sectionName: string; // top-level FRAME name this node lives in
  imageRef:    string;
  width:       number;
  height:      number;
  assetType:   AssetType;
}

export interface ExtractedVector {
  nodeId:      string;
  nodeName:    string;
  sectionName: string;
  width:       number;
  height:      number;
  assetType:   AssetType;
}

// ─────────────────────────────────────────────────────────────
// Extract all image-fill nodes (section-aware walk)
// ─────────────────────────────────────────────────────────────

export function extractImageFills(document: FigmaNode): ExtractedImageFill[] {
  const result: ExtractedImageFill[] = [];
  const canvas = document.children?.find((n) => n.type === 'CANVAS') ?? document;

  for (const section of canvas.children ?? []) {
    if (section.visible === false) continue;
    walkForFills(section, section.name, result);
  }
  return result;
}

function walkForFills(node: FigmaNode, sectionName: string, result: ExtractedImageFill[]): void {
  if (!node.absoluteBoundingBox) {
    for (const child of node.children ?? []) walkForFills(child, sectionName, result);
    return;
  }
  const { width, height } = node.absoluteBoundingBox;
  const imageFill = node.fills?.find((f) => f.type === 'IMAGE' && f.visible !== false && f.imageRef);

  if (imageFill?.imageRef) {
    let assetType: AssetType = 'image';
    if (isLogoNode(node.name))                      assetType = 'logo';
    else if (isIconNode(node.name, width, height))  assetType = 'icon';
    else if (isIllustrationNode(node.name, width, height)) assetType = 'illustration';

    result.push({
      nodeId:      node.id,
      nodeName:    node.name,
      sectionName,
      imageRef:    imageFill.imageRef,
      width:       Math.round(width),
      height:      Math.round(height),
      assetType,
    });
  }

  for (const child of node.children ?? []) walkForFills(child, sectionName, result);
}

// ─────────────────────────────────────────────────────────────
// Extract all vector/SVG exportable nodes (section-aware walk)
// ─────────────────────────────────────────────────────────────

const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE']);

export function extractVectors(document: FigmaNode): ExtractedVector[] {
  const result: ExtractedVector[] = [];
  const canvas = document.children?.find((n) => n.type === 'CANVAS') ?? document;

  for (const section of canvas.children ?? []) {
    if (section.visible === false) continue;
    walkForVectors(section, section.name, result);
  }
  return result;
}

function walkForVectors(node: FigmaNode, sectionName: string, result: ExtractedVector[]): void {
  if (node.visible === false) return;

  if (VECTOR_TYPES.has(node.type) && node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    result.push({
      nodeId:      node.id,
      nodeName:    node.name,
      sectionName,
      width:       Math.round(width),
      height:      Math.round(height),
      assetType:   isLogoNode(node.name) ? 'logo' : 'icon',
    });
    return; // don't recurse into vector children
  }

  for (const child of node.children ?? []) walkForVectors(child, sectionName, result);
}

// ─────────────────────────────────────────────────────────────
// Extract all font information
// ─────────────────────────────────────────────────────────────

export function extractFonts(document: FigmaNode, _file: FigmaFile): ParsedFont[] {
  const seen  = new Set<string>();
  const fonts: ParsedFont[] = [];

  walkAllNodes(document, (node) => {
    if (node.type !== 'TEXT' || !node.style) return;
    const { fontFamily, fontWeight = 400, italic = false } = node.style;
    if (!fontFamily) return;

    const weight = toCssFontWeight(fontWeight);
    const style  = italic ? 'italic' : 'normal';
    const key    = `${fontFamily}|${weight}|${style}`;

    if (!seen.has(key)) {
      seen.add(key);
      fonts.push({ family: fontFamily, weight, style, isGoogleFont: isGoogleFont(fontFamily) });
    }
  });

  // file.styles is covered by the text-node walk above; parameter kept for API compatibility
  return fonts;
}

// ─────────────────────────────────────────────────────────────
// Build ParsedAsset list from extracted fills + vectors
// ─────────────────────────────────────────────────────────────

export function buildAssetList(
  imageFills: ExtractedImageFill[],
  vectors:    ExtractedVector[],
  viewport:   'desktop' | 'mobile',
  date:       string
): ParsedAsset[] {
  const assets: ParsedAsset[] = [];

  for (const fill of imageFills) {
    const subDir   = (fill.assetType === 'icon' || fill.assetType === 'logo') ? 'assets/icons' : 'assets/images';
    const fileName = makeAssetName(fill.sectionName, fill.nodeName, fill.nodeId, fill.assetType, viewport, date, 'webp');

    assets.push({
      nodeId:        fill.nodeId,
      nodeName:      fill.nodeName,
      type:          fill.assetType,
      originalFormat:'png',
      targetFormat:  'webp',
      fileName,
      relativePath:  `${subDir}/${fileName}`,
      width:         fill.width,
      height:        fill.height,
      altText:       generateAltText(fill.nodeName),
      figmaImageRef: fill.imageRef,
      scale:         2,
    });
  }

  for (const vec of vectors) {
    const fileName = makeAssetName(vec.sectionName, vec.nodeName, vec.nodeId, vec.assetType, viewport, date, 'svg');

    assets.push({
      nodeId:        vec.nodeId,
      nodeName:      vec.nodeName,
      type:          vec.assetType,
      originalFormat:'svg',
      targetFormat:  'svg',
      fileName,
      relativePath:  `assets/icons/${fileName}`,
      width:         vec.width,
      height:        vec.height,
      altText:       generateAltText(vec.nodeName),
      figmaImageRef: undefined,
      scale:         1,
    });
  }

  return assets;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function walkAllNodes(node: FigmaNode, visitor: (n: FigmaNode) => void): void {
  visitor(node);
  for (const child of node.children ?? []) walkAllNodes(child, visitor);
}

// ─────────────────────────────────────────────────────────────
// Match desktop and mobile assets for responsive images
// ─────────────────────────────────────────────────────────────

export function matchResponsiveAssets(
  desktopAssets: ParsedAsset[],
  mobileAssets:  ParsedAsset[]
): Array<{ desktop: ParsedAsset; mobile: ParsedAsset | undefined }> {
  return desktopAssets.map((d) => {
    const mobile = mobileAssets.find(
      (m) => m.nodeId === d.nodeId ||
             m.nodeName.toLowerCase() === d.nodeName.toLowerCase()
    );
    return { desktop: d, mobile };
  });
}
