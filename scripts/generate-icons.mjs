#!/usr/bin/env node
/**
 * Génère les icônes PNG de l'application installable (public/icons/) à partir de
 * public/favicon.svg, rasterisé par Chromium (Playwright). Les PNG sont versionnés : ce
 * script n'est relancé qu'après une modification du favicon. Playwright n'est pas une
 * dépendance du projet : on utilise une installation globale.
 *
 * Usage : PW_PATH=$(npm root -g)/playwright node scripts/generate-icons.mjs
 *
 * Icônes produites :
 * - apple-touch-icon.png (180 px) : opaque, à fond plein (iOS arrondit lui-même les coins et
 *   noircirait la transparence) ;
 * - icon-192.png et icon-512.png : le favicon tel quel (coins arrondis transparents),
 *   « purpose: any » du manifeste ;
 * - icon-maskable-512.png : fond plein, dessin réduit à 76 % (zone sûre des icônes
 *   « maskable » d'Android : disque de 80 %).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH ?? 'playwright');

/** Fond du favicon (rectangle arrondi de public/favicon.svg). */
const BACKGROUND = '#14163a';

const svg = readFileSync(join(ROOT, 'public', 'favicon.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const outDir = join(ROOT, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, background: BACKGROUND, scale: 1 },
  { file: 'icon-192.png', size: 192, background: null, scale: 1 },
  { file: 'icon-512.png', size: 512, background: null, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, background: BACKGROUND, scale: 0.76 },
];

const browser = await chromium.launch();
try {
  for (const { file, size, background, scale } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const art = Math.round(size * scale);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;display:flex;` +
        `align-items:center;justify-content:center;background:${background ?? 'transparent'}">` +
        `<img src="${dataUrl}" width="${art}" height="${art}" style="display:block"></body></html>`,
    );
    await page.waitForFunction(() => document.images[0]?.complete);
    await page.screenshot({ path: join(outDir, file), omitBackground: background === null });
    await page.close();
    console.log(`public/icons/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
