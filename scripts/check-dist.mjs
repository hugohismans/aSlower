#!/usr/bin/env node
/**
 * Vérification des licences dans le site construit (lancé par `npm run build`, en postbuild).
 *
 * La licence MIT d'OpenRelativity exige l'avis de copyright et le texte de la licence dans
 * toute copie : le site publié en est une. Ce script échoue (code de sortie 1) si dist/ ne
 * contient pas :
 * - dist/index.html ;
 * - dans au moins un dist/assets/*.js, un commentaire légal « /*! … » EN DÉBUT DE LIGNE qui
 *   cite OpenRelativity et le Massachusetts Institute of Technology (gardé par
 *   build.rolldownOptions.output.comments.legal). L'en-tête des shaders GLSL importés en ?raw
 *   ne compte pas : il est dans une chaîne (« `/*! »), et il resterait publié même si
 *   comments.legal disparaissait. Limite : un /*! placé ailleurs qu'en ligne 1 d'un .glsl
 *   se retrouverait en début de ligne dans le gabarit et compterait (les en-têtes GLSL
 *   sont tous en ligne 1) ;
 * - dist/licences/openrelativity-MIT.txt (copié depuis public/) ;
 * - dist/licences/npm-dependencies.txt (généré par build.license) avec le texte MIT de three.
 *
 * Usage : node scripts/check-dist.mjs [dossier]   (dossier par défaut : dist/ du projet)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(process.argv[2] ?? join(ROOT, 'dist'));

const problems = [];
const fail = (message) => problems.push(message);
const readIfExists = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** Vrai si un commentaire légal « /*! … *\/ » en début de ligne cite OpenRelativity et le MIT. */
function hasOpenRelativityHeader(text) {
  for (const [comment] of text.matchAll(/^\/\*![\s\S]*?\*\//gm)) {
    if (comment.includes('OpenRelativity') && comment.includes('Massachusetts Institute of Technology')) return true;
  }
  return false;
}

if (!existsSync(dist)) {
  fail(`dossier ${dist} introuvable : lancer « npm run build » d'abord.`);
} else {
  if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html est absent.');

  // 1. En-tête d'attribution OpenRelativity dans le JavaScript publié.
  const assets = join(dist, 'assets');
  const scripts = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js')) : [];
  if (scripts.length === 0) {
    fail('aucun fichier dist/assets/*.js.');
  } else if (!scripts.some((f) => hasOpenRelativityHeader(readFileSync(join(assets, f), 'utf8')))) {
    fail(
      "aucun dist/assets/*.js ne contient l'en-tête « /*! … OpenRelativity … Massachusetts Institute of Technology … */ » " +
        '(vérifier build.rolldownOptions.output.comments.legal dans vite.config.js et les en-têtes des fichiers dérivés).',
    );
  }

  // 2. Texte de la licence MIT d'OpenRelativity, servi avec le jeu.
  const orLicence = readIfExists(join(dist, 'licences', 'openrelativity-MIT.txt'));
  if (orLicence === null) {
    fail('dist/licences/openrelativity-MIT.txt est absent (copie de public/licences/).');
  } else if (!orLicence.includes('Copyright (c) 2013 Massachusetts Institute of Technology')) {
    fail("dist/licences/openrelativity-MIT.txt ne contient pas l'avis de copyright du MIT.");
  }

  // 3. Licences des dépendances empaquetées (three.js), générées par build.license.
  const npmLicences = readIfExists(join(dist, 'licences', 'npm-dependencies.txt'));
  if (npmLicences === null) {
    fail('dist/licences/npm-dependencies.txt est absent (vérifier build.license dans vite.config.js).');
  } else if (!/\bthree\b/.test(npmLicences) || !npmLicences.includes('MIT')) {
    fail('dist/licences/npm-dependencies.txt ne mentionne pas three et sa licence MIT.');
  } else if (!npmLicences.includes('Permission is hereby granted')) {
    fail('dist/licences/npm-dependencies.txt ne contient pas le texte intégral de la licence MIT.');
  }
}

if (problems.length > 0) {
  console.error(`check-dist : ÉCHEC — licences incomplètes dans ${dist}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-dist : OK — en-tête OpenRelativity et licences présents dans ${dist}`);
