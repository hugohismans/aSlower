/**
 * Plan du sol (module pur : ni DOM, ni three) : géométrie des marquages et des revêtements que
 * render/streetMap.js dessine sur la carte des rues.
 *
 * Repère du jeu (x vers l'est, y vers le nord, m). Une rue est un segment {from, to, width}
 * (width = chaussée ; streetMap ajoute SIDEWALK_WIDTH de trottoir de chaque côté, et toutes
 * les rues sont tracées avec des bouts carrés : la chaussée déborde de width/2 aux deux bouts).
 *
 * - Place : rue dont la chaussée fait au moins PLAZA_MIN_WIDTH (« Place de l'Horloge », place
 *   au bout de l'avenue) ; dallée au lieu d'asphaltée, sans marquage propre.
 * - Carrefour : partie d'une rue dont l'axe passe dans la chaussée d'une autre rue (non
 *   parallèle, ou place de toute orientation) ; calcul par rectangle, si bien que les T, les
 *   croix et une rue qui finit DANS une place (sans atteindre son axe, ou dans son axe) sont
 *   traités de la même façon.
 * - Bras : de part et d'autre d'un carrefour, s'il reste assez de rue libre, un passage piéton
 *   zébré en retrait (CROSSWALK) puis une ligne d'arrêt sur la voie entrante (circulation à
 *   droite) ; la ligne axiale (tirets) s'arrête avant la ligne d'arrêt.
 *
 * Échelle : la carte a au plus 2 px/m (souvent 1,5 à 2) ; aucun motif n'a de détail sous
 * 0,5 m (il scintillerait en mouvement). Les bandes du zébra font 1 m, séparées de 1 m : sur
 * une grille au demi-mètre, leurs bords tombent sur les pixels à 2 px/m.
 */

/** Largeur du trottoir de chaque côté de la chaussée (m). */
export const SIDEWALK_WIDTH = 3;
/** Chaussée à partir de laquelle une « rue » est une place (m). */
export const PLAZA_MIN_WIDTH = 40;
/** Bordure de trottoir : liseré de pierre claire au bord de la chaussée (m). */
export const CURB_WIDTH = 0.5;
/** Caniveau pavé, le long de la bordure, côté chaussée (m). */
export const GUTTER_WIDTH = 0.8;

/**
 * Passage piéton zébré : retrait depuis le bord de la chaussée croisée, longueur (le long de
 * la rue), largeur des bandes et des intervalles (en travers de la rue). Les bandes sont
 * parallèles à la circulation, comme en France ; le passage, lui, traverse la rue.
 */
export const CROSSWALK = Object.freeze({ setback: 1, length: 4, bar: 1, gap: 1 });
/** Ligne d'arrêt : distance au passage piéton et épaisseur (m). */
export const STOP_LINE = Object.freeze({ gap: 1.5, width: 0.5 });
/** Ligne axiale : épaisseur, tiret, intervalle (m). */
export const CENTER_LINE = Object.freeze({ width: 0.2, dash: 3, space: 6 });

/** Rue libre minimale d'un bras pour y peindre passage et ligne d'arrêt (m). */
const ARM_MIN = CROSSWALK.setback + CROSSWALK.length + STOP_LINE.gap + STOP_LINE.width + 3;
/** Recul de la ligne axiale devant un carrefour sans passage (m). */
const CENTER_LINE_CLEARANCE = 1;
/** Section de ligne axiale plus courte que ceci : non peinte (m). */
const CENTER_LINE_MIN = 2;
/** |sin| de l'angle entre deux rues sous lequel elles sont tenues pour parallèles. */
const PARALLEL_SIN = 0.2;

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {{from: Point, to: Point, width: number}} Street
 * @typedef {{t0: number, t1: number, crossWidth: number}} Junction
 *   partie [t0, t1] (m, abscisse depuis street.from) de l'axe d'une rue qui est dans la chaussée
 *   d'une autre ; crossWidth : chaussée la plus large parmi les rues croisées là
 * @typedef {{street: number, center: Point, along: Point, across: Point, length: number,
 *            width: number, bars: Point[][]}} Crosswalk
 *   passage piéton : centre, direction de la rue (unitaire, du carrefour vers le bras), normale,
 *   longueur le long de la rue, largeur peinte en travers ; bars : rectangles (4 sommets)
 * @typedef {{from: Point, to: Point, width: number}} Line
 */

