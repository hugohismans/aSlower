// Test de pureté : applique aux sources de src/ les règles d'imports du contrat
// (docs/interfaces.md, « Imports permis ») :
// - chaque dossier n'importe que ce qui lui est permis ;
// - les fichiers « purs » n'utilisent ni window, ni document, ni three, et n'importent
//   que des fichiers purs ;
// - localStorage et sessionStorage ne sont utilisés que dans src/storage.js ;
// - aucune chaîne de src/ ne contient de clé « hh-… » (préfixe du portfolio, même origine).
// Les sources sont lues comme du texte (fs) : rien n'est exécuté. Les fichiers absents
// (écrits par d'autres lots) sont ignorés ; un fichier qui existe doit respecter les règles.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* ------------------------------------------------------------------------- */
/* Analyse lexicale minimale du JavaScript                                    */
/* ------------------------------------------------------------------------- */

/** Mots-clés après lesquels « / » ouvre une expression régulière (et non une division). */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
  'else', 'yield', 'await',
]);

const IDENT_CHAR = /[\w$\u0080-￿]/;

/** « / » ouvre-t-il une regex, vu le jeton significatif précédent ? */
function regexAllowed(prev) {
  if (prev === '') return true;
  if (prev === 'string' || prev === 'regex') return false;
  if (IDENT_CHAR.test(prev[0])) return REGEX_KEYWORDS.has(prev); // mot ou nombre
  return prev !== ')' && prev !== ']';
}

/**
 * Sépare le code JS de ses commentaires, chaînes, gabarits et expressions régulières.
 * @param {string} src
 * @returns {{code: string, bare: string, strings: string[]}}
 *   code : source sans commentaires (sauts de ligne conservés, pour les numéros de ligne) ;
 *   bare : idem, avec le contenu des chaînes, gabarits et regex remplacé par des espaces ;
 *   strings : contenu brut des chaînes et des morceaux de gabarits.
 */
