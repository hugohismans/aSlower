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
  // → {ux, uy, dx, dy, dt}. Identique à v₀ ⊕ C·tanh(|a|h/C)·â
  // (â fixe dans le référentiel comobile initial ; découpage indifférent seulement si a ∥ u₀).
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
  // observer, positionAt(te) : {x, y, z}. → {te, iterations, converged}
  // converged = false si maxIterations est atteint sans convergence (te n'a alors pas de
  // sens) : vitesse qui tend vers c dans le passé, observateur derrière l'horizon.
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
updateObserver(snapshot, k)        // k ∈ [0, 1] (vision classique) ; calcule β_eff = kβ,
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
createClassicVariant(material)     // même pipeline compilé sans effets (define REL_CLASSIC),
                                   // pour le critère « vision classique » du jalon 1
```
Tous les `ShaderMaterial` partagent `REL` par référence (jamais `clone()`).

### `render/cityMesher.js`
```js
buildCity(scene, palette, {lodSteps = [1.5, 5, 15]} = {})
  // scene : JSON de src/data/scenes/*.json ; palette : src/data/palette.json
  // → {chunks, emitters, streets, start, visibility, bounds, buildings}
  //   chunks[i] = {id, center: {x, y, z} (jeu), radius, nearestDistance(px, py) → m,
  //                lod(k) → THREE.BufferGeometry (créée à la demande, mise en cache),
  //                release(k) (libère la géométrie du LOD k ; lod(k) la remaille)}
  //   emitters = THREE.BufferGeometry (attribut aEmit) ou null
  //   streets = [{from: {x, y}, to: {x, y}, width}] pour streetMap.js
  //   start = {x, y, heading} ; visibility = {lite, default} (m) ; bounds = {xmin, ymin, xmax, ymax}
  //   buildings = emprises développées (expandScene), pour les ombres de streetMap
```

### `render/layout.js` (pur)
```js
expandScene(scene, palette)        // développe les macros (rangées d'îlots) en bâtiments
                                   // → {buildings: [{x, y, width, depth, height, color, ir, uv,
                                   //     blockId}], lamps: [{x, y, height, temperature, intensity}],
                                   //     streets, start, visibility, bounds}
                                   // déterministe (générateur pseudo-aléatoire à graine).
MIN_BUILDING_HEIGHT                // 3 m : l'œil (EYE_HEIGHT) reste sous tous les toits ;
                                   // expandScene refuse un bâtiment ou une rangée plus bas
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
  `?dpr=`, garde-fou de démarrage (clés `aslower:v1:gl-boot`, `gl-crash`, `gl-tier` via
  `storage.js`) : `createQuality()` lit l'état à l'ouverture ; `armBootGuard()` pose le
  drapeau juste avant la création du renderer (pas sur l'écran titre) ; `confirmBoot()` le
  retire après 30 images. Le profil « lite » d'après plantage expire au bout de 3 jours.
- `camera.js` : caméra première personne, œil à EYE_HEIGHT, hFOV 90° en paysage.
- `dopplerLut.js` : `createDopplerLutTexture()` → DataTexture HalfFloat RGBA, LinearFilter,
  sans mipmaps, à partir de `buildDopplerLutData()`.
- `streetMap.js` : `createStreetMap(streets, bounds, {buildings = [], sunDir = SUN_DIRECTION} = {})`
  → CanvasTexture (plan et ombres portées des bâtiments).
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
exclu de la zone volant. Cibles ≥ 48 px, à ≥ 24 px des bords. Un doigt de l'accélérateur
qui glisse sur la pédale freine (et réaccélère s'il en ressort) ; un doigt posé sur la pédale
puis glissé hors d'elle continue de freiner (cas sûr).

## `src/hud/` (DOM)

```js
// hud.js
createHud(rootElement, {phiMax = PHI_MAX_DEFAULT} = {}) // → {update(snapshot, {k, fps}), show(), hide()}
// format.js (pur)
formatClock(seconds)               // "1:05,3"
formatGap(seconds)                 // "+8,3 s"
createGammaPhrase()                // → (gamma) → texte, avec hystérésis
formatSpeed(speed, phiMax)         // décimales tronquées près de c
gaugeFraction(speed)               // position de l'aiguille ∈ [0, 1] (linéaire en v, mur à C)
gapState(previous, gamma, gap)     // état de la pastille d'écart, avec hystérésis, pour le HUD :
                                   // 'growing' | 'steady' | 'zero'
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
- `loop.js` : `createLoop(frame, {onError} = {})` → `{start(), stop(), running, dispose()}` ;
  rAF, `frame(dtReal, dt, now)` avec `dtReal` mesuré (s) et `dt = clampFrameDt(dtReal)` ; pause
  sur `visibilitychange` (la boucle s'arrête et l'horloge est réinitialisée à la reprise). Une
  exception de `frame` arrête la boucle et appelle `onError(error)` une fois (main.js affiche
  alors « Le jeu s'est arrêté » avec « Recharger »).
- Paramètres d'URL : `?scene=avenue-test|quartier-test` (défaut : avenue-test), `?diag`,
  `?bench` (résultat dans `window.__benchResult`), `?sansciel` (avec `?diag` ou `?bench` : passe
  ciel/sol coupée dès le départ), `?dpr=`. Avec `?diag` ou `?bench`,
  `window.__coursier` donne l'état en lecture seule (`mode`, `k`, `snapshot()`, `stats()`)
  pour les tests automatisés.
