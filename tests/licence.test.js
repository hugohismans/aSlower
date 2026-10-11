// Tests des licences, sur les SOURCES seulement (dist/ est vérifié après le build par
// scripts/check-dist.mjs) :
// (a) THIRD_PARTY_NOTICES.md contient le texte MIT intégral d'OpenRelativity (identique,
//     espaces normalisés, à public/licences/openrelativity-MIT.txt) et celui de three.js ;
// (b) chaque fichier du tableau « fichiers dérivés » qui existe commence par l'en-tête
//     d'attribution, et tout fichier de src/ qui porte cet en-tête figure dans le tableau ;
// (c) LICENSE est la licence MIT de Hugo Hismans, LICENSE-CONTENT.md la CC BY 4.0.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** Compare deux textes de licence aux espaces près (sauts de ligne, retraits, fin de fichier). */
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

/** Contenu des blocs de code délimités par ``` d'un texte Markdown. */
function codeBlocks(markdown) {
  return [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
}

/**
 * Lignes du tableau « | fichier | source:lignes | nature | » de THIRD_PARTY_NOTICES.md.
 * @returns {{file: string, sources: string[], nature: string}[]}
 */
function derivedFiles(markdown) {
  const lines = markdown.split('\n');
  const header = lines.findIndex((l) => /^\|\s*fichier\s*\|\s*source:lignes\s*\|\s*nature\s*\|\s*$/.test(l));
  if (header < 0) return [];
  const rows = [];
  // On saute l'en-tête et la ligne de séparation |---|---|---|, puis on lit jusqu'à la
  // première ligne qui n'est plus une ligne de tableau.
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replace(/^`|`$/g, ''));
    const [file, source, nature] = cells;
    rows.push({ file, sources: source.split(';').map((s) => s.trim()), nature });
  }
  return rows;
}

/**
 * Premier commentaire « /*! … *\/ » d'un fichier, s'il commence dans ses premières lignes.
 * @returns {string | null}
 */
function legalHeader(text, maxLines = 5) {
  const start = text.indexOf('/*!');
  if (start < 0) return null;
  const line = text.slice(0, start).split('\n').length;
  if (line > maxLines) return null;
  const end = text.indexOf('*/', start);
  return end < 0 ? null : text.slice(start, end + 2);
}

/** Fichiers (chemins relatifs à la racine, séparateur « / ») d'un dossier, récursivement. */
function walk(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => relative(ROOT, join(e.parentPath, e.name)).split(sep).join('/'));
}

const notices = read('THIRD_PARTY_NOTICES.md');

describe('(a) THIRD_PARTY_NOTICES.md : textes MIT intégraux', () => {
  const blocks = codeBlocks(notices).map(normalize);

  it('contient le texte MIT d’OpenRelativity, identique à public/licences/openrelativity-MIT.txt', () => {
    const served = read('public/licences/openrelativity-MIT.txt');
    expect(served).toContain('Copyright (c) 2013 Massachusetts Institute of Technology');
    expect(served).toContain('Permission is hereby granted, free of charge');
    expect(served).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(blocks).toContain(normalize(served));
  });

  it('contient le texte MIT de three.js, identique au fichier LICENSE du paquet', () => {
    const three = readFileSync(join(ROOT, 'node_modules/three/LICENSE'), 'utf8');
    expect(blocks).toContain(normalize(three));
  });

  it('cite la provenance (dépôt, commit) et la non-affiliation', () => {
    expect(notices).toContain('https://github.com/MITGameLab/OpenRelativity');
    expect(notices).toContain('35b806a1224ff96047c1ce3c907e7c68bb9e540e');
    expect(notices).toMatch(/non affilié|ni affilié/);
    expect(notices).toContain('Wyman');
  });

  it('ne contient pas d’en-tête « /*! » (sinon check-dist pourrait passer sans les vrais en-têtes)', () => {
    expect(notices).not.toContain('/*!');
  });
});

describe('(b) en-têtes des fichiers dérivés d’OpenRelativity', () => {
  const rows = derivedFiles(notices);

  it('le tableau des fichiers dérivés est lisible et complet (8 fichiers au jalon 1)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(row.file).toMatch(/^src\/\S+\.(js|glsl)$/);
      expect(row.nature).toMatch(/^(Adapté|Inspiré)$/);
      expect(row.sources.every((s) => /^[\w.]+\.(cs|shader)(:\d+-\d+(, \d+-\d+)*)?$/.test(s))).toBe(true);
    }
    expect(new Set(rows.map((r) => r.file)).size).toBe(rows.length);
  });

  // Les fichiers sont écrits par plusieurs lots : on vérifie ceux qui existent déjà.
  for (const row of rows) {
    it.skipIf(!existsSync(join(ROOT, row.file)))(`${row.file} commence par l’en-tête d’attribution`, () => {
      const header = legalHeader(read(row.file));
      expect(header, 'commentaire « /*! » absent des premières lignes').not.toBeNull();
      expect(header).toContain('OpenRelativity');
      expect(header).toContain('Massachusetts Institute of Technology');
      expect(header).toContain('SPDX-License-Identifier: MIT');
      expect(header).toContain('THIRD_PARTY_NOTICES.md');
      // Même nature et mêmes lignes d'origine que dans le tableau.
      expect(header).toContain(`${row.nature} d'OpenRelativity`);
      for (const source of row.sources) expect(header).toContain(source);
    });
  }

  it('tout fichier de src/ qui porte un en-tête OpenRelativity figure dans le tableau', () => {
    const listed = new Set(rows.map((r) => r.file));
    const withHeader = walk('src').filter((file) => {
      if (!/\.(js|mjs|glsl)$/.test(file)) return false;
      const header = legalHeader(read(file));
      return header !== null && header.includes('OpenRelativity');
    });
    expect(withHeader.filter((f) => !listed.has(f))).toEqual([]);
  });
});

describe('(c) licences du projet', () => {
  it('LICENSE est la licence MIT de Hugo Hismans (2026)', () => {
    const text = normalize(read('LICENSE'));
    expect(text.startsWith('MIT License Copyright (c) 2026 Hugo Hismans')).toBe(true);
    expect(text).toContain(
      'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction',
    );
    expect(text).toContain(
      'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
    );
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
  });

  it('LICENSE-CONTENT.md place les contenus sous CC BY 4.0', () => {
    const text = read('LICENSE-CONTENT.md');
    expect(text).toContain('Creative Commons Attribution 4.0 International');
    expect(text).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(text).toContain('https://creativecommons.org/licenses/by/4.0/legalcode.fr');
    expect(text).toContain('src/levels/**/*.json');
    expect(text).toContain('src/data/**/*.json');
  });

  it('package.json déclare les deux licences', () => {
    expect(JSON.parse(read('package.json')).license).toBe('MIT AND CC-BY-4.0');
  });
});