function scanJs(src) {
  let code = '';
  let bare = '';
  const strings = [];
  const templateStack = []; // profondeur d'accolades à l'ouverture de chaque ${
  let depth = 0;
  let prev = '';
  let i = 0;
  const n = src.length;

  const keep = (s) => {
    code += s;
    bare += s;
  };
  const blank = (s) => {
    code += s;
    bare += s.replace(/[^\n]/g, ' ');
  };
  const drop = (s) => {
    const newlines = s.replace(/[^\n]/g, '');
    code += newlines;
    bare += newlines;
  };

  // Lit un morceau de gabarit (après « ` » ou après la « } » d'un ${ … }).
  const readTemplate = () => {
    let j = i;
    while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    if (j >= n) throw new Error('gabarit non fermé');
    strings.push(src.slice(i, j));
    blank(src.slice(i, j));
    if (src[j] === '`') {
      keep('`');
      i = j + 1;
      prev = 'string';
    } else {
      keep('${');
      i = j + 2;
      templateStack.push(depth);
      prev = '{';
    }
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? n : end;
      drop(src.slice(i, j));
      i = j;
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('commentaire non fermé');
      drop(src.slice(i, end + 2));
      i = end + 2;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (src[j] !== ch) throw new Error('chaîne non fermée');
      strings.push(src.slice(i + 1, j));
      keep(ch);
      blank(src.slice(i + 1, j));
      keep(ch);
      i = j + 1;
      prev = 'string';
    } else if (ch === '`') {
      keep('`');
      i += 1;
      readTemplate();
    } else if (ch === '/' && regexAllowed(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      if (src[j] !== '/') throw new Error('expression régulière non fermée');
      keep('/');
      blank(src.slice(i + 1, j));
      keep('/');
      i = j + 1;
      while (i < n && /[a-z]/i.test(src[i])) keep(src[i++]); // drapeaux
      prev = 'regex';
    } else if (IDENT_CHAR.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j += 1;
      prev = src.slice(i, j);
      keep(prev);
      i = j;
    } else if (/\s/.test(ch)) {
      keep(ch);
      i += 1;
    } else {
      if (ch === '}' && templateStack.length && templateStack[templateStack.length - 1] === depth) {
        // Fin d'un ${ … } : on reprend la lecture du gabarit.
        templateStack.pop();
        keep('}');
        i += 1;
        readTemplate();
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      keep(ch);
      i += 1;
      prev = ch;
    }
  }
  return { code, bare, strings };
}

/** Numéro de ligne (1…) d'un index du code. */
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Imports d'un code sans commentaires : statiques (import/export … from), de bord
 * (import 'x') et dynamiques (import('x')). Un import dynamique dont l'argument n'est
 * pas une chaîne simple est rendu avec specifier = null (non analysable).
 * @returns {{specifier: string | null, line: number}[]}
 */
function findImports(code) {
  const found = [];
  // Espaces facultatifs (import{A}from'x', import*as T from'x') ; le lookbehind écarte les
  // chaînes 'import' / 'export' suivies d'une autre chaîne et les propriétés (a.import).
  const staticRe = /(?<![\w$.'"`])(?:import|export)\b\s*(?:[\w$*{},\s]*?[\s}*]?from\s*)?(['"])([^'"\n]+)\1/g;
  for (const m of code.matchAll(staticRe)) found.push({ specifier: m[2], line: lineAt(code, m.index) });
  const dynamicRe = /\bimport\s*\(/g;
  for (const m of code.matchAll(dynamicRe)) {
    const rest = code.slice(m.index + m[0].length);
    const literal = /^\s*(['"`])([^'"`$\n]+)\1\s*[,)]/.exec(rest);
    found.push({ specifier: literal ? literal[2] : null, line: lineAt(code, m.index) });
  }
  return found;
}

/* ------------------------------------------------------------------------- */
/* Règles du contrat                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Zone d'un fichier de src/ (chemin relatif à la racine, séparateur « / »), ou null
 * si le contrat ne le couvre pas.
 */
function areaOf(path) {
  if (path === 'src/storage.js') return 'storage';
  if (path === 'src/main.js' || path === 'src/loop.js') return 'entry';
  const m = /^src\/(physics|game|render|hud|input|levels)\//.exec(path);
  return m ? m[1] : null;
}

/**
 * Imports permis par zone (docs/interfaces.md). Chaque zone peut importer ses propres
 * fichiers. `rawDocs` : documentation Markdown importée en ?raw (écran Crédits).
 * `files` : fichiers précis permis en plus (game : render/layout.js, fichier pur qui développe
 * les scènes paramétriques des niveaux).
 * Les feuilles de style sont liées dans index.html, jamais importées depuis hud/ ou input/.
 */
const RULES = {
  physics: { allowed: ['physics'] },
  storage: { allowed: [] },
  game: { allowed: ['game', 'physics', 'storage'], files: ['src/render/layout.js'] },
  levels: { allowed: ['levels'] },
  render: { allowed: ['render', 'physics', 'storage', 'three'] },
  hud: { allowed: ['hud', 'physics', 'storage'], rawDocs: true },
  input: { allowed: ['input'] },
  entry: { allowed: '*' },
};

/** Fichiers purs : ni window, ni document, ni three ; n'importent que des fichiers purs. */
const PURE_FILES = [
  'src/render/subdivide.js',
  'src/render/lod.js',
  'src/render/culling.js',
  'src/render/facades.js',
  'src/render/layout.js',
  'src/render/adaptiveDpr.js',
  'src/render/streetPlan.js',
  'src/render/decorLayout.js',
  'src/render/decorMesher.js',
  'src/hud/format.js',
  'src/hud/levelFormat.js',
  'src/hud/skyMath.js',
  'src/input/tiltMath.js',
  'src/game/conditions.js',
  'src/game/bubbles.js',
  'src/game/validate.js',
  'src/game/level.js',
  'src/game/rules.js',
  'src/game/score.js',
  'src/game/states.js',
  'src/game/bot.js',
  'src/levels/index.js',
];
const isPure = (path) => path.startsWith('src/physics/') || PURE_FILES.includes(path);

/**
 * Cible d'un import vu depuis `fromFile`.
 * @returns {{kind: 'three' | 'npm' | 'file', path: string, query: string, area: string}}
 */
function resolveTarget(fromFile, specifier) {
  const [pathPart, query = ''] = specifier.split('?');
  if (!pathPart.startsWith('.') && !pathPart.startsWith('/')) {
    const parts = pathPart.split('/');
    const name = pathPart.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const kind = name === 'three' ? 'three' : 'npm';
    return { kind, path: name, query, area: kind === 'three' ? 'three' : `paquet npm « ${name} »` };
  }
  const path = pathPart.startsWith('/')
    ? posix.normalize(pathPart.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromFile), pathPart));
  const area = areaOf(path) ?? (path.startsWith('src/') ? 'src hors contrat' : 'hors de src');
  return { kind: 'file', path, query, area };
}

/**
 * Infractions d'un fichier JS de src/ aux règles du contrat.
 * @param {string} file chemin relatif à la racine (« src/physics/player.js »)
 * @param {string} source texte du fichier
 * @returns {string[]} messages (vide si tout est en règle)
 */
function checkFile(file, source) {
  const problems = [];
  let scan;
  try {
    scan = scanJs(source);
  } catch (error) {
    return [`${file} : analyse impossible (${error.message})`];
  }
  const { code, bare, strings } = scan;
  const area = areaOf(file);
  const rule = area ? RULES[area] : null;
  if (!rule) {
    problems.push(`${file} : fichier hors du contrat (ajouter sa règle dans docs/interfaces.md et tests/purity.test.js)`);
  }

  for (const { specifier, line } of findImports(code)) {
    if (specifier === null) {
      if (rule?.allowed !== '*') problems.push(`${file}:${line} : import dynamique non analysable`);
      continue;
    }
    const target = resolveTarget(file, specifier);
    if (rule && rule.allowed !== '*') {
      const isRawDoc = target.kind === 'file' && /(^|&)raw(&|$)/.test(target.query) && target.path.endsWith('.md');
      const isExtraFile = target.kind === 'file' && (rule.files ?? []).includes(target.path);
      const permitted = rule.allowed.includes(target.area) || (rule.rawDocs && isRawDoc) || isExtraFile;
      if (!permitted) {
        const allowed = rule.allowed.length ? rule.allowed.join(', ') : 'rien';
        problems.push(`${file}:${line} : importe « ${specifier} » (${target.area}) ; ${area} n'a droit qu'à : ${allowed}`);
      }
    }
    if (isPure(file)) {
      if (target.kind === 'three') problems.push(`${file}:${line} : fichier pur qui importe three`);
      else if (target.kind === 'file' && !isPure(target.path) && !/\.json$/.test(target.path)) {
        problems.push(`${file}:${line} : fichier pur qui importe un fichier non pur (${target.path})`);
      }
    }
  }

  if (isPure(file)) {
    for (const global of ['window', 'document']) {
      const m = new RegExp(`\\b${global}\\b`).exec(bare);
      if (m) problems.push(`${file}:${lineAt(bare, m.index)} : fichier pur qui utilise ${global}`);
    }
  }

  if (file !== 'src/storage.js') {
    const m = /\b(localStorage|sessionStorage)\b/.exec(code);
    if (m) problems.push(`${file}:${lineAt(code, m.index)} : ${m[1]} hors de src/storage.js`);
  }

  const hh = strings.find((s) => /\bhh-/.test(s));
  if (hh !== undefined) problems.push(`${file} : chaîne « ${hh} » (préfixe hh- du portfolio interdit ; utiliser storage.js)`);

  return problems;
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                      */
/* ------------------------------------------------------------------------- */

/** Fichiers JS de src/ (chemins relatifs à la racine, séparateur « / »). */
function sourceFiles() {
  return readdirSync(join(ROOT, 'src'), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(js|mjs)$/.test(e.name))
    .map((e) => relative(ROOT, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

describe('analyseur du test (commentaires, chaînes, gabarits, regex)', () => {
  it('ignore les commentaires et vide les chaînes dans « bare »', () => {
    const { code, bare, strings } = scanJs("// window\n/* document\n */ const a = 'document';\nwindow.x = a;");
    expect(code).not.toContain('// window');
    expect(code.split('\n')).toHaveLength(4); // lignes conservées
    expect(bare).not.toContain('document');
    expect(bare).toContain('window.x');
    expect(strings).toEqual(['document']);
  });

  it('reconnaît une regex qui contient des guillemets, et la division', () => {
    const { strings, bare } = scanJs("const r = /['\"]\\//g; const q = a / b / c; const s = 'hh-x';");
    expect(strings).toEqual(['hh-x']);
    expect(bare).toContain('a / b / c');
  });

  it('suit les gabarits imbriqués', () => {
    const { strings, bare } = scanJs('const t = `a ${ {b: `c${d}`}.b } e`; window.y = 1;');
    expect(strings).toEqual(['a ', 'c', '', ' e']);
    expect(bare).toContain('window.y');
  });

  it('trouve les imports statiques, de bord et dynamiques', () => {
    const { code } = scanJs(
      "import {\n  A,\n  B,\n} from '../physics/constants.js';\nimport './x.css';\nexport * from \"./y.js\";\n" +
        "const n = import('../../THIRD_PARTY_NOTICES.md?raw');\nconst k = import(`./${id}.js`);\n" +
        "/** @param {import('three').Camera} c */",
    );
    expect(findImports(code)).toEqual([
      { specifier: '../physics/constants.js', line: 1 },
      { specifier: './x.css', line: 5 },
      { specifier: './y.js', line: 6 },
      { specifier: '../../THIRD_PARTY_NOTICES.md?raw', line: 7 },
      { specifier: null, line: 8 },
    ]);
    // Sans espaces (aucun formateur n'impose la forme) : rien ne doit échapper au contrat.
    expect(findImports(scanJs("import{A}from'three';export{b}from'./z.js';import*as T from'three';").code)).toEqual([
      { specifier: 'three', line: 1 },
      { specifier: './z.js', line: 1 },
      { specifier: 'three', line: 1 },
    ]);
    // Pas de faux positif : chaînes 'import' / 'export', propriété nommée from, import.meta.
    expect(
      findImports(scanJs("const k = ['import', 'export']; export const from = 'x'; const u = import.meta.url;").code),
    ).toEqual([]);
  });
});

describe('les règles détectent les infractions (fichiers fictifs)', () => {
  it('fichier pur : three, window, document, import non pur', () => {
    const problems = checkFile(
      'src/physics/fake.js',
      "import { Vector3 } from 'three';\nimport { REL } from '../render/uniforms.js';\nconst w = window.innerWidth;\ndocument.title = 'x';",
    );
    expect(problems.join('\n')).toMatch(/importe three/);
    expect(problems.join('\n')).toMatch(/fichier non pur/);
    expect(problems.join('\n')).toMatch(/utilise window/);
    expect(problems.join('\n')).toMatch(/utilise document/);
    expect(problems.join('\n')).toMatch(/physics n'a droit qu'à : physics/);
  });

  it('fichier pur hors de physics (render/lod.js) : window interdit, mais pas dans un commentaire', () => {
    expect(checkFile('src/render/lod.js', '// ni window ni document\nexport const a = 1;')).toEqual([]);
    expect(checkFile('src/render/lod.js', 'export const w = () => window.devicePixelRatio;')).toHaveLength(1);
  });

  it('stockage : localStorage hors de storage.js et clés hh- refusés', () => {
    expect(checkFile('src/hud/hud.js', "localStorage.setItem('aslower:v1:a', '1');")).toHaveLength(1);
    expect(checkFile('src/storage.js', 'const s = globalThis.localStorage;')).toEqual([]);
    expect(checkFile('src/game/rules.js', "const KEY = 'hh-theme';")).toHaveLength(1);
    expect(checkFile('src/game/rules.js', 'const KEY = `hh-${id}`;')).toHaveLength(1);
  });

  it('imports par zone : input sans physics, hud avec la documentation ?raw', () => {
    expect(checkFile('src/input/touch.js', "import { C } from '../physics/constants.js';")).toHaveLength(1);
    expect(checkFile('src/hud/credits.js', "const t = import('../../THIRD_PARTY_NOTICES.md?raw');")).toEqual([]);
    expect(checkFile('src/hud/credits.js', "import x from '../../package.json';")).toHaveLength(1);
    expect(checkFile('src/storage.js', "import { C } from './physics/constants.js';")).toHaveLength(1);
    expect(checkFile('src/main.js', "import * as THREE from 'three';\nimport { local } from './storage.js';")).toEqual([]);
    expect(checkFile('src/render/camera.js', "import { PerspectiveCamera } from 'three';")).toEqual([]);
    expect(checkFile('src/game/x.js', "import { PerspectiveCamera } from 'three';")).toHaveLength(1);
    // game : render/layout.js (pur) seulement, pas le reste de render/.
    expect(checkFile('src/game/x.js', "import { expandScene } from '../render/layout.js';")).toEqual([]);
    expect(checkFile('src/game/x.js', "import { buildCity } from '../render/cityMesher.js';")).toHaveLength(1);
    expect(checkFile('src/levels/index.js', "import { C } from '../physics/constants.js';")).toHaveLength(1);
    expect(checkFile('src/foo.js', 'export const a = 1;')[0]).toMatch(/hors du contrat/);
  });
});

describe('sources de src/ (docs/interfaces.md, « Imports permis »)', () => {
  const files = sourceFiles();

  it('trouve les sources (le test n’est pas vide)', () => {
    expect(files).toContain('src/physics/constants.js');
  });

  for (const file of files) {
    it(`${file} respecte le contrat`, () => {
      expect(checkFile(file, read(file))).toEqual([]);
    });
  }

  // Les fichiers purs nommés dans le contrat : vérifiés dès qu'ils existent.
  for (const file of PURE_FILES) {
    it.skipIf(!existsSync(join(ROOT, file)))(`${file} est pur`, () => {
      expect(isPure(file)).toBe(true);
      expect(checkFile(file, read(file))).toEqual([]);
    });
  }
});
