# Coursier de la lumière lente — plan et arborescence

> Contrat entre modules (signatures, repères, attributs, imports permis) : [`docs/interfaces.md`](interfaces.md). En cas de désaccord sur une signature, c'est le contrat qui fait foi ; ce document donne le pourquoi.

Statut : **jalon 1 terminé** le 2026-10-11, prochain : jalon 2 (plan validé ; décisions de l'auteur du 2026-10-11 intégrées, voir §11). Le dépôt `hugohismans/aSlower` est public ; GitHub Pages y est publié en mode « GitHub Actions ». Les prototypes jetables du bac à sable (§0) ont servi de base au code du jalon 1. Publication sur <https://hugohismans.github.io/aSlower/> (la casse de l'URL compte).

Méthode : six analyses en parallèle (shaders et physique d'OpenRelativity, mathématiques, rendu Three.js, outillage et contrôles, game design), puis une relecture critique sous quatre angles. Chaque objection a été contre-vérifiée et tous les chiffres ci-dessous ont été recalculés par script.

---

## 0. Ce qui a été vérifié

- **Licence d'OpenRelativity** : MIT, « Copyright (c) 2013 Massachusetts Institute of Technology » (`MITLicense.md`, commit `35b806a1` du 2020-12-10). Seule condition : joindre l'avis de copyright et le texte de la licence à toute copie ou partie substantielle. Leur README remercie Gerd Kortemeyer et le MIT Game Lab.
- **Code d'OpenRelativity lu en entier** (16 fichiers). Leur vertex shader calcule, pour chaque sommet, la date d'émission de la lumière, puis applique un boost de Lorentz. Une seule passe donne ainsi aberration, retard de la lumière et contraction. Bugs relevés, que nous ne reprendrons pas :
  - signe faux dans la vitesse relative, d'où des NaN quand deux objets se croisent (`relativity.shader:105`) ;
  - D faussé de 4 à 5 % par un facteur d'écran (`:333-334`) ;
  - objets mobiles jamais contractés ;
  - intensité en D² au lieu de D⁴ ;
  - frottement non invariant par rotation.
- **Valeurs des tests obligatoires**, recalculées : v = 76,159416 m/s, t = 11,752012 s, x = 543,080635 m.
- **Prototypes jetables** (bac à sable, rien dans le dépôt) :
  - intégrateur exact ;
  - solveur de temps retardé ;
  - formules de rendu, confrontées à un boost de Lorentz explicite (1e-12) ;
  - shaders compilés en WebGL2 ;
  - LUT Doppler ;
  - validateur de niveaux ;
  - configuration Vite/Vitest/build sous `/aSlower/` ;
  - mathématiques du volant par inclinaison (61 tests).

## 1. Constats qui modifient le cahier des charges

### 1.1 L'échelle naturelle est le kilomètre
Avec c = 100 m/s et a = 10 m/s², les unités naturelles sont **c²/a = 1 000 m** et **c/a = 10 s**.

| Pour… | il faut… |
|---|---|
| atteindre γ = 2 (86,6 m/s) | 13,2 s de poussée et **1 000 m** (autant pour freiner) |
| s'arrêter depuis 50 / 76 / 90 m/s | 155 / 543 / 1 294 m |
| tourner à fond à 20 / 50 / 76 / 90 m/s (conduite arcade, §3) | rayon 20 / 58 / 117 / 206 m (r = \|u\|/TURN_RATE, avec TURN_RATE = 1,0 rad/s) |
| échapper à un flash (horizon de Rindler) | 1 000 m d'avance |

La « petite ville » mesure environ 3 × 2 km : îlots de 50 à 60 m, avenues droites de 2 à 3 km (4 km pour la seule scène de test J1). Chaque niveau charge un quartier de 0,7 à 2,4 km. La lumière la traverse en 30 s : c'est une petite ville pour un véhicule.

### 1.2 Sur un trajet simple, foncer gagne sur les deux horloges
Pour un trajet A→B fixé, τ = ∫dx/(γv) et t = ∫dx/v **diminuent tous les deux** quand on va plus vite. Exemple sur 1 000 m :
- à 20 m/s : τ = 51 s et t = 52 s ;
- à fond (poussée puis freinage) : τ = 19,3 s et t = 22,4 s.

Avec une simple échéance « avant t = X », le dilemme n'existe donc pas. La vraie tension entre τ et t vient des **fenêtres « pas avant »** : client absent, pont levé, pommes pas mûres. Attendre sur place coûte 1 s de batterie par seconde de ville, alors que rouler vite fait passer la ville au prix de 1/γ. Le paradoxe des jumeaux devient la solution : pour « sauter dans le futur » de la ville sans vider sa batterie, on fait un détour rapide.

Les autres freins au « foncer » : la porte colorée (il faut une vitesse précise), les distances de freinage et de virage, le retard de la lumière (pont).

### 1.3 Le modèle de couleur d'OpenRelativity rend le jeu illisible
OpenRelativity remplace chaque canal par une raie étroite (615, 550 et 463 nm). Vue de face, la luminance tombe sous 10 % vers 28 m/s et devient quasi nulle (< 2 %) vers 50–54 m/s, quelle que soit la teinte. Or le jeu vise 50 à 95 m/s.

Retenu (décision 3, §11 ; détails au §4) : le modèle le plus fidèle à la physique, « réflectance × soleil à 5 800 K », avec une composante infrarouge en plateau jusqu'à l'infini et une composante ultraviolette, les fonctions colorimétriques de Wyman et al., des lampadaires « corps noir » et l'effet projecteur physique (D⁴, borné). Le modèle d'OpenRelativity reste disponible en préréglage pour comparer.

### 1.4 « Δv = a·Δτ » et « Δt = γ·Δτ » ne sont exacts qu'à pas infinitésimal
Appliqué tel quel à chaque image, le test des 543 m donne 542,10 m à 60 i/s et 541,12 m à 30 i/s. On garde l'esprit demandé avec la forme exacte :
- dans le référentiel instantané, on compose w = c·tanh(a·Δτ/c) (≈ a·Δτ) par l'addition relativiste vectorielle v ⊕ w ;
- x et t avancent par la solution exacte (sinh, cosh) sur le pas.

Erreur ≤ 2e-11 sur les trois valeurs, quel que soit le découpage, y compris un pas unique de 10 s.

### 1.5 Écarts assumés au cahier des charges (récapitulatif)

| Cahier des charges | Plan | Pourquoi |
|---|---|---|
| « petite ville » | ≈ 3 × 2 km, quartiers par niveau | §1.1 |
| foncer pas toujours gagnant | fenêtres « pas avant » | §1.2 (décision 2) |
| Δv = a·Δτ, Δt = γ·Δτ | forme exacte équivalente | §1.4 |
| approximation spectrale RGB | 5 canaux (r, g, b, IR, UV) × soleil à 5 800 K | §1.3 (décision 3) |
| Δτ = temps réel écoulé | Δτ plafonné à 0,1 s par image, horloges gelées en pause et pendant les bulles bloquantes du tutoriel | ne pas simuler un joueur absent |
| a = 10 m/s² au maximum | a = 10 m/s² pour la poussée et le frein seulement ; la route fournit la force latérale (conduite arcade), y compris sur l'anneau du niveau 6 (160 à 300 m/s² centripètes) | sinon des kilomètres pour tourner (décision 1) |
| respect des délais = critère de score | un retard coûte seulement l'étoile « Ponctuel » ; l'échec ne vient que de la batterie vide et du flash | décision 6 |
| gyroscope, bulles | J2 (J1 : tactile glisser + clavier) | priorité au risque technique |
| objets mobiles | solveur pur et testé en J1, rendu en J4 | les niveaux mobiles arrivent en J4 |

## 2. Architecture

**Imports permis** (liste de référence dans `docs/interfaces.md`), vérifiés par `tests/purity.test.js` :
- `physics/` : seulement `physics/` ;
- `game/` : physics, storage ;
- `render/` : physics, storage (garde-fou) et three ;
- `hud/` : physics (constantes et formats), storage, et la documentation importée en `?raw` pour l'écran Crédits ;
- `input/` : DOM seulement ;
- `storage.js` : rien ;
- `main.js` et `loop.js` : tout ;
- `localStorage` et `sessionStorage` ne sont accessibles que via `storage.js`, et aucune clé `hh-*` (celles du portfolio) n'apparaît dans `src/` (test) ;
- les fichiers purs (`physics/**`, `render/subdivide.js`, `lod.js`, `culling.js`, `layout.js`, `hud/format.js`) n'utilisent ni `window`, ni `document`, ni three.

**Une image** :
1. `dτ = clampFrameDt(Δréel)` (≤ 0,1 s), puis entrées → `player.step(state, cmd, dτ)`, avec des sous-pas internes ≤ 1/60 s et ≤ 1 m de déplacement ;
2. monde (objets en temps de ville t) ;
3. règles (livraisons avant échecs) ;
4. bulles (5 Hz) ;
5. uniformes, culling et LOD ;
6. rendu ;
7. HUD (DOM à 12 Hz).

Pause sur `visibilitychange`.

**Conventions** (celles du portfolio) :
- code (fichiers JS/GLSL/CSS, identifiants, clés de stockage) en anglais ;
- données en français, sans accents : clés JSON en camelCase ; ids et noms de fichiers en kebab-case ASCII (`^n\d{2}-[a-z0-9-]+$` pour les niveaux) ;
- commentaires, docs et interface en français ;
- un seul mot pour le temps t : « ville » (HUD, JSON `tVille…`, bulles) ;
- glossaire FR→EN dans `docs/conception.md` ;
- JSDoc + `checkJs` + `@types/three`.

## 3. Physique (module pur et testé)

### API (`physics/player.js`, signatures exactes dans `docs/interfaces.md`)
- `createPlayer({x, y, heading, phiMax})`.
- `step(state, {thrust, brake, steer}, dτ)` : sans plafond, sous-pas internes.
- `snapshot(state)` renvoie `{x, y, vx, vy, speed, beta, gamma, rapidity, tau, t, ux, uy, heading, hx, hy}`, avec `speed` < c en m/s.
- `clampFrameDt(dtReal)` : pure, testée à part.

### État et intégration
- **État interne en float64** : position, vitesse propre **u = γv**, cap, τ, t. On en déduit γ = √(1 + |u|²/c²) et v = u/γ.
- **|v| < c** est garanti par u en arithmétique exacte. En float64, il faut en plus un **plafond de rapidité φ_max** : défaut 3 (β = 0,995, γ = 10), fixé explicitement dans chaque niveau et borné à 3 par le validateur. Cette borne vient de la couverture de la LUT (|log₂D| ≤ 4,5) et du float32 côté GPU, où β s'arrondit à 1 vers φ ≈ 9. Côté CPU en float64, u/γ s'arrondirait à c vers φ ≈ 18.
- **Segment hyperbolique exact** par sous-pas, sous poussée propre α constante. Avec η = |α|h/c, S = sinh η/η, K = (cosh η − 1)/η² et A = α + (α·u₀)u₀/(c²(γ₀+1)) :
  - u₁ = cosh η·u₀ + h·S·A
  - Δx = h·S·u₀ + h²·K·A
  - Δt = h·S·γ₀ + h²·K·(α·u₀)/c²

  C'est identique à v₀ ⊕ c·tanh(η)·n, à 4,5e-14 près. `relativity.js` expose aussi la composition vectorielle (ordre v_ancien ⊕ w, non commutative) pour la pédagogie et les tests.
- **Exactitude** : exact en ligne droite et en virage pur. En virage avec poussée, schéma de Strang d'ordre 2 (0,39 mm d'écart après 10 s de poussée pleine, volant à mi-course, à 60 Hz). La rotation de Thomas-Wigner n'est pas simulée, car aucune orientation propre n'est suivie ; c'est documenté.

