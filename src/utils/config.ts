import path from 'path';
import { GeneratorConfig } from '../types/index';

export const BOOTSTRAP_VERSION = '5.3.3';
export const BOOTSTRAP_CSS_CDN = `https://cdn.jsdelivr.net/npm/bootstrap@${BOOTSTRAP_VERSION}/dist/css/bootstrap.min.css`;
export const BOOTSTRAP_JS_CDN  = `https://cdn.jsdelivr.net/npm/bootstrap@${BOOTSTRAP_VERSION}/dist/js/bootstrap.bundle.min.js`;

export const FIGMA_API_BASE = 'https://api.figma.com/v1';

export const BREAKPOINTS = {
  xs:  0,
  sm:  576,
  md:  768,
  lg:  992,
  xl:  1200,
  xxl: 1400,
} as const;

export const DESKTOP_MIN_WIDTH = 1200;
export const MOBILE_MAX_WIDTH  = 767;

export const IMAGE_SCALE_DESKTOP = 2;
export const IMAGE_SCALE_MOBILE  = 2;
export const SVG_SCALE           = 1;

export const WEBP_QUALITY = 85;
export const PNG_QUALITY  = 90;

export function buildOutputPaths(config: GeneratorConfig) {
  const root    = path.resolve(config.outputDir, config.projectName);
  const css     = path.join(root, 'css');
  const js      = path.join(root, 'js');
  const assets  = path.join(root, 'assets');
  const images  = path.join(assets, 'images');
  const icons   = path.join(assets, 'icons');
  const fonts   = path.join(assets, 'fonts');

  return { root, css, js, assets, images, icons, fonts };
}