/**
 * Une rue est-elle une place ?
 * @param {Street} street
 */
export function isPlaza(street) {
  return street.width >= PLAZA_MIN_WIDTH;
}

/** Repère d'une rue : origine, direction unitaire, normale (à gauche), longueur. */
function frame(street) {
  const dx = street.to.x - street.from.x;
  const dy = street.to.y - street.from.y;
  const length = Math.hypot(dx, dy);
  const d = length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  return { o: street.from, d, n: { x: -d.y, y: d.x }, length };
}

/**
 * Intervalle de t où a + t·b ∈ [lo, hi] (droite paramétrée), intersecté avec [t0, t1].
 * @returns {[number, number] | null}
 */
function clipSlab(a, b, lo, hi, t0, t1) {
  if (Math.abs(b) < 1e-12) return a >= lo && a <= hi ? [t0, t1] : null;
  let ta = (lo - a) / b;
  let tb = (hi - a) / b;
  if (ta > tb) [ta, tb] = [tb, ta];
  const s = Math.max(t0, ta);
  const e = Math.min(t1, tb);
  return s < e ? [s, e] : null;
}

/**
 * Carrefours de chaque rue : parties de son axe dans la chaussée (bouts carrés compris) d'une
 * autre rue non parallèle (ou d'une place, même parallèle), fusionnées et triées.
 * @param {Street[]} streets
 * @returns {Junction[][]} un tableau par rue (même ordre que `streets`)
 */
export function findJunctions(streets) {
  const frames = streets.map(frame);
  return streets.map((street, i) => {
    const f = frames[i];
    /** @type {Junction[]} */
    const raw = [];
    streets.forEach((other, j) => {
      if (j === i) return;
      const g = frames[j];
      const sin = f.d.x * g.n.x + f.d.y * g.n.y; // composante de d le long de la normale de l'autre
      // Une rue parallèle n'est pas un carrefour, sauf une place : ce qui en est recouvert
      // (une avenue qui y débouche dans l'axe) n'a pas de marquage.
      if (Math.abs(sin) < PARALLEL_SIN && !isPlaza(other)) return;
      const h = other.width / 2;
      const rel = { x: f.o.x - g.o.x, y: f.o.y - g.o.y };
      // Le long de l'autre rue (bouts carrés : ± h au-delà des extrémités), puis en travers.
      const along = clipSlab(rel.x * g.d.x + rel.y * g.d.y, f.d.x * g.d.x + f.d.y * g.d.y, -h, g.length + h, 0, f.length);
      if (!along) return;
      const across = clipSlab(rel.x * g.n.x + rel.y * g.n.y, sin, -h, h, along[0], along[1]);
      if (across) raw.push({ t0: across[0], t1: across[1], crossWidth: other.width });
    });
    raw.sort((a, b) => a.t0 - b.t0);
    /** @type {Junction[]} */
    const merged = [];
    for (const j of raw) {
      const last = merged[merged.length - 1];
      if (last && j.t0 <= last.t1 + 1e-9) {
        last.t1 = Math.max(last.t1, j.t1);
        last.crossWidth = Math.max(last.crossWidth, j.crossWidth);
      } else merged.push({ ...j });
    }
    return merged;
  });
}

/** Rectangle centré en c, demi-longueur hl selon u, demi-largeur hw selon v. */
function rect(c, u, v, hl, hw) {
  return [
    { x: c.x - u.x * hl - v.x * hw, y: c.y - u.y * hl - v.y * hw },
    { x: c.x + u.x * hl - v.x * hw, y: c.y + u.y * hl - v.y * hw },
    { x: c.x + u.x * hl + v.x * hw, y: c.y + u.y * hl + v.y * hw },
    { x: c.x - u.x * hl + v.x * hw, y: c.y - u.y * hl + v.y * hw },
  ];
}

