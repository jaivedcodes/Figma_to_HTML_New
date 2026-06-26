import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import prettier from 'prettier';

import { parseFigmaUrl, buildGoogleFontsUrl, deduplicateFonts, getDateSuffix, slugify } from './utils/helpers';
import { FigmaClient } from './figma/client';
import { parseFigmaFile } from './figma/parser';
import { extractImageFills, extractVectors, extractFonts, buildAssetList } from './figma/extractor';
import { downloadAssets, fetchImageRefUrls } from './assets/downloader';
import { optimizeImages, optimizeSvgs } from './assets/optimizer';
import { generateHTML } from './generators/html';
import { generateCSS } from './generators/css';
import { generateJS, needsJS } from './generators/js';
import { generateReadme } from './generators/readme';
import { GeneratorConfig } from './types/index';

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export interface GenerationInput {
  desktopUrl:  string;
  mobileUrl:   string;
  apiToken:    string;
  projectName: string;
}

export interface ProgressEvent {
  type:    'section' | 'info' | 'success' | 'warn' | 'error' | 'done' | 'preview';
  message: string;
  data?:   Record<string, unknown>; // extra structured payload for preview
}

export interface GenerationResult {
  outputDir:   string;
  projectName: string;
  totalAssets: number;
  sections:    number;
  fonts:       string[];
}

// ─────────────────────────────────────────────────────────────
// Core generation function
// ─────────────────────────────────────────────────────────────

