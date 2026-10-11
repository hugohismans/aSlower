// Application installable : public/manifest.webmanifest (champs, portée /aSlower/ de Pages),
// icônes PNG versionnées aux bonnes tailles, balises de index.html (manifeste, iOS).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** Largeur et hauteur d'un PNG (en-tête IHDR). */
function pngSize(path) {
  const buffer = readFileSync(path);
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

describe('manifeste', () => {
  it('nom, portée et départ sous /aSlower/ (GitHub Pages), plein écran en paysage', () => {
    expect(manifest.name).toBe('Le Coursier relativiste');
    expect(manifest.short_name).toBe('Coursier');
    expect(manifest.start_url).toBe('/aSlower/');
    expect(manifest.scope).toBe('/aSlower/');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.display_override).toEqual(['fullscreen', 'standalone']);
    expect(manifest.orientation).toBe('landscape');
  });

  it('couleurs du jeu (fond --bg de base.css, theme-color de index.html)', () => {
    const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(readFileSync(join(ROOT, 'src', 'styles', 'base.css'), 'utf8'))[1];
    expect(manifest.background_color).toBe(bg);
    expect(manifest.theme_color).toBe(bg);
    expect(html).toContain(`<meta name="theme-color" content="${bg}" />`);
  });

  it('icônes PNG présentes aux tailles déclarées (192, 512, maskable)', () => {
    const sizes = new Set();
    for (const icon of manifest.icons) {
      const path = join(ROOT, 'public', icon.src);
      expect(existsSync(path), icon.src).toBe(true);
      const [w, h] = pngSize(path);
      expect(`${w}x${h}`).toBe(icon.sizes);
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/')).toBe(false); // relatif au manifeste (sous /aSlower/)
      sizes.add(`${icon.sizes}:${icon.purpose}`);
    }
    expect(sizes).toContain('192x192:any');
    expect(sizes).toContain('512x512:any');
    expect(sizes).toContain('512x512:maskable');
  });

  it('index.html : manifeste, icône Apple 180 px et balises iOS', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(pngSize(join(ROOT, 'public', 'icons', 'apple-touch-icon.png'))).toEqual([180, 180]);
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+" \/>/);
  });
});
