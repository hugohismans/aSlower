# Interfaces entre modules (jalon 1)

Ce document est le contrat entre les modules. Chaque signature ci-dessous doit être
respectée à la lettre ; un module ne dépend des autres que par ces signatures.
Les constantes partagées sont dans `src/physics/constants.js` (ne pas les dupliquer).

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
  - `src/game/**` : physics, storage ;
  - `src/render/**` : physics, storage, three ;
  - `src/hud/**` : physics, storage (+ fichiers `?raw` de documentation pour les Crédits) ;
  - `src/input/**` : rien d'autre que le DOM ;
  - `src/main.js`, `src/loop.js` : tout.
  - `localStorage` et `sessionStorage` ne sont utilisés que dans `src/storage.js`.
  - Les fichiers « purs » (`physics/**`, `render/subdivide.js`, `render/lod.js`,
    `render/culling.js`, `render/layout.js`, `hud/format.js`) n'utilisent ni `window`,
    ni `document`, ni `three`.

## `src/physics/relativity.js` (pur)

```js
gammaFromU(ux, uy)                 // √(1 + (ux² + uy²)/C²)
velocityFromU(ux, uy)              // → {x, y}, |v| < C
uFromVelocity(vx, vy)              // → {x, y} ; lève une erreur si |v| ≥ C
rapidityFromU(ux, uy)              // asinh(|u|/C)
composeVelocities(v, w)            // v ⊕ w (vitesse du référentiel d'abord), → {x, y}
                                   // (v + w∥ + w⊥/γ_v)/(1 + v·w/C²)
hyperbolicSegment(ux, uy, ax, ay, h)
  // Poussée propre constante (ax, ay) pendant le temps propre h, forme exacte.
  // → {ux, uy, dx, dy, dt}. Identique à v₀ ⊕ C·tanh(|a|h/C)·â.
dopplerFactor(beta, n)             // γ(1 + β·n) ; beta, n : {x, y, z}, n unitaire
                                   // (direction observateur → source) ; > 1 devant
aberrate(beta, n)                  // → {x, y, z, D} : direction apparente n' et D
                                   // n' = (n + (γ²/(γ+1)(β·n) + γ)β)/D
aberrateInverse(beta, nApparent)   // → {x, y, z, D} : direction monde et D
emissionTimeStatic(t, d)           // t − d/C
```

## `src/physics/player.js` (pur)

```js
/** @typedef {{x:number, y:number, ux:number, uy:number, hx:number, hy:number,
 *             tau:number, t:number, phiMax:number}} PlayerState */
createPlayer({x = 0, y = 0, heading = Math.PI / 2, phiMax = PHI_MAX_DEFAULT} = {}) // → PlayerState
step(state, cmd, dtau)             // modifie et renvoie state ; cmd = {thrust, brake, steer}
                                   // (0..1, 0..1, −1..1, valeurs absentes = 0) ; dtau ≥ 0
                                   // sans plafond (sous-pas internes) ; frein prioritaire.
snapshot(state)                    // → {x, y, vx, vy, speed, beta, gamma, rapidity,
                                   //    tau, t, ux, uy, heading, hx, hy}
clampFrameDt(dtReal)               // min(max(dtReal, 0), MAX_FRAME_DT)
```

- Vitesse propre u = γv ; γ = √(1 + |u|²/C²) ; t avance de Δt, τ de dtau.
- Modèle « voiture arcade » : le cap suit la vitesse quand on roule ; poussée et frein
  le long du cap (colinéaires à u) ; virage = rotation exacte de u et du cap
  (schéma de Strang : demi-rotation, segment, demi-rotation), dθ/dτ = −steer·TURN_RATE ;
  à l'arrêt, pivot du cap à PIVOT_RATE.
- Frein : arrêt exact à v = 0, sans marche arrière (jalon 1).
- Plafond : la rapidité ne dépasse jamais `state.phiMax` (découpe exacte du sous-pas).

## `src/physics/retarded.js` (pur)