/**
 * Bandes d'un passage piéton sur une chaussée de largeur `roadWidth` : autant de bandes que
 * possible entre les caniveaux, motif centré sur l'axe. Abscisses en travers de la rue.
 * @param {number} roadWidth
 * @returns {number[]} centres des bandes (m, depuis l'axe)
 */
export function crosswalkBarOffsets(roadWidth) {
  const usable = roadWidth - 2 * GUTTER_WIDTH;
  const pitch = CROSSWALK.bar + CROSSWALK.gap;
  const count = Math.max(0, Math.floor((usable + CROSSWALK.gap) / pitch));
  const first = -((count - 1) * pitch) / 2;
  return Array.from({ length: count }, (_, k) => first + k * pitch);
}

/**
 * Marquages et revêtements des rues.
 * @param {Street[]} streets
 * @returns {{plazas: number[], junctions: Junction[][], crosswalks: Crosswalk[],
 *            stopLines: Line[], centerLines: Line[]}}
 *   plazas : indices des places ; stopLines : segments (épaisseur STOP_LINE.width) ;
 *   centerLines : sections de ligne axiale (à tracer en tirets CENTER_LINE)
 */
export function planStreets(streets) {
  const junctions = findJunctions(streets);
  const plazas = [];
  /** @type {Crosswalk[]} */
  const crosswalks = [];
  /** @type {Line[]} */
  const stopLines = [];
  /** @type {Line[]} */
  const centerLines = [];

  streets.forEach((street, i) => {
    if (isPlaza(street)) {
      plazas.push(i);
      return;
    }
    const f = frame(street);
    if (f.length <= 0) return;
    const at = (t) => ({ x: f.o.x + f.d.x * t, y: f.o.y + f.d.y * t });
    const half = street.width / 2;
    const list = junctions[i];

    // Bras : de chaque côté de chaque carrefour, la rue libre jusqu'au carrefour voisin (ou au
    // bout). `edge` est le bord du carrefour, `sign` le sens du bras (+1 : vers `to`).
    /** Recul de la ligne axiale à chaque bord de carrefour : clé = abscisse du bord. */
    const trims = new Map();
    list.forEach((j, k) => {
      const sides = [
        { edge: j.t0, sign: -1, free: j.t0 - (k > 0 ? list[k - 1].t1 : 0) },
        { edge: j.t1, sign: +1, free: (k + 1 < list.length ? list[k + 1].t0 : f.length) - j.t1 },
      ];
      for (const side of sides) {
        if (side.free <= 0) continue;
        // Deux bras qui se font face partagent la rue libre entre deux carrefours.
        const between = side.sign < 0 ? k > 0 : k + 1 < list.length;
        const room = between ? side.free / 2 : side.free;
        if (room < ARM_MIN) {
          trims.set(side.edge, CENTER_LINE_CLEARANCE);
          continue;
        }
        const along = { x: f.d.x * side.sign, y: f.d.y * side.sign };
        const across = { x: -along.y, y: along.x }; // à gauche du bras = voie entrante (à droite)
        const cwStart = side.edge + side.sign * CROSSWALK.setback;
        const cwMid = cwStart + (side.sign * CROSSWALK.length) / 2;
        const center = at(cwMid);
        const offsets = crosswalkBarOffsets(street.width);
        const bars = offsets.map((o) =>
          rect({ x: center.x + across.x * o, y: center.y + across.y * o }, along, across, CROSSWALK.length / 2, CROSSWALK.bar / 2),
        );
        const width = offsets.length > 0 ? offsets[offsets.length - 1] - offsets[0] + CROSSWALK.bar : 0;
        crosswalks.push({ street: i, center, along, across, length: CROSSWALK.length, width, bars });
        const stopT = cwStart + side.sign * (CROSSWALK.length + STOP_LINE.gap + STOP_LINE.width / 2);
        const stopC = at(stopT);
        const reach = half - GUTTER_WIDTH;
        stopLines.push({ from: stopC, to: { x: stopC.x + across.x * reach, y: stopC.y + across.y * reach }, width: STOP_LINE.width });
        trims.set(side.edge, CROSSWALK.setback + CROSSWALK.length + STOP_LINE.gap + STOP_LINE.width + CENTER_LINE_CLEARANCE);
      }
    });

    // Ligne axiale : entre les carrefours, reculée devant chacun.
    let start = 0;
    let startTrim = 0;
    const sections = [];
    for (const j of list) {
      sections.push([start + startTrim, j.t0 - (trims.get(j.t0) ?? CENTER_LINE_CLEARANCE)]);
      start = j.t1;
      startTrim = trims.get(j.t1) ?? CENTER_LINE_CLEARANCE;
    }
    sections.push([start + startTrim, f.length]);
    for (const [a, b] of sections) {
      if (b - a >= CENTER_LINE_MIN) centerLines.push({ from: at(a), to: at(b), width: CENTER_LINE.width });
    }
  });

  return { plazas, junctions, crosswalks, stopLines, centerLines };
}

