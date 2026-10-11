/**
 * Assemblage du monde d'une scène de src/data/scenes/ (docs/interfaces.md, « scene.js ») :
 * îlots maillés à la demande (LOD et coupe à la distance de visibilité), lampadaires,
 * passe ciel/sol/brouillard, cockpit, carte des rues et brouillard.
 *
 * Une image : update(snapshot, k, dtReal) puis render(camera).
 * - update : observateur relativiste (uniformes partagés), choix des matériaux (variantes
 *   « vision classique » quand k = 0), coupe des îlots au-delà de la visibilité, LOD de
 *   chaque îlot visible et distance r pour le tri des opaques (renderer.opaqueSort) ;
 * - render : un seul renderer.render() ; la caméra (et le cockpit qu'elle porte) est
 *   ajoutée à la scène au premier appel.
 *
 * Géométrie à la demande : un LOD n'est maillé que la première fois qu'il est demandé
 * (cityMesher le garde ensuite). Le maillage d'un îlot au LOD 0 coûte quelques
 * millisecondes sur GSM : au plus GENERATION_BUDGET_MS par image (les îlots les plus proches
 * d'abord) ; un îlot qui attend garde son LOD actuel, et un îlot qui apparaît prend d'abord
 * le LOD le plus grossier (rapide à mailler). La première mise à jour n'a pas de budget
 * (elle a lieu derrière l'écran de chargement).
 */
import { Mesh, Scene } from 'three';
import { EYE_HEIGHT } from '../physics/constants.js';
import { setCameraVisibility } from './camera.js';
import { DEFAULT_LOD_STEPS, buildCity } from './cityMesher.js';
import { createCockpit } from './cockpit.js';
import { createLevelObjects } from './levelObjects.js';
import { chunkDistance } from './culling.js';
import { apparentNearestDistance, chooseLod, shouldReleaseLod0 } from './lod.js';
import {
  createClassicVariant,
  createEmitterMaterial,
  createEnvironmentMaterial,
  createEnvironmentMesh,
  createSurfaceMaterial,
} from './materials.js';
import { warmup } from './renderer.js';
import { createStreetMap } from './streetMap.js';
import { REL, setStreetMap, setVisibility, updateObserver } from './uniforms.js';

/** Temps de maillage permis par image (ms) ; au moins un îlot est maillé par image. */
export const GENERATION_BUDGET_MS = 4;

/** Début du brouillard, en fraction de la distance où il devient opaque. */
export const FOG_NEAR_FRACTION = 0.25;

/** Angle apparent du coin du champ avant le premier rendu (rad), ≈ paysage 932 × 430. */
const DEFAULT_CORNER_ANGLE = (48 * Math.PI) / 180;

/**
 * Demi-angle apparent du coin de l'écran (rad) : angle entre l'axe de la caméra et la
 * direction du coin, pour une PerspectiveCamera (champ vertical `fov`, aspect largeur/hauteur).
 * @param {{fov: number, aspect: number}} camera
 */
export function cornerAngle(camera) {
  const tanV = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  return Math.atan(tanV * Math.sqrt(1 + camera.aspect * camera.aspect));
}

/**
 * Angle (rad) entre l'axe de la caméra (cap) et la vitesse ; 0 à l'arrêt.
 * En conduite arcade, le cap suit la vitesse : l'écart est nul dès qu'on roule.
 * @param {{vx: number, vy: number, heading: number}} snapshot
 */