export async function runGeneration(
  input: GenerationInput,
  onProgress: (event: ProgressEvent) => void
): Promise<GenerationResult> {

  const emit       = onProgress;
  const emitInfo   = (m: string)                   => emit({ type: 'info',    message: m });
  const emitOk     = (m: string)                   => emit({ type: 'success', message: m });
  const emitWarn   = (m: string)                   => emit({ type: 'warn',    message: m });
  const emitSec    = (m: string)                   => emit({ type: 'section', message: m });
  const emitPrev   = (m: string, d: Record<string, unknown>) => emit({ type: 'preview', message: m, data: d });

  // Mini callback adaptor for downloader / optimizer
  const progressCb = (msg: string, t?: 'info' | 'success' | 'warn') =>
    emit({ type: t ?? 'info', message: msg });

  const projectName = slugify(input.projectName.trim()) || 'my-website';
  const date        = getDateSuffix();
  const outputDir   = path.join(os.tmpdir(), 'figma-to-html', `${projectName}-${Date.now()}`);

  const config: GeneratorConfig = {
    desktopUrl:  input.desktopUrl.trim(),
    mobileUrl:   input.mobileUrl.trim(),
    apiToken:    input.apiToken,
    projectName,
    outputDir:   path.dirname(outputDir),
    date,
  };

  const paths = {
    root:   outputDir,
    css:    path.join(outputDir, 'css'),
    js:     path.join(outputDir, 'js'),
    images: path.join(outputDir, 'assets', 'images'),
    icons:  path.join(outputDir, 'assets', 'icons'),
    fonts:  path.join(outputDir, 'assets', 'fonts'),
  };

  await fs.ensureDir(paths.root);
  await fs.ensureDir(paths.css);
  await fs.ensureDir(paths.js);
  await fs.ensureDir(paths.images);
  await fs.ensureDir(paths.icons);
  await fs.ensureDir(paths.fonts);

  // ── 1. Parse URLs ─────────────────────────────────────────
  emitSec('Connecting to Figma');
  const desktopInfo = parseFigmaUrl(config.desktopUrl);
  const mobileInfo  = parseFigmaUrl(config.mobileUrl);
  emitInfo(`Desktop file key: ${desktopInfo.fileKey}`);
  emitInfo(`Mobile file key:  ${mobileInfo.fileKey}`);

  const client = new FigmaClient(input.apiToken);

  // ── 2. Fetch files ────────────────────────────────────────
  emitSec('Fetching Figma Files');
  let desktopFile, mobileFile;

  try {
    emitInfo('Fetching desktop file…');
    desktopFile = await withTimeout(client.getFile(desktopInfo.fileKey), 60_000, 'Desktop file fetch timed out (60s)');
    emitOk(`Desktop: "${desktopFile.name}"`);
  } catch (e: any) {
    throw new Error(friendlyFetchError(e, 'desktop'));
  }

  try {
    emitInfo('Fetching mobile file…');
    mobileFile = await withTimeout(client.getFile(mobileInfo.fileKey), 60_000, 'Mobile file fetch timed out (60s)');
    emitOk(`Mobile: "${mobileFile.name}"`);
  } catch (e: any) {
    throw new Error(friendlyFetchError(e, 'mobile'));
  }

  emitOk('Figma token authenticated ✔');

  // ── 3. Parse designs ──────────────────────────────────────
  emitSec('Parsing Designs');

  const desktopDesign = parseFigmaFile(desktopFile, 'desktop', desktopInfo.nodeId);
  emitOk(`Desktop: ${desktopDesign.sections.length} sections`);

  // Send section preview data
  emitPrev('sections', {
    desktop: desktopDesign.sections.map(s => ({ name: s.name, tag: s.semanticTag, class: s.className })),
  });

  desktopDesign.sections.forEach(s => emitInfo(`  • ${s.semanticTag.toUpperCase()} › ${s.name}`));

  const mobileDesign = parseFigmaFile(mobileFile, 'mobile', mobileInfo.nodeId);
  emitOk(`Mobile: ${mobileDesign.sections.length} sections`);

  // ── 4. Extract assets ─────────────────────────────────────
  emitSec('Extracting Assets');

  const dImageFills = extractImageFills(desktopFile.document);
  const dVectors    = extractVectors(desktopFile.document);
  const dAssets     = buildAssetList(dImageFills, dVectors, 'desktop', date);

  const mImageFills = extractImageFills(mobileFile.document);
  const mVectors    = extractVectors(mobileFile.document);
  const mAssets     = buildAssetList(mImageFills, mVectors, 'mobile', date);

  const totalAssetCount = dAssets.length + mAssets.length;
  emitInfo(`Desktop: ${dAssets.length} assets (${dImageFills.length} images, ${dVectors.length} icons)`);
  emitInfo(`Mobile:  ${mAssets.length} assets (${mImageFills.length} images, ${mVectors.length} icons)`);

  // Send asset preview data
  emitPrev('assets', {
    total: totalAssetCount,
    images: dImageFills.length + mImageFills.length,
    icons:  dVectors.length + mVectors.length,
    list:   [...dAssets, ...mAssets].map(a => ({ name: a.fileName, type: a.type })),
  });

  // ── 5. Resolve image fill URLs ────────────────────────────
  emitSec('Downloading Assets');

  const dRefs   = dImageFills.map(f => f.imageRef);
  const mRefs   = mImageFills.map(f => f.imageRef);
  const dRefMap = await fetchImageRefUrls(desktopInfo.fileKey, dRefs, client, progressCb);
  const mRefMap = await fetchImageRefUrls(mobileInfo.fileKey,  mRefs, client, progressCb);

  // ── 6. Download ───────────────────────────────────────────
  if (dAssets.length > 0) emitInfo(`Downloading ${dAssets.length} desktop asset(s)…`);
  const dResults = await downloadAssets(desktopInfo.fileKey, dAssets, paths.root, client, dRefMap, progressCb);

  if (mAssets.length > 0) emitInfo(`Downloading ${mAssets.length} mobile asset(s)…`);
  const mResults = await downloadAssets(mobileInfo.fileKey,  mAssets, paths.root, client, mRefMap, progressCb);

  const dlD = dResults.filter(r => r.success).map(r => r.asset);
  const dlM = mResults.filter(r => r.success).map(r => r.asset);
  emitOk(`Downloaded ${dlD.length + dlM.length} / ${totalAssetCount} assets`);

  // ── 7. Optimize ───────────────────────────────────────────
  emitSec('Optimizing Assets');
  await optimizeImages([...dlD, ...dlM], progressCb);
  await optimizeSvgs([...dlD,  ...dlM], progressCb);

  // ── 8. Fonts ──────────────────────────────────────────────
  emitSec('Detecting Fonts');
  const allFonts = deduplicateFonts([
    ...extractFonts(desktopFile.document, desktopFile),
    ...extractFonts(mobileFile.document,  mobileFile),
  ]);
  const googleFontsUrl = buildGoogleFontsUrl(allFonts);
  const fontFamilies   = [...new Set(allFonts.map(f => f.family))];

  if (fontFamilies.length) {
    emitOk(`Fonts: ${fontFamilies.join(', ')}`);
    if (googleFontsUrl) emitInfo('Google Fonts CDN link generated');
    emitPrev('fonts', { families: fontFamilies });
  } else {
    emitInfo('No custom fonts detected — using system fonts');
  }

  // ── 9. Generate HTML ──────────────────────────────────────
  emitSec('Generating HTML');
  const hasJs = needsJS(desktopDesign, mobileDesign);

  let html = generateHTML({ desktopDesign, mobileDesign, projectName, googleFontsUrl, hasJs });
  try { html = await prettier.format(html, { parser: 'html', printWidth: 120, tabWidth: 2 }); } catch { /* ok */ }
  await fs.writeFile(path.join(paths.root, 'index.html'), html, 'utf8');
  emitOk(`index.html generated (${desktopDesign.sections.length} sections)`);

  // ── 10. Generate CSS ──────────────────────────────────────
  emitSec('Generating CSS');
  let css = generateCSS(desktopDesign, mobileDesign);
  try { css = await prettier.format(css, { parser: 'css', printWidth: 100, tabWidth: 2 }); } catch { /* ok */ }
  await fs.writeFile(path.join(paths.css, 'style.css'), css, 'utf8');
  emitOk(`style.css generated (7 responsive breakpoints)`);

  // ── 11. Generate JS ───────────────────────────────────────
  emitSec('Generating JavaScript');
  let js = hasJs
    ? generateJS(desktopDesign, mobileDesign)
    : `'use strict';\n// Custom scripts\n`;
  try { js = await prettier.format(js, { parser: 'babel', printWidth: 100, tabWidth: 2 }); } catch { /* ok */ }
  await fs.writeFile(path.join(paths.js, 'script.js'), js, 'utf8');
  emitOk(hasJs ? 'script.js generated (sticky nav, scroll, animations)' : 'script.js placeholder created');

  // ── 12. Generate README ───────────────────────────────────
  emitSec('Generating README');
  const readme = generateReadme(config, dlD, dlM, allFonts);
  await fs.writeFile(path.join(paths.root, 'README.md'), readme, 'utf8');
  emitOk('README.md generated');

  // ── Done ──────────────────────────────────────────────────
  const totalDownloaded = dlD.length + dlM.length;
  emit({
    type: 'done',
    message: `Generation complete!`,
    data: {
      sections:    desktopDesign.sections.length,
      assets:      totalDownloaded,
      fonts:       fontFamilies.length,
      fontNames:   fontFamilies,
      projectName,
    },
  });

  return { outputDir: paths.root, projectName, totalAssets: totalDownloaded, sections: desktopDesign.sections.length, fonts: fontFamilies };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function friendlyFetchError(e: any, which: string): string {
  const status = e?.response?.status;
  if (status === 401 || status === 403)
    return `Figma token rejected (${status}). Ensure "File content → Read" scope is enabled on your token.`;
  if (status === 404)
    return `${which} Figma file not found (404). Check the URL and confirm you have access.`;
  if (e?.message?.includes('timeout') || e?.code === 'ECONNABORTED')
    return `${which} file fetch timed out. Check your internet connection and try again.`;
  return `Failed to fetch ${which} file: ${e?.message ?? e}`;
}
