# Interfaces entre modules (jalons 1 à 3)

Ce document est le contrat entre les modules. Chaque signature ci-dessous doit être
respectée à la lettre ; un module ne dépend des autres que par ces signatures.
Les constantes partagées sont dans `src/physics/constants.js` (ne pas les dupliquer).

**Vitesse de la lumière : réglage du joueur** (décision du 2026-10-11). Entier c de
`C_MIN = 10` à `C_MAX = 100` m/s, `C_DEFAULT = 30`. Les constantes physiques de la partie
viennent de `physicsFor(c)` → `{c, a = c/ACCEL_TIME, lengthUnit = c·LENGTH_TIME}` (gelé ;
RangeError hors plage ou non entier), avec `ACCEL_TIME = 5` et `LENGTH_TIME = 10` : a = c/5,
c/a = 5 s pour tout c (0,76·c en 5 s de poussée), L = 10·c m = 2·c²/a (décision 11 ; L valait
c²/a quand a valait c/10). Le code du jeu ne lit jamais
les exports `C`, `A`, `LENGTH_UNIT` (= `DEFAULT_PHYSICS`, réglage par défaut) : ils ne servent
que de valeurs par défaut des fonctions pures et aux tests. La partie injecte ses constantes
dans le joueur (`createPlayer({physics})`), la scène (`lengthUnit`), et tout le reste lit
`snapshot.c`.

## Conventions générales

- JavaScript ES2020, modules ES, JSDoc pour les types. Identifiants et noms de fichiers
  en anglais ; commentaires, docs et textes d'interface en français.
- Données JSON en français, sans accents : clés en camelCase ; ids et noms de fichiers
  en kebab-case ASCII.
- **Repère du jeu** : x vers l'est, y vers le nord, z vers le haut, en mètres.
  **Repère Three.js** : X = x, Y = z, Z = −y (fonction `toThree` de `render/coords.js`).
- **Cap** : angle θ en radians, compté depuis +x vers +y (sens trigonométrique).
  Vecteur unitaire (hx, hy) = (cos θ, sin θ). θ = π/2 regarde vers le nord.
