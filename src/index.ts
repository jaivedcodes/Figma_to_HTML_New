import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs-extra';
import ora from 'ora';
import chalk from 'chalk';
import dayjs from 'dayjs';

import { logger } from './utils/logger';
import { parseFigmaUrl, buildGoogleFontsUrl, deduplicateFonts, getDateSuffix, slugify } from './utils/helpers';
import { buildOutputPaths } from './utils/config';

import { FigmaClient } from './figma/client';
import { parseFigmaFile } from './figma/parser';
import {
  extractImageFills,
  extractVectors,
  extractFonts,
  buildAssetList,
} from './figma/extractor';

import { downloadAssets, fetchImageRefUrls } from './assets/downloader';
import { optimizeImages, optimizeSvgs } from './assets/optimizer';

import { generateHTML }   from './generators/html';
import { generateCSS }    from './generators/css';
import { generateJS, needsJS } from './generators/js';
import { generateReadme } from './generators/readme';

import { GeneratorConfig, ParsedDesign, ParsedAsset, ParsedFont } from './types/index';
import prettier from 'prettier';

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.banner();

  // ── 1. Collect inputs ──────────────────────────────────────
  logger.section('Configuration');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'desktopUrl',
      message: chalk.cyan('Desktop Figma URL:'),
      validate: (v: string) => v.includes('figma.com') ? true : 'Please enter a valid Figma URL.',
    },
    {
      type: 'input',
      name: 'mobileUrl',
      message: chalk.cyan('Mobile Figma URL:'),
      validate: (v: string) => v.includes('figma.com') ? true : 'Please enter a valid Figma URL.',
    },
    {
      type: 'password',
      name: 'apiToken',
      message: chalk.cyan('Figma Personal Access Token:'),
      mask: '*',
      validate: (v: string) => v.length > 10 ? true : 'Token too short.',
    },
    {
      type: 'input',
      name: 'projectName',
      message: chalk.cyan('Output project name:'),
      default: 'my-website',
      validate: (v: string) => v.trim().length > 0 ? true : 'Project name is required.',
    },
    {
      type: 'input',
      name: 'outputDir',
      message: chalk.cyan('Output directory:'),
      default: './output',
    },
  ]);

  const config: GeneratorConfig = {
    desktopUrl:  answers.desktopUrl.trim(),
    mobileUrl:   answers.mobileUrl.trim(),
    apiToken:    answers.apiToken,
    projectName: slugify(answers.projectName.trim()),
    outputDir:   answers.outputDir.trim(),
    date:        getDateSuffix(),
  };

  // ── 2. Validate token + parse URLs ─────────────────────────
  logger.section('Connecting to Figma');

  const client = new FigmaClient(config.apiToken);

  const spinner = ora('Validating Figma token…').start();
  try {
    const me = await client.validateToken();
    spinner.succeed(`Authenticated as ${chalk.green(me.handle)} (${me.email})`);
  } catch (err) {
    spinner.fail('Authentication failed. Check your Figma token.');
    logger.error(String(err));
    process.exit(1);
  }

  const desktopUrlInfo = parseFigmaUrl(config.desktopUrl);
  const mobileUrlInfo  = parseFigmaUrl(config.mobileUrl);

  logger.dim(`Desktop file key: ${desktopUrlInfo.fileKey}`);
  if (desktopUrlInfo.nodeId) logger.dim(`Desktop node ID:  ${desktopUrlInfo.nodeId}`);
  logger.dim(`Mobile file key:  ${mobileUrlInfo.fileKey}`);
  if (mobileUrlInfo.nodeId) logger.dim(`Mobile node ID:   ${mobileUrlInfo.nodeId}`);

  // ── 3. Fetch Figma files ───────────────────────────────────
  logger.section('Fetching Figma Files');

  let desktopFile, mobileFile;

  const fetchSpinner = ora('Fetching desktop file…').start();
  try {
    desktopFile = await client.getFile(desktopUrlInfo.fileKey);
    fetchSpinner.succeed(`Desktop: "${desktopFile.name}"`);
  } catch (err) {
    fetchSpinner.fail('Failed to fetch desktop Figma file.');
    logger.error(String(err));
    process.exit(1);
  }

  const mobileSpinner = ora('Fetching mobile file…').start();
  try {
    mobileFile = await client.getFile(mobileUrlInfo.fileKey);
    mobileSpinner.succeed(`Mobile:  "${mobileFile.name}"`);
  } catch (err) {
    mobileSpinner.fail('Failed to fetch mobile Figma file.');
    logger.error(String(err));
    process.exit(1);
  }

  // ── 4. Parse designs ──────────────────────────────────────
  logger.section('Parsing Designs');

  let desktopDesign: ParsedDesign, mobileDesign: ParsedDesign;

  try {
    const dSpinner = ora('Parsing desktop design…').start();
    desktopDesign = parseFigmaFile(desktopFile, 'desktop', desktopUrlInfo.nodeId);
    dSpinner.succeed(`Desktop: ${desktopDesign.sections.length} sections detected.`);
  } catch (err) {
    logger.error(`Failed to parse desktop design: ${err}`);
    process.exit(1);
  }

  try {
    const mSpinner = ora('Parsing mobile design…').start();
    mobileDesign = parseFigmaFile(mobileFile, 'mobile', mobileUrlInfo.nodeId);
    mSpinner.succeed(`Mobile:  ${mobileDesign.sections.length} sections detected.`);
  } catch (err) {
    logger.error(`Failed to parse mobile design: ${err}`);
    process.exit(1);
  }

  // Log section names
  logger.dim(`Desktop sections: ${desktopDesign!.sections.map((s) => s.name).join(', ')}`);
  logger.dim(`Mobile sections:  ${mobileDesign!.sections.map((s) => s.name).join(', ')}`);

  // ── 5. Extract assets ─────────────────────────────────────
  logger.section('Extracting Assets');

  const outputPaths = buildOutputPaths(config);
  await fs.ensureDir(outputPaths.root);
  await fs.ensureDir(outputPaths.css);
  await fs.ensureDir(outputPaths.js);
  await fs.ensureDir(outputPaths.images);
  await fs.ensureDir(outputPaths.icons);
  await fs.ensureDir(outputPaths.fonts);

  const date = config.date;

  // Desktop assets
  const dImageFills = extractImageFills(desktopFile.document);
  const dVectors    = extractVectors(desktopFile.document);
  const dAssets     = buildAssetList(dImageFills, dVectors, 'desktop', date);

  // Mobile assets
  const mImageFills = extractImageFills(mobileFile.document);
  const mVectors    = extractVectors(mobileFile.document);
  const mAssets     = buildAssetList(mImageFills, mVectors, 'mobile', date);

  logger.info(`Desktop assets: ${dAssets.length} (${dImageFills.length} images, ${dVectors.length} SVGs)`);
  logger.info(`Mobile assets:  ${mAssets.length} (${mImageFills.length} images, ${mVectors.length} SVGs)`);

  // ── 6. Fetch image ref URLs ────────────────────────────────
  const dImageRefs = dImageFills.map((f) => f.imageRef).filter(Boolean);
  const mImageRefs = mImageFills.map((f) => f.imageRef).filter(Boolean);

  const dRefUrlMap = await fetchImageRefUrls(desktopUrlInfo.fileKey, dImageRefs, client);
  const mRefUrlMap = await fetchImageRefUrls(mobileUrlInfo.fileKey, mImageRefs, client);

  // ── 7. Download assets ────────────────────────────────────
  logger.section('Downloading Assets');

  const dResults = await downloadAssets(
    desktopUrlInfo.fileKey, dAssets, outputPaths.root, client, dRefUrlMap
  );
  const mResults = await downloadAssets(
    mobileUrlInfo.fileKey, mAssets, outputPaths.root, client, mRefUrlMap
  );

  const downloadedDAssets = dResults.filter((r) => r.success).map((r) => r.asset);
  const downloadedMAssets = mResults.filter((r) => r.success).map((r) => r.asset);

  // ── 8. Optimize assets ────────────────────────────────────
  logger.section('Optimizing Assets');

  await optimizeImages([...downloadedDAssets, ...downloadedMAssets]);
  await optimizeSvgs([...downloadedDAssets, ...downloadedMAssets]);

  // ── 9. Generate fonts list ────────────────────────────────
  const allFonts = deduplicateFonts([
    ...extractFonts(desktopFile.document, desktopFile),
    ...extractFonts(mobileFile.document, mobileFile),
  ]);

  const googleFontsUrl = buildGoogleFontsUrl(allFonts);
  if (googleFontsUrl) {
    logger.info(`Google Fonts URL generated for: ${[...new Set(allFonts.filter((f) => f.isGoogleFont).map((f) => f.family))].join(', ')}`);
  }

  // ── 10. Generate HTML ─────────────────────────────────────
  logger.section('Generating HTML');

  const hasJs = needsJS(desktopDesign!, mobileDesign!);

  let html = generateHTML({
    desktopDesign: desktopDesign!,
    mobileDesign:  mobileDesign!,
    projectName:   config.projectName,
    googleFontsUrl,
    hasJs,
  });

  // Format with Prettier
  try {
    html = await prettier.format(html, { parser: 'html', printWidth: 120, tabWidth: 2 });
  } catch { /* leave unformatted if Prettier fails */ }

  const htmlPath = path.join(outputPaths.root, 'index.html');
  await fs.writeFile(htmlPath, html, 'utf8');
  logger.success(`HTML written: ${path.relative(process.cwd(), htmlPath)}`);

  // ── 11. Generate CSS ──────────────────────────────────────
  logger.section('Generating CSS');

  let css = generateCSS(desktopDesign!, mobileDesign!);

  try {
    css = await prettier.format(css, { parser: 'css', printWidth: 100, tabWidth: 2 });
  } catch { /* leave unformatted */ }

  const cssPath = path.join(outputPaths.css, 'style.css');
  await fs.writeFile(cssPath, css, 'utf8');
  logger.success(`CSS written: ${path.relative(process.cwd(), cssPath)}`);

  // ── 12. Generate JS ───────────────────────────────────────
  let jsPath: string | undefined;
  if (hasJs) {
    logger.section('Generating JS');
    let js = generateJS(desktopDesign!, mobileDesign!);
    try {
      js = await prettier.format(js, { parser: 'babel', printWidth: 100, tabWidth: 2 });
    } catch { /* leave unformatted */ }
    jsPath = path.join(outputPaths.js, 'script.js');
    await fs.writeFile(jsPath, js, 'utf8');
    logger.success(`JS written: ${path.relative(process.cwd(), jsPath)}`);
  } else {
    // Write minimal script.js placeholder
    jsPath = path.join(outputPaths.js, 'script.js');
    await fs.writeFile(jsPath, `'use strict';\n// Custom scripts go here\n`, 'utf8');
  }

  // ── 13. Generate README ───────────────────────────────────
  logger.section('Generating README');

  const readme = generateReadme(
    config,
    downloadedDAssets,
    downloadedMAssets,
    allFonts
  );

  const readmePath = path.join(outputPaths.root, 'README.md');
  await fs.writeFile(readmePath, readme, 'utf8');
  logger.success(`README written: ${path.relative(process.cwd(), readmePath)}`);

  // ── 14. Summary ───────────────────────────────────────────
  const totalAssets = downloadedDAssets.length + downloadedMAssets.length;

  console.log('');
  console.log(chalk.green.bold('  ╔═══════════════════════════════════════╗'));
  console.log(chalk.green.bold('  ║') + chalk.white.bold('        Generation Complete! ✔          ') + chalk.green.bold('║'));
  console.log(chalk.green.bold('  ╚═══════════════════════════════════════╝'));
  console.log('');
  logger.info(`Project:   ${chalk.white.bold(config.projectName)}`);
  logger.info(`Output:    ${chalk.white(outputPaths.root)}`);
  logger.info(`Sections:  ${chalk.white(desktopDesign!.sections.length + ' desktop, ' + mobileDesign!.sections.length + ' mobile')}`);
  logger.info(`Assets:    ${chalk.white(totalAssets + ' downloaded')}`);
  logger.info(`Fonts:     ${chalk.white([...new Set(allFonts.map((f) => f.family))].join(', ') || 'system fonts')}`);
  console.log('');
  logger.success('Open ' + chalk.cyan(path.join(outputPaths.root, 'index.html')) + ' in your browser.');
  console.log('');
}

main().catch((err) => {
  logger.error(`Unexpected error: ${err}`);
  if (err.stack) console.error(chalk.gray(err.stack));
  process.exit(1);
});