### Conduite (modèle « voiture arcade », décision 1)
- **La route fournit la force latérale**, hors du budget du moteur : a = 10 m/s² (accélération propre) ne vaut que pour la poussée et le frein, tous deux le long du cap, donc colinéaires à u. Pas de cercle d'adhérence.
- Le cap suit la vitesse quand on roule ; le virage fait tourner u (et le cap) à |u| constant.
- Taux de virage en temps propre : dθ/dτ = −steer·TURN_RATE (`steer` > 0 : à droite, sens horaire ; TURN_RATE = 1,0 rad/s dans `constants.js`). Dans la ville, le rayon vaut r = |u|/TURN_RATE = γv/TURN_RATE : 20 m à 20 m/s, 117 m à 76 m/s, 206 m à 90 m/s, volant à fond.
- **À l'arrêt**, le volant fait pivoter le cap sur place à PIVOT_RATE (0,8 rad/s) ; la poussée part ensuite dans la direction du cap.
- **Relâcher** : roue libre exacte (Δt = γh, Δx = u·h), sans frottement.
- **Frein** : poussée opposée, prioritaire sur l'accélérateur, bornée pour s'arrêter exactement à v = 0, sans marche arrière en J1. Marche arrière lente (≤ 5 m/s) en maintenant le frein à l'arrêt, en J3.
- **Collisions (J3)** : test balayé ; la composante normale de u est annulée. La pénalité prend la forme d'un **étourdissement à l'arrêt** de κ_choc·(γ_avant − γ_après) s, ajouté à τ et à t, de sorte que la batterie reste égale à τ.

### Horloges
- Batterie = τ, qui s'use aussi à l'arrêt. Tout ce qui appartient à la ville (délais, pont, flash, pommier) avance en t.
- Le HUD affiche t, l'heure de la ville à l'endroit du joueur, synchronisée dans le référentiel de la ville. L'écart t − τ ne dépend d'aucune convention.
- Les objets **vus** sont affichés à leur temps d'émission t_e. Leurs horloges défilent donc au rythme D par rapport à ta montre (×2,7 en fonçant vers elles à 76 m/s, ×0,37 en s'éloignant), et non γ. Les bulles et le carnet l'expliquent.
- Objets fixes qui changent d'état (porte, client) : t_e = t − d/c, via `emissionTimeStatic` (J3).

### Temps retardé des objets mobiles (`physics/retarded.js`, livré et testé en J1, rendu en J4)
- Trajectoires analytiques p(t) en temps de ville.
- On résout t_e = t − |x_obs − p(t_e)|/c par Newton sécurisé (bissection, bornes inclusives, sortie anticipée). Départ : la valeur de l'image précédente ou la quadratique d'OpenRelativity.
- 2 à 5 itérations jusqu'à β = 0,99, contre plus de 1 000 pour le point fixe.
- Historique en anneau seulement pour les objets réactifs. Objet masqué si t_e < t_apparition.

### Tests Vitest (J1)
**Obligatoires.** Depuis l'arrêt, τ = 10 s. Valeurs attendues calculées dans le test : 100·tanh 1, 10·sinh 1, 1000·(cosh 1 − 1).
- Tolérances : v et t à 1e-6, x à 1e-5 m.
- Quatre découpages : 1/60, 1/30, aléatoire à graine fixe sommant à 10 s, un appel unique `step(10)`.
- Ces tolérances détectent aussi un retour accidentel à un schéma approché (jusqu'à 1e-2 m d'erreur).

**Complémentaires** :
- freinage depuis φ = 1 : arrêt à 543,080635 m, sans recul ;
- accélérer puis freiner : 1 086,161270 m, t = 23,504024 s ;
- virage pur : |u| conservé à 1e-12 ;
- jumeaux, aller-retour de 1 000 m : τ = 38,497 s, t = 44,721 s ;
- cohérence de `snapshot` : |v| = |u|/γ et γ = 1/√(1 − v²/c²) ;
- composition : non-commutativité, colinéaire = addition des rapidités ;
- plafond : après 1 000 s de poussée, φ = φ_max et |v| = c·tanh φ_max ;
- sans plafond, à 150 s : v < c, et la rapidité reste additive à 1e-9 ;
- `clampFrameDt` ;
- `retarded` : convergence, objet uniforme comparé à la forme fermée, cas où le résidu F(t_e) = t_e − t + |x_obs − p(t_e)|/c est nul dès le départ.

## 4. Rendu relativiste (Three.js r186, WebGL2)

### Matériaux
- `ShaderMaterial` maison, sans `onBeforeCompile` ni TSL/WebGPU.
- Chunks GLSL préfixés `rel_`, enregistrés dans `THREE.ShaderChunk`.
- Uniformes partagés par référence ; ne jamais appeler `material.clone()`.
- Matériaux non éclairés : couleurs plates par face, ombrage cuit, palette convertie en linéaire côté CPU.
- `renderer.toneMapping = NoToneMapping` ; chaque fragment se termine par `<colorspace_fragment>`.

### Transformation par sommet (aberration et retard)
Port vectoriel du pipeline d'OpenRelativity, sans rotation ni acos. Pour le décor statique, n est la direction monde du sommet vue depuis la caméra, r sa distance, et β, γ ceux de l'observateur :
- D = γ(1 + β·n) : vaut > 1 devant, donc décalage vers le bleu.
- n' = (n + (γ²/(γ+1)(β·n) + γ)β)/D.
- Le sommet est placé en `cameraPosition + n'·r`.