```js
retardedTime(observer, t, positionAt, {tolerance = 1e-5, maxIterations = 30, guess} = {})
  // Résout te = t − |observer − positionAt(te)|/C (te ≤ t), Newton sécurisé par bissection.
  // observer, positionAt(te) : {x, y, z}. → {te, iterations}
retardedTimeUniform(observer, t, p0, w, t0)
  // Forme fermée pour p(t) = p0 + w·(t − t0), |w| < C. → te
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
beamFactor(D, p = BEAM_EXPONENT, max = BEAM_MAX) // min(D^p, max)
toneMap(rgb, knee = TONEMAP_KNEE)  // compression qui préserve la teinte (même formule que le GLSL)
perceivedColor(source, D, opts)    // source = {kind: 'surface', reflectance: [r, g, b, ir, uv]}
                                   //        | {kind: 'line', lambda} | {kind: 'blackbody', T}
                                   // → [r, g, b] linéaire après projecteur et tone mapping
classifyHue(rgb)                   // → 'noir' | 'blanc' | 'gris' | 'rouge' | 'orange' | 'jaune'
                                   //   | 'vert' | 'cyan' | 'bleu' | 'violet'
buildDopplerLutData({size = LUT_SIZE, log2Range = LUT_LOG2_RANGE,
                     temperatures = BLACKBODY_TEMPERATURES} = {})
  // → {data: Float32Array RGBA (width × height × 4), width, height, log2Range}
  // ligne LUT_ROWS.k : colonne k de M(D) ; ligne blackbodyRow(T) : blackbodyColor(D, T).
  // Texel i ↔ log₂ D = −L + 2L·i/(size − 1).
sampleLutLikeGpu(lut, D, row)      // reproduit le GPU : valeurs arrondies en half float,
                                   // interpolation linéaire entre texels → [r, g, b]
```

Échantillonnage côté GPU (identique dans le GLSL) :
x = clamp((log₂ D + L)/(2L), 0, 1) ; u = (x·(N − 1) + 0,5)/N ; v = (ligne + 0,5)/H.

## `src/render/` (three autorisé)

### Attributs des géométries (produits par `cityMesher.js`, lus par les shaders)

- `position` (vec3, repère Three).
- `color` (vec3) : réflectance r, g, b **linéaire** (palette convertie depuis sRGB).
- `aSpec` (vec3) : (ir, uv, ombrage cuit ∈ [0, 1]).
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
  // uSunDir (Vector3), uSkyRow (float)
updateObserver(snapshot, k)        // k ∈ [0, 1] (vision classique) ; calcule β_eff = kβ,
                                   // γ_eff = 1/√(1 − k²β²) en double précision côté CPU
setVisibility(near, far)
```

### `render/materials.js`
```js
createSurfaceMaterial()            // façades, sol maillé éventuel (attributs color + aSpec)
createEmitterMaterial()            // lampadaires corps noir (attribut aEmit)
createEnvironmentMaterial()        // passe plein écran ciel + sol + brouillard (renderOrder 1)
createCockpitMaterial()            // avant du véhicule, comobile, sans effet relativiste
createClassicVariant(material)     // même pipeline compilé sans effets (define REL_CLASSIC),
                                   // pour le critère « vision classique » du jalon 1
```
Tous les `ShaderMaterial` partagent `REL` par référence (jamais `clone()`).

### `render/cityMesher.js`
```js
buildCity(scene, palette, {lodSteps = [1.5, 5, 15]} = {})
  // scene : JSON de src/data/scenes/*.json ; palette : src/data/palette.json
  // → {chunks, emitters, streets, start, visibility, bounds}
  //   chunks[i] = {id, center: {x, y, z} (jeu), radius, nearestDistance(px, py) → m,
  //                lod(k) → THREE.BufferGeometry (créée à la demande, mise en cache)}
  //   emitters = THREE.BufferGeometry (attribut aEmit) ou null
  //   streets = [{from: {x, y}, to: {x, y}, width}] pour streetMap.js
  //   start = {x, y, heading} ; visibility = {lite, default} (m) ; bounds = {xmin, ymin, xmax, ymax}
```

### `render/layout.js` (pur)
```js
expandScene(scene, palette)        // développe les macros (rangées d'îlots) en bâtiments
                                   // → {buildings: [{x, y, width, depth, height, color, ir, uv,
                                   //     blockId}], lamps: [{x, y, height, temperature, intensity}],
                                   //     streets, start, visibility, bounds}
                                   // déterministe (générateur pseudo-aléatoire à graine).
```

### `render/subdivide.js`, `render/lod.js`, `render/culling.js` (purs)
```js
subdivideQuad(p0, p1, p2, p3, maxStep)  // → {positions: Float32Array, indices: Uint32Array}
chooseLod(currentLod, nearestApparentDistance, gamma, beta, lodSteps, {epsilon, hysteresis})
  // règle s_k ≤ κ·d_min, κ = min(0,2 ; √(8ε/(γβ))) avec hystérésis de 10 %
