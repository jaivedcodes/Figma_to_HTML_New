import { AssetType } from '../types/index';
import { toClassName, getDateSuffix } from '../utils/helpers';

export function buildAssetFileName(
  nodeName: string,
  type: AssetType,
  viewport: 'desktop' | 'mobile' | 'shared',
  targetFormat: 'webp' | 'svg',
  date?: string
): string {
  const d = date ?? getDateSuffix();
  const base = toClassName(nodeName).slice(0, 40).replace(/-+$/, '');
  const viewportSuffix = viewport === 'shared' ? '' : `-${viewport}`;
  return `${base}${viewportSuffix}-${d}.${targetFormat}`;
}

export function getAssetSubDir(type: AssetType): 'assets/images' | 'assets/icons' {
  return type === 'icon' || type === 'logo' ? 'assets/icons' : 'assets/images';
}