**On conserve la distance monde r** (l'image n'en dépend pas). near/far, brouillard et tri restent ainsi indépendants de β. highp est obligatoire.

### Couleur (Doppler) : convention écrite une fois pour toutes
- Chaque surface porte 5 canaux de réflectance (r, g, b, IR, UV), qui **partitionnent l'unité** sur [0 ; ∞) : IR = 0 sous 830 nm et 1 au-delà jusqu'à l'infini ; UV = 1 sous 360 nm et 0 au-dessus.
- On intègre les CMF de Wyman et al. (2013) sur [360 ; 830] nm, avec un éclairage solaire de 5 800 K.
- M_k(D) = 𝐍·RGB(∫ CMF(λ)·D·E(Dλ)·ρ_k(Dλ) dλ), où 𝐍 est une **matrice 3×3** : l'inverse du bloc RGB de l'intégrale à D = 1, appliquée aux 5 colonnes. On obtient ainsi **M(1) = [I | 0]**. Au repos, IR et UV sont exactement invisibles, puisque leurs bases n'ont aucun support dans [360 ; 830] nm.
- **Effet projecteur** : couleur = M(D)·ρ × min(D^p, borne). Avec cette convention, **p = 4 est le réglage physique, et c'est le réglage par défaut** (décision 3) : `BEAM_EXPONENT = 4`, borné par `BEAM_MAX = 4096` (= 8⁴, `constants.js`). D⁴ est donc exact jusqu'à D = 8 (γ ≈ 4,1 de face), sur tous les niveaux prévus ; la borne reste (cahier des charges) et garde les valeurs loin du maximum half float (65 504). L'ancienne borne 8 coupait le projecteur dès 47,7 m/s de face : une façade vue de face s'assombrissait quand on accélérait.
- **Adaptation de l'œil** : la luminosité d'ensemble est rendue par une exposition E = `adaptationExposure(D_avant)` = 1/G(D_avant), avec D_avant = e^φ (droit devant) et G le gain, projecteur compris, d'une façade de référence (`ADAPTATION_REFERENCE` : gris 0,6, ir 0,3, uv 0,15) vue de face. Cette façade garde sa luminance du repos ; les rapports de luminance dans l'image restent physiques. E = 1 à l'arrêt et en vision classique, 0,31 à 30 m/s, 0,093 à 76 m/s, 0,039 à 90 m/s ; `updateObserver` la pose dans `uExposure`. Le cockpit, comobile et éclairé par la lumière projetée vers l'avant, n'y est pas soumis. Le tone mapping (genou 0,75) ne fait plus que compresser les hautes lumières.
- **Lampes à raie** : lineRGB(λ₀/D) × min(D^p, borne).
- **Lampes corps noir** : XYZ(B(D·T))/D⁴ rapporté à XYZ(B(T)), × min(D^p, borne). On ne compte jamais deux fois les D⁴.
- Tone mapping qui préserve la teinte (Reinhard sur le maximum), car la teinte porte l'information du jeu.

### LUT
- `DataTexture` HalfFloat de **taille impaire N_LUT = 257** sur log₂D ∈ [−4,5 ; 4,5] (couvre φ ≤ 3,1 pour le décor statique).
- Lecture : coordonnée = (x·(N_LUT − 1) + 0,5)/N_LUT, si bien que D = 1 tombe au centre d'un texel.
- En J4, le Doppler relatif des objets mobiles peut atteindre e^{φ_joueur + φ_objet} : la plage sera recalculée à partir des niveaux.
- Déclarer explicitement `LinearFilter` (le défaut de r186 est `NearestFilter`) et pas de mipmaps.
- Construite par `render/dopplerLut.js` à partir de `physics/spectrum.js`, module pur et testé.

### Doppler par fragment dans tous les profils
Varying highp `vRel` (position relative à l'œil, non aberrée), puis n = normalize(vRel), D = γ(1 + β·n) et LUT. Le calcul par sommet donnait des taches de teinte, jusqu'à ΔE 30 dès le LOD le plus fin. Repli si la mesure l'exige : un « mode palette » à une seule lecture par pixel. L'économie du profil lite vient du DPR, pas de la couleur.

### Gameplay
**Le même module `spectrum.js` sert au gameplay.** `perceivedColor()` reprend toute la chaîne du shader (D par la géométrie réelle, projecteur, tone mapping), avec `{exposure: adaptationExposure(e^φ)}` pour suivre la même adaptation que l'écran. La fenêtre « vert » de la lampe à 640 nm du N3 n'en dépend pas (13,0–22,3 m/s) ; « noir » arrive dès 40,7 m/s au lieu de 44,6. Les lampes de puzzle ne sont pas diffusées par le brouillard (atténuation seulement).

Test d'adaptation (il remplace l'ancien test de lisibilité « ≥ 2 % de la luminance du blanc », pensé pour un projecteur borné à 8 sans adaptation) : la façade de référence vue de face, multipliée par E, garde sa luminance du repos à 2e-3 près pour v ∈ {5, 20, 30, 50, 76, 90, 95} m/s ; E décroît strictement avec v et vaut 1 à l'arrêt ; les façades vues de face sont plus lumineuses à 90 m/s qu'à 47,7 m/s (`tests/spectrum.test.js`). Au-delà de D = 830/360 ≈ 2,31 (68 m/s de face), seule la base IR d'une surface est visible : les façades de la palette ont donc des réflectances proche IR **variées** (ir de 0,1 à 0,6, moyenne 0,31 ≈ la référence), comme les pigments réels (≈ 0,05 pour le noir de carbone, 0,6–0,85 pour les oxydes de fer ou le blanc de titane) ; à D = 3, leurs luminances diffèrent d'un facteur ≥ 3. Même avec l'ancienne borne 8, une façade d'ir 0,1 vue de face à γ = 4 garde 2,5 % de la luminance du blanc.

### Ciel, sol et brouillard
Une passe plein écran après les opaques, à z = 1 (renderOrder 1, sans écriture de profondeur). Elle couvre environ 41 % de l'écran, soit environ 1 ms estimée sur un Mali-G52. Pour chaque pixel :
- aberration inverse exacte ;
- intersection analytique avec le plan du sol, calculée sans branchement avant la lecture de texture (`mix`/`step`) ;
- marquages tracés analytiquement, carte Canvas2D pour le plan et les ombres ;
- ciel procédural : brume à l'horizon, lumière diffuse d'un corps noir à 6 500 K près de l'horizon, et vers le zénith un **ciel dégagé à spectre continu**, ρ ∝ (550/λ)⁴ + 0,35·(550/λ)^1,3 (Rayleigh + aérosols à 90° du soleil : τ_A ≈ 0,1, Ångström 1,3, Henyey-Greenstein g = 0,7), nul sous 295 nm (ozone), de luminance 0,186 au repos, tabulé dans la ligne `SKY_CLEAR_ROW` de la LUT. Décalé, il reste bleu et lisse (les anciennes réflectances en créneaux donnaient du violet et du cyan saturé). Coût : 8 lectures de texture par pixel de la passe au lieu de 7. Au repos, il est un peu plus pâle qu'avant, à cause des aérosols ;
- brouillard en distance monde, mélangé avant le Doppler (correct pour un milieu immobile dans la ville), totalement opaque à `visibilite` ;
- `visibilite` est fixée par niveau et par profil dans le JSON (300–400 m en lite, 600 m ailleurs, sauf exception du niveau).

**Objets clés** (pont, pommier, lampes de puzzle) : ils sont exemptés du brouillard et de la coupe, avec une atténuation propre faible, et sont toujours dessinés. Le validateur vérifie que chaque objet clé reste visible depuis ses points d'observation de référence (N4 : point de non-retour ; N6 : anneau, à 500 m).

**Règle** : aucune géométrie sous y = 0. La rivière est un matériau de la carte, et le validateur le vérifie.

**Leviers si c'est trop cher** : DPR, occultation par le cockpit (dessiné en premier), sol en mode palette.

