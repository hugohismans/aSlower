/*! Inspiré d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, ObjectMeshDensity.cs — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
/**
 * Subdivision des faces planes (module pur : ni DOM, ni three).
 *
 * Pourquoi subdiviser : l'aberration déplace chaque sommet vers sa direction
 * apparente, mais le GPU trace des segments droits entre sommets. Une arête longue
 * devient une corde de la vraie courbe. Il faut donc des arêtes assez courtes,
 * d'où une grille à pas maximal choisi par le LOD (render/lod.js).
 *
 * Idée reprise d'OpenRelativity (ObjectMeshDensity.cs) : découper le maillage
 * jusqu'à une taille maximale d'élément. Différences : OpenRelativity coupe chaque
 * triangle en 4 jusqu'à une aire < 2 m² ; ici, grille régulière à pas maximal
 * (bornes comprises), et bandes « fermeture éclair » entre lignes de sommets pour
 * raccorder sans jonction en T des faces voisines de pas différents.
 */

/** Deux niveaux plus proches que cette tolérance (m) sont confondus. */
export const LEVEL_TOLERANCE = 1e-6;

/**
 * Nombre de segments de longueur ≤ maxStep pour couvrir une longueur (au moins 1).
 * @param {number} length longueur (m)
 * @param {number} maxStep pas maximal (m), > 0
 */
export function segmentCount(length, maxStep) {
  if (!(maxStep > 0)) throw new Error(`Pas de subdivision invalide : ${maxStep}`);
  if (!(length > 0)) return 1;
  // − 1e-9 : une longueur multiple exacte du pas ne gagne pas un segment d'arrondi.
  return Math.max(1, Math.ceil(length / maxStep - 1e-9));
}

/**
 * Trie des valeurs et fusionne celles qui sont à moins de `tolerance` l'une de
 * l'autre (la première rencontrée est gardée). Ne modifie pas l'argument.
 * @param {number[]} values
 * @param {number} [tolerance]
 * @returns {number[]}
 */
export function uniqueSorted(values, tolerance = LEVEL_TOLERANCE) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > tolerance) out.push(v);
  }
  return out;
}

/**
 * Niveaux de a à b (inclus) : les bornes, les coupures imposées strictement entre
 * a et b, puis chaque intervalle découpé en parts égales de longueur ≤ maxStep.
 * Deux appels qui partagent les mêmes coupures sur un intervalle donnent les mêmes
 * niveaux sur cet intervalle (c'est ce qui rend les raccords conformes).
 * @param {number} a
 * @param {number} b b > a
 * @param {number} maxStep
 * @param {number[]} [breaks] coupures imposées (valeurs hors de ]a, b[ ignorées)
 * @returns {number[]} niveaux croissants, a et b compris
 */
export function splitRange(a, b, maxStep, breaks = []) {
  const inner = breaks.filter((t) => t > a + LEVEL_TOLERANCE && t < b - LEVEL_TOLERANCE);
  const cuts = uniqueSorted([a, b, ...inner]);
  const out = [cuts[0]];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lo = cuts[i];
    const hi = cuts[i + 1];
    const n = segmentCount(hi - lo, maxStep);
    for (let k = 1; k < n; k++) out.push(lo + ((hi - lo) * k) / n);
    out.push(hi); // valeur exacte de la coupure, sans erreur d'arrondi
  }
  return out;
}

/**
 * Grille sur un quadrilatère p0 → p1 → p2 → p3 (interpolation bilinéaire) aux
 * paramètres donnés. Ordre des sommets : i (le long de p0 → p1) varie le plus vite.
 * Triangles dans le sens de p0 → p1 → p2 → p3 (anti-horaire vu de devant si les
 * coins le sont).
 * @param {{x:number, y:number, z:number}} p0
 * @param {{x:number, y:number, z:number}} p1
 * @param {{x:number, y:number, z:number}} p2
 * @param {{x:number, y:number, z:number}} p3
 * @param {number[]} us paramètres croissants de 0 à 1 le long de p0 → p1
 * @param {number[]} vs paramètres croissants de 0 à 1 le long de p0 → p3
 * @returns {{positions: Float32Array, indices: Uint32Array}}
 */