/**
 * Polygones de pelouse normalisés : sommets {x, y} (ou paires [x, y]), au moins 3, orientés
 * dans le sens trigonométrique (un seul chemin « nonzero » les remplit alors une seule fois,
 * même s'ils se recouvrent). Les polygones invalides sont ignorés.
 * @param {(Point[] | number[][])[]} greens
 * @returns {Point[][]}
 */
export function normalizeGreens(greens) {
  const out = [];
  for (const poly of greens ?? []) {
    if (!Array.isArray(poly)) continue;
    const pts = poly
      .map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p && { x: p.x, y: p.y }))
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length < 3) continue;
    const area = signedArea(pts);
    if (Math.abs(area) < 1e-9) continue;
    out.push(area > 0 ? pts : pts.reverse());
  }
  return out;
}

/** Aire signée (positive dans le sens trigonométrique). */
export function signedArea(pts) {
  let a = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Pieds d'arbres normalisés : {x, y, r} finis, r > 0.
 * @param {{x: number, y: number, r: number}[]} vegetation
 */
export function normalizeTreePits(vegetation) {
  return (vegetation ?? []).filter((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.r > 0);
}

/**
 * Détail du sol demandé par l'URL et le profil de qualité :
 * - `?solDetail=0` : 'off', la carte d'avant le jalon « ville vivante » (comparaison, mesures) ;
 * - profil « lite » : 'lite' (marquages, bordures et pelouses, sans motif de dalles) ;
 * - sinon 'full'.
 * @param {string} search ex. location.search
 * @param {'default' | 'lite'} [tier]
 * @returns {'off' | 'lite' | 'full'}
 */
export function groundDetailFor(search, tier = 'default') {
  const raw = new URLSearchParams(search).get('solDetail');
  if (raw !== null && raw.trim() === '0') return 'off';
  return tier === 'lite' ? 'lite' : 'full';
}

/** sRGB (0..1) → linéaire. */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Réflectances ir et uv d'un matériau de la palette, en fraction de sa luminance Y (sRGB
 * linéaire) : la passe d'environnement les multiplie par la luminance lue sur la carte, si
 * bien qu'une pelouse à l'ombre (ou plus sombre) garde un rapport ir/visible juste.
 * @param {{srgb: string, ir?: number, uv?: number}} entry ex. palette.vegetation
 * @returns {[number, number]}
 */
export function irUvPerLuminance(entry) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(entry.srgb);
  if (!m) throw new RangeError(`Couleur sRGB invalide : ${entry.srgb}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => srgbToLinear(parseInt(h, 16) / 255));
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [(entry.ir ?? 0) / Y, (entry.uv ?? 0) / Y];
}