### Subdivision et LOD
L'aberration courbe les droites, mais seulement entre sommets.
- **Chunk** = un îlot entier, sans jamais couper un bâtiment ; les façades mitoyennes restent dans le même chunk (pas de fissures).
- **Trois LOD** : 1,5 / 5 / 15 m.
- **Règle** : LOD k permis si s_k ≤ κ·d_min, avec κ = min(0,2 ; √(8ε/(γβ))), où ε est la tolérance angulaire (2 px CSS). d_min est la distance apparente du point le plus proche du chunk, avec D minimal sur le champ visible, et 10 % d'hystérésis.
- **Image propre à environ 3 px près jusqu'à γ ≈ 2,5**. Au-delà (niveaux 5 et 6), on ajoute un LOD de 0,75–1 m pour les 2 à 6 chunks les plus proches (J5).
- **Triangles visibles par image (modèle calculé)** : 11 à 64 k sur l'avenue, 13 à 85 k en quartier. Le LOD0 est généré à la demande pour les îlots proches, LOD1 et LOD2 restent résidents. Tout générer en LOD0 donnerait environ 385 k triangles pour l'avenue de 4 km.

### Culling et nombre d'appels de dessin (draw calls)
- `frustumCulled = false` : le culling de Three passe avant le shader et ferait disparaître la moitié des chunks visibles à β = 0,76, puisque l'aberration ramène devant ce qui est derrière.
- **J1** : coupe à `visibilite`, exacte à ≤ 6/255 près sur quelques pixels au-dessus de l'horizon (le ciel brumeux n'a pas exactement la couleur de la brume ; nul à grande vitesse), puisque r est conservé et que le brouillard y est opaque ; au plus 42 chunks sur l'avenue.
- **J3** : culling par « cône apparent » exact, environ 0,3 µs par chunk.
- **Appels de dessin** : en quartier, 98 à 294 chunks sont visibles pour un brouillard à 600 m. D'où des super-chunks LOD2 de 256 m, ou un `BatchedMesh` piloté par notre culling (à mesurer en J1). Le budget d'appels de dessin est vérifié par niveau dans `levels.test.js`, qui peut importer le découpage en chunks de `render/`. Le validateur, lui, ne dépend que de physics.
- **Ordre de rendu** : cockpit d'abord (écrit la profondeur), puis opaques triés par r, passe ciel/sol, transparents et fantômes. `setOpaqueSort` remplace tout le tri de three : notre comparateur trie donc d'abord par `renderOrder` (cockpit −1, opaques 0, ciel/sol 1), puis par r.

### Objets mobiles (J4)
- Notation : w est la vitesse de l'objet dans la ville (β_w, γ_w), β et γ ceux du joueur.
- Côté CPU : pose à t_e, contraction 1/γ_w le long de w.
- Côté GPU : correction quadratique par sommet, exacte à vitesse constante, qui donne l'effet Terrell.
- Doppler relatif par fragment : D = γ(1 + n·β)/(γ_w(1 + n·β_w)).

### Contour fantôme (débloquable, J4)
Position des objets à l'instant t de la **ville**, passée par la même aberration, en fil de fer. Libellé « maintenant (horloge de la ville) ».

### Vision classique
- k ∈ [0, 1] (bouton à maintenir ou touche C, transition de 150 ms, instantanée avec `prefers-reduced-motion`).
- Côté CPU, on calcule β_eff = kβ et γ_eff = 1/√(1 − k²β²), ainsi que k·w et γ_w,eff pour les objets mobiles, et k/c dans le solveur de retard. Aucun k dans le GLSL statique.
- À k = 0, on voit la ville telle qu'elle est à l'instant t (= positions du fantôme), sans aucun effet, contraction comprise.

### Caméra, performances et robustesse
- **Caméra** : première personne, œil à 1,6 m, avant du véhicule en bas de l'écran, **hFOV 90°** en paysage.
- **Cible** : 60 i/s sur un GSM moyen (classe Mali-G68 / Adreno 710), plancher de 30 i/s stables sur entrée de gamme (Mali-G52 / Adreno 610).
- **Appareil de test de l'auteur** (décision 7) : iPhone 14 Pro Max, Safari iOS, DPR 3 (rendu à DPR 2 par défaut, plafonné à 2,2 Mpx), `requestAnimationFrame` limité à 60 Hz par défaut malgré l'écran ProMotion à 120 Hz. C'est sur lui que se mesure le critère de performance du J1 ; un Android moyen reste souhaitable en J2.
- **Profils lite / mid / full** inspirés du portfolio. DPR adaptatif recalé sur 60 i/s : on baisse de 0,25 au-delà de 18,5 ms d'intervalle moyen sur 90 images. On remonte sur un autre critère, puisqu'à 60 Hz l'intervalle ne descend jamais sous 16,7 ms : au moins 98 % des images à ≤ 17,5 ms pendant 10 s, et un temps de travail CPU (performance.now() autour de step + render) bas. On utilise `EXT_disjoint_timer_query_webgl2` quand elle existe. `powerPreference: 'high-performance'`.
- **Garde-fou de démarrage** :
  - clés `aslower:v1:gl-boot`, `…:gl-crash` et `…:gl-tier` (stockage local et de session), jamais `hh-*` puisque l'origine est partagée avec le portfolio ;
  - après un 1er plantage : lite, DPR 0,75 ;
  - après le 2e : écran « WebGL instable » avec bouton Réessayer, jamais de coupure définitive.
- **Compilation** : `compileAsync`, puis une ou deux images de préchauffage avec un mesh factice par variante de matériau, derrière l'écran de chargement.
- **Perte de contexte** : pause, puis recompilation et préchauffage avant de reprendre. On garde les tableaux CPU, la carte Canvas2D et les données de la LUT. Sans restauration après environ 5 s, on sauvegarde et on propose « Recharger ».

## 5. Contrôles et HUD

**Orientation** : **paysage strictement imposé** sur appareil tactile (décision 4). Le champ horizontal est d'environ 90° en paysage contre 30 à 40° en portrait, alors que l'aberration a besoin d'un champ large. En portrait, le panneau « Tourne ton GSM » masque le jeu, **sans** bouton « Jouer quand même » ; dès le J1 (`main.js`, `index.html`). La règle suit la forme de la fenêtre : si l'écran est déjà en paysage (`screen.orientation`, iPad en écran partagé ou Slide Over), le même panneau dit « Agrandis la fenêtre du jeu ». Pas de zoom par pincement : Safari iOS ignore `user-scalable=no`, d'où `touch-action: pan-x pan-y` sur `body` **et** sur chaque conteneur défilant (WebKit y repart de `auto`), plus `gesturestart` annulé sur le document.