export function gridQuad(p0, p1, p2, p3, us, vs) {
  const nu = us.length - 1;
  const nv = vs.length - 1;
  const positions = new Float32Array((nu + 1) * (nv + 1) * 3);
  let o = 0;
  for (let j = 0; j <= nv; j++) {
    const v = vs[j];
    for (let i = 0; i <= nu; i++) {
      const u = us[i];
      // Bilinéaire : (1−u)(1−v)·p0 + u(1−v)·p1 + uv·p2 + (1−u)v·p3.
      const w0 = (1 - u) * (1 - v);
      const w1 = u * (1 - v);
      const w2 = u * v;
      const w3 = (1 - u) * v;
      positions[o++] = w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x;
      positions[o++] = w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y;
      positions[o++] = w0 * p0.z + w1 * p1.z + w2 * p2.z + w3 * p3.z;
    }
  }
  const indices = new Uint32Array(nu * nv * 6);
  o = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i; // (i, j)
      const b = a + 1; // (i + 1, j)
      const c = b + nu + 1; // (i + 1, j + 1)
      const d = a + nu + 1; // (i, j + 1)
      indices[o++] = a;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = d;
    }
  }
  return { positions, indices };
}

const dist3 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/**
 * Subdivise un quadrilatère en grille régulière conforme : pas ≤ maxStep le long
 * des deux directions (les diagonales des cellules font au plus √2·maxStep), aucun
 * sommet ajouté sur un bord sans être partagé (pas de jonction en T). Deux
 * quadrilatères qui partagent une arête de même longueur reçoivent les mêmes
 * sommets sur cette arête.
 * @param {{x:number, y:number, z:number}} p0
 * @param {{x:number, y:number, z:number}} p1
 * @param {{x:number, y:number, z:number}} p2
 * @param {{x:number, y:number, z:number}} p3
 * @param {number} maxStep pas maximal (m)
 * @returns {{positions: Float32Array, indices: Uint32Array}}
 */
export function subdivideQuad(p0, p1, p2, p3, maxStep) {
  // Le plus long des deux côtés opposés fixe le nombre de segments : la grille
  // bilinéaire a alors des pas ≤ maxStep partout (combinaison convexe des côtés).
  const nu = segmentCount(Math.max(dist3(p0, p1), dist3(p3, p2)), maxStep);
  const nv = segmentCount(Math.max(dist3(p0, p3), dist3(p1, p2)), maxStep);
  const us = Array.from({ length: nu + 1 }, (_, i) => i / nu);
  const vs = Array.from({ length: nv + 1 }, (_, j) => j / nv);
  return gridQuad(p0, p1, p2, p3, us, vs);
}

/**
 * Triangule une bande entre deux lignes de sommets (« fermeture éclair ») :
 * chaque ligne garde tous ses sommets, même si les deux lignes n'en ont pas le
 * même nombre. Chaque triangle a deux sommets sur une ligne et un sur l'autre,
 * donc aucun n'est dégénéré tant que les paramètres d'une ligne sont distincts.
 *
 * Orientation : la ligne « gauche » est à u plus petit, les paramètres t croissent
 * vers le haut ; les triangles sont alors anti-horaires dans le plan (u, t).
 * Un niveau présent sur les deux lignes n'est jamais traversé par un triangle.
 * @param {ArrayLike<number>} leftIdx indices des sommets de la ligne gauche (t croissant)
 * @param {ArrayLike<number>} leftT paramètres de ces sommets
 * @param {ArrayLike<number>} rightIdx indices des sommets de la ligne droite (t croissant)
 * @param {ArrayLike<number>} rightT paramètres de ces sommets (mêmes extrémités que leftT)
 * @param {(a: number, b: number, c: number) => void} emit reçoit chaque triangle
 */
export function zipperStrip(leftIdx, leftT, rightIdx, rightT, emit) {
  const nl = leftIdx.length - 1;
  const nr = rightIdx.length - 1;
  let i = 0;
  let j = 0;
  while (i < nl || j < nr) {
    // On avance la ligne dont le prochain sommet est le plus bas (à égalité : la gauche).
    if (j === nr || (i < nl && leftT[i + 1] <= rightT[j + 1])) {
      emit(leftIdx[i], rightIdx[j], leftIdx[i + 1]);
      i++;
    } else {
      emit(leftIdx[i], rightIdx[j], rightIdx[j + 1]);
      j++;
    }
  }
}
