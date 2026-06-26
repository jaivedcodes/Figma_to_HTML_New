// ============================================================
// Figma REST API Types
// ============================================================

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaVector2D {
  x: number;
  y: number;
}

export interface FigmaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaColorStop {
  position: number;
  color: FigmaColor;
}

export type FigmaFillType =
  | 'SOLID'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'IMAGE'
  | 'EMOJI';

export interface FigmaFill {
  type: FigmaFillType;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientHandlePositions?: FigmaVector2D[];
  gradientStops?: FigmaColorStop[];
  scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  imageRef?: string;
  imageTransform?: number[][];
  filters?: {
    exposure?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    tint?: number;
    highlights?: number;
    shadows?: number;
  };
}

export type FigmaEffectType =
  | 'INNER_SHADOW'
  | 'DROP_SHADOW'
  | 'LAYER_BLUR'
  | 'BACKGROUND_BLUR';

export interface FigmaEffect {
  type: FigmaEffectType;
  visible?: boolean;
  radius: number;
  color?: FigmaColor;
  blendMode?: string;
  offset?: FigmaVector2D;
  spread?: number;
  showShadowBehindNode?: boolean;
}

export interface FigmaConstraints {
  vertical: 'TOP' | 'BOTTOM' | 'CENTER' | 'TOP_BOTTOM' | 'SCALE';
  horizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'LEFT_RIGHT' | 'SCALE';
}

export interface FigmaTypeStyle {
  fontFamily: string;
  fontPostScriptName?: string;
  italic?: boolean;
  fontWeight: number;
  fontSize: number;
  textAlignHorizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED';
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM';
  letterSpacing: number;
  lineHeightPx: number;
  lineHeightPercent: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit: 'PIXELS' | 'FONT_SIZE_%' | 'INTRINSIC_%';
  textDecoration?: 'NONE' | 'STRIKETHROUGH' | 'UNDERLINE';
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS';
  paragraphSpacing?: number;
  fills?: FigmaFill[];
  hyperlink?: { type: string; url: string };
}

export type FigmaNodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'VECTOR'
  | 'BOOLEAN_OPERATION'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'REGULAR_POLYGON'
  | 'RECTANGLE'
  | 'TEXT'
  | 'SLICE'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE';

export interface FigmaNode {
  id: string;
  name: string;
  type: FigmaNodeType;
  visible?: boolean;
  locked?: boolean;
  children?: FigmaNode[];
  backgroundColor?: FigmaColor;
  fills?: FigmaFill[];
  strokes?: FigmaFill[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  effects?: FigmaEffect[];
  opacity?: number;
  absoluteBoundingBox?: FigmaBoundingBox;
  absoluteRenderBounds?: FigmaBoundingBox;
  constraints?: FigmaConstraints;
  // Auto Layout
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  layoutGrow?: number;
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  // Sizing
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  // Shape
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  // Text
  characters?: string;
  style?: FigmaTypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, Partial<FigmaTypeStyle>>;
  // Export
  exportSettings?: Array<{
    suffix?: string;
    format: 'JPG' | 'PNG' | 'SVG' | 'PDF';
    constraint?: { type: string; value: number };
  }>;
  blendMode?: string;
  isMask?: boolean;
  clipsContent?: boolean;
  componentId?: string;
  rotation?: number;
}

export interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  remote?: boolean;
}

export interface FigmaStyle {
  key: string;
  name: string;
  description: string;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
}

export interface FigmaFile {
  document: FigmaNode;
  components: Record<string, FigmaComponent>;
  componentSets: Record<string, FigmaComponent>;
  styles: Record<string, FigmaStyle>;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
}

export interface FigmaImageResponse {
  err?: string;
  images: Record<string, string | null>;
}

// ============================================================
// Parsed / Intermediate Representations
// ============================================================

export interface ParsedColor {
  hex: string;
  rgba: string;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ParsedFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  isGoogleFont: boolean;
}

export interface ParsedGradient {
  type: 'linear' | 'radial';
  stops: Array<{ color: string; position: number }>;
  angle?: number;
}

export interface ParsedEffect {
  type: 'drop-shadow' | 'inner-shadow' | 'blur';
  css: string;
}

export type AssetType = 'image' | 'icon' | 'svg' | 'illustration' | 'logo';

export interface ParsedAsset {
  nodeId: string;
  nodeName: string;
  type: AssetType;
  originalFormat: 'png' | 'jpg' | 'jpeg' | 'svg';
  targetFormat: 'webp' | 'svg';
  fileName: string;
  relativePath: string;
  downloadUrl?: string;
  localPath?: string;
  width: number;
  height: number;
  altText: string;
  figmaImageRef?: string;
  scale: number;
}

export interface ParsedTextNode {
  id: string;
  name: string;
  text: string;
  htmlTag: HeadingTag | 'p' | 'span' | 'label' | 'a';
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  textAlign: string;
  textTransform: string;
  textDecoration: string;
  className: string;
  href?: string;
}

export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface ParsedElement {
  id: string;
  name: string;
  className: string;
  htmlTag: string;
  children: ParsedElement[];
  textNode?: ParsedTextNode;
  asset?: ParsedAsset;
  mobileAsset?: ParsedAsset;
  isResponsiveImage: boolean;
  attributes: Record<string, string>;
  inlineStyles: Record<string, string>;
  cssStyles: Record<string, string>;
  layoutType: 'flex-row' | 'flex-col' | 'block' | 'grid';
  isAbsolute: boolean;
  bounds?: FigmaBoundingBox;
  backgroundFill?: string;
  borderRadius?: string;
  shadow?: string;
  isButton: boolean;
  isLink: boolean;
  isNav: boolean;
  isImage: boolean;
  isSvg: boolean;
}

export interface ParsedSection {
  id: string;
  name: string;
  className: string;
  semanticTag: 'header' | 'nav' | 'main' | 'section' | 'article' | 'footer' | 'aside' | 'div';
  children: ParsedElement[];
  cssStyles: Record<string, string>;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundGradient?: string;
  height?: number;
  width?: number;
  x?: number;
  y?: number;
  isAutoLayout?: boolean;
  hasContainer: boolean;
}

export interface ParsedDesign {
  fileName: string;
  pageName: string;
  width: number;
  height: number;
  backgroundColor: string;
  sections: ParsedSection[];
  colors: Map<string, string>;
  fonts: ParsedFont[];
  assets: ParsedAsset[];
  type: 'desktop' | 'mobile';
}

// ============================================================
// Tool Configuration
// ============================================================

export interface FigmaUrlInfo {
  fileKey: string;
  nodeId?: string;
  title?: string;
}

export interface GeneratorConfig {
  desktopUrl: string;
  mobileUrl: string;
  apiToken: string;
  outputDir: string;
  projectName: string;
  date: string;
}

export interface GeneratedOutput {
  projectDir: string;
  htmlPath: string;
  cssPath: string;
  jsPath?: string;
  assetsDir: string;
  readmePath: string;
  totalAssets: number;
  fonts: ParsedFont[];
}