isChunkVisible(chunk, camera {x, y, z}, visibilityFar) // coupe à la distance de visibilité
```

### Autres modules de rendu
- `renderer.js` : création du WebGLRenderer (WebGL2, `powerPreference: 'high-performance'`),
  redimensionnement (DPR plafonné), tri des opaques (renderOrder puis distance r),
  perte et restauration du contexte, préchauffage des programmes.
- `quality.js` : DPR (défaut min(devicePixelRatio, 2), plafond de pixels), paramètre d'URL
  `?dpr=`, garde-fou de démarrage (clés `aslower:v1:gl-boot`, `gl-crash`, `gl-tier` via
  `storage.js`).
- `camera.js` : caméra première personne, œil à EYE_HEIGHT, hFOV 90° en paysage.
- `dopplerLut.js` : `createDopplerLutTexture()` → DataTexture HalfFloat RGBA, LinearFilter,
  sans mipmaps, à partir de `buildDopplerLutData()`.
- `streetMap.js` : `createStreetMap(streets, bounds)` → CanvasTexture (plan et ombres).
- `cockpit.js` : `createCockpit()` → Object3D attaché à la caméra (renderOrder −1).
- `scene.js` : assemble tout pour une scène de `src/data/scenes/` ;
  `createWorld(renderer, sceneJson, palette, {tier = 'default', lodSteps} = {})` →
  `{update(snapshot, k, dtReal), render(camera), stats(), dispose()}`, plus
  `scene`, `start`, `bounds`, `streets`, `visibilityFar`, `warmup(camera)` (préchauffage, variantes
  « vision classique » comprises) et `setEnvironmentEnabled(on)` (diagnostic). `update` choisit
  les variantes `REL_CLASSIC` quand k = 0 ; `stats()` → `{calls, triangles, chunks,
  visibleChunks, lodCounts, generated, generationMs, renderMs}`.

## `src/input/` (DOM)

```js
// controls.js
createControls(rootElement, {mode = 'drag'} = {})
  // → {read() → {thrust, brake, steer, classic, pause}, setEnabled(bool), dispose()}
  // fusionne clavier (keyboard.js) et tactile (touch.js).
```

Clavier (`event.code`, indépendant de la disposition) : ArrowUp/KeyW accélérer ;
ArrowLeft/KeyA, ArrowRight/KeyD tourner ; Space/ArrowDown/KeyS freiner ;
KeyC/ShiftLeft/ShiftRight vision classique ; Escape/KeyP pause.

Tactile (mode glisser) : moitié droite maintenue = accélérer ; pédale de frein 96×80 px
en bas à gauche de la moitié droite (prioritaire) ; moitié gauche = volant à origine
flottante (R = 56 px) ; bouton vision classique (60 px) à mi-hauteur du bord gauche,
exclu de la zone volant. Cibles ≥ 48 px, à ≥ 24 px des bords.

## `src/hud/` (DOM)

```js
// hud.js
createHud(rootElement) // → {update(snapshot, {k, fps}), show(), hide()}
// format.js (pur)
formatClock(seconds)               // "1:05,3"
formatGap(seconds)                 // "+8,3 s"
createGammaPhrase()                // → (gamma) → texte, avec hystérésis
formatSpeed(speed, phiMax)         // décimales tronquées près de c
gaugeFraction(speed)               // position de l'aiguille ∈ [0, 1] (linéaire en v, mur à C)
// credits.js
createCredits(dialogElement)       // ouvre THIRD_PARTY_NOTICES.md (?raw) dans un <dialog>
// diag.js
createDiag(rootElement)            // panneau #diag : p50/p95, CPU render, appels de dessin,
                                   // triangles, première image, extensions, GPU, DPR
```

## `src/storage.js`

```js
export const local                 // {get(key, fallback), set(key, value), remove(key)}
export const session               // idem pour sessionStorage
// Clés préfixées par STORAGE_PREFIX ; try/catch partout ; repli en mémoire si indisponible.
// Valeurs sérialisées en JSON.
```

## `src/main.js` et `src/loop.js`

- `main.js` : écran titre (Jouer, Crédits), panneau « Tourne ton GSM » en portrait
  (appareils tactiles, strictement imposé), création du monde, des commandes et du HUD.
- `loop.js` : `createLoop(frame)` → `{start(), stop(), running, dispose()}` ; rAF,
  `frame(dtReal, dt, now)` avec `dtReal` mesuré (s) et `dt = clampFrameDt(dtReal)` ; pause sur
  `visibilitychange` (la boucle s'arrête et l'horloge est réinitialisée à la reprise).
- Paramètres d'URL : `?scene=avenue-test|quartier-test` (défaut : avenue-test), `?diag`,
  `?bench` (résultat dans `window.__benchResult`), `?sansciel` (avec `?diag` ou `?bench` : passe
  ciel/sol coupée dès le départ), `?dpr=`. Avec `?diag` ou `?bench`,
  `window.__coursier` donne l'état en lecture seule (`mode`, `k`, `snapshot()`, `stats()`)
  pour les tests automatisés.