- **Volant** : `steer` ∈ [−1, 1] ; positif = tourner à droite = sens horaire = θ diminue.
- Vecteurs : objets simples `{x, y}` ou `{x, y, z}`. Aucune fonction ne modifie ses
  arguments, sauf `step` (qui modifie l'état du joueur) et les fonctions `…Into`.
- **Imports permis** (vérifiés par `tests/purity.test.js`) :
  - `src/physics/**` : uniquement `src/physics/**` ;
  - `src/storage.js` : rien ;
  - `src/game/**` : physics, storage (`game/settings.js` : réglage de c, `game/progress.js` :
    progression), et le seul fichier `src/render/layout.js` (pur : développe les scènes
    paramétriques des niveaux) ;
  - `src/levels/**` : rien (données JSON, chargées par `import.meta.glob`) ;
  - `src/render/**` : physics, storage, three ;
  - `src/hud/**` : physics, storage (+ fichiers `?raw` de documentation pour les Crédits) ;
  - `src/input/**` : rien d'autre que le DOM ;
  - `src/main.js`, `src/loop.js` : tout.
  - `localStorage` et `sessionStorage` ne sont utilisés que dans `src/storage.js`.
  - Les fichiers « purs » (`physics/**`, `render/subdivide.js`, `render/lod.js`,
    `render/culling.js`, `render/layout.js`, `render/decorLayout.js`, `render/decorMesher.js`,
    `render/adaptiveDpr.js`, `hud/format.js`,
    `hud/levelFormat.js`,
    `input/tiltMath.js`, `game/conditions.js`, `game/bubbles.js`, `game/validate.js`,
    `game/level.js`, `game/rules.js`, `game/score.js`, `game/states.js`, `game/bot.js`,
    `levels/index.js`) n'utilisent ni `window`, ni `document`, ni `three`, et n'importent que
    des fichiers purs (ou du JSON). `game/progress.js` n'est pas pur (stockage).

## `src/physics/relativity.js` (pur)

Chaque fonction qui dépend de c la reçoit en dernier paramètre facultatif `c` (défaut : `C`,
réglage par défaut) ; Doppler et aberration (β sans dimension) n'en dépendent pas.

```js
gammaFromU(ux, uy, c = C)          // √(1 + (ux² + uy²)/c²)
velocityFromU(ux, uy, c = C)       // → {x, y}, |v| < c
uFromVelocity(vx, vy, c = C)       // → {x, y} ; lève une erreur si |v| ≥ c
rapidityFromU(ux, uy, c = C)       // asinh(|u|/c)
composeVelocities(v, w, c = C)     // v ⊕ w (vitesse du référentiel d'abord), → {x, y}
                                   // (v + w∥ + w⊥/γ_v)/(1 + v·w/c²)
hyperbolicSegment(ux, uy, ax, ay, h, c = C)
  // Poussée propre constante (ax, ay) pendant le temps propre h, forme exacte.
  // → {ux, uy, dx, dy, dt}. Identique à v₀ ⊕ C·tanh(|a|h/C)·â
  // (â fixe dans le référentiel comobile initial ; découpage indifférent seulement si a ∥ u₀).
dopplerFactor(beta, n)             // γ(1 + β·n) ; beta, n : {x, y, z}, n unitaire
                                   // (direction observateur → source) ; > 1 devant
aberrate(beta, n)                  // → {x, y, z, D} : direction apparente n' et D
                                   // n' = (n + (γ²/(γ+1)(β·n) + γ)β)/D
aberrateInverse(beta, nApparent)   // → {x, y, z, D} : direction monde et D
emissionTimeStatic(t, d, c = C)    // t − d/c
```

## `src/physics/player.js` (pur)

```js
/** @typedef {{x:number, y:number, ux:number, uy:number, hx:number, hy:number,
 *             tau:number, t:number, phiMax:number, c:number, a:number,
 *             reverse:boolean, brakeHold:number}} PlayerState */
createPlayer({x = 0, y = 0, heading = Math.PI / 2, phiMax = PHI_MAX_DEFAULT,
              physics = {c: C, a: A}, reverse = false} = {})
                                   // → PlayerState ; physics : physicsFor(c) de la
                                   // partie (ou {c: 100, a: 10} des tests du cahier des charges),
                                   // gardé dans l'état (c, a) ; RangeError si c ou a ≤ 0 ;
                                   // reverse : marche arrière lente (J3 ; game/level.js l'active)
step(state, cmd, dtau)             // modifie et renvoie state ; cmd = {thrust, brake, steer}
                                   // (0..1, 0..1, −1..1, valeurs absentes = 0) ; dtau ≥ 0
                                   // sans plafond (sous-pas internes) ; frein prioritaire.
snapshot(state)                    // → {x, y, vx, vy, speed, beta, gamma, rapidity,
                                   //    tau, t, ux, uy, heading, hx, hy, c, reversing}
                                   // reversing : marche arrière (u opposée au cap ; heading
                                   // reste le cap du véhicule)
REVERSE_MAX_RAPIDITY               // atanh(REVERSE_MAX_BETA)
clampFrameDt(dtReal)               // min(max(dtReal, 0), MAX_FRAME_DT)
```

- Vitesse propre u = γv ; γ = √(1 + |u|²/c²) avec c = state.c ; t avance de Δt, τ de dtau.
- Poussée et frein : accélération propre ≤ state.a. Sous-pas ≤ 1/60 s et ≤ 1 m (à l'échelle
  humaine, indépendants de c).
- Modèle « voiture arcade » : le cap suit la vitesse quand on roule ; poussée et frein
  le long du cap (colinéaires à u) ; virage = rotation exacte de u et du cap
  (schéma de Strang : demi-rotation, segment, demi-rotation), dθ/dτ = −steer·TURN_RATE ;
  à l'arrêt, pivot du cap à PIVOT_RATE.
- Frein : arrêt exact à v = 0. Sans `reverse` (défaut), pas de marche arrière (jalon 1).
  Avec `reverse` (jalon 3) : frein maintenu à l'arrêt pendant `REVERSE_DELAY` = 0,5 s de τ
  (délai compté depuis l'arrêt ; il laisse le temps de livrer), puis recul le long de −cap à
  l'accélération propre brake·a, plafonné à `REVERSE_MAX_BETA`·c = 0,05·c ; volant inversé
  (à droite : θ augmente) ; relâcher = roue libre en arrière ; poussée = freine le recul
  (arrêt exact) puis repart en avant ; Δt = γΔτ comme en marche avant.
- Plafond : la rapidité ne dépasse jamais `state.phiMax` (découpe exacte du sous-pas).

## `src/physics/collisions.js` (pur, jalon 3)

Véhicule = cercle de `PLAYER_RADIUS` = 0,6 m ; obstacles = rectangles alignés
`Box = {x0, y0, x1, y1, kind?, id?}` (`kind` : 'batiment' | 'porte' | 'limite').

```js
PLAYER_RADIUS = 0.6 · STUN_PER_GAMMA = 20 (κ, s) · STUN_MAX = 30 · CONTACT_SKIN = 1e-5 · MAX_SLIDES = 4
boxFromCenter(x, y, width, depth, extra?) · boxesFromBuildings(buildings) // expandScene → Box[]
boundaryBoxes(bounds, thickness = 50)   // 4 murs juste hors des limites
distanceToBox(px, py, box)
createBoxIndex(boxes, cell = 32)        // → {boxes, query(xmin, ymin, xmax, ymax) → Box[]}
sweepCircleBox(x0, y0, dx, dy, r, box)  // premier contact du cercle balayé (rectangle grossi de r,
                                        // coins arrondis) → {time ∈ [0, 1], nx, ny, penetration?} | null
sweepCircle(x0, y0, dx, dy, r, boxes)   // → {time, nx, ny, penetration?, box} | null (le plus tôt)
stunFor(gammaBefore, gammaAfter, kappa = STUN_PER_GAMMA) // κ·(γ_avant − γ_après), dans [0 ; STUN_MAX]
resolveMove(from, to, {ux, uy}, obstacles, {radius, c, kappa} = {})   // PURE
  // → {x, y, ux, uy, hits: [{box, nx, ny, x, y}], gammaBefore, gammaAfter, stun, dTau, dT}
  // contact : composante normale entrante de u annulée, tangentielle gardée, reste du
  // déplacement projeté sur la tangente ; dTau = dT = stun (étourdissement à l'arrêt)
stepWithCollisions(state, cmd, dtau, obstacles, {radius, kappa, applyStun = true} = {})
  // comme step (modifie state), en morceaux ≤ 1/60 s et ≤ SUBSTEP_MAX_DIST (1 m), chacun passé
  // à resolveMove ; le cap suit la vitesse après un glissement ; applyStun : ajoute
  // l'étourdissement à state.tau ET state.t (la batterie reste τ).
  // → {hits: [{box, kind, id, nx, ny, x, y, gammaBefore, gammaAfter, stun, tau, t}], stun}
```
`obstacles` : tableau de `Box` ou source `{query(...)}` (index, ou `level.obstacles`).

## `src/physics/retarded.js` (pur)

```js
retardedTime(observer, t, positionAt, {tolerance = 1e-5, maxIterations = 30, guess, c = C} = {})
  // Résout te = t − |observer − positionAt(te)|/c (te ≤ t), Newton sécurisé par bissection.
  // observer, positionAt(te) : {x, y, z}. → {te, iterations, converged}
  // converged = false si maxIterations est atteint sans convergence (te n'a alors pas de
  // sens) : vitesse qui tend vers c dans le passé, observateur derrière l'horizon.
retardedTimeUniform(observer, t, p0, w, t0, c = C)
  // Forme fermée pour p(t) = p0 + w·(t − t0), |w| < c. → te
createHistory({capacity, interval})
  // Anneau de positions : {push(t, p), positionAt(t)} (interpolation linéaire).
```

## `src/physics/spectrum.js` (pur)

Convention (docs/conception.md §4) : M_k(D) = 𝐍·RGB(∫ CMF(λ)·D·E(Dλ)·ρ_k(Dλ) dλ),
E = Planck à SUN_TEMPERATURE, 𝐍 = inverse du bloc RGB 3×3 à D = 1, appliquée aux
5 colonnes. Bases de réflectance (partition de l'unité) : UV λ < 360 ; b [360, 490[ ;
g [490, 590[ ; r [590, 830[ ; IR λ ≥ 830 nm. M(1) = [I | 0]. Couleurs en sRGB **linéaire**.

```js
cmfWyman(lambdaNm)                 // → {x, y, z} (Wyman, Sloan, Shirley, JCGT 2013)
planck(lambdaNm, T)                // radiance spectrale relative
XYZ_TO_LINEAR_SRGB                 // matrice 3×3 (tableau de 3 lignes)
reflectanceBasis(k, lambdaNm)      // k = 0..4 (r, g, b, ir, uv) → 0 ou 1
colorMatrix(D)                     // → tableau de 5 colonnes [r, g, b] (ordre r, g, b, ir, uv)
blackbodyColor(D, T)               // → [r, g, b] : RGB(B(D·T))/D⁴, normalisé pour que
                                   //   la luminance vaille 1 à D = 1 (avant projecteur)
lineColor(lambdaObsNm)             // → [r, g, b] d'une raie monochromatique, luminance
                                   //   relative ȳ(λ)/max ȳ, ramenée dans le gamut
clearSkyColor(D)                   // → [r, g, b] du ciel dégagé, avant projecteur : spectre
                                   //   continu ρ ∝ (550/λ)⁴ + SKY_AEROSOL_FRACTION·(550/λ)^1,3,
                                   //   nul sous 295 nm ; luminance SKY_CLEAR_LUMINANCE à D = 1
beamFactor(D, p = BEAM_EXPONENT, max = BEAM_MAX) // min(D^p, max)
adaptationExposure(Dforward)       // exposition d'adaptation de l'œil E = 1/G(D) ≤ 1, E = 1
                                   //   si D ≤ 1 ; G = gain de la façade de référence
                                   //   ADAPTATION_REFERENCE vue de face, projecteur compris.
                                   //   Tabulée pour BEAM_EXPONENT et BEAM_MAX par défaut : à
                                   //   recalculer si l'exposant devient réglable.
toneMap(rgb, knee = TONEMAP_KNEE)  // compression qui préserve la teinte (même formule que le GLSL)
perceivedColor(source, D, opts)    // source = {kind: 'surface', reflectance: [r, g, b, ir, uv]}
                                   //        | {kind: 'line', lambda} | {kind: 'blackbody', T}
                                   // opts = {beamExponent, beamMax, knee, exposure = 1}
                                   // → [r, g, b] linéaire après projecteur et tone mapping.
                                   // Règles du jeu (portes) : exposure = adaptationExposure(e^φ),
                                   // la même loi que l'écran.
classifyHue(rgb)                   // → 'noir' | 'blanc' | 'gris' | 'rouge' | 'orange' | 'jaune'
                                   //   | 'vert' | 'cyan' | 'bleu' | 'violet'
buildDopplerLutData({size = LUT_SIZE, log2Range = LUT_LOG2_RANGE,
                     temperatures = BLACKBODY_TEMPERATURES} = {})
  // → {data: Float32Array RGBA (width × height × 4), width, height, log2Range}
  // ligne LUT_ROWS.k : colonne k de M(D) ; ligne blackbodyRow(T) : blackbodyColor(D, T) ;
  // dernière ligne (SKY_CLEAR_ROW avec les températures par défaut) : clearSkyColor(D).
  // height = 5 + temperatures.length + 1.
  // Texel i ↔ log₂ D = −L + 2L·i/(size − 1).
sampleLutLikeGpu(lut, D, row)      // reproduit le GPU : valeurs arrondies en half float,
                                   // interpolation linéaire entre texels → [r, g, b]
```

Échantillonnage côté GPU (identique dans le GLSL) :
x = clamp((log₂ D + L)/(2L), 0, 1) ; u = (x·(N − 1) + 0,5)/N ; v = (ligne + 0,5)/H.

Constantes de couleur (`constants.js`) : `BEAM_EXPONENT = 4`, `BEAM_MAX = 4096` (= 8⁴ : D⁴
exact jusqu'à D = 8), `TONEMAP_KNEE`, `ADAPTATION_REFERENCE = [0.6, 0.6, 0.6, 0.3, 0.15]`
(façade de référence de l'adaptation), `SKY_AEROSOL_FRACTION = 0.35`,
`SKY_CLEAR_LUMINANCE = 0.186`, `SKY_CLEAR_ROW = 5 + BLACKBODY_TEMPERATURES.length`,
`LUT_HEIGHT = SKY_CLEAR_ROW + 1`.

## `src/render/` (three autorisé)

### Attributs des géométries (produits par `cityMesher.js`, lus par les shaders)

- `position` (vec3, repère Three).
- `color` (vec3) : réflectance r, g, b **linéaire** (palette convertie depuis sRGB).
- `aSpec` (vec3) : (ir, uv, ombrage cuit ∈ [0, 1]).
- `aFacade` (vec4) : (style, u, z, W) du motif de façade ; style 0 = aucun motif. Le décor
  écrit (0, 0, 0, 0) ; tant que `meshBlock` ne fournit pas de tableau `facades`, les murs
  reçoivent aussi des zéros (`mergeChunkMeshes`).
- Émetteurs (lampadaires) : géométrie séparée avec `position` et `aEmit` (vec2) :
  (ligne de LUT du corps noir, intensité).

### `render/coords.js`
```js
toThree(x, y, z = 0)               // → THREE.Vector3(x, z, −y)
toThreeInto(target, x, y, z = 0)
```

### `render/uniforms.js`
```js
export const REL                   // uniformes partagés par référence entre tous les matériaux :
  // uBeta (Vector3, β effectif, repère Three), uGamma, uG2 (= γ²/(γ+1)),
  // uLut (DataTexture), uLutParams (Vector4 : N, L, H, 0),
  // uBeamExp, uBeamMax, uKnee, uExposure,
  // uFogNear, uFogFar, uFogSpec (Vector3 : r, g, b), uFogIrUv (Vector2),
  // uEyeHeight, uStreetMap (Texture), uStreetBounds (Vector4 : xmin, ymin, xmax, ymax du jeu),
  // uSunDir (Vector3), uSkyRow (float), uSkyClearRow (float, ligne du ciel dégagé)
export const SUN_DIRECTION         // {x, y, z} unitaire du jeu, vers le soleil (gelé)
updateObserver(snapshot, k)        // k ∈ [0, 1] (vision classique) ; β = (vx, vy)/snapshot.c
                                   // (c obligatoire, RangeError sinon) ; calcule β_eff = kβ,
                                   // γ_eff = 1/√(1 − k²β²) en double précision côté CPU,
                                   // et uExposure = adaptationExposure(γ_eff + √(γ_eff² − 1))
                                   // (1 à l'arrêt et en vision classique)
setVisibility(near, far)
setStreetMap(texture, bounds)      // branche la carte des rues sur la passe d'environnement
```

### `render/materials.js`
```js
createSurfaceMaterial()            // façades, sol maillé éventuel (attributs color + aSpec)
createEmitterMaterial()            // lampadaires corps noir (attribut aEmit)
createEnvironmentMaterial()        // passe plein écran ciel + sol + brouillard (renderOrder 1)
createEnvironmentMesh(material = createEnvironmentMaterial())
                                   // triangle plein écran de cette passe (jamais éliminé)
createCockpitMaterial()            // avant du véhicule, comobile, sans effet relativiste ni
                                   // exposition d'adaptation (éclairé par la lumière projetée)
createLampMaterial()               // lampe de porte (jalon 3) : aberration ; couleur = uniforme
                                   // uLampColor (Vector3, sRGB linéaire FINAL), calculée par le CPU
                                   // avec game/rules.perceivedLamp (même chaîne que la règle) ;
                                   // pas de brouillard ; un matériau par lampe (shaders/lamp.*.glsl)
createClassicVariant(material)     // même pipeline compilé sans effets (define REL_CLASSIC),
                                   // pour le critère « vision classique » du jalon 1
```
Tous les `ShaderMaterial` partagent `REL` par référence (jamais `clone()`).

### `render/cityMesher.js`
```js
buildCity(scene, palette, {lodSteps = [1.5, 5, 15], lengthUnit = LENGTH_UNIT, decor} = {})
  // scene : JSON de src/data/scenes/*.json ; palette : src/data/palette.json ;
  // lengthUnit : L = 10·c de la partie (longueurs de jeu de la scène, voir layout.js) ;
  // decor : réglage d'exécution du décor (expandScene ; quality.decorOptions)
  // → {chunks, emitters, streets, start, visibility, bounds, buildings, decor}
  //   chunks[i] = {id, center: {x, y, z} (jeu), radius, buildingCount, decorCount,
  //                nearestDistance(px, py) → m (bâtiments ET emprises du décor),
  //                lod(k) → THREE.BufferGeometry (créée à la demande, mise en cache : murs
  //                  de meshBlock + décor de l'îlot au même LOD, UN SEUL BufferGeometry ;
  //                  userData {triangles, wallTriangles, decorTriangles}),
  //                release(k) (libère la géométrie du LOD k ; lod(k) la remaille)}
  //   un objet du décor loin de tout bâtiment forme un chunk de décor seul (id « decor:i,j »)
  //   emitters = THREE.BufferGeometry (attribut aEmit) ou null
  //   streets = [{from: {x, y}, to: {x, y}, width}] pour streetMap.js
  //   start = {x, y, heading} ; visibility = {lite, default} (m) ; bounds = {xmin, ymin, xmax, ymax}
  //   lengthUnit = L utilisé
  //   buildings = emprises développées (expandScene), pour les ombres de streetMap
  //   decor = objets du décor (decorLayout.js)
mergeChunkMeshes(walls, decor)     // pur : concatène deux maillages (indices décalés, aFacade
                                   // nul là où il manque) → {…, wallTriangles, decorTriangles}
decorStyle(palette)                // matériaux du décor en linéaire + FACE_SHADE, AO_HEIGHT,
                                   // AO_STRENGTH (style de decorMesher.meshDecor)
```

### `render/layout.js` (pur)
```js
expandScene(scene, palette, {lengthUnit = LENGTH_UNIT, decor} = {})
                                   // développe les expressions en L puis les macros (rangées
                                   // d'îlots) en bâtiments, puis place le décor
                                   // → {buildings: [{x, y, width, depth, height, color, ir, uv,
                                   //     blockId}], lamps: [{x, y, height, temperature, intensity}],
                                   //     streets, decor (decorLayout.DecorItem[]), start,
                                   //     visibility, bounds, lengthUnit}
                                   // déterministe (générateur pseudo-aléatoire à graine).
                                   // Clés de scène du décor : decor {actif?, densite?},
                                   // decorExclusions [{pos, rayon} | {de, a, rayon}].
                                   // Option decor (exécution) : false | {enabled?, density?
                                   // (fraction gardée), small?} → sous-ensemble exact du décor
resolveSceneLengths(scene, lengthUnit) // remplace chaque expression {fois, de?, plus?, min?, max?,
                                   // arrondiSup?, arrondiInf?, puisPlus?} par sa valeur (m) :
                                   // borne(fois·base + plus), arrondie, + puisPlus ; base = L,
                                   // `visibilite` (visibilityFor(L).default) ou un paramètre de
                                   // `parametres` (évalués dans l'ordre). Échelle humaine en mètres.
visibilityFor(lengthUnit)          // → {lite, default} : défaut = clamp(1,2·L, 300, 600) m,
                                   // lite = round(0,7 × défaut) ; utilisée si la scène n'a pas
                                   // de `visibilite`
MIN_BUILDING_HEIGHT                // 3 m : l'œil (EYE_HEIGHT) reste sous tous les toits ;
                                   // expandScene refuse un bâtiment ou une rangée plus bas
```

### `render/decorLayout.js` et `render/decorMesher.js` (purs)
```js
placeDecor({buildings, streets, lamps, bounds, start?}, {seed, density = 1, exclusions = []})
  // → DecorItem[] = {kind, x, y, cap, variant, length?, radius?, awning?, blockId,
  //    collision: {x0, y0, x1, y1} | null (boîte indulgente : tronc 0,5 m), extent (emprise au
  //    sol, houppier compris), height, small, keep}
  // kind ∈ platane, banc, colonne (Morris), kiosque, parasol (table de terrasse), store,
  //   jardiniere, potelet, fontaine (DECOR_KINDS : rayons, hauteurs, boîtes)
  // Règles : trottoirs (SIDEWALK_WIDTH = 3 m) bordant une façade (≤ FRONTAGE_DISTANCE) et
  // places (chaussée ≥ PLACE_MIN_WIDTH = 40 m : fontaine) ; jamais sur une chaussée (bouts
  // carrés) ni dans un bâtiment ; à ≥ CORNER_CLEARANCE_LOW (14 m, objets bas) ou
  // CORNER_CLEARANCE_TALL (10 m) de la chaussée d'une rue qui croise ; platanes à ≥ 3,5 m des
  // lampadaires, en quinconce ; hors des exclusions et à ≥ 6 m du départ ; sans chevauchement ;
  // rattachés à l'îlot du bâtiment le plus proche (≤ 60 m) ou à « decor:i,j »
decorSettings(sceneDecor, override) // → {enabled, density, keep, small}
filterDecor(items, settings)        // sous-ensemble : keep < fraction, sans petits objets
normalizeExclusions(list)           // disques et couloirs → segments {ax, ay, bx, by, r}
meshDecor(items, lod, style)        // → {positions, colors, specs, facades (nuls), indices
  // (Uint32Array), vertexCount, triangleCount} : mêmes attributs que les îlots, faces vers
  // l'extérieur, ombrage cuit decorFaceShade(n, FACE_SHADE) × AO (+ sous-bois des houppiers) ;
  // LOD 0 complet (grandes faces ≤ DECOR_STEP = 1,5 m), LOD 1 sans potelets ni tables,
  // LOD 2 arbres, colonnes, kiosques, stores et fontaines simplifiés (drawnAtLod)
DECOR_MATERIALS · decorPaletteEntries(palette) · decorFaceShade(nx, ny, nz, table)
```

### `render/subdivide.js`, `render/lod.js`, `render/culling.js` (purs)
```js
subdivideQuad(p0, p1, p2, p3, maxStep)  // → {positions: Float32Array, indices: Uint32Array}
chooseLod(currentLod, nearestApparentDistance, gamma, beta, lodSteps, {epsilon, hysteresis})
  // règle s_k ≤ κ·d_min, κ = min(0,2 ; √(8ε/(γβ))) avec hystérésis de 10 %
shouldReleaseLod0(currentLod, distance, releaseDistance = LOD0_RELEASE_M)
  // vrai si le LOD 0 d'un îlot qui ne l'affiche pas est à libérer (au-delà de 120 m)
isChunkVisible(chunk, camera {x, y, z}, visibilityFar) // coupe à la distance de visibilité
```

### Autres modules de rendu
- `renderer.js` : création du WebGLRenderer (WebGL2, `powerPreference: 'high-performance'`),
  redimensionnement (DPR plafonné), tri des opaques `opaqueSort` (renderOrder puis distance r
  de `object.userData.r`, en cm entiers ; résultat −1, 0 ou 1),
  perte et restauration du contexte, préchauffage des programmes.
- `quality.js` : DPR (défaut min(devicePixelRatio, 2), plafond de pixels), paramètre d'URL
  `?dpr=`, réglage du décor `decorOptions(search, tier)` → `quality.decor` = `{enabled,
  density, small}` (`?decor=0` : aucun ; « lite » : `DECOR_LITE_DENSITY` = 0,6, sans petits
  objets ; le même réglage sert au rendu et à `createLevel`), `profilePixelRatio(quality, w, h)` (DPR du profil : `?dpr=` ou DPR plafonné ; plafond
  du DPR adaptatif), `resolvePixelRatio(quality, w, h)` (le même, abaissé par
  `quality.adaptiveDpr` s'il est posé, jamais avec `?dpr=`), garde-fou de démarrage (clés `aslower:v1:gl-boot-v2` en session, `gl-crash-v2` et
  `gl-tier-v2` en local, via `storage.js` ; `?qualite=normale` les remet à zéro) : `createQuality()` lit l'état à l'ouverture ; `armBootGuard()` pose le
  drapeau juste avant la création du renderer (pas sur l'écran titre) ; `confirmBoot()` le
  retire après 30 images. Le profil « lite » d'après plantage expire au bout de 3 jours.
- `adaptiveDpr.js` (pur) : `createAdaptiveDpr({max, min = DPR_FLOOR, initial = max})` →
  `{sample(frameMs, cpuMs) → nouveau DPR | null, reset(), setMax(max) → dpr, dpr, max, min,
  changes}`. Baisse de `DPR_STEP` = 0,25 quand l'intervalle moyen des 90 dernières images
  dépasse 18,5 ms (plancher `DPR_FLOOR` = 1, `DPR_FLOOR_LITE` = 0,75 en « lite ») ; remonte de
  0,25 (jusqu'à `max`) après une fenêtre de 10 s où ≥ 98 % des images sont à ≤ 17,5 ms et
  ≥ 95 % ont un CPU (step + render) ≤ 8 ms, jamais dans les 30 s qui suivent une baisse ;
  30 images ignorées après un départ, une reprise (`reset`) ou un changement ; intervalles
  plafonnés à 100 ms. main.js ne le crée ni avec `?bench` ni avec `?dpr=`, lui passe une
  mesure par image de jeu et applique le DPR renvoyé à l'image suivante, avant le rendu.
- `camera.js` : caméra première personne, œil à EYE_HEIGHT, hFOV 90° en paysage.
- `dopplerLut.js` : `createDopplerLutTexture()` → DataTexture HalfFloat RGBA, LinearFilter,
  sans mipmaps, à partir de `buildDopplerLutData()`.
- `streetMap.js` : `createStreetMap(streets, bounds, {buildings = [], sunDir = SUN_DIRECTION} = {})`
  → CanvasTexture (plan et ombres portées des bâtiments).
- `cockpit.js` : `createCockpit()` → Object3D attaché à la caméra (renderOrder −1).
- `scene.js` : assemble tout pour une scène de `src/data/scenes/` ;
  `createWorld(renderer, sceneJson, palette, {tier = 'default', lodSteps, physics, decor} = {})` →
  `{update(snapshot, k, dtReal), render(camera), stats(), dispose()}`, plus
  `scene`, `start`, `bounds`, `streets`, `buildings` (emprises au sol {x, y, width, depth, …},
  pour `game/bubbles.facadeAhead`), `visibilityFar`, `warmup(camera)` (préchauffage, variantes
  « vision classique » comprises) et `setEnvironmentEnabled(on)` (diagnostic). `update` choisit
  les variantes `REL_CLASSIC` quand k = 0 ; `stats()` → `{calls, triangles, chunks,
  visibleChunks, lodCounts, generated, generationMs, renderMs}`. `physics` (physicsFor(c)) :
  la scène est développée pour `physics.lengthUnit` ; une nouvelle partie (« Changer c »)
  appelle `dispose()` puis recrée le monde avec le même renderer. Option `level` (jalon 3) :
  vue statique d'un niveau (`LevelView`, ci-dessous) → objets du niveau dans la scène ;
  `updateLevel(state, eye, dtReal)` les met à jour après `update` ; ils suivent les variantes
  « vision classique », le préchauffage et `dispose()`.
- `levelObjects.js` (jalon 3) : `createLevelObjects(view, {surface: {rel, classic}, emitter:
  {rel, classic}})` → `{group, setClassic(on), update(state, eye, dtReal), ownMaterials,
  dispose()}`. `view` (`LevelView`) = `{stops: [{key, kind: 'retrait'|'livraison', x, y,
  rayon}], doors: [{id, x, y, capDegres, largeur, hauteur, lampZ}], buildings}` ; `state`
  (`LevelRenderState`, calculé par main.js) = `{stops: {clé: {active, present}}, doors: {id:
  {open, lampRgb}}}` : `present` = client VU présent (`rules.seenClientPresent`, à t_e),
  `open` = porte VUE ouverte (`rules.seenDoorOpen`), `lampRgb` = `perceivedLamp(lampe,
  instantané effectif k·β).rgb` (à k = 1, exactement la couleur jugée par la règle). Zone :
  anneau au sol (rayon de la zone) et balise corps noir à côté du client (6 500 K livraison,
  2 700 K retrait) ; client : silhouette en boîtes ; porte : deux battants qui coulissent
  (0,8 s) dans les façades, linteau, potence et lentille de la lampe. Fonctions de géométrie
  exportées et testées : `ringGeometry`, `beaconGeometry`, `clientGeometry`,
  `doorLeafGeometry`, `doorFrameGeometry`, `lampGeometry`, `clientSpot`.

## `src/input/` (DOM)

```js
// controls.js
createControls(rootElement, {mode = 'drag', tilt = null, onFallback} = {})
  // → {read(), setEnabled(bool), setMode('drag' | 'tilt') → mode effectif, getMode(), dispose()}
  // read() → {thrust, brake, steer, classic, pause, lastSource}
  //   lastSource : 'clavier' | 'tactile' | 'inclinaison', dernière source qui a commandé
  //   (avant toute commande : 'tactile' sur écran tactile, sinon 'clavier') ;
  //   main.js en tire la variable modeVolant des bulles ('clavier', sinon getMode()).
  // fusionne clavier (keyboard.js), tactile (touch.js) et inclinaison (tilt : createTilt).
  // setMode('tilt') sans capteur, ou capteur 'refuse' / 'indisponible' : repli en 'drag' et
  // onFallback('refuse' | 'indisponible') ; idem si le capteur échoue en cours de partie.
  // Le mode est écrit dans rootElement.dataset.mode (la feuille de style s'y adapte).
activeSource(keys, fingers, tiltSteer, mode) // source active d'une image, ou null (pure)

// tilt.js — direction par inclinaison (deviceorientation)
createTilt({onState, win = window, now = performance.now, autoRecalibrate = true} = {})
  // → {state, neutral, requestPermission(), start(), stop(), calibrate(ms = CALIBRATION_MS),
  //    read() → steer lissé ∈ [−1, 1], debugInfo(), subscribe(fn) → désabonnement, dispose()}
  // state : 'inconnu' | 'demande' | 'actif' | 'refuse' | 'indisponible'.
  // requestPermission() → Promise<'accorde' | 'refuse' | 'indisponible'> : À APPELER EN PREMIER,
  //   de façon synchrone, dans un gestionnaire `click` (iOS vérifie le geste à l'appel) ;
  //   puis `.then(r => r === 'accorde' && tilt.start())`. Sans événement non nul 1 s après
  //   start() : 'indisponible'. Recalibrage auto 300 ms après un changement d'orientation.
  // Constantes : DETECTION_TIMEOUT_MS = 1000, CALIBRATION_MS = 500, RECALIBRATE_DELAY_MS = 300.

// tiltMath.js (pur) — angle de volant depuis β, γ et screen.orientation.angle
normalizeScreenAngle(angle) · wrapDegrees(deg) · isValidOrientation(event) · upVector(β, γ)
steeringAngleDetail({beta, gamma}, screenAngle) // → {angle (° , + = penché à droite), held, sx, sy}
steeringAngle(orientation, screenAngle)
steerFromAngle(angleDeg, neutralDeg = 0, {deadZone = 3, saturation = 25, exponent = 1.3})
smoothToward(previous, target, dt, tau = 0.06) · meanAngle(anglesDeg)

// device.js — appareil
enterFullscreen(doc = document) // → Promise<boolean> ; sans API (iPhone) : false, sans erreur ;
                                // tente ensuite screen.orientation.lock('landscape') (Android)
createWakeLock({nav = navigator} = {}) // → {acquire() → Promise<boolean>, release(), active}
                                // try/catch partout ; une demande qui aboutit après release()
                                // est aussitôt rendue
```

Clavier (`event.code`, indépendant de la disposition) : ArrowUp/KeyW accélérer ;
ArrowLeft/KeyA, ArrowRight/KeyD tourner ; Space/ArrowDown/KeyS freiner ;
KeyC/ShiftLeft/ShiftRight vision classique ; Escape/KeyP pause.

Tactile (mode glisser) : moitié droite maintenue = accélérer ; pédale de frein 96×80 px
en bas à gauche de la moitié droite (prioritaire) ; moitié gauche = volant à origine
flottante (R = 56 px) ; bouton vision classique (60 px) à mi-hauteur du bord gauche,
exclu de la zone volant. Cibles ≥ 48 px, à ≥ 24 px des bords. Un doigt de l'accélérateur
qui glisse sur la pédale freine (et réaccélère s'il en ressort) ; un doigt posé sur la pédale
puis glissé hors d'elle continue de freiner (cas sûr).

Tactile (mode inclinaison, `#controls[data-mode='tilt']`) : volant = inclinaison du GSM ;
moitié droite maintenue = accélérer ; frein 88×88 px en bas à gauche ; vision classique à
mi-hauteur à gauche ; ni zone volant ni repère.

## `src/hud/` (DOM)

```js
// hud.js
createHud(rootElement, {phiMax = PHI_MAX_DEFAULT} = {}) // → {update(snapshot, {k, fps}),
                                   //    setSpeedZone({min, max} | null), show(), hide()}
                                   // c lu dans snapshot.c (jauge, décimales, libellé « c = 30 m/s ») ;
                                   // setSpeedZone : bande verte sur la jauge (aide « zoneVitesse »)
// levelHud.js (jalon 3)
createLevelHud(hudRoot)            // → {update(info), show(), hide(), element} ; info =
                                   // {battery: {text, fraction, level}, colis: {done, total},
                                   //  next: {client, verb, distance, angle, behind, inZone, timing}
                                   //  | null, brake: texte, spectro: {text, ok} | null} ; 12 Hz,
                                   // flèche et jauge par transform
// levelFormat.js (pur, jalon 3)
frNumber(x, decimals) · formatClockShort(s) « 1:30 » · batteryFraction(tau, tauMax)
batteryLevel(f) 'ok'|'bas'|'critique' · formatBattery(tau, tauMax) « 65 s » · formatDistance(m)
formatStars(n) « ★★☆ » · brakingDistance(snap, a) · counterfactualBattery(d, c, β = 0,2)
stopIndicator(snap, stop, {k}) → {distance, angle, worldAngle, inZone, behind} : angle =
                                   // direction APPARENTE (aberrate avec β_eff = k·β), 0 = devant,
                                   // > 0 = à droite ; distance dans la ville
stopTiming(stop, t) → {text, state: 'absent'|'delai'|'retard'|'libre'} (heure de la ville)
headOnHue(lamp, β, d) · hueSpeedWindow(lamp, teinte, {distance}) → {min, max} | null
                                   // même chaîne que rules.perceivedLamp (testé)
spectrometerReading(vue, lampe, teinte) → {text: « vert ✓ 533 nm », ok}
hintFor(indices, echecs) · activeAids(indices, echecs) → Set · starLines(score) · failureText(score)
resultFigures({tauFin, tFin, tauMax, distance, c}) → {montre, ville, ecart, batterie, contrefactuel}
// screens.js (jalon 3) : #screen et #countdown de index.html
createScreens(root, countdownRoot) // → {showSelection({levels, cText, total, onChoose, onBack,
                                   //  option}), showBriefing({…, controls, onGo, onBack}) →
                                   //  {setBusy(text)}, showResult({…, stats: [{label, value}],
                                   //  onReplay, onNext, onQuit}), showFailure({…,
                                   //  canSkip, onRetry, onSkip, onQuit}), hide(), showCountdown(text,
                                   //  {small}), hideCountdown()}
// lightSpeed.js (DOM)
createLightSpeedControl(container, {value, presets, parse, onChange})
                                   // réglage « Vitesse de la lumière : [−] n [+] m/s » + préréglages,
                                   // aide et km/h ; parse = game/settings.parseLightSpeed (passé par
                                   // main.js) → {value, setValue(c), setMessage(text), element}
// format.js (pur)
formatClock(seconds)               // "1:05,3"
formatGap(seconds)                 // "+8,3 s"
createGammaPhrase()                // → (gamma) → texte, avec hystérésis
formatSpeed(speed, phiMax, c = C_DEFAULT) // décimales tronquées près de c (premier chiffre de
                                   // c − v, plafonné par c·tanh φ_max) ; n'affiche jamais c
gaugeFraction(speed, c = C_DEFAULT) // position de l'aiguille ∈ [0, 1] (linéaire en v, mur à c)
formatLightSpeed(c)                // « c = 30 m/s »
formatKmh(speed)                   // « 108 km/h »
gapState(previous, gamma, gap)     // état de la pastille d'écart, avec hystérésis, pour le HUD :
                                   // 'growing' | 'steady' | 'zero'
// credits.js
createCredits(dialogElement)       // ouvre THIRD_PARTY_NOTICES.md (?raw) dans un <dialog>
// settingsPanel.js (DOM) : <dialog id="settings"> de l'accueil
createSettingsPanel(dialog, {onClose}) // → {open(), close(), setStatus(text), isOpen}
// skyMath.js (pur) : ciel animé des menus
skyBeta(t) · aberrateCos(cosθ, β) · dopplerCos(cosθ, β) · stereoRadius(cosθ′) · makeStars(n, seed)
starColorTable() → {rgb, intensity} (corps noir D·T, comme les lampes) · tableIndex(D)
starLook(I, mag) → {alpha, size} · formatSkyReadout(β) → « v = 0,62 c · γ = 1,27 »
// sky.js (DOM) : canevas 2D #sky derrière l'accueil, la sélection et le briefing
createSky(canvas, {readout, reducedMotion}) // → {show(), hide(), visible} ; 30 i/s au plus,
                                   // image fixe sous prefers-reduced-motion
// diag.js
createDiag(rootElement)            // panneau #diag : p50/p95, CPU render, appels de dessin,
                                   // triangles, première image, extensions, GPU, DPR (courant,
                                   // et « adaptatif 1–2 », « fixe (?bench) » ou « imposé (?dpr=) »)
// direction.js
createDirectionControl(container, {value = 'drag', onChange, onRetry} = {})
                                   // réglage « Direction : [Inclinaison] [Glisser] » (aria-pressed),
                                   // aide, message de repli, bouton « Réessayer l'inclinaison » ;
                                   // onChange(mode) appelé SYNCHRONEMENT dans le `click` (geste) ;
                                   // → {value, setValue(mode), setMessage(text), setRetry(bool), element}
// tiltDebug.js
tiltDebugFromUrl(search)           // vrai avec ?debug
createTiltDebug(container)         // → {update(info, now), show(), hide(), dispose(), element} ;
                                   // info = {...tilt.debugInfo(), mode} (12 Hz, aria-hidden)
formatTiltDebug(info)              // texte du panneau
// bubbles.js (styles : hud/bubbles.css)
createBubbleView(hudRoot, {onDismiss, announcer} = {})
                                   // bulle sous les horloges ; un toucher la ferme (onDismiss),
                                   // sans atteindre le jeu ; non focalisable ; annoncée par announcer
                                   // → {show({id, text, blocking}), hide(), dispose(), element}
// announcer.js
createAnnouncer(parent = document.body, {minIntervalMs = 3000, now} = {})
                                   // région role="status" aria-live="polite", hors du HUD, une
                                   // annonce par 3 s au plus (la plus récente gagne)
                                   // → {announce(text), clear(), dispose(), element}
```

## `src/game/settings.js` (physics, storage)

```js
SETTINGS_KEY = 'reglages'          // stockage local : aslower:v1:reglages → {c}
LIGHT_SPEED_PRESETS                // [10, 30, 50, 100]
parseLightSpeed(raw)               // → {c, message} : entier de la plage accepté ; entier hors plage
                                   // ramené dans la plage (message) ; non entier ou illisible :
                                   // c = null (refusé, message)
isValidLightSpeed(c)
loadSettings(store = local)        // → {c} (valeur abîmée ou absente : C_DEFAULT)
saveSettings({c}, store = local)   // RangeError si c invalide
initialLightSpeed(search, store = local) // → {c, source: 'url' | 'reglage', message} :
                                   // ?c= prioritaire (jamais mémorisé), sinon le réglage
CONTROLS_KEY = 'commandes'         // stockage local : aslower:v1:commandes → {mode}
CONTROL_MODES                      // ['tilt', 'drag']
loadControlMode({touch} = {}, store = local) // direction mémorisée, sinon 'tilt' sur écran tactile
                                   // ((any-pointer: coarse)) et 'drag' ailleurs
saveControlMode(mode, store = local) // choix du joueur (un repli automatique n'est pas mémorisé)
OPTIONS_KEY = 'options'            // stockage local : aslower:v1:options → {spectrometre}
DEFAULT_OPTIONS                    // {spectrometre: false}
loadOptions(store = local) · saveOptions({spectrometre}, store = local)
```

## `src/game/conditions.js` (pur)

Langage déclaratif des déclencheurs (bulles, plus tard niveaux), évalué sans `eval` :
`{var, op, val}` (op ∈ <, <=, ==, !=, >, >=), `{var}` (booléen), `{tous: […]}`, `{un: […]}`,
`{non: c}`, `{pendant: {cond, s}}` (s de temps propre), `{evenement: nom}`, `{apres: idBulle}`.
Toutes les branches sont évaluées (pas de court-circuit) ; variable absente ou NaN : faux.

```js
OPERATORS, MAX_DEPTH = 16, MAX_PENDANT_S = 3600
VARIABLES                          // {nom: {type, valeurs?, entier?, description, calcul}} :
                                   // beta, gamma, speed, c, tau, t, ecart, depuisDebut, k,
                                   // vitessePropre, distanceFreinage, distanceDevant, margeFreinage,
                                   // accelere, freine, relache, tourne, dejaParti, dejaTourne,
                                   // regardArriere, facadeDevant, modeVolant ('tilt'|'drag'|'clavier') ;
                                   // niveaux (J3, neutres en conduite libre) : enNiveau, distanceArret,
                                   // margeArret, arretDerriere, dansZone, attendClient, porteProche,
                                   // teintePorte ('aucune' | teintes), teinteVoulue, batterie,
                                   // margeDelai, colisLivres
EVENTS                             // depart, relache, frein, butee, visionClassique, regardArriere ;
                                   // niveaux : livraison, retrait, choc, reprise, porteOuverte, attente
validateCondition(cond, {path, variables, events, bubbleIds}) // → liste d'erreurs (chemin JSON)
compileCondition(cond, options)    // → {evaluate(ctx, dt) → bool, reset()} ; lève si invalide
evaluateCondition(cond, ctx)       // évaluation ponctuelle (sans état)
conditionReferences(cond)          // → {variables, events, bubbles} (ensembles de noms)
```

## `src/game/bubbles.js` (pur, stockage injecté)

Bulles « une seule fois » : textes et déclencheurs dans `src/data/bubbles.json` (schéma
`coursier-bulles/1`, textes ≤ 100 caractères, variantes `texteDesktop`/`texteTilt`/`texteDrag`,
variables `{gamma}`… interpolées en français). Une bulle visible, file de 2 au plus (oubli après
20 s), 8 s entre deux apparitions, 5 s d'affichage ou toucher ; vues mémorisées sous
`aslower:v1:bulles` → `{vues: [ids]}`.

```js
createBubbleEngine({definitions, store = mémoire, now = Date.now, key = 'bulles'})
  // now : horloge (ms) qui S'ARRÊTE EN PAUSE (main.js : playClockMs, temps réel de jeu cumulé)
  // → {update(vars, dt) (à chaque image de jeu ; conditions à 5 Hz ; dt = temps propre),
  //    emit(name), onShow(cb → bulle | null) → désabonnement, dismiss(), current(), seen(id),
  //    reset() (« Revoir les bulles » : oublie les vues, stockage compris),
  //    clearPending() (nouvelle partie : ferme et vide la file, garde les vues), list()}
createBubbleVariables()            // → {compute({snapshot, command, k, a, modeVolant,
                                   //    distanceDevant, facadeDevant, regardArriere, butee, niveau})
                                   //    → vars, reset()} (mémoire : τ au départ, dejaParti, fronts) ;
                                   //    niveau (J3, null en conduite libre) : {distanceArret,
                                   //    arretDerriere, dansZone, attendClient, porteProche,
                                   //    teintePorte, teinteVoulue, batterie, margeDelai, colisLivres,
                                   //    evenements}
facadeAhead(buildings, x, y, hx, hy, {range = 300, halfAngleDeg = 20, rays = 5})
                                   // façade dans l'axe (lancer de rayons, à appeler à 5 Hz)
validateBubbles(json) · interpolate(template, vars) · chooseText(def, modeVolant)
formatNumberFr(x, decimals = 1) · createMemoryStore()
```

## Niveaux (jalon 3)

### Schéma « coursier-niveau/1 »

Documentation complète en tête de `src/game/validate.js` (source de vérité). Un fichier par
niveau, `src/levels/nNN-nom.json` (id = nom du fichier). **Unités** : longueurs = nombre (m,
échelle humaine) ou expression `{fois, de?, plus?, min?, max?, arrondiSup?, arrondiInf?,
puisPlus?}` en L = 10·c m (ou d'un paramètre de `parametres`) ; temps (s) et vitesses (β) :
nombres seulement (le validateur refuse une expression dans un temps).

| Clé | Contenu |
|---|---|
| `schema`, `id`, `numero`, `titre`, `notion`, `briefing[]`, `note?` | métadonnées (`numero` = chiffres de l'id ; briefing : 1 à 4 lignes ≤ 140 car.) |
| `parametres?` | `{nom: longueur}` partagés par la scène et le jeu |
| `scene` | format « coursier-scene/1 » de `render/layout.js` sans `schema`, `id`, `depart`, `parametres` |
| `depart` | `{pos, capDegres, beta?}` (beta : départ lancé) |
| `batterie` | `{tauMax}` (s de τ) |
| `phiMax` | ]0 ; 3] |
| `colis[]` | `{id, client, nom?, retrait?: {lieu, rayon? (8 m), pasAvant?}, livraison: {lieu, rayon?, pasAvant?}, delai?, obligatoire}` |
| `portes[]?` | `{id, nom?, pos, capDegres (0/90/180/270 : sens du passage), largeur, hauteur, lampe: {raie (nm) \| corpsNoir (K), intensite?, hauteur? (porte + 1 m), allumee?: [[début, fin[…] (t ville)}, teinte, portee: [min ≥ 12 m, max ≥ min + 12 m], maintien (s de τ), resteOuverte? (s de t), reprise?}` |
| `reprises[]?` | `{id, pos, capDegres, cout}` (s ajoutées à τ et t) |
| `etoiles` | `{batterieMin (fraction restante), tVilleMax (s)}` |
| `bulles[]?` | schéma des bulles (`game/bubbles.js`), langage de `game/conditions.js` ; ids distincts des bulles globales |
| `indices[]?` | `{apresEchecs, texte, aide?}` (aide ∈ repereFreinage, zoneVitesse, horaire, fantome, diagramme, spectrometre) |
| `parcours?` | `{reference: {note?, etapes}, naif?: {…}}` ; étapes `{aller: pos, beta, arret?, rayon?}`, `{attendre: s}`, `{attendreJusqua: t}` (bot) |

Exemple complet : `tests/fixtures/levels-valid/n99-exemple.json`.

### `src/game/validate.js` (pur)
```js
validateLevel(json, {fileName?, palette, lightSpeeds = [10, 30, 100], globalBubbleIds = []})
  // → {ok, errors: string[], warnings: string[]} ; messages « fichier.json › chemin : raison » ;
  // passe 1 structure (clés connues, types, bornes, temps sans expression), passe 2 sémantique
  // pour chaque c (suffixe « (c = 10 m/s) » si l'erreur n'existe pas pour tous) : id = nom de
  // fichier, numéro, φmax ≤ 3, scène développable, aucune géométrie sous le sol, capteurs ≥ 12 m
  // (plage ≥ 12 m), lieux dans la carte et ATTEIGNABLES depuis le départ (grille de 1 m, portes
  // ouvertes), références (porte → reprise), pasAvant < délai, ≥ 1 colis obligatoire, aucun
  // obstacle du décor dans une zone, sur une porte, une reprise ou le départ…
assertValidLevel(json, options, max = 10)   // lève une Error qui liste les erreurs
levelIdFromFileName(path) · reachabilityGrid(scene, start, radius)
LEVEL_ID_PATTERN · ID_PATTERN · HUES · AIDS · MIN_SENSOR_DISTANCE = 12 · MIN_SENSOR_SPAN = 12
VALIDATION_LIGHT_SPEEDS = [10, 30, 100]
```

### `src/game/level.js` (pur)
```js
LEVEL_SCHEMA = 'coursier-niveau/1' · DEFAULT_ZONE_RADIUS = 8 · DOOR_THICKNESS = 1
resolveLevel(json, lengthUnit)      // expressions → mètres (copie, sans parametres)
sceneOfLevel(resolved, lengthUnit?) // scène « coursier-scene/1 » (pour render/scene.createWorld),
                                    // avec decorExclusions += levelDecorExclusions(resolved, L)
levelDecorExclusions(resolved, L)   // zones (rayon + 4 m), portes (portée min + largeur/2),
                                    // reprises et départ (8 m), couloirs des itinéraires du pilote
                                    // (max(4 m, 0,014·L·β))
decorBoxes(scene)                   // obstacles du décor : {x0, y0, x1, y1, kind: 'decor', id: sorte}
createLevel(json, physics, palette, {decor} = {}) // → LevelState (JSON supposé valide) :
  // {id, numero, titre, json, level (résolu), physics, scene (expandScene), sceneJson, start:
  //  {x, y, heading, beta}, tauMax, phiMax, etoiles, status: 'enCours'|'reussite'|'echec',
  //  raison, fin: {t, tau} | null, tau, t, colis[], portes[], reprises[], chocs,
  //  reprisesFaites, playerRadius, obstacles: {query(...)} (bâtiments, décor, portes FERMÉES,
  //  bords)} ; decor : réglage d'exécution du décor (celui du rendu ; défaut : complet)
  // colis[i] = {id, client, nom, obligatoire, delai, etat: 'aRetirer'|'aBord'|'livre',
  //   retrait | null, livraison : {x, y, rayon, pasAvant, timer, inZone, waiting},
  //   retireA, livreA : {t, tau} | null, enRetard}
  // portes[i] = {id, nom, x, y, capDegres, largeur, hauteur, box, lampe: {x, y, z, kind:
  //   'line'|'blackbody', lambda, T, intensity, allumee}, teinte, portee: [min, max] (m),
  //   maintien, resteOuverte, reprise, ouverte, ouverteA, timer, inRange,
  //   vue: perceivedLamp(...) | null (spectromètre), history: [{t, ouverte}]}
createLevelPlayer(level)            // createPlayer(…, reverse: true), départ lancé si beta > 0
advance(level, player, cmd, dtau)   // UNE IMAGE : stepWithCollisions (sans appliquer
  // l'étourdissement), étourdissement des chocs ajouté à τ et t (sauf porte à reprise),
  // rules.update, reprises appliquées → {events, snapshot}
applyReprise(player, {x, y, heading, cout}) · doorBox(door, id) · headingFromDegrees(deg)
```

### `src/game/rules.js` (pur)
```js
DELIVERY_MAX_BETA = 0.03 · DELIVERY_HOLD = 0.5
update(level, snapshot, dt, events = []) // → {events, status} ; modifie level. Ordre :
  // 1. retraits puis livraisons (zone + v ≤ 0,03·c pendant 0,5 s de τ + t ≥ pasAvant) ;
  // 2. portes (teinte perçue = teinte demandée pendant maintien, dans la portée) ;
  // 3. chocs reçus ({type: 'choc', kind, id, stun, …}) → reprise si porte à reprise ;
  // 4. réussite (tous les obligatoires livrés, même en retard) ; 5. échec batterie (τ ≥ tauMax).
  // Événements produits : {type: 'retrait'|'livraison' (colis, client, t, tau, enRetard?, delai?)},
  // 'attente' (on se met à attendre dans la zone avant pasAvant), 'porte' (porte, ouverte, t), 'choc', 'reprise'
  // (reprise, cause: 'choc:<porte>', x, y, heading, cout), 'reussite', 'echec' (raison).
perceivedLamp(lamp, snapshot)       // → {hue, D, te, on, rgb, distance, lambdaObs} : œil à
  // EYE_HEIGHT, D = γ + (u·n)/c (géométrie réelle), état allumé vu à t_e = t − d/c,
  // perceivedColor(…, {exposure: adaptationExposure(e^φ)}) puis classifyHue
lampOnAt(lamp, te) · seenDoorOpen(door, snapshot) · seenClientPresent(stop, snapshot)
  // états VUS (rendu, HUD) : à t_e = t − d/c (emissionTimeStatic)
activeStops(level)                  // arrêts à faire : [{colis, client, kind, x, y, rayon,
                                    //   pasAvant, delai, obligatoire}]
```

### `src/game/score.js` (pur)
```js
scoreResult({reussite, raison?, tauFin, tFin, retards?}, {tauMax, etoiles}) // → Score
computeScore(level)                 // → Score = {etoiles 0..3, reussite, raison, econome: {ok,
  // batterieRestante, seuil, tauFin, tauMax}, ponctuel: {ok, tFin, seuil, retards: [{colis,
  // client, t, delai}]}, manque: ['econome' | 'ponctuel'], messages: [français]}
  // étoiles = 0 si échec ; sinon 1 + [batterie restante ≥ batterieMin]
  //                               + [t_fin ≤ tVilleMax et aucun retard]
```

### `src/game/states.js` (pur)
```js
STATES  // chargement, menu, selection, briefing, decompte, enCours, pause, reprise, bilan, echec
TRANSITIONS  // table {état: {événement: état}} ; GUARDS {'echec.passer', 'bilan.suivant'}
SKIP_AFTER_FAILURES = 4
createStateMachine({initial = 'chargement', onChange(to, from, event), transitions, guards})
  // → {state, send(event, ctx) → état | null (refusé), can(event, ctx), events(ctx), history}
nextState(state, event, ctx) · checkTransitions() → [] · clocksRunning(state) (enCours seul)
```

### `src/game/progress.js` (storage)
```js
PROGRESS_KEY = 'progression'        // aslower:v1:progression
// {version: 1, niveaux: {id: {echecs, passe, parC: {"30": {etoiles, meilleureBatterie,
//  meilleurTVille, reussites}}}}} : records par niveau ET par c
emptyProgress() · sanitizeProgress(raw) · loadProgress(store = local) · saveProgress(p, store)
recordResult(p, levelId, c, score | {reussite, etoiles, batterieRestante, tFin})
  // → {progress (nouvelle), records: {etoiles, batterie, tVille, premiereReussite}} ; échec : echecs + 1
recordSkip(p, levelId) · canSkip(p, levelId) · levelSucceeded(p, levelId)
isUnlocked(p, levelIds, levelId)    // 1er toujours ; sinon précédent réussi (tout c) ou passé
levelStats(p, levelId, c?)          // → {etoiles (meilleures, tous c), etoilesC, meilleureBatterie,
                                    //    meilleurTVille, echecs, passe, reussi}
totalStars(p, levelIds)
```

### `src/game/bot.js` (pur) et `scripts/calibrate.mjs`
```js
BOT_DT = 1/60 · BOT_TURN_RADIUS = 6 · ARRET_PAUSE = 0,65 s
createBotDriver(route (résolu), physics, {dt, turnRadius}) // → {command(snapshot) → cmd, done, index}
  // anticipation : la rapidité permise à chaque point tient compte des points suivants (frein
  // plein jusqu'au plafond du point d'après, de proche en proche) ; volant proportionnel à
  // l'écart de cap + poursuite pure (courbure 2·sin(écart)/d × |u|/TURN_RATE) ; un point de
  // passage frôlé (au-delà de la perpendiculaire au tronçon) compte comme atteint
runBot(json, {c = 30, palette, route = 'reference' | 'naif' | {etapes}, dt, maxTau, onFrame})
  // vraie physique (level.advance) → {status, score, tau, t, events, frames, level, player, finished}
```
`npm run calibrate [-- fichier.json] [-- --c=10,30,100]` : joue `parcours.reference` (et
`naif`) pour chaque c, affiche les étoiles et des seuils suggérés (batterieMin ≈
(τmax − 1,15·τ_ref)/τmax aux 0,05 inférieurs, tVilleMax ≈ 1,12·t_ref aux 5 s supérieures) ; n'écrit rien.

### `src/levels/index.js`
```js
LEVEL_FILES   // [{id, fileName, json}] : import.meta.glob('./n[0-9][0-9]-*.json', {eager: true}), triés
LEVEL_IDS · levelJson(id) · levelIdFromPath(path)
```
Tests : `tests/levels.test.js` valide chaque niveau (c = 10, 30, 100) et y fait jouer le bot
(référence ★★★, naïf < 3) dès qu'il a un `parcours`.

## `src/storage.js`

```js
export const local                 // {get(key, fallback), set(key, value), remove(key)}
export const session               // idem pour sessionStorage
// Clés préfixées par STORAGE_PREFIX ; try/catch partout ; repli en mémoire si indisponible.
// Valeurs sérialisées en JSON.
```

## `src/main.js` et `src/loop.js`

- `main.js` : accueil (Jouer, Conduite libre, Théorie → `BASE_URL + 'theorie/'`, Réglages,
  Crédits ; étoiles gagnées et c courant ; ligne « Sur l'écran d'accueil » sur iPhone ; ciel
  animé `hud/sky.js`), dialogue Réglages (réglage de c, Direction sur écran tactile,
  Spectromètre, Revoir les bulles, touches du clavier), bouton ⏸ `#pause-button` en jeu
  (niveaux et conduite libre : même menu que Échap ou P ; au toucher dès `pointerdown`, car
  aucun `click` n'est émis quand d'autres doigts sont posés ; placé en haut à gauche sous les
  panneaux du HUD, ou en haut à droite si le bouton 👁 est trop près), menu pause (Reprendre ; Recentrer le volant si
  l'inclinaison est active ; Direction ; « Changer c » → nouvelle partie au départ avec le
  nouveau c ; Revoir les bulles ; Recommencer ; Crédits ; tout au clavier et au toucher),
  panneau « Tourne ton GSM » en portrait (appareils tactiles, strictement imposé), création du
  monde, des commandes, du HUD et des bulles. Clic « C'est parti ! » (briefing) ou « Conduite libre », dans cet ordre :
  `tilt.requestPermission()` (synchrone, en premier), `enterFullscreen()` (écran tactile),
  puis le chargement. Wake Lock pris en jeu, rendu en pause. DPR adaptatif.
- Application installable : `public/manifest.webmanifest` (start_url et scope `/aSlower/`,
  `display: fullscreen`, paysage, icônes `public/icons/` générées par
  `scripts/generate-icons.mjs`), balises iOS dans `index.html`.
- `loop.js` : `createLoop(frame, {onError} = {})` → `{start(), stop(), running, dispose()}` ;
  rAF, `frame(dtReal, dt, now)` avec `dtReal` mesuré (s) et `dt = clampFrameDt(dtReal)` ; pause
  sur `visibilitychange` (la boucle s'arrête et l'horloge est réinitialisée à la reprise). Une
  exception de `frame` arrête la boucle et appelle `onError(error)` une fois (main.js affiche
  alors « Le jeu s'est arrêté » avec « Recharger »).
- Machine à états des niveaux (`game/states.js`) branchée sur les écrans (`hud/screens.js`) :
  menu → sélection (étoiles par c, verrous, option Spectromètre) → briefing (« C'est parti » :
  permission d'inclinaison, plein écran, chargement) → décompte (3 s ; 1 s après une pause ou
  une reprise ; calibrage du volant d'inclinaison) → partie (`level.advance` remplace
  step/softStop/keepInside ; la conduite libre garde ce dernier fonctionnement) ⇄ pause
  (Recommencer, Quitter le niveau) / reprise (message, +coût) → bilan (étoiles, chiffres,
  contrefactuel, records ; Niveau suivant, Rejouer, Niveaux) | échec (raison, indice gradué,
  Recommencer, « Passer » après 4 échecs). Progression et options enregistrées. Bulles :
  globales + bulles du niveau dans un même moteur (refait à chaque partie).
- Paramètres d'URL : `?c=n` (vitesse de la lumière, entier de 10 à 100, prioritaire sur le
  réglage mémorisé), `?scene=avenue-test|quartier-test` (défaut : avenue-test), `?diag`,
  `?bench` (résultat dans `window.__benchResult`, avec `c` et `lengthUnit`), `?sansciel` (avec `?diag` ou `?bench` : passe
  ciel/sol coupée dès le départ), `?dpr=` (coupe le DPR adaptatif), `?debug` (panneau de
  l'inclinaison), `?autopilote[=reference|naif]` (en niveau, le pilote de référence conduit,
  à pas fixes de 1/60 s ; sans effet sinon). Avec `?diag`, `?bench`, `?debug` ou
  `?autopilote`, `window.__coursier` donne l'état en lecture seule (`mode`, `etat` (machine
  à états), `flow` ('libre' | 'niveau'), `k`, `c`, `controlMode`, `tiltState`, `tiltNeutral`,
  `bubble`, `dpr`, `snapshot()`, `stats()`, `niveau()` (statut, horloges, colis, portes et
  teinte vue, chocs, reprises, distance parcourue), `progression()`) pour les tests automatisés.