**Tactile** : cibles d'au moins 48 px, à au moins 24 px des bords. Pointer Events avec capture, `touch-action: none`. Un doigt de l'accélérateur qui glisse sur la pédale freine (la capture le garderait sinon sur l'accélérateur).

| | Mode glisser (J1, et repli sans gyroscope) | Mode inclinaison (J2) |
|---|---|---|
| Accélérer | moitié droite maintenue | moitié droite maintenue |
| Frein | pédale de 96×80 px en bas à gauche de la moitié droite, prioritaire | bouton en bas à gauche |
| Tourner | moitié gauche, origine qui suit le pouce (R ≈ 56 px) | inclinaison du GSM |
| Vision classique | à mi-hauteur à gauche, hors de la zone volant | à mi-hauteur à gauche |

**Inclinaison (J2)** :
- `DeviceOrientationEvent.requestPermission()` est appelé en premier dans le geste « Jouer », sans `await` avant.
- On attend ensuite un vrai événement pendant 1 s, faute de quoi on passe au mode glisser.
- L'angle de volant est calculé à partir de β, γ et `screen.orientation.angle`, exact dans les deux paysages (90° et 270°), seuls permis.
- Calibrage pendant le décompte, zone morte de 3°, saturation à 25°, lissage de 60 ms. HTTPS requis (assuré par Pages).
- Panneau `?debug` pour vérifier les signes sur un vrai iPhone et un vrai Android.

**Clavier** (`event.code`, position physique des touches : W/A/S/D en QWERTY sont Z/Q/S/D en AZERTY) :
- ↑ ou KeyW (Z en AZERTY) : accélérer ;
- ← → ou KeyA D (Q D en AZERTY) : tourner ;
- Espace, ↓ ou KeyS : frein ;
- C ou Maj (gauche ou droite) : vision classique ;
- Échap ou P : pause.

**HUD** :
- **Horloges** : « Ta montre » et « Horloge de la ville » côte à côte. Pastille d'écart : **rouge avec ▲ quand γ > 1,02** (retour sous 1,01), grise quand l'écart est stable. Contraste de 5,6:1, symbole en plus de la couleur.
- **Phrase γ** (formulation du cahier des charges) : « même rythme » sous 1,01, puis « la ville va 15 % plus vite que toi », puis « ×2 », « ×2,5 »… avec hystérésis. Le carnet précise qu'il s'agit des horloges de la ville que tu croises.
- **Jauge de vitesse** : linéaire, avec un mur hachuré à 100 m/s. L'aiguille ralentit à poussée constante, ce qui montre l'asymptote. Des décimales s'ajoutent près de c, jusqu'à 99,5 m/s avec φ_max = 3 (99,5055, tronqué).
- **Mises à jour** : texte à 12 Hz, écrit seulement s'il change ; jauge par `transform` ; aucune lecture de mise en page dans la boucle.
- **Bulles (J2)** :
  - une seule fois par profil, stockées dans `aslower:v1:bulles` (try/catch, repli en mémoire) ;
  - déclencheurs décrits en JSON et évalués sans `eval` (`game/conditions.js`) ;
  - une bulle à la fois, non bloquantes, sauf au tutoriel où les horloges sont gelées.
- **Annonces accessibles** : région `aria-live` à débit limité (J2). Spectromètre textuel (« vert ✓, 530 nm ») pour les daltoniens (J3).

## 6. Niveaux (data-driven) et score

### Format
- Schéma `coursier-niveau/1`, un JSON par niveau : `src/levels/n01-premier-jour.json` … `n06-pommier-langevin.json`.
- Un seul glob, `./n[0-9][0-9]-*.json`, dans `src/levels/index.js`. `level.js` et `validate.js` reçoivent des objets simples, donc utilisables par un script Node.
- La palette est dans `src/data/palette.json` (J1). Les scènes de développement sont dans `src/data/scenes/` (J1) et utilisent le même format de carte.
- **Validateur maison en deux passes** (structure puis sémantique), avec des messages précis (chemin JSON et raison). Fichiers invalides de test dans `tests/fixtures/`.
- **Règles vérifiées par le validateur** :
  - id = nom du fichier ;
  - φ_max explicite et ≤ 3 ;
  - `visibilite` suffisante pour les objets clés ;
  - aucune géométrie sous y = 0 ;
  - abris hors de la ligne de vue des flashs ;
  - capteurs de porte à au moins 12 m.
- **Bot de référence** (`game/bot.js`, pur) : les tests vérifient que les seuils d'étoiles sont atteignables (parcours de référence = 3 étoiles, parcours naïf < 3). `npm run calibrate` affiche des seuils suggérés sans rien écrire.
- **Aucune fenêtre de vitesse dans le JSON** : les portes appellent `spectrum.js`.

### Réussite, échecs et étoiles
- **Réussite** : tous les colis obligatoires livrés (zone + v ≤ 3 m/s pendant 0,5 s de τ), même en retard (décision 6).
- **Échecs** : seulement la batterie vide (τ ≥ τmax) et le flash (N5). Un délai dépassé n'est **pas** un échec : il coûte l'étoile « Ponctuel ».
- **Reprises** (pas d'échec) : chute du pont, choc contre une porte. On repart au point défini dans le JSON, avec quelques secondes ajoutées aux deux horloges.
- **Étoiles**, une par critère du cahier des charges :
  - ★ Livré = réussite ;
  - ★ Économe = batterie restante ≥ seuil ;
  - ★ Ponctuel = chaque colis livré avant son délai, en heure de la ville (t) ; un seul retard suffit à perdre cette étoile, et rien d'autre.

  Le bilan dit laquelle manque, chiffres à l'appui. Les aides ne coûtent jamais d'étoile.

### Les six niveaux

| N° | Titre proposé | Notion | Mécanique (chiffres vérifiés, à recalibrer par le bot) |
|---|---|---|---|
| 1 | Premier jour | inertie, frein, Doppler | Deux livraisons (300 m, puis virage et 420 m). Relâcher garde la vitesse ; il faut 48 m pour s'arrêter à 30 m/s. Batterie large (150 s). |
| 2 | Le Grand Boulevard | deux horloges | Délais en heure de la ville (60 s puis 100 s ; un retard coûte l'étoile « Ponctuel »), batterie de 90 s. Boulevard de 2 km (τ 26 s, écart 8 s) contre un raccourci sinueux, plus coûteux sur les deux horloges. Une fenêtre « pas avant » légère introduit le coût de l'attente. |
| 3 | La Porte Verte | Doppler | Lampe rouge (raie fixée à 640 nm, comme dans le test J1) à voir verte : **≈ 13 à 22 m/s** dans l'axe. Lampe infrarouge à 900 nm, « éteinte », vue verte vers **44–52 m/s**. Trop vite, la lampe bleuit puis noircit (UV), et c'est le choc. |
| 4 | Le Pont Rømer | retard de la lumière | Pont-levis dont l'horaire est en heure de la ville (panneau). **Le niveau démarre lancé** à environ 76 m/s, profil de référence inscrit dans le JSON. Décision au **point de non-retour** : à 76 m/s, il faut 543 m pour s'arrêter, et l'image du pont a alors 5,4 s de retard. Le pont est signalé par de grands feux, car le tablier ne fait que ≈ 9 px à cette distance. Le pont peut paraître baissé alors qu'il est déjà levé. Débloque le contour fantôme. |
| 5 | La Pellicule | horizon de Rindler | Flash à t = 20 s, 400 m derrière le studio. **Condition de victoire** : atteindre l'abri (800 m, hors de la ligne de vue du flash) avant le front, soit partir vers le nord avant t ≈ 17 s (≈ 18 s si l'on part à 10 m/s). Avec l'approche prévue (300 m puis un virage), on ne part vers le nord qu'à t ≈ 12 s, à environ 10 m/s. **Bonus « au-delà de l'horizon »** si l'on part avant t = 14,0 s depuis l'arrêt (1 000 m d'avance), ou 14,95 s à 10 m/s (905 m d'avance) : fenêtre réelle d'environ 3 s. La lumière ne te rattrape alors jamais tant que tu accélères. Compte à rebours du flash affiché. |
| 6 | Le Pommier de Langevin | paradoxe des jumeaux | Pommes mûres à t = 200 s, batterie de 120 s : attendre est impossible. Anneau (Ø 1 km), φ_max fixé pour γ ≤ 4. Faire passer 200 s de ville coûte 72 à 83 s de batterie sur l'anneau, et environ **101 à 111 s** avec l'accès, les 500 m jusqu'au pommier et la livraison (marge de 9 à 19 s, à recalibrer par le bot). Le pommier, au centre de l'anneau, est vu avec D = γ : il vieillit **visiblement** ×γ (étapes : fleurs, fruits verts, mûrs, tombés). C'est un **pommier géant** (≈ 45 m), sans quoi il ne ferait que 2 à 3 px à 500 m. Le bilan « Luc a vieilli de … s, toi de … s » est produit par le bot. |

### Détails qui corrigent le premier jet
- **N3, contrat du capteur** : la porte s'ouvre si la lampe, telle qu'on la voit, a la teinte demandée pendant 0,4 s de τ, à une distance comprise entre 12 et 150 m (200 m pour l'infrarouge). D est calculé avec la géométrie réelle (hauteur et décalage de la lampe). Au passage sous la porte, l'angle fait revenir la lampe au rouge : on n'évalue donc jamais là. Tests du bot : franchir la porte à la vitesse de référence ; à fond, c'est le choc.
- **N4, règle juste** : ce que tu vois a r/c de retard, et le pont continue de bouger pendant ton trajet. Seul compte son état à ton arrivée : il faut se fier à l'horaire de la ville. La condition dépend de r, donc de la vitesse d'approche : 155 m (1,55 s) à 50 m/s, 543 m (5,4 s) à 76 m/s. D'où le départ lancé, qui impose le profil de référence. Le cycle (durée « baissé » ≤ r/c et ≤ P − r/c) est réglé pour que les fenêtres de réussite en vision relativiste et en vision classique soient disjointes. Tests du bot :
  - à profil égal, la fenêtre exprimée en phase vue est décalée d'exactement r/c entre k = 1 et k = 0 ;
  - « je fonce dès que je le vois baissé » échoue ;
  - « je suis l'horaire » réussit.

  En fonçant vers le pont, on voit son « film » en accéléré : ×(1+β) par rapport à l'horloge de la ville (×1,76 à 76 m/s), soit ×D = γ(1+β) par rapport à ta montre (×2,7).
- **N5, jauge** : elle mesure l'écart **dans ton référentiel** : g' = |Δx'| − cΔt', soit g·e^φ en ligne droite. Dans la ville, l'écart diminue toujours, même au-delà de l'horizon. La jauge porte le repère « horizon : 1 000 m ». La bulle « l'écart ne se referme plus » se déclenche sur dg'/dτ ≥ −0,5 m/s.
- **N6, anneau** : avec la conduite arcade (décision 1), la route fournit les 160 à 300 m/s² d'accélération centripète, hors du budget du moteur : plus besoin d'un rail d'exception. Un rayon de 500 m demande le volant à |u|/(500 m · TURN_RATE), soit 0,77 à γ = 4 (TURN_RATE = 1,0 rad/s). Un guidage facultatif pour rester sur l'anneau reste à décider en J5. Le mécanisme des « vivants » (étapes d'âge affichées en t_e) arrive en J4.

### Habillage (proposition, facultative)
- Ville de Lumière-sur-Lente, entreprise Photon Express.
- Clients nommés d'après des physiciens : Planck, Lorentz, FitzGerald, Rømer, Rindler, Langevin.
- Jumeau sédentaire « Luc » au dépôt.
- Façades saturées dans l'ordre de l'arc-en-ciel, pour que la rue « glisse d'un cran » avec le Doppler. Primaires pures réservées aux lampes ; ni noir (réservé à « hors du visible »), ni grandes surfaces blanches.
- Modélisation low poly (boîtes, aplats) ; seule la subdivision invisible des faces est imposée par l'aberration.
- Pas de son diégétique : avec c = 100 m/s, le son à 343 m/s irait plus vite que la lumière.

## 7. Licences et crédits

**Licence du projet** (décision 5) :
- **code** (JS, GLSL, HTML, CSS, scripts, tests) : MIT, « Copyright (c) 2026 Hugo Hismans » (`LICENSE`) ;
- **contenus** (`src/data/**/*.json`, `src/levels/**/*.json`, textes du jeu, documentation) : Creative Commons Attribution 4.0 International, CC BY 4.0 (`LICENSE-CONTENT.md`, avec l'attribution attendue) ;
- `package.json` : `"license": "MIT AND CC-BY-4.0"`.

**OpenRelativity (MIT)** :
- **`THIRD_PARTY_NOTICES.md`** contient :
  - les textes MIT intégraux, non traduits, en blocs de code, d'OpenRelativity et de three.js ;
  - la liste des fichiers dérivés, en tableau « fichier | source:lignes | nature » (adapté ou inspiré). C'est la source de vérité des tests ;
  - la citation de Wyman, Sloan et Shirley (JCGT 2013) ;
  - la mention « projet indépendant, non affilié au MIT ni au MIT Game Lab », sans aucune ressource du jeu d'origine.
- **Copies servies sur Pages** :
  - `public/licences/openrelativity-MIT.txt` (test : identique, à la normalisation près, au bloc des notices) ;
  - `licences/npm-dependencies.txt`, généré par `build.license` (texte MIT de three 0.186.1).
- **Écran Crédits** (`<dialog>`, accessible depuis l'écran titre) : charge `THIRD_PARTY_NOTICES.md?raw` à l'ouverture et pointe vers `BASE_URL + 'licences/…'`.
- **En-tête dans chaque fichier dérivé**, conservé par `build.rolldownOptions.output.comments.legal: true` (« Adapté » ou « Inspiré » selon la nature) :
  `/*! Adapté d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, <fichier>:<lignes> — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */`
- **Fichiers concernés** (liste fixée au J1, reprise telle quelle dans `THIRD_PARTY_NOTICES.md`) :

  | fichier | source:lignes | nature |
  |---|---|---|
  | `src/physics/relativity.js` | `MovementScripts.cs:164-183 ; relativity.shader:122-224` | Adapté |
  | `src/physics/player.js` | `GameState.cs:220-246 ; MovementScripts.cs:114-183` | Inspiré |
  | `src/physics/spectrum.js` | `relativity.shader:27-47, 243-327, 356-371` (préréglage OpenRelativity, pour comparaison) | Adapté |
  | `src/physics/retarded.js` | `RelativisticObject.cs:316-328 ; relativity.shader:176-182` | Adapté |
  | `src/render/shaders/rel_vertex.glsl` | `relativity.shader:83-239` | Adapté |
  | `src/render/shaders/rel_doppler.glsl` | `relativity.shader:299-379` | Adapté |
  | `src/render/shaders/environment.frag.glsl` | `skybox.shader` | Inspiré |
  | `src/render/subdivide.js` | `ObjectMeshDensity.cs` | Inspiré |

  En J4 s'ajoutera `src/render/movers.js` (`RelativisticObject.cs:329-340`).

  Règle : tout fichier qui reprend une formule, une constante ou une logique d'OpenRelativity porte l'en-tête et figure dans le tableau des notices.
- **Vérifications** :
  - `tests/licence.test.js` (sources seulement) : texte MIT d'OpenRelativity dans les notices, identique à la copie servie ; texte MIT de three.js identique au `LICENSE` du paquet ; en-tête de chaque fichier du tableau qui existe (nature et lignes d'origine comprises) ; tout fichier de `src/` qui porte l'en-tête figure dans le tableau ; `LICENSE` MIT et `LICENSE-CONTENT.md` CC BY 4.0 ;
  - `scripts/check-dist.mjs` en `postbuild` : en-tête présent comme **commentaire légal** (`/*!` en début de ligne) dans au moins un `dist/assets/*.js`, ce qui exige `comments.legal` ; celui des shaders importés en `?raw`, pris dans une chaîne, ne compte pas. Aussi `dist/licences/openrelativity-MIT.txt` et `dist/licences/npm-dependencies.txt` (three, MIT). La CI échoue sinon (`tests/check-dist.test.js` vérifie le script lui-même).
- **README et Crédits** : MIT Game Lab, *A Slower Speed of Light*, lien vers le dépôt, remerciements à Gerd Kortemeyer. Mention « projet indépendant, non affilié au MIT », sans aucune ressource du jeu d'origine. Citation de Wyman, Sloan et Shirley (JCGT 2013). Licences du projet (MIT et CC BY 4.0).

## 8. Arborescence

```
aSlower/
├── .github/
│   ├── workflows/deploy.yml       # npm ci → npm test → npm run build (+ postbuild check-dist) → Pages
│   │                              # actions épinglées par SHA ; contents:read ; pages/id-token sur deploy seul
│   ├── workflows/ci.yml           # pull requests (Dependabot comprises) : npm ci → npm test → npm run build
│   └── dependabot.yml             # npm + actions, mensuel, cooldown de 14 jours
├── .editorconfig  .gitignore  .npmrc (save-exact, engine-strict)  .nvmrc (24)  jsconfig.json
├── LICENSE                        # MIT, pour le code (décision 5)
├── LICENSE-CONTENT.md             # CC BY 4.0, pour les contenus (JSON, textes, docs)
├── THIRD_PARTY_NOTICES.md         # textes MIT + liste des fichiers dérivés + Wyman et al.
├── README.md                      # FR : jouer, développer, tester sur GSM, crédits
├── docs/conception.md             # ce plan tenu à jour + décisions + glossaire FR→EN
├── docs/interfaces.md             # contrat entre modules (signatures, repères, imports permis)
├── index.html                     # canvas, HUD, écrans, <dialog> Crédits
├── package.json  package-lock.json  vite.config.js
├── scripts/
│   ├── check-dist.mjs             # J1 : licences présentes dans dist/
│   └── calibrate.mjs              # J3 : seuils d'étoiles suggérés par le bot
├── public/
│   ├── favicon.svg
│   ├── licences/openrelativity-MIT.txt
│   └── manifest.webmanifest  icons/                         # J2
├── src/
│   ├── main.js                    # écran titre → geste utilisateur → boucle ; panneau « Tourne ton GSM »
│   ├── loop.js                    # rAF, clampFrameDt, pause sur visibilitychange
│   ├── storage.js                 # local + session, try/catch, repli mémoire, préfixe aslower:v1:
│   ├── data/
│   │   ├── palette.json           # couleurs nommées : r, g, b, ir, uv
│   │   ├── scenes/avenue-test.json  quartier-test.json      # J1 (scènes de développement)
│   │   ├── bubbles.json           # J2 : textes et déclencheurs des bulles
│   │   └── notebook.json          # J5 : carnet de physique
│   ├── physics/                   # PUR : ni three ni DOM
│   │   ├── constants.js           # C = 100, A = 10, PHI_MAX
│   │   ├── relativity.js          # γ, composition, aberration, Doppler, emissionTimeStatic
│   │   ├── player.js              # état u = γv, segment exact, conduite, snapshot, clampFrameDt
│   │   ├── spectrum.js            # bases, CMF, M(D), raies, corps noirs, perceivedColor
│   │   ├── retarded.js            # temps retardé (Newton sécurisé), historique
│   │   └── collisions.js          # J3
│   ├── render/
│   │   ├── renderer.js            # WebGLRenderer, resize, perte de contexte, préchauffage
│   │   ├── quality.js             # profils, DPR adaptatif, garde-fou
│   │   ├── camera.js              # 1re personne, hFOV 90°
│   │   ├── uniforms.js            # uniformes partagés, β_eff/γ_eff (vision classique)
│   │   ├── materials.js           # fabriques : statique, émetteur, cockpit, environnement
│   │   ├── dopplerLut.js          # DataTexture HalfFloat N_LUT = 257 depuis spectrum.js
│   │   ├── subdivide.js           # PUR : grilles à pas maximal
│   │   ├── scene.js               # assemble le monde d'une scène (createWorld)
│   │   ├── coords.js              # repère du jeu → repère Three
│   │   ├── layout.js              # PUR : développe les scènes JSON en bâtiments
│   │   ├── cityMesher.js          # carte JSON → îlots-chunks, 3 LOD
│   │   ├── lod.js                 # règle κ·d_min, hystérésis (PUR)
│   │   ├── culling.js             # J1 : distance ; J3 : cône apparent (PUR)
│   │   ├── streetMap.js           # carte Canvas2D (plan, ombres)
│   │   ├── cockpit.js             # avant du véhicule
│   │   ├── movers.js  ghosts.js  living.js                  # J4
│   │   └── shaders/
│   │       ├── rel_vertex.glsl  rel_doppler.glsl  rel_fog.glsl
│   │       ├── surface.*.glsl  emitter.*.glsl  cockpit.*.glsl  environment.vert.glsl
│   │       └── environment.frag.glsl                        # ciel + sol + brouillard
│   ├── input/
│   │   ├── controls.js            # → { thrust, brake, steer, classic, pause }
│   │   ├── keyboard.js  touch.js  # J1 (touch : mode glisser)
│   │   └── tilt.js  tiltMath.js  device.js                  # J2 (tiltMath pur ; device : plein écran, Wake Lock)
│   ├── hud/
│   │   ├── hud.js  hud.css  format.js (PUR)  credits.js  diag.js   # J1 (diag : #diag, ?bench)
│   │   ├── bubbles.js  announcer.js                                # J2 (affichage)
│   │   └── spectrometer.js                                         # J3
│   ├── game/
│   │   ├── conditions.js  bubbles.js   # J2 : déclencheurs (sans eval), moteur « une seule fois »
│   │   └── states.js  level.js  rules.js  score.js  validate.js  bot.js   # J3
│   ├── levels/                    # J3+
│   │   ├── index.js               # seul glob ./n[0-9][0-9]-*.json
│   │   └── n01-premier-jour.json … n06-pommier-langevin.json
│   └── styles/base.css
└── tests/
    ├── J1 : player  relativity  retarded  spectrum (LUT échantillonnée comme le GPU)
    │        render-math  layout  lod  culling  format  storage  purity  licence  check-dist  loop
    ├── J2 : tiltMath  conditions
    ├── J3 : collisions  rules  levels (+ fixtures/levels-invalid/)  score  states  culling (cône apparent)
    └── J4 : living
```

### Outillage
- **Versions** : vite 8.3.1, vitest 5.0.2, three 0.186.1 et @types/three 0.186.0, épinglées exactement (toutes publiées depuis au moins 14 jours).
- **Node** : `engines: "^22.12.0 || ^24.0.0 || >=26.0.0"`.
- **vite.config.js** :
  - `base: '/aSlower/'` ;
  - cible es2020 ;
  - three dans son propre fichier ;
  - GLSL en `?raw` ;
  - `build.license` et `comments.legal`.
- **Lint et format** : pas d'ESLint ni de Prettier au départ (`.editorconfig` et `checkJs`). En option, `tsc --noEmit -p jsconfig.json` en CI : `jsconfig.json` ne couvre que `src/` (0 erreur), les tests et scripts Node demanderaient `@types/node`.
- **Sécurité** : passer `source-map-js` (dépendance de développement) à 1.2.2 à partir du 2026-10-14, quand le correctif aura 14 jours.

## 9. Jalons

### J1 : socle physique et rendu

**Bilan (2026-10-11) : terminé.** 292 tests verts, CI et Pages en ligne, vision classique identique au pixel près
au rendu sans effets. Mesure `?bench` sur l'iPhone 14 Pro Max de l'auteur (Safari, DPR 2, profil normal) :
avenue 59 i/s, image p95 17 ms (max 68 ms), 39 appels, 21,7 k triangles ; quartier 59 i/s, p95 17 ms
(max 34 ms), 211 appels, 110 k triangles ; CPU du rendu ≤ 2 ms au p95. Commandes tactiles et virage validés
par l'auteur. Reste à mesurer : un GSM Android moyen (J2).
Un seul jalon à valider. Chaque étape est publiée sur Pages et jouable sur le GSM.

| Étape | Contenu |
|---|---|
| **J1a** | Outillage, CI (tests → build → check-dist → Pages), notices, Crédits, README. `physics/` complet (constants, relativity, player, spectrum, retarded) avec ses tests. Scène avenue **non relativiste** chargée depuis `avenue-test.json` (cityMesher, LOD par distance). Clavier et tactile (mode glisser) ; paysage strictement imposé (panneau « Tourne ton GSM »). HUD minimal : deux horloges et leur écart, phrase γ, jauge. |
| **J1b** | Aberration et retard dans le vertex shader. Vision classique (k). `#diag` et `?bench`. **Première mesure sur le GSM.** `#diag` affiche : temps d'image p50 et p95, temps CPU de `render()`, appels de dessin et triangles (`renderer.info`), durée de la première image, présence de `KHR_parallel_shader_compile`, `gl.RENDERER`, DPR atteint, et un interrupteur de la passe ciel/sol. |
| **J1c** | LUT Doppler par fragment, projecteur, tone mapping. Lampadaires corps noir, panneaux IR/UV. |
| **J1d** | Passe ciel/sol/brouillard, mesurée par différence avec J1b ; leviers si nécessaire. Scène `quartier-test` (≈ 1,3 × 1,3 km, pour contenir tout le disque de 600 m) pour mesurer les appels de dessin, et super-chunks ou `BatchedMesh` si besoin. |

**Scène de test** : avenue droite de **4 km**, bordée d'environ 280 bâtiments aux couleurs de l'arc-en-ciel. Il faut 1,5 km pour atteindre γ ≈ 2,5 (91,7 m/s), autant pour freiner, et il reste 1 km de marge. Au bout, une place avec une butée douce (pas de collision avant J3). Pas de batterie ni de délai.

**Livré en plus de la demande, et pourquoi** :
- CI et Pages : tester sur le GSM, puisque le gyroscope exige HTTPS ;
- Crédits : obligation de licence dès la première publication ;
- HUD minimal : voir τ et t ;
- `#diag` : mesurer.

**Reporté** :
- gyroscope et bulles → J2 ;
- rendu des objets mobiles → J4 (le solveur, lui, est livré en J1) ;
- culling par cône apparent → J3 ;
- profils mid/full et DPR adaptatif → J2.

**Critères de fin de J1** :
1. **`npm test` vert** :
   - les 3 valeurs (v et t à 1e-6, x à 1e-5 m) sur les 4 découpages ;
   - la LUT, échantillonnée comme sur le GPU (half + interpolation), vaut [I | 0] à 1e-3 près à D = 1 ;
   - invariance du corps noir, qui fixe l'exposant : pour un blanc plat (r + g + b + ir + uv ≡ 1), D⁴·M(D)·w = 𝐍·RGB(XYZ(B(D·5 800 K))) à 1e-4 près pour D ∈ {0,5 ; 2 ; 6 ; 20} ;
   - une lampe corps noir à D ≠ 1 ne reçoit pas deux fois le facteur D⁴ ;
   - lampe à 640 nm : spectrum.js la classe « verte » exactement quand λ₀/D ∈ [510 ; 562] nm, D étant calculé indépendamment dans le test (soit v ∈ [12,9 ; 22,3] m/s ; tolérance de ±3 nm sur les bornes) ;
   - pureté, stockage, licences (sources).
2. **CI verte**, `check-dist` OK, jeu en ligne sur <https://hugohismans.github.io/aSlower/>.
3. **Performance** (`?bench` : sur l'avenue, accélération réelle jusqu'à γ ≈ 2,5 ; sur le quartier, caméra scriptée à β imposé de 0 à 0,92, puisque la scène est trop petite pour accélérer) : médiane ≥ 55 i/s et 95e centile ≤ 20 ms. Conditions : après 2 min de chauffe, DPR ≥ 1, hors mode économie d'énergie, sur l'iPhone 14 Pro Max de l'auteur (Safari iOS, rAF à 60 Hz ; et un GSM Android moyen si possible). Sinon, on identifie le poste dominant dans `#diag` et on applique le levier correspondant avant de clore.
4. **Vision classique** : à k = 0, image identique à ±1/255 par canal à celle du même pipeline compilé sans effets relativistes (brouillard et tone mapping inclus).
5. **Contrôles et robustesse** : tactile validé sur l'iPhone 14 Pro Max (paysage imposé, panneau « Tourne ton GSM » en portrait), Crédits accessibles depuis l'écran titre, test `WEBGL_lose_context` réussi.

### J2 : contrôles mobiles et pédagogie
- gyroscope (permission iOS, calibrage, repli) et panneau `?debug` ;
- plein écran et Wake Lock (le panneau portrait, lui, est livré dès le J1) ;
- bulles « une seule fois » ;
- pause et reprise ;
- profils mid/full et DPR adaptatif ;
- matrice d'appareils (l'iPhone 14 Pro Max de l'auteur, plus un Mali ou Adreno moyen ou d'entrée de gamme si possible, avec `?bench`) ;
- accessibilité.

### J3 : moteur de niveaux et niveaux 1 à 3
- schéma et validateur, machine à états (menu → briefing → décompte → jeu → bilan) ;
- livraisons, batterie, délais (étoile « Ponctuel », jamais un échec), collisions, marche arrière, `emissionTimeStatic` ;
- étoiles, bot et calibrage ;
- progression sauvegardée ;
- culling par cône apparent, spectromètre ;
- niveaux 1, 2 et 3.

### J4 : lumière retardée et objets mobiles
- matériaux des objets mobiles (correction par sommet, Doppler relatif, contraction) ;
- horloges vues en t_e, « vivants » à étapes d'âge ;
- contour fantôme ;
- niveau 4.

### J5 : Rindler, jumeaux et finitions
- niveau 5 (abri, jauge dans ton référentiel, bonus horizon, mini-diagramme d'espace-temps) ;
- niveau 6 (anneau, pommier, Luc) ;
- LOD fin pour γ > 2,5 ;
- carnet de physique, finitions ;
- éventuelle fiche dans le portfolio.

## 10. Risques principaux

| Risque | Parade |
|---|---|
| Appels de dessin en quartier (98 à 294 chunks visibles à 600 m) | Mesure en J1d ; super-chunks ou BatchedMesh ; brouillard plus court en lite |
| Lisibilité des couleurs à grande vitesse | IR en plateau infini et réflectances proche IR variées dans la palette ; corps noirs ; projecteur physique p = 4 (D⁴ exact jusqu'à D = 8, BEAM_MAX = 8⁴) et adaptation de l'exposition (`adaptationExposure`) ; exposant réglable |
| Teintes hypersensibles (4 % sur D font passer du jaune au vert) | Règles de porte calculées par la même chaîne (`perceivedColor`) ; Doppler par fragment |
| Courbes polygonales au-delà de γ ≈ 2,5 | LOD fin pour les îlots proches (J5) ou plafond visuel |
| Mal des transports (FOV, aberration, anneau) | FOV réglable, plafond γ par niveau, `prefers-reduced-motion` |
| Signes du gyroscope selon les appareils | `?debug`, tests sur de vrais appareils en J2 |
| Minificateur qui retire les en-têtes | `comments.legal` + check-dist en CI |
| Perte de contexte (iOS) | données CPU conservées, préchauffage, « Recharger » |
| Écran DPR 3 de l'iPhone 14 Pro Max (≈ 3,6 Mpx en paysage) | DPR plafonné à 2 et à 2,2 Mpx ; `?dpr=` pour mesurer |
| Puzzles qui enseigneraient l'inverse (cf. N4) | tests de stratégie du bot en vision relativiste et classique |

## 11. Décisions de l'auteur (2026-10-11)

Réponses aux neuf questions du plan. Elles priment sur toute version antérieure de ce document, qui a été mis à jour en conséquence.

1. **Conduite : arcade**, plutôt que l'adhérence honnête à 10 m/s² d'abord proposée. La route fournit la force latérale, hors du budget du moteur : a = 10 m/s² ne vaut que pour la poussée et le frein. Le virage fait tourner u à |u| constant, dθ/dτ = −steer·TURN_RATE ; à l'arrêt, le cap pivote à PIVOT_RATE. Plus de cercle d'adhérence, plus de rail d'exception au niveau 6. L'échelle reste celle du §1.1 : 1 km pour atteindre γ = 2, autant pour freiner (§1.1, §3, §6).
2. **Dilemme des horloges : choix délégué** (« je te laisse choisir la meilleure option »). Retenu : les fenêtres « pas avant », qui font du paradoxe des jumeaux la solution (§1.2). Le moteur qui consomme (optimum vers 50 m/s) n'est pas retenu : il brouillerait la règle simple « batterie = τ ».
3. **Couleurs : le modèle le plus fidèle à la physique**, plutôt que la fidélité stricte à OpenRelativity (illisible au-delà d'environ 50 m/s). Réflectance × soleil à 5 800 K, bases infrarouge et ultraviolette, fonctions colorimétriques de Wyman et al. ; effet projecteur physique par défaut, `BEAM_EXPONENT = 4`, borné par `BEAM_MAX` (= 8⁴, D⁴ exact jusqu'à D = 8), avec adaptation de l'exposition de l'œil (§4). Le modèle d'OpenRelativity reste un préréglage de comparaison.
4. **Orientation : paysage strictement imposé** sur appareil tactile : panneau « Tourne ton GSM » sans bouton « Jouer quand même », dès le J1 (§5).
5. **Licence : MIT pour le code, CC BY 4.0 pour les contenus**, plutôt que MIT pour tout : `LICENSE` et `LICENSE-CONTENT.md` (§7).
6. **Délais : un retard coûte seulement l'étoile « Ponctuel »**, au lieu de faire échouer le niveau. L'échec ne vient que de la batterie vide et du flash (§6) ; règles livrées au J3, flash avec le niveau 5.
7. **Appareil de test : iPhone 14 Pro Max** (Safari iOS, DPR 3, `requestAnimationFrame` limité à 60 Hz par défaut). C'est l'appareil des mesures de performance du J1 (§4, §9).
8. **GitHub Pages : source « GitHub Actions »**, confirmée. Publication par `.github/workflows/deploy.yml` sur <https://hugohismans.github.io/aSlower/>.
9. **Niveau 4 : interprétation confirmée.** « Il semble ouvert » se lit « il semble praticable » (pont baissé).

## 12. Glossaire FR → EN

Le jeu, les données JSON et la documentation sont en français ; les identifiants du code sont en anglais. Les clés JSON restent françaises et sans accents (`depart`, `rues`, `batiments`, `lampadaires`, `visibilite`…).

| Français (jeu, docs) | Code |
|---|---|
| horloge de la ville, temps de la ville t | `t` |
| ta montre, batterie, temps propre τ | `tau` |
| écart t − τ | gap (`formatGap`) |
| vitesse propre u = γv | `ux`, `uy` |
| rapidité φ, plafond de rapidité | `rapidity`, `phiMax` |
| cap | `heading` (`hx`, `hy`) |
| volant, accélérateur, frein | `steer`, `thrust`, `brake` |
| vision classique | `classic` (coefficient k, `REL_CLASSIC`) |
| facteur Doppler D | `dopplerFactor` |
| aberration (directe, inverse) | `aberrate`, `aberrateInverse` |
| temps d'émission, temps retardé | `emissionTimeStatic`, `retardedTime` (`te`) |
| effet projecteur | beam (`beamFactor`, `BEAM_EXPONENT`, `BEAM_MAX`) |
| compression des couleurs | tone mapping (`toneMap`, `TONEMAP_KNEE`) |
| table Doppler | LUT (`buildDopplerLutData`, `dopplerLut.js`) |
| fonctions colorimétriques | CMF (`cmfWyman`) |
| réflectance (r, g, b, IR, UV) | `reflectance` ; attributs `color` et `aSpec` |
| corps noir, raie | `blackbody`, `line` |
| îlot (morceau de ville), niveau de détail | chunk, LOD (`chooseLod`) |
| brouillard, visibilité | fog (`uFogNear`, `uFogFar`), `visibility` |
| lampadaire | lamp, emitter |
| jauge de vitesse | gauge (`gaugeFraction`) |
| commandes, HUD, diagnostic, stockage, boucle | `controls`, `hud`, `diag`, `storage`, `loop` |
| colis, livraison, délai, étoile (J3) | parcel, delivery, deadline, star |
| bulle (J2), carnet de physique (J5) | bubble, notebook |
