import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { ParsedAsset } from '../types/index';
import { FigmaClient } from '../figma/client';

export type ProgressFn = (msg: string, type?: 'info' | 'success' | 'warn') => void;

export interface DownloadResult {
  asset: ParsedAsset;
  localPath: string;
  success: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Download all assets for a design
// ─────────────────────────────────────────────────────────────

export async function downloadAssets(
  fileKey: string,
  assets: ParsedAsset[],
  outputRoot: string,
  figmaClient: FigmaClient,
  imageRefUrlMap: Record<string, string> = {},
  onProgress?: ProgressFn
): Promise<DownloadResult[]> {
  const emit = onProgress ?? (() => {});

  if (assets.length === 0) {
    emit('No assets to download — skipping.', 'info');
    return [];
  }

  const results: DownloadResult[] = [];
  const svgAssets    = assets.filter(a => a.targetFormat === 'svg');
  const imageAssets  = assets.filter(a => a.targetFormat !== 'svg');
  const refAssets    = imageAssets.filter(a => a.figmaImageRef && imageRefUrlMap[a.figmaImageRef]);
  const nodeAssets   = imageAssets.filter(a => !a.figmaImageRef || !imageRefUrlMap[a.figmaImageRef]);

  // ── Get SVG export URLs ─────────────────────────────────────
  let svgUrlMap: Record<string, string | null> = {};
  if (svgAssets.length > 0) {
    emit(`Getting export URLs for ${svgAssets.length} SVG icon(s)…`, 'info');
    try {
      svgUrlMap = await withTimeout(
        figmaClient.getImageUrls(fileKey, svgAssets.map(a => a.nodeId), 'svg', 1),
        30_000,
        'SVG URL fetch timed out'
      );
      emit(`Got ${Object.keys(svgUrlMap).length} SVG URL(s)`, 'success');
    } catch (e) {
      emit(`Could not get SVG URLs: ${e} — skipping SVGs`, 'warn');
    }
  }

  // ── Get raster export URLs ──────────────────────────────────
  let rasterUrlMap: Record<string, string | null> = {};
  if (nodeAssets.length > 0) {
    emit(`Getting export URLs for ${nodeAssets.length} image(s)…`, 'info');
    try {
      rasterUrlMap = await withTimeout(
        figmaClient.getImageUrls(fileKey, nodeAssets.map(a => a.nodeId), 'png', 2),
        45_000,
        'Raster URL fetch timed out'
      );
      emit(`Got ${Object.keys(rasterUrlMap).length} image URL(s)`, 'success');
    } catch (e) {
      emit(`Could not get image URLs: ${e} — skipping raster images`, 'warn');
    }
  }

  // ── Download each asset ─────────────────────────────────────
  const total = assets.length;
  let done = 0;

  for (const asset of assets) {
    const destPath = path.join(outputRoot, ...asset.relativePath.split('/'));
    await fs.ensureDir(path.dirname(destPath));
    const url = resolveUrl(asset, svgUrlMap, rasterUrlMap, imageRefUrlMap);
    done++;
    const result = await downloadOne(asset, url, destPath, done, total, emit);
    results.push(result);
  }

  const succeeded = results.filter(r => r.success).length;
  emit(`Download complete: ${succeeded}/${total} assets`, succeeded === total ? 'success' : 'warn');
  return results;
}

// ─────────────────────────────────────────────────────────────
// Fetch image-fill CDN URLs from Figma
// ─────────────────────────────────────────────────────────────

export async function fetchImageRefUrls(
  fileKey: string,
  imageRefs: string[],
  figmaClient: FigmaClient,
  onProgress?: ProgressFn
): Promise<Record<string, string>> {
  const emit = onProgress ?? (() => {});
  if (imageRefs.length === 0) return {};

  emit(`Resolving ${imageRefs.length} image fill URL(s)…`, 'info');
  try {
    const urlMap = await withTimeout(
      figmaClient.getFileImageRefs(fileKey, imageRefs),
      30_000,
      'Image refs fetch timed out'
    );
    emit(`Resolved ${Object.keys(urlMap).length} fill URL(s)`, 'success');
    return urlMap;
  } catch (e) {
    emit(`Could not resolve image fills: ${e}`, 'warn');
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function resolveUrl(
  asset: ParsedAsset,
  svgUrlMap: Record<string, string | null>,
  rasterUrlMap: Record<string, string | null>,
  imageRefUrlMap: Record<string, string>
): string | null | undefined {
  if (asset.targetFormat === 'svg') return svgUrlMap[asset.nodeId];
  if (asset.figmaImageRef && imageRefUrlMap[asset.figmaImageRef]) return imageRefUrlMap[asset.figmaImageRef];
  return rasterUrlMap[asset.nodeId];
}

async function downloadOne(
  asset: ParsedAsset,
  url: string | null | undefined,
  destPath: string,
  done: number,
  total: number,
  emit: ProgressFn
): Promise<DownloadResult> {
  if (!url) {
    emit(`[${done}/${total}] Skipped (no URL): ${asset.fileName}`, 'warn');
    return { asset, localPath: destPath, success: false, error: 'No URL available' };
  }
  try {
    await downloadFile(url, destPath);
    asset.localPath = destPath;
    emit(`[${done}/${total}] ↓ ${asset.fileName}`, 'success');
    return { asset, localPath: destPath, success: true };
  } catch (err) {
    emit(`[${done}/${total}] Failed: ${asset.fileName}`, 'warn');
    return { asset, localPath: destPath, success: false, error: String(err) };
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await axios.get<Buffer>(url, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: { 'User-Agent': 'figma-to-html/1.0' },
  });
  await fs.writeFile(destPath, res.data);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms / 1000}s): ${label}`)), ms)
    ),
  ]);
}
