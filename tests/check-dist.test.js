// Tests de scripts/check-dist.mjs : l'en-tête OpenRelativity doit être un VRAI commentaire
// légal du JavaScript publié (comments.legal), pas seulement la copie prise dans une chaîne
// par un shader importé en ?raw.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/check-dist.mjs', import.meta.url));
const HEADER = "/*! Adapté d'OpenRelativity — Copyright (c) 2013 Massachusetts Institute of Technology */";
const made = [];

/** Faux dossier dist/ complet, dont le seul JS publié est `js`. */
function fakeDist(js) {
  const dir = mkdtempSync(join(tmpdir(), 'check-dist-'));
  made.push(dir);
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'licences'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, 'assets', 'index.js'), js);
  writeFileSync(join(dir, 'licences', 'openrelativity-MIT.txt'), 'Copyright (c) 2013 Massachusetts Institute of Technology');
  writeFileSync(join(dir, 'licences', 'npm-dependencies.txt'), 'three MIT Permission is hereby granted');
  return dir;
}

/** Code de sortie du script sur `dir`. */
function run(dir) {
  try {
    execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

describe('check-dist', () => {
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  it('refuse un en-tête présent seulement dans une chaîne (shader ?raw, comments.legal perdu)', () => {
    expect(run(fakeDist('var a=`' + HEADER + '\nvoid main(){}`;'))).toBe(1);
  });

  it('accepte un vrai commentaire légal en début de ligne', () => {
    expect(run(fakeDist('import"./three.js";\n' + HEADER + '\nconst b=1;'))).toBe(0);
  });
});
