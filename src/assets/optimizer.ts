import path from 'path';
import fs from 'fs-extra';
import { ParsedAsset } from '../types/index';
import { WEBP_QUALITY } from '../utils/config';
import type { ProgressFn } from './downloader';

// ─────────────────────────────────────────────────────────────
// Convert raster images (PNG/JPG) → WebP using Sharp
// ─────────────────────────────────────────────────────────────

export async function optimizeImages(
  assets: ParsedAsset[],
  onProgress?: ProgressFn
): Promise<void> {
  const emit = onProgress ?? (() => {});
  const rasterAssets = assets.filter(a => a.targetFormat === 'webp' && a.localPath);
  if (rasterAssets.length === 0) return;

  let sharp: typeof import('sharp') | undefined;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    emit('sharp not installed — images kept as PNG (run: npm install sharp)', 'warn');
    return;
  }

  emit(`Converting ${rasterAssets.length} image(s) to WebP…`, 'info');
  let converted = 0;

  for (const asset of rasterAssets) {
    if (!asset.localPath || !await fs.pathExists(asset.localPath)) continue;

    const srcPath  = asset.localPath;
    const destPath = path.join(path.dirname(srcPath), asset.fileName);

    try {
      await sharp!(srcPath).webp({ quality: WEBP_QUALITY, effort: 4 }).toFile(destPath);
      if (srcPath !== destPath) await fs.remove(srcPath);
      asset.localPath = destPath;
      converted++;
      emit(`[${converted}/${rasterAssets.length}] → WebP: ${asset.fileName}`, 'success');
    } catch (err) {
      emit(`Could not convert ${asset.fileName}: ${err}`, 'warn');
    }
  }

  emit(`WebP conversion done: ${converted}/${rasterAssets.length}`, 'success');
}

// ─────────────────────────────────────────────────────────────
// Optimize SVG files using SVGO
// ─────────────────────────────────────────────────────────────

export async function optimizeSvgs(
  assets: ParsedAsset[],
  onProgress?: ProgressFn
): Promise<void> {
  const emit = onProgress ?? (() => {});
  const svgAssets = assets.filter(a => a.targetFormat === 'svg' && a.localPath);
  if (svgAssets.length === 0) return;

  let optimize: ((svg: string, cfg?: unknown) => { data: string }) | undefined;
  try {
    const svgo = await import('svgo');
    optimize = svgo.optimize as unknown as typeof optimize;
  } catch {
    emit('svgo not installed — SVGs kept as-is', 'warn');
    return;
  }

  emit(`Optimizing ${svgAssets.length} SVG(s)…`, 'info');
  let done = 0;

  for (const asset of svgAssets) {
    if (!asset.localPath) continue;
    try {
      const raw = await fs.readFile(asset.localPath, 'utf8');
      if (!raw.trim().startsWith('<')) continue;
      const result = optimize!(raw, {
        plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }, 'removeDimensions'],
      });
      await fs.writeFile(asset.localPath, result!.data, 'utf8');
      done++;
    } catch { /* skip bad SVG silently */ }
  }

  emit(`SVG optimization done: ${done}/${svgAssets.length}`, 'success');
}