function headingGap(snapshot) {
  const speed = Math.hypot(snapshot.vx, snapshot.vy);
  if (!(speed > 0)) return 0;
  const cos = (snapshot.vx * Math.cos(snapshot.heading) + snapshot.vy * Math.sin(snapshot.heading)) / speed;
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/**
 * Crée le monde d'une scène.
 * @param {import('three').WebGLRenderer} renderer
 * @param {any} sceneJson scène de src/data/scenes/ (schéma « coursier-scene/1 »)
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette src/data/palette.json
 * @param {{tier?: 'default' | 'lite', lodSteps?: number[], physics?: {lengthUnit: number},
 *          level?: import('./levelObjects.js').LevelView | null, facades?: 0 | 1 | 2}} [options]
 *   profil de qualité (choisit la visibilité « lite » ou « defaut » de la scène) ; pas des LOD
 *   (m) ; constantes physiques de la partie (physicsFor(c)) : la scène est développée pour
 *   leur unité de longueur L (défaut : réglage par défaut) ; level : vue statique d'un niveau
 *   (zones, clients, portes, lampes : render/levelObjects.js), mise à jour par updateLevel ;
 *   facades : détail des motifs de façade (quality.facades : 0 coupés, 1 simplifiés, 2 complets ;
 *   défaut : selon le profil)
 */
export function createWorld(renderer, sceneJson, palette, { tier = 'default', lodSteps, physics, level = null, facades } = {}) {
  const city = buildCity(sceneJson, palette, {
    ...(lodSteps ? { lodSteps } : {}),
    ...(physics ? { lengthUnit: physics.lengthUnit } : {}),
  });
  const steps = lodSteps ?? [...DEFAULT_LOD_STEPS];
  const coarsest = steps.length - 1;

  // Brouillard : opaque à la visibilité de la scène (qui sert aussi de coupe des îlots).
  const visibilityFar = tier === 'lite' ? city.visibility.lite : city.visibility.default;
  setVisibility(FOG_NEAR_FRACTION * visibilityFar, visibilityFar);

  // Carte des rues AVANT les matériaux : pas de sol uni provisoire.
  const streetMap = createStreetMap(city.streets, city.bounds, { buildings: city.buildings });
  setStreetMap(streetMap, city.bounds);

  // Matériaux relativistes et leurs variantes « vision classique » (mêmes uniformes).
  const relMaterials = {
    surface: createSurfaceMaterial({ facades: facades ?? (tier === 'lite' ? 1 : 2), palette }),
    emitter: createEmitterMaterial(),
    environment: createEnvironmentMaterial(),
  };
  const classicMaterials = {
    surface: createClassicVariant(relMaterials.surface),
    emitter: createClassicVariant(relMaterials.emitter),
    environment: createClassicVariant(relMaterials.environment),
  };
  let classic = false;
  let materials = relMaterials;

  const scene = new Scene();
  scene.name = sceneJson.id ?? 'scene';

  const environmentMesh = createEnvironmentMesh(materials.environment);
  scene.add(environmentMesh);

  /** Lampadaires : une seule géométrie, jamais coupée (au-delà du brouillard, ils s'y fondent). */
  let emitterMesh = null;
  if (city.emitters) {
    emitterMesh = new Mesh(city.emitters, materials.emitter);
    emitterMesh.name = 'lampadaires';
    emitterMesh.frustumCulled = false; // l'aberration ramène devant ce qui est derrière
    emitterMesh.matrixAutoUpdate = false;
    emitterMesh.userData.r = 0;
    scene.add(emitterMesh);
  }

  const cockpit = createCockpit();

  /** Éléments du niveau (zones, clients, portes, lampes), dans le même pipeline. */
  const levelObjects = level
    ? createLevelObjects(level, {
        surface: { rel: relMaterials.surface, classic: classicMaterials.surface },
        emitter: { rel: relMaterials.emitter, classic: classicMaterials.emitter },
      })
    : null;
  if (levelObjects) scene.add(levelObjects.group);

  /**
   * État de chaque îlot : mesh (créé à sa première apparition), LOD affiché, LOD déjà
   * maillés, distance monde au point le plus proche (mise à jour s'il est visible).
   * @type {{chunk: any, mesh: Mesh | null, lod: number | null, built: Set<number>,
   *         distance: number}[]}
   */
  const entries = city.chunks.map((chunk) => ({ chunk, mesh: null, lod: null, built: new Set(), distance: Infinity }));

  /** Caméras déjà rattachées à la scène (cockpit, plan lointain). */
  const cameras = new Set();
  let corner = DEFAULT_CORNER_ANGLE;
  let primed = false;
  let lastStats = { visibleChunks: 0, lodCounts: steps.map(() => 0), generated: 0, generationMs: 0 };
  let renderMs = 0;

  /** Affiche le LOD `level` d'un îlot (maillé à la demande) ; crée son mesh au besoin. */
  function showLod(entry, level) {
    const geometry = entry.chunk.lod(level);
    entry.built.add(level);
    entry.lod = level;
    if (!entry.mesh) {
      const mesh = new Mesh(geometry, materials.surface);
      mesh.name = `ilot:${entry.chunk.id}`;
      mesh.frustumCulled = false; // voir culling.js : le frustum de three précède l'aberration
      mesh.matrixAutoUpdate = false; // géométrie déjà dans le repère Three
      entry.mesh = mesh;
      scene.add(mesh);
    } else {
      entry.mesh.geometry = geometry;
    }
  }

  /** Libère le LOD 0 d'un îlot qui ne l'affiche pas, s'il est loin (mémoire CPU et GPU). */
  function releaseLod0(entry, distance) {
    if (entry.built.has(0) && shouldReleaseLod0(entry.lod, distance)) {
      entry.chunk.release(0);
      entry.built.delete(0);
    }
  }

  /** Bascule tous les meshes sur les matériaux relativistes ou « vision classique ». */
  function useClassic(on) {
    if (on === classic) return;
    classic = on;
    materials = on ? classicMaterials : relMaterials;
    environmentMesh.material = materials.environment;
    if (emitterMesh) emitterMesh.material = materials.emitter;
    for (const entry of entries) if (entry.mesh) entry.mesh.material = materials.surface;
    levelObjects?.setClassic(on);
  }

  /** Rattache une caméra à la scène (une fois) : cockpit, plan lointain. */
  function attachCamera(camera) {
    if (cameras.has(camera)) return;
    cameras.add(camera);
    scene.add(camera);
    camera.add(cockpit);
    setCameraVisibility(camera, visibilityFar);
  }

  return {
    /** Scène three (pour le préchauffage et les mesures). */
    scene,
    /** Départ de la scène : {x, y, heading} (repère du jeu). */
    start: city.start,
    /** Limites de la carte et segments de rue (repère du jeu). */
    bounds: city.bounds,
    streets: city.streets,
    /**
     * Emprises au sol des bâtiments (repère du jeu : x, y = centre ; width le long de x, depth
     * le long de y), pour game/bubbles.facadeAhead (bulles « façade dans l'axe »).
     */
    buildings: city.buildings,
    /** Distance où le brouillard devient opaque (m) : coupe des îlots. */
    visibilityFar,

    /**
     * Prépare l'image : observateur, matériaux, coupe, LOD et distances de tri.
     * @param {{x: number, y: number, vx: number, vy: number, gamma: number, heading: number, c: number}} snapshot
     *   instantané du joueur (physics/player.js)
     * @param {number} k 1 = relativiste, 0 = vision classique (variantes REL_CLASSIC)
     * @param {number} [_dtReal] durée réelle de l'image (s) ; réservé (animations futures)
     */
    update(snapshot, k, _dtReal = 0) {
      updateObserver(snapshot, k);
      useClassic(!(k > 0));

      // β et γ EFFECTIFS (ceux que voient les shaders), pour la règle des LOD.
      const beta = REL.uBeta.value.length();
      const gamma = REL.uGamma.value;
      const viewAngle = Math.min(Math.PI, corner + headingGap(snapshot));
      const eye = { x: snapshot.x, y: snapshot.y, z: EYE_HEIGHT };

      const visible = [];
      for (const entry of entries) {
        const distance = chunkDistance(entry.chunk, eye);
        if (distance <= visibilityFar) {
          entry.distance = distance;
          visible.push(entry);
        } else if (entry.mesh) {
          entry.mesh.visible = false;
          releaseLod0(entry, Infinity);
        }
      }
      visible.sort((a, b) => (a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : 0));

      const budget = primed ? GENERATION_BUDGET_MS : Infinity;
      primed = true;
      const start = performance.now();
      let generated = 0;
      const lodCounts = steps.map(() => 0);
      for (const entry of visible) {
        const apparent = apparentNearestDistance(entry.distance, gamma, beta, viewAngle);
        const wanted = chooseLod(entry.lod, apparent, gamma, beta, steps);
        if (wanted !== entry.lod) {
          if (entry.built.has(wanted)) {
            showLod(entry, wanted);
          } else if (generated === 0 || performance.now() - start < budget) {
            showLod(entry, wanted);
            generated += 1;
          } else if (entry.lod === null) {
            // Budget épuisé, îlot qui apparaît : le LOD le plus grossier tout de suite ;
            // le LOD voulu viendra aux images suivantes.
            if (!entry.built.has(coarsest)) generated += 1;
            showLod(entry, coarsest);
          }
        }
        releaseLod0(entry, entry.distance);
        entry.mesh.visible = true;
        // Distance à l'œil en cm, ENTIÈRE : sous V8, lire un flottant dans le comparateur du
        // tri des opaques l'alloue (≈ 23 Ko par image) ; un petit entier, non.
        entry.mesh.userData.r = Math.round(entry.distance * 100);
        lodCounts[entry.lod] += 1;
      }
      lastStats = { visibleChunks: visible.length, lodCounts, generated, generationMs: performance.now() - start };
    },

    /**
     * État vu des éléments du niveau (sans effet hors niveau) : à appeler après update().
     * @param {import('./levelObjects.js').LevelRenderState} state
     * @param {{x: number, y: number}} eye position du joueur (repère du jeu)
     * @param {number} [dtReal] durée réelle de l'image (s)
     */
    updateLevel(state, eye, dtReal = 0) {
      levelObjects?.update(state, { x: eye.x, y: eye.y, z: EYE_HEIGHT }, dtReal);
    },

    /**
     * Dessine l'image (un seul renderer.render).
     * @param {import('three').PerspectiveCamera} camera placée par camera.updateCamera
     */
    render(camera) {
      attachCamera(camera);
      corner = cornerAngle(camera);
      const t0 = performance.now();
      renderer.render(scene, camera);
      renderMs = performance.now() - t0;
    },

    /**
     * Mesures de la dernière image : appels de dessin et triangles (renderer.info),
     * îlots visibles et par LOD, maillages et leur durée, temps CPU de render().
     */
    stats() {
      const { calls, triangles } = renderer.info.render;
      return { calls, triangles, chunks: entries.length, ...lastStats, renderMs };
    },

    /**
     * Préchauffage (derrière l'écran de chargement) : compile tous les programmes, y compris
     * les variantes inactives, puis deux rendus. Appeler update() avant, pour que les îlots
     * visibles aient leur géométrie.
     * @param {import('three').PerspectiveCamera} camera
     * @returns {Promise<void>}
     */
    warmup(camera) {
      attachCamera(camera);
      const inactive = Object.values(classic ? relMaterials : classicMaterials);
      if (levelObjects) inactive.push(...levelObjects.ownMaterials); // lampes : deux variantes
      return warmup(renderer, scene, camera, inactive);
    },

    /**
     * Active ou coupe la passe ciel/sol/brouillard (diagnostic : mesurer son coût).
     * @param {boolean} on
     */
    setEnvironmentEnabled(on) {
      environmentMesh.visible = Boolean(on);
    },

    /** Libère géométries, matériaux et textures du monde (la LUT, partagée, est gardée). */
    dispose() {
      for (const camera of cameras) {
        camera.remove(cockpit);
        scene.remove(camera);
      }
      cameras.clear();
      for (const entry of entries) {
        if (entry.mesh) scene.remove(entry.mesh);
        for (const level of entry.built) entry.chunk.lod(level).dispose();
      }
      city.emitters?.dispose();
      levelObjects?.dispose();
      environmentMesh.geometry.dispose();
      cockpit.geometry.dispose();
      /** @type {import('three').Material} */ (cockpit.material).dispose();
      for (const material of [...Object.values(relMaterials), ...Object.values(classicMaterials)]) material.dispose();
      streetMap.dispose();
      scene.clear();
    },
  };
}
