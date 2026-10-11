# Le Coursier relativiste — plan et arborescence

> Contrat entre modules (signatures, repères, attributs, imports permis) : [`docs/interfaces.md`](interfaces.md). En cas de désaccord sur une signature, c'est le contrat qui fait foi ; ce document donne le pourquoi.

Statut : **jalon 3 intégré** (niveaux 1 à 3, à valider sur l'iPhone, §9) ; jalon 2 intégré ; jalon 1 terminé le 2026-10-11. Décisions de l'auteur du 2026-10-11 intégrées (voir §11, dont la décision 10 : **la vitesse de la lumière est un réglage du joueur**, entier de 10 à 100 m/s, 30 m/s par défaut ; et la décision 11 : **a = c/5**).

> **Unités naturelles.** Le moteur garde c/a = **T = 5 s** (`ACCEL_TIME`) quel que soit le réglage ; l'unité de longueur des niveaux vaut **L = c·`LENGTH_TIME` = 10·c m** (300 m au réglage par défaut c = 30 m/s, 1 000 m à c = 100 m/s, valeur du cahier des charges). Depuis la décision 11 (a = c/5), L = 2·c²/a : la longueur naturelle du mouvement, c²/a = 5·c m (150 m à c = 30), en vaut la moitié ; jusque-là (a = c/10), L valait c²/a. Les distances de jeu ci-dessous sont données en L (et en mètres à c = 30), les vitesses en fractions de c (β) ; les temps ne dépendent pas de c. Les éléments à l'échelle humaine (îlots de 56 m, rues, hauteurs, lampadaires tous les 40 m, œil à 1,6 m) restent en mètres. Le dépôt `hugohismans/aSlower` est public ; GitHub Pages y est publié en mode « GitHub Actions ». Les prototypes jetables du bac à sable (§0) ont servi de base au code du jalon 1. Publication sur <https://hugohismans.github.io/aSlower/> (la casse de l'URL compte).

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
- **Valeurs des tests obligatoires** (cahier des charges, c = 100 m/s et a = 10 m/s², injectées dans les tests), recalculées : v = 76,159416 m/s, t = 11,752012 s, x = 543,080635 m. Au réglage par défaut (c = 30, a = 6), les 10 s de poussée donnent φ = 2 : v = 30·tanh 2 = 28,920827 m/s, t = 5·sinh 2 = 18,134302 s, x = 150·(cosh 2 − 1) = 414,329354 m.
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

### 1.1 L'échelle naturelle : c²/a et L = 10·c
Avec a = c/5 (décision 11), les unités naturelles du mouvement sont **c²/a = 5·c m** et **T = c/a = 5 s** ; l'unité de longueur des niveaux reste **L = 10·c m = 2·c²/a** (elle valait c²/a avec a = c/10). Au réglage par défaut (c = 30 m/s ≈ 108 km/h, a = 6 m/s²), c²/a = 150 m et L = 300 m ; à c = 100 m/s (a = 20 m/s² ; le cahier des charges demandait 10 m/s²), c²/a = 500 m et L = 1 000 m.

| Pour… | il faut… (en L, puis à c = 30 m/s) | à c = 100 m/s |
|---|---|---|
| atteindre γ = 2 (β = 0,866) | 6,6 s de poussée et c²/a = **0,5·L** (autant pour freiner) : 26,0 m/s, **150 m** | 86,6 m/s, 500 m |
| s'arrêter depuis β = 0,5 / 0,76 / 0,9 | (γ − 1)·c²/a = 0,077 / 0,272 / 0,647 L : depuis 15 / 22,8 / 27 m/s, 23 / 81 / 194 m | 77 / 272 / 647 m |
| tourner à fond à β = 0,2 / 0,5 / 0,76 / 0,9 (conduite arcade, §3) | rayon γβ·c/TURN_RATE = 0,020 / 0,058 / 0,117 / 0,206 L : 6 / 17 / 35 / 62 m (r = \|u\|/TURN_RATE, TURN_RATE = 1,0 rad/s pour tout c) | 20 / 58 / 117 / 206 m |
| échapper à un flash (horizon de Rindler) | c²/a = 0,5·L d'avance : 150 m | 500 m |

La « petite ville » mesure environ 3 L × 2 L (0,9 × 0,6 km à c = 30) : îlots de 50 à 60 m (échelle humaine, pour tout c), avenues droites de 2 à 3 L (4 L pour la seule scène de test J1 : 1 200 m). Chaque niveau charge un quartier de 0,7 à 2,4 L (210 à 720 m à c = 30). La lumière la traverse en 30 s, pour tout c : c'est une petite ville pour un véhicule. À c = 30, la ville compte donc 3,3 fois moins d'îlots par L qu'à c = 100 : moins de géométrie, mais des niveaux plus « serrés » (moins de rues entre deux points de jeu), à valider niveau par niveau.

### 1.2 Sur un trajet simple, foncer gagne sur les deux horloges
Pour un trajet A→B fixé, τ = ∫dx/(γv) et t = ∫dx/v **diminuent tous les deux** quand on va plus vite. Exemple sur L (300 m à c = 30 ; mêmes temps pour tout c) :
- à β = 0,2 (6 m/s à c = 30) : τ = 50 s et t = 51 s ;
- à fond (poussée puis freinage) : τ = 13,2 s et t = 17,3 s.

Avec une simple échéance « avant t = X », le dilemme n'existe donc pas. La vraie tension entre τ et t vient des **fenêtres « pas avant »** : client absent, pont levé, pommes pas mûres. Attendre sur place coûte 1 s de batterie par seconde de ville, alors que rouler vite fait passer la ville au prix de 1/γ. Le paradoxe des jumeaux devient la solution : pour « sauter dans le futur » de la ville sans vider sa batterie, on fait un détour rapide.

Les autres freins au « foncer » : la porte colorée (il faut une vitesse précise), les distances de freinage et de virage, le retard de la lumière (pont).

### 1.3 Le modèle de couleur d'OpenRelativity rend le jeu illisible
OpenRelativity remplace chaque canal par une raie étroite (615, 550 et 463 nm). Vue de face, la luminance tombe sous 10 % vers β = 0,28 et devient quasi nulle (< 2 %) vers β = 0,50–0,54, quelle que soit la teinte. Or le jeu vise β = 0,5 à 0,95 (15 à 28,5 m/s à c = 30).

Retenu (décision 3, §11 ; détails au §4) : le modèle le plus fidèle à la physique, « réflectance × soleil à 5 800 K », avec une composante infrarouge en plateau jusqu'à l'infini et une composante ultraviolette, les fonctions colorimétriques de Wyman et al., des lampadaires « corps noir » et l'effet projecteur physique (D⁴, borné). Le modèle d'OpenRelativity reste disponible en préréglage pour comparer.

### 1.4 « Δv = a·Δτ » et « Δt = γ·Δτ » ne sont exacts qu'à pas infinitésimal
Appliqué tel quel à chaque image, le test des 543 m (c = 100, a = 10) donne 542,10 m à 60 i/s et 541,12 m à 30 i/s. On garde l'esprit demandé avec la forme exacte :
- dans le référentiel instantané, on compose w = c·tanh(a·Δτ/c) (≈ a·Δτ) par l'addition relativiste vectorielle v ⊕ w ;
- x et t avancent par la solution exacte (sinh, cosh) sur le pas.

Erreur ≤ 2e-11 sur les trois valeurs, quel que soit le découpage, y compris un pas unique de 10 s.

### 1.5 Écarts assumés au cahier des charges (récapitulatif)

| Cahier des charges | Plan | Pourquoi |
|---|---|---|
| « petite ville » | ≈ 3 L × 2 L (0,9 × 0,6 km à c = 30), quartiers par niveau | §1.1 |
| c = 100 m/s | c réglable par le joueur, entier de 10 à 100 m/s, 30 par défaut ; a = c/5 | décisions 10 et 11 |
| foncer pas toujours gagnant | fenêtres « pas avant » | §1.2 (décision 2) |
| Δv = a·Δτ, Δt = γ·Δτ | forme exacte équivalente | §1.4 |
| approximation spectrale RGB | 5 canaux (r, g, b, IR, UV) × soleil à 5 800 K | §1.3 (décision 3) |
| Δτ = temps réel écoulé | Δτ plafonné à 0,1 s par image, horloges gelées en pause et pendant les bulles bloquantes du tutoriel | ne pas simuler un joueur absent |
| a = 10 m/s² au maximum | a = c/5 (6 m/s² à c = 30, 20 m/s² à c = 100) pour la poussée et le frein seulement ; la route fournit la force latérale (conduite arcade), y compris sur l'anneau du niveau 6 (8 à 15·a centripètes : 48 à 90 m/s² à c = 30) | accélération plus franche (décision 11) ; sinon des kilomètres pour tourner (décision 1) |
| respect des délais = critère de score | un retard coûte seulement l'étoile « Ponctuel » ; l'échec ne vient que de la batterie vide et du flash | décision 6 |
| gyroscope, bulles | J2 (J1 : tactile glisser + clavier) | priorité au risque technique |
| objets mobiles | solveur pur et testé en J1, rendu en J4 | les niveaux mobiles arrivent en J4 |

## 2. Architecture

**Imports permis** (liste de référence dans `docs/interfaces.md`), vérifiés par `tests/purity.test.js` :
- `physics/` : seulement `physics/` ;
- `game/` : physics, storage, et le seul fichier pur `render/layout.js` (scènes paramétriques des niveaux, J3) ;
- `levels/` : rien (JSON chargés par `import.meta.glob`) ;
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
- `createPlayer({x, y, heading, phiMax, physics})` : `physics` = `physicsFor(c)` de la partie (c et a gardés dans l'état ; les tests du cahier des charges injectent {c: 100, a: 10}). `relativity.js` et `retarded.js` prennent c en paramètre facultatif.
- `step(state, {thrust, brake, steer}, dτ)` : sans plafond, sous-pas internes.
- `snapshot(state)` renvoie `{x, y, vx, vy, speed, beta, gamma, rapidity, tau, t, ux, uy, heading, hx, hy, c}`, avec `speed` < c en m/s ; le HUD et le rendu lisent c dans l'instantané.
- `clampFrameDt(dtReal)` : pure, testée à part.

### État et intégration
- **État interne en float64** : position, vitesse propre **u = γv**, cap, τ, t. On en déduit γ = √(1 + |u|²/c²) et v = u/γ.
- **|v| < c** est garanti par u en arithmétique exacte. En float64, il faut en plus un **plafond de rapidité φ_max** : défaut 3 (β = 0,995, γ = 10), fixé explicitement dans chaque niveau et borné à 3 par le validateur. Cette borne vient de la couverture de la LUT (|log₂D| ≤ 4,5) et du float32 côté GPU, où β s'arrondit à 1 vers φ ≈ 9. Côté CPU en float64, u/γ s'arrondirait à c vers φ ≈ 18.
- **Segment hyperbolique exact** par sous-pas, sous poussée propre α constante. Avec η = |α|h/c, S = sinh η/η, K = (cosh η − 1)/η² et A = α + (α·u₀)u₀/(c²(γ₀+1)) :
  - u₁ = cosh η·u₀ + h·S·A
  - Δx = h·S·u₀ + h²·K·A
  - Δt = h·S·γ₀ + h²·K·(α·u₀)/c²

  C'est identique à v₀ ⊕ c·tanh(η)·n, à 4,5e-14 près. `relativity.js` expose aussi la composition vectorielle (ordre v_ancien ⊕ w, non commutative) pour la pédagogie et les tests.
- **Exactitude** : exact en ligne droite et en virage pur. En virage avec poussée, schéma de Strang d'ordre 2 (moins d'un millimètre d'écart après 10 s de poussée pleine, volant à mi-course, à 60 Hz). La rotation de Thomas-Wigner n'est pas simulée, car aucune orientation propre n'est suivie ; c'est documenté.

### Conduite (modèle « voiture arcade », décision 1)
- **La route fournit la force latérale**, hors du budget du moteur : a = c/5 (accélération propre ; 6 m/s² à c = 30) ne vaut que pour la poussée et le frein, tous deux le long du cap, donc colinéaires à u. Pas de cercle d'adhérence.
- Le cap suit la vitesse quand on roule ; le virage fait tourner u (et le cap) à |u| constant.
- Taux de virage en temps propre : dθ/dτ = −steer·TURN_RATE (`steer` > 0 : à droite, sens horaire ; TURN_RATE = 1,0 rad/s dans `constants.js`). Dans la ville, le rayon vaut r = |u|/TURN_RATE = γv/TURN_RATE, volant à fond : 0,117·L à β = 0,76 et 0,206·L à β = 0,9, soit 35 m à 22,8 m/s et 62 m à 27 m/s à c = 30 (117 et 206 m à c = 100). TURN_RATE ne dépend pas de c (les temps du jeu non plus) : les rayons suivent la ville, à l'échelle de L.
- **À l'arrêt**, le volant fait pivoter le cap sur place à PIVOT_RATE (0,8 rad/s) ; la poussée part ensuite dans la direction du cap.
- **Relâcher** : roue libre exacte (Δt = γh, Δx = u·h), sans frottement.
- **Frein** : poussée opposée, prioritaire sur l'accélérateur, bornée pour s'arrêter exactement à v = 0, sans marche arrière en J1. **Marche arrière lente (livrée en J3**, option `reverse` de `createPlayer`, activée par les niveaux) : frein maintenu à l'arrêt pendant 0,5 s de τ (délai compté depuis l'arrêt : il laisse le temps de livrer), puis recul le long de −cap, plafonné à 0,05·c (1,5 m/s à c = 30) ; le cap reste celui du véhicule, volant inversé comme en voiture, la poussée freine le recul puis repart en avant.
- **Collisions (livrées en J3, `physics/collisions.js`)** : véhicule = cercle de 0,6 m, obstacles = emprises rectangulaires (bâtiments, portes fermées, bords de la carte). Test **balayé** (segment contre rectangle grossi du rayon, coins arrondis), sur des morceaux de ≤ 1 m : aucune traversée, même à φ = 3. Réponse inélastique : la composante normale de u est annulée, la tangentielle conservée (on glisse le long du mur, le cap suit). La pénalité prend la forme d'un **étourdissement à l'arrêt** de κ·(γ_avant − γ_après) s, **κ = 20 s**, borné à 30 s, ajouté à τ et à t, de sorte que la batterie reste égale à τ : choc de face à β = 0,2 → 0,4 s ; β = 0,5 → 3,1 s ; β = 0,76 → 10,9 s (pour tout c). Un choc contre une porte qui a une reprise coûte la reprise à la place.

### Horloges
- Batterie = τ, qui s'use aussi à l'arrêt. Tout ce qui appartient à la ville (délais, pont, flash, pommier) avance en t.
- Le HUD affiche t, l'heure de la ville à l'endroit du joueur, synchronisée dans le référentiel de la ville. L'écart t − τ ne dépend d'aucune convention.
- Les objets **vus** sont affichés à leur temps d'émission t_e. Leurs horloges défilent donc au rythme D par rapport à ta montre (×2,7 en fonçant vers elles à β = 0,76, soit 22,8 m/s à c = 30 ; ×0,37 en s'éloignant), et non γ. Les bulles et le carnet l'expliquent.
- Objets fixes qui changent d'état (porte, client, lampe) : t_e = t − d/c, via `emissionTimeStatic` (livré en J1, utilisé par `game/rules.js` en J3 : `seenDoorOpen`, `seenClientPresent`, lampes à horaire). Les règles, elles, suivent l'état réel à t (on livre sur place, la porte bloque dès qu'elle est fermée).

### Temps retardé des objets mobiles (`physics/retarded.js`, livré et testé en J1, rendu en J4)
- Trajectoires analytiques p(t) en temps de ville.
- On résout t_e = t − |x_obs − p(t_e)|/c par Newton sécurisé (bissection, bornes inclusives, sortie anticipée). Départ : la valeur de l'image précédente ou la quadratique d'OpenRelativity.
- 2 à 5 itérations jusqu'à β = 0,99, contre plus de 1 000 pour le point fixe.
- Historique en anneau seulement pour les objets réactifs. Objet masqué si t_e < t_apparition.

### Tests Vitest (J1)
**Obligatoires** (cahier des charges, **exécutés avec c = 100, a = 10 injectés** : `createPlayer({physics: {c: 100, a: 10}})`). Depuis l'arrêt, τ = 10 s. Valeurs attendues calculées dans le test : 100·tanh 1, 10·sinh 1, 1000·(cosh 1 − 1) (76,159416 m/s, 11,752012 s, 543,080635 m). Les mêmes tests tournent aussi avec c = 30, a = 3 injectés (22,847825 m/s, 11,752012 s, 162,924190 m) et c = 10, a = 1 injectés (7,615942 m/s, 11,752012 s, 54,308063 m), valeurs c·tanh 1, (c/a)·sinh 1, (c²/a)(cosh 1 − 1) ; et avec les constantes du jeu (a = c/5, φ = 2 après 10 s) : par défaut c = 30, a = 6 (28,920827 m/s, 18,134302 s, 414,329354 m), et c = 10, a = 2 (9,640276 m/s, 18,134302 s, 138,109785 m).
- Tolérances : v et t à 1e-6, x à 1e-5 m.
- Quatre découpages : 1/60, 1/30, aléatoire à graine fixe sommant à 10 s, un appel unique `step(10)`.
- Ces tolérances détectent aussi un retour accidentel à un schéma approché (jusqu'à 1e-2 m d'erreur).

**Complémentaires** :
- freinage depuis φ = 1 : arrêt à (c²/a)(cosh 1 − 1), sans recul (543,080635 m à c = 100, a = 10 ; 162,924190 m à c = 30, a = 3) ;
- accélérer puis freiner : 2·(c²/a)(cosh 1 − 1), t = 23,504024 s pour c/a = 10 s (1 086,161270 m à c = 100, a = 10 ; 325,848381 m à c = 30, a = 3) ;
- virage pur : |u| conservé à 1e-12 ;
- jumeaux, aller-retour de c²/a avec c/a = 10 s injecté : τ = 38,497 s, t = 44,721 s pour tout c (1 000 m à c = 100, 300 m à c = 30) ; avec les constantes du jeu (c/a = 5 s), un aller-retour de L = 2·c²/a donne τ = 4·5·arcosh 2 = 26,339 s et t = 4·5·√3 = 34,641 s ;
- injection de c dans `relativity.js` et `retarded.js` (c = 100 et c = 30 : mêmes résultats sans dimension, temps identiques) ;
- `physicsFor` (plage, entiers, a = c/5, L = 10·c), réglage de c (`game/settings.js` : saisie refusée ou ramenée, `?c=`, stockage `aslower:v1:reglages`), scènes paramétriques (avenue de 4·L pour c = 10, 30 et 100, quartier qui contient le disque de visibilité, sans chevauchement), HUD (jauge et décimales près de c pour plusieurs c) ;
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
- **Effet projecteur** : couleur = M(D)·ρ × min(D^p, borne). Avec cette convention, **p = 4 est le réglage physique, et c'est le réglage par défaut** (décision 3) : `BEAM_EXPONENT = 4`, borné par `BEAM_MAX = 4096` (= 8⁴, `constants.js`). D⁴ est donc exact jusqu'à D = 8 (γ ≈ 4,1 de face), sur tous les niveaux prévus, pour tout c ; la borne reste (cahier des charges) et garde les valeurs loin du maximum half float (65 504). L'ancienne borne 8 coupait le projecteur dès β = 0,477 de face (14,3 m/s à c = 30) : une façade vue de face s'assombrissait quand on accélérait.
- **Adaptation de l'œil** : la luminosité d'ensemble est rendue par une exposition E = `adaptationExposure(D_avant)` = 1/G(D_avant), avec D_avant = e^φ (droit devant) et G le gain, projecteur compris, d'une façade de référence (`ADAPTATION_REFERENCE` : gris 0,6, ir 0,3, uv 0,15) vue de face. Cette façade garde sa luminance du repos ; les rapports de luminance dans l'image restent physiques. E = 1 à l'arrêt et en vision classique, 0,31 à β = 0,3, 0,093 à β = 0,76, 0,039 à β = 0,9 (9, 22,8 et 27 m/s à c = 30 ; les couleurs ne dépendent que de β) ; `updateObserver` la pose dans `uExposure`. Le cockpit, comobile et éclairé par la lumière projetée vers l'avant, n'y est pas soumis. Le tone mapping (genou 0,75) ne fait plus que compresser les hautes lumières.
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
**Le même module `spectrum.js` sert au gameplay.** `perceivedColor()` reprend toute la chaîne du shader (D par la géométrie réelle, projecteur, tone mapping), avec `{exposure: adaptationExposure(e^φ)}` pour suivre la même adaptation que l'écran. La fenêtre « vert » de la lampe à 640 nm du N3 n'en dépend pas (β = 0,130–0,223, soit **≈ 3,9–6,7 m/s à c = 30** ; 13,0–22,3 m/s à c = 100) ; « noir » arrive dès β = 0,407 au lieu de 0,446 (12,2 au lieu de 13,4 m/s à c = 30). Les lampes de puzzle ne sont pas diffusées par le brouillard (atténuation seulement).

Test d'adaptation (il remplace l'ancien test de lisibilité « ≥ 2 % de la luminance du blanc », pensé pour un projecteur borné à 8 sans adaptation) : la façade de référence vue de face, multipliée par E, garde sa luminance du repos à 2e-3 près pour β ∈ {0,05 ; 0,2 ; 0,3 ; 0,5 ; 0,76 ; 0,9 ; 0,95} ; E décroît strictement avec v et vaut 1 à l'arrêt ; les façades vues de face sont plus lumineuses à β = 0,9 qu'à β = 0,477 (`tests/spectrum.test.js`). Au-delà de D = 830/360 ≈ 2,31 (β = 0,68 de face, 20,4 m/s à c = 30), seule la base IR d'une surface est visible : les façades de la palette ont donc des réflectances proche IR **variées** (ir de 0,1 à 0,6, moyenne 0,31 ≈ la référence), comme les pigments réels (≈ 0,05 pour le noir de carbone, 0,6–0,85 pour les oxydes de fer ou le blanc de titane) ; à D = 3, leurs luminances diffèrent d'un facteur ≥ 3. Même avec l'ancienne borne 8, une façade d'ir 0,1 vue de face à γ = 4 garde 2,5 % de la luminance du blanc.

### Ciel, sol et brouillard
Une passe plein écran après les opaques, à z = 1 (renderOrder 1, sans écriture de profondeur). Elle couvre environ 41 % de l'écran, soit environ 1 ms estimée sur un Mali-G52. Pour chaque pixel :
- aberration inverse exacte ;
- intersection analytique avec le plan du sol, calculée sans branchement avant la lecture de texture (`mix`/`step`) ;
- marquages tracés analytiquement, carte Canvas2D pour le plan et les ombres ;
- ciel procédural : brume à l'horizon, lumière diffuse d'un corps noir à 6 500 K près de l'horizon, et vers le zénith un **ciel dégagé à spectre continu**, ρ ∝ (550/λ)⁴ + 0,35·(550/λ)^1,3 (Rayleigh + aérosols à 90° du soleil : τ_A ≈ 0,1, Ångström 1,3, Henyey-Greenstein g = 0,7), nul sous 295 nm (ozone), de luminance 0,186 au repos, tabulé dans la ligne `SKY_CLEAR_ROW` de la LUT. Décalé, il reste bleu et lisse (les anciennes réflectances en créneaux donnaient du violet et du cyan saturé). Coût : 8 lectures de texture par pixel de la passe au lieu de 7. Au repos, il est un peu plus pâle qu'avant, à cause des aérosols ;
- brouillard en distance monde, mélangé avant le Doppler (correct pour un milieu immobile dans la ville), totalement opaque à `visibilite` ;
- `visibilite` : par défaut `visibilityFor(L)` (`render/layout.js`), **défaut = clamp(1,2·L ; 300 ; 600) m, lite = 0,7 × défaut** ; un niveau peut la fixer dans son JSON. À c = 30 : 360 m (lite 252 m) ; à c = 10 : 300 m (lite 210 m) ; à c ≥ 50 : 600 m (lite 420 m, la valeur du jalon 1). Pourquoi : proportionnelle à L, elle garde le même temps de lecture de la route à β donné (1,2·L parcouru en 12/β s) ; le plancher de 300 m garde au moins quatre îlots lisibles devant soi (la ville reste à l'échelle humaine) ; le plafond de 600 m est le budget d'appels de dessin mesuré au J1 (quartier : 211 appels). À c = 30, le disque de visibilité contient 2,8 fois moins d'îlots qu'à 600 m : marge de performance sur GSM moyen.

**Objets clés** (pont, pommier, lampes de puzzle) : ils sont exemptés du brouillard et de la coupe, avec une atténuation propre faible, et sont toujours dessinés. Le validateur vérifie que chaque objet clé reste visible depuis ses points d'observation de référence (N4 : point de non-retour ; N6 : anneau, à 0,5·L, 150 m à c = 30).

**Règle** : aucune géométrie sous y = 0. La rivière est un matériau de la carte, et le validateur le vérifie.

**Leviers si c'est trop cher** : DPR, occultation par le cockpit (dessiné en premier), sol en mode palette.

### Subdivision et LOD
L'aberration courbe les droites, mais seulement entre sommets.
- **Chunk** = un îlot entier, sans jamais couper un bâtiment ; les façades mitoyennes restent dans le même chunk (pas de fissures).
- **Trois LOD** : 1,5 / 5 / 15 m.
- **Règle** : LOD k permis si s_k ≤ κ·d_min, avec κ = min(0,2 ; √(8ε/(γβ))), où ε est la tolérance angulaire (2 px CSS). d_min est la distance apparente du point le plus proche du chunk, avec D minimal sur le champ visible, et 10 % d'hystérésis.
- **Image propre à environ 3 px près jusqu'à γ ≈ 2,5**. Au-delà (niveaux 5 et 6), on ajoute un LOD de 0,75–1 m pour les 2 à 6 chunks les plus proches (J5).
- **Triangles visibles par image (modèle calculé)** : 11 à 64 k sur l'avenue, 13 à 85 k en quartier. Le LOD0 est généré à la demande pour les îlots proches, LOD1 et LOD2 restent résidents. Tout générer en LOD0 donnerait environ 385 k triangles pour l'avenue de 4 km (c = 100) ; ces chiffres datent du J1 à c = 100 m/s, l'avenue de 4·L en a 3,3 fois moins à c = 30. Les pas des LOD (1,5 / 5 / 15 m) et la règle κ·d_min sont géométriques : ils ne dépendent pas de c.

### Culling et nombre d'appels de dessin (draw calls)
- `frustumCulled = false` : le culling de Three passe avant le shader et ferait disparaître la moitié des chunks visibles à β = 0,76, puisque l'aberration ramène devant ce qui est derrière.
- **J1** : coupe à `visibilite`, exacte à ≤ 6/255 près sur quelques pixels au-dessus de l'horizon (le ciel brumeux n'a pas exactement la couleur de la brume ; nul à grande vitesse), puisque r est conservé et que le brouillard y est opaque ; au plus 42 chunks sur l'avenue à c = 100 (visibilité 600 m), moins à c = 30 (360 m).
- **J3** : culling par « cône apparent » exact, environ 0,3 µs par chunk.
- **Appels de dessin** : en quartier, 98 à 294 chunks sont visibles pour un brouillard à 600 m (c ≥ 50) ; à 360 m (c = 30), environ 2,8 fois moins. D'où des super-chunks LOD2 de 256 m, ou un `BatchedMesh` piloté par notre culling (à mesurer en J1). Le budget d'appels de dessin est vérifié par niveau dans `levels.test.js`, qui peut importer le découpage en chunks de `render/`. Le validateur, lui, ne dépend que de physics.
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
- **Profils lite / mid / full** inspirés du portfolio. DPR adaptatif (livré en J2, `render/adaptiveDpr.js`) recalé sur 60 i/s : on baisse de 0,25 au-delà de 18,5 ms d'intervalle moyen sur 90 images. On remonte sur un autre critère, puisqu'à 60 Hz l'intervalle ne descend jamais sous 16,7 ms : au moins 98 % des images à ≤ 17,5 ms pendant 10 s, et un temps de travail CPU (performance.now() autour de step + render) bas. On utilise `EXT_disjoint_timer_query_webgl2` quand elle existe. `powerPreference: 'high-performance'`.
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
- Calibrage pendant le décompte (en J2, sans décompte : ≈ 0,5 s au départ, quand le capteur répond ; « Recentrer le volant » au menu pause), zone morte de 3°, saturation à 25°, lissage de 60 ms. HTTPS requis (assuré par Pages).
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
- **Jauge de vitesse** : linéaire, avec un mur hachuré à c (celle de la partie), et le rappel « c = 30 m/s » sous la jauge. L'aiguille ralentit à poussée constante, ce qui montre l'asymptote. Des décimales s'ajoutent près de c (premier chiffre de l'écart c − v), jusqu'à c·tanh 3 = 0,99505·c avec φ_max = 3, tronqué : **29,8 m/s à c = 30** (29,85), 9,95 m/s à c = 10, 99,5 m/s à c = 100. Graduations à 50, 90 et 99 % de c.
- **Réglage de c** (décision 10) : sur l'écran titre, « Vitesse de la lumière : [−] 30 [+] m/s », préréglages 10 / 30 / 50 / 100, aide « Plus c est bas, plus les effets arrivent tôt » et l'équivalent en km/h (30 m/s ≈ 108 km/h) ; cibles de 48 px. Saisie non entière refusée, entier hors plage ramené dans la plage, avec un message. Mémorisé dans `aslower:v1:reglages` ({c}) ; `?c=n` prioritaire (tests), jamais mémorisé. Au menu pause, « Changer c » recommence la partie au départ avec la nouvelle valeur. c est aussi affiché dans `#diag`.
- **Mises à jour** : texte à 12 Hz, écrit seulement s'il change ; jauge par `transform` ; aucune lecture de mise en page dans la boucle.
- **Bulles (J2)** :
  - une seule fois par profil, stockées dans `aslower:v1:bulles` (try/catch, repli en mémoire) ;
  - déclencheurs décrits en JSON et évalués sans `eval` (`game/conditions.js`) ;
  - une bulle à la fois, non bloquantes, sauf au tutoriel où les horloges sont gelées.
- **Annonces accessibles** : région `aria-live` à débit limité (J2). Spectromètre textuel (« vert ✓, 530 nm ») pour les daltoniens (J3).

## 6. Niveaux (data-driven) et score

### Format
- Schéma `coursier-niveau/1`, un JSON par niveau : `src/levels/n01-premier-jour.json` … `n06-pommier-langevin.json`. **Documentation complète en tête de `src/game/validate.js`** (résumé dans `docs/interfaces.md`, exemple complet : `tests/fixtures/levels-valid/n99-exemple.json`). Clés : `schema, id, numero, titre, notion, briefing[], note?, parametres?, scene` (format des scènes de `render/layout.js`, sans départ ni paramètres), `depart {pos, capDegres, beta?}`, `batterie {tauMax}`, `phiMax`, `colis[] {id, client, nom?, retrait? {lieu, rayon?, pasAvant?}, livraison {lieu, rayon?, pasAvant?}, delai?, obligatoire}`, `portes[]? {id, pos, capDegres, largeur, hauteur, lampe {raie | corpsNoir, intensite?, hauteur?, allumee?}, teinte, portee [min, max], maintien, resteOuverte?, reprise?}`, `reprises[]? {id, pos, capDegres, cout}`, `etoiles {batterieMin, tVilleMax}`, `bulles[]?`, `indices[]? {apresEchecs, texte, aide?}`, `parcours? {reference, naif?}` (itinéraires du bot).
- **Unités** (décision 10) : toutes les distances de jeu en L (expressions `{fois, de?, plus?, min?…}` de `layout.js`, paramètres communs à la scène et au jeu), l'échelle humaine (rues, îlots, rayons de zone, hauteurs) en mètres ; temps (délais, batterie, « pas avant », maintien, coûts) en secondes, **nombres seulement** (le validateur refuse une expression en L dans un temps) ; vitesses en β.
- Un seul glob, `./n[0-9][0-9]-*.json`, dans `src/levels/index.js` (`LEVEL_FILES`, chargés d'avance). `level.js` et `validate.js` reçoivent des objets simples, donc utilisables par un script Node.
- La palette est dans `src/data/palette.json` (J1). Les scènes de développement sont dans `src/data/scenes/` (J1) et utilisent le même format de carte.
- **Validateur maison en deux passes** (structure puis sémantique), avec des messages précis (chemin JSON et raison). Fichiers invalides de test dans `tests/fixtures/`.
- **Règles vérifiées par le validateur** (J3 : structure, puis sémantique pour c = 10, 30 et 100 m/s) :
  - id = nom du fichier, numéro = ses deux chiffres ;
  - φ_max explicite et ≤ 3 ;
  - `visibilite` suffisante pour les objets clés (avertissement si la portée d'une porte la dépasse) ;
  - aucune géométrie sous y = 0 (hauteurs des bâtiments, portes, lampes) ;
  - abris hors de la ligne de vue des flashs (J5) ;
  - capteurs de porte à au moins 12 m, plage d'au moins 12 m ;
  - départ, zones de retrait et de livraison, reprises : dans la carte, hors des bâtiments et **atteignables** depuis le départ (remplissage sur une grille de 1 m, rayon du véhicule, portes ouvertes) ;
  - références d'ids (porte → reprise), ids uniques, bulles du niveau valides et distinctes des bulles globales, « pas avant » antérieur au délai, au moins un colis obligatoire, temps sans expression en L.
- **Bot de référence** (`game/bot.js`, pur, livré en J3) : il suit `parcours.reference` (points de passage, β de croisière, arrêts, attentes « jusqu'à t ») avec la vraie physique (`level.advance` : player.step, collisions, règles). Les tests vérifient, pour c = 10, 30 et 100, que le parcours de référence fait 3 étoiles et le parcours naïf moins de 3. `npm run calibrate` affiche des seuils suggérés sans rien écrire (batterieMin ≈ (τmax − 1,15·τ_ref)/τmax, tVilleMax ≈ 1,12·t_ref).
- **Machine à états** (`game/states.js`) : chargement → menu → selection → briefing → decompte → enCours ⇄ pause / reprise → bilan | echec ; table déclarative et gardes (« passer » après 4 échecs). **Progression** (`game/progress.js`, `aslower:v1:progression`) : étoiles et records gardés **par niveau et par valeur de c** ; un niveau se débloque quand le précédent est réussi (à n'importe quel c) ou passé.
- **Aucune fenêtre de vitesse dans le JSON** : les portes appellent `spectrum.js`.

### Réussite, échecs et étoiles
- **Réussite** : tous les colis obligatoires livrés (zone + v ≤ 0,03·c pendant 0,5 s de τ : 0,9 m/s à c = 30, 3 m/s à c = 100 ; et t ≥ pasAvant : on peut attendre dans la zone), même en retard (décision 6). Ordre des règles dans une image : retraits et livraisons, portes, chocs et reprises, réussite, puis échecs.
- **Échecs** : seulement la batterie vide (τ ≥ τmax) et le flash (N5). Un délai dépassé n'est **pas** un échec : il coûte l'étoile « Ponctuel ».
- **Reprises** (pas d'échec) : chute du pont, choc contre une porte. On repart au point défini dans le JSON, avec quelques secondes ajoutées aux deux horloges.
- **Étoiles**, une par critère du cahier des charges :
  - ★ Livré = réussite ;
  - ★ Économe = batterie restante ≥ seuil ;
  - ★ Ponctuel = chaque colis livré avant son délai, en heure de la ville (t) ; un seul retard suffit à perdre cette étoile, et rien d'autre.

  Le bilan dit laquelle manque, chiffres à l'appui. Les aides ne coûtent jamais d'étoile.

### Les six niveaux

Les distances sont en L = 10·c m (= 2·c²/a depuis la décision 11) et les vitesses en β (fractions de c) ; entre parenthèses, les valeurs au réglage par défaut **c = 30 m/s (L = 300 m)**. Les temps (délais, batterie, horloges) ne dépendent pas de c. Pour c = 100 m/s (cahier des charges, L = 1 000 m), multiplier les mètres et les m/s par 10/3 : ce sont les chiffres du premier jet. Les tailles des objets (pont, pommier, lampes) sont à l'échelle humaine : vus de 3,3 fois plus près à c = 30, ils paraissent 3,3 fois plus grands.

| N° | Titre proposé | Notion | Mécanique (chiffres vérifiés, à recalibrer par le bot) |
|---|---|---|---|
| 1 | Premier jour | inertie, frein, Doppler | **Livré (J3)** : deux livraisons dans une grille d'îlots (boulangerie à 0,3·L, puis virage à droite au premier carrefour après 0,3·L + 40 m et Mme Ampère à 0,42·L ; 130 + 70 + 126 m à c = 30). Relâcher garde la vitesse ; il faut 0,024·L (7,2 m) pour s'arrêter à β = 0,3 (9 m/s). Batterie large (150 s), pas de délai. |
| 2 | Le Grand Boulevard | deux horloges | **Livré (J3)** : l'Hôtel Lorentz à ≈ 1,6·L sur le boulevard (480 m), délai 45 s à l'horloge de la ville (à β ≤ 0,3, retard : l'étoile « Ponctuel » est perdue) ; Mme FitzGerald plus bas sur le boulevard (≈ 0,7·L), absente avant t = 90 s (délai 115 s) ; batterie de 100 s. Le chemin direct arrive ≈ 40 s trop tôt : attendre (ou flâner dans les ruelles à γ ≈ 1) coûte 1 s de batterie par seconde de ville ; un tour et demi de la place de l'Horloge (rayon 0,2·L) à β = 0,85 (γ ≈ 1,9) fait passer la ville à moindre coût : 60 s de batterie contre 80 s (dτ = dt/γ). |
| 3 | La Porte Verte | Doppler | **Livré (J3)** : lampe rouge (raie fixée à 640 nm, comme dans le test J1) à voir verte : **β ≈ 0,13 à 0,22, soit ≈ 4,0 à 6,8 m/s** dans l'axe (porte à 0,4·L) ; lampe infrarouge à 900 nm, « éteinte », vue verte vers **β = 0,44–0,52 (13,3–15,5 m/s)** (porte à 1·L). Trop vite, la lampe bleuit puis noircit (UV), et c'est le choc : reprise sur la ligne d'élan (+3 s). Batterie de 120 s ; délais 60 s et 150 s. |
| 4 | Le Pont Rømer | retard de la lumière | Pont-levis dont l'horaire est en heure de la ville (panneau). **Le niveau démarre lancé** à β ≈ 0,76 (22,8 m/s), profil de référence inscrit dans le JSON. Décision au **point de non-retour** : à β = 0,76, il faut 0,272·L (81 m) pour s'arrêter, et l'image du pont a alors 2,7 s de retard (pour tout c). Le pont est signalé par de grands feux : le tablier ne fait que ≈ 60 px à 81 m (≈ 18 px à 272 m, à c = 100). Le pont peut paraître baissé alors qu'il est déjà levé. Débloque le contour fantôme. |
| 5 | La Pellicule | horizon de Rindler | Flash à t = 20 s, 0,4·L (120 m) derrière le studio. **Condition de victoire** : atteindre l'abri (0,8·L = 240 m, hors de la ligne de vue du flash) avant le front, soit partir vers le nord avant t ≈ 20 s (≈ 20,5 s si l'on part à β = 0,1, 3 m/s). Avec l'approche prévue (0,3·L = 90 m puis un virage), on ne part vers le nord qu'à t ≈ 12 s, à environ β = 0,1. **Bonus « au-delà de l'horizon »** si l'on part avant t = 19,0 s depuis l'arrêt (c²/a = 0,5·L = 150 m d'avance), ou 19,5 s à β = 0,1 (0,905·c²/a = 136 m d'avance) : fenêtre réelle d'environ 7 s, bien plus large que les 3 s du premier jet (a = c/10) : instant du flash et distances à recalibrer. La lumière ne te rattrape alors jamais tant que tu accélères. Compte à rebours du flash affiché. |
| 6 | Le Pommier de Langevin | paradoxe des jumeaux | Pommes mûres à t = 200 s, batterie de 120 s : attendre est impossible. Anneau (Ø L = 300 m), φ_max fixé pour γ ≤ 4. Faire passer 200 s de ville coûte 61 à 75 s de batterie sur l'anneau (γ = 4 à 3, poussée et freinage compris ; 72 à 83 s au premier jet, avec a = c/10), plus l'accès, les 0,5·L (150 m) jusqu'au pommier et la livraison (≈ 30 s au premier jet) : marge à recalibrer par le bot. Le pommier, au centre de l'anneau, est vu avec D = γ : il vieillit **visiblement** ×γ (étapes : fleurs, fruits verts, mûrs, tombés). C'est un **pommier géant**, sans quoi il ne ferait que 2 à 3 px à 500 m (c = 100) : ≈ 45 m à c = 100 ; à c = 30, vu de 150 m, ≈ 15 m suffisent (taille ∝ L, à recalibrer). Le bilan « Luc a vieilli de … s, toi de … s » est produit par le bot. |

### Détails qui corrigent le premier jet
- **N3, contrat du capteur** : la porte s'ouvre si la lampe, telle qu'on la voit, a la teinte demandée pendant 0,4 s de τ, à une distance comprise entre 12 m et 0,15·L (45 m à c = 30 ; 0,2·L pour l'infrarouge), mais au moins 12 m de plage (à recalibrer à petit c). D est calculé avec la géométrie réelle (hauteur et décalage de la lampe). Au passage sous la porte, l'angle fait revenir la lampe au rouge : on n'évalue donc jamais là. Tests du bot : franchir la porte à la vitesse de référence ; à fond, c'est le choc.
- **N4, règle juste** : ce que tu vois a r/c de retard, et le pont continue de bouger pendant ton trajet. Seul compte son état à ton arrivée : il faut se fier à l'horaire de la ville. La condition dépend de r, donc de la vitesse d'approche : 0,077·L (23 m ; 0,77 s) à β = 0,5, 0,272·L (81 m ; 2,7 s) à β = 0,76. D'où le départ lancé, qui impose le profil de référence. Le cycle (durée « baissé » ≤ r/c et ≤ P − r/c) est réglé pour que les fenêtres de réussite en vision relativiste et en vision classique soient disjointes. Tests du bot :
  - à profil égal, la fenêtre exprimée en phase vue est décalée d'exactement r/c entre k = 1 et k = 0 ;
  - « je fonce dès que je le vois baissé » échoue ;
  - « je suis l'horaire » réussit.

  En fonçant vers le pont, on voit son « film » en accéléré : ×(1+β) par rapport à l'horloge de la ville (×1,76 à β = 0,76), soit ×D = γ(1+β) par rapport à ta montre (×2,7).
- **N5, jauge** : elle mesure l'écart **dans ton référentiel** : g' = |Δx'| − cΔt', soit g·e^φ en ligne droite. Dans la ville, l'écart diminue toujours, même au-delà de l'horizon. La jauge porte le repère « horizon : c²/a » (0,5·L, 150 m à c = 30). La bulle « l'écart ne se referme plus » se déclenche sur dg'/dτ ≥ −0,005·c (−0,15 m/s à c = 30).
- **N6, anneau** : avec la conduite arcade (décision 1), la route fournit 8 à 15·a d'accélération centripète (48 à 90 m/s² à c = 30, 160 à 300 m/s² à c = 100), hors du budget du moteur : plus besoin d'un rail d'exception. Un rayon de 0,5·L demande le volant à |u|/(0,5·L · TURN_RATE) = γβ/5, soit 0,77 à γ = 4, pour tout c (TURN_RATE = 1,0 rad/s). Un guidage facultatif pour rester sur l'anneau reste à décider en J5. Le mécanisme des « vivants » (étapes d'âge affichées en t_e) arrive en J4.

### Habillage (proposition, facultative)
- Ville de Lumière-sur-Lente, entreprise Photon Express.
- Clients nommés d'après des physiciens : Planck, Lorentz, FitzGerald, Rømer, Rindler, Langevin.
- Jumeau sédentaire « Luc » au dépôt.
- Façades saturées dans l'ordre de l'arc-en-ciel, pour que la rue « glisse d'un cran » avec le Doppler. Primaires pures réservées aux lampes ; ni noir (réservé à « hors du visible »), ni grandes surfaces blanches.
- Modélisation low poly (boîtes, aplats) ; seule la subdivision invisible des faces est imposée par l'aberration.
- Pas de son diégétique : avec c ≤ 100 m/s, le son à 343 m/s irait plus vite que la lumière.

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
│   └── calibrate.mjs              # J3 : seuils d'étoiles suggérés par le bot (npm run calibrate)
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
│   │   ├── scenes/avenue-test.json  quartier-test.json      # J1 (scènes de développement, longueurs en L)
│   │   ├── bubbles.json           # J2 : textes et déclencheurs des bulles
│   │   └── notebook.json          # J5 : carnet de physique
│   ├── physics/                   # PUR : ni three ni DOM
│   │   ├── constants.js           # c réglable : C_MIN..C_MAX = 10..100, C_DEFAULT = 30, physicsFor(c), PHI_MAX
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
│   │   ├── levelObjects.js        # J3 : zones, balises, clients, portes, lampes (couleur de la règle)
│   │   ├── movers.js  ghosts.js  living.js                  # J4
│   │   └── shaders/
│   │       ├── rel_vertex.glsl  rel_doppler.glsl  rel_fog.glsl
│   │       ├── surface.*.glsl  emitter.*.glsl  cockpit.*.glsl  lamp.*.glsl (J3)  environment.vert.glsl
│   │       └── environment.frag.glsl                        # ciel + sol + brouillard
│   ├── input/
│   │   ├── controls.js            # → { thrust, brake, steer, classic, pause }
│   │   ├── keyboard.js  touch.js  # J1 (touch : mode glisser)
│   │   └── tilt.js  tiltMath.js  device.js                  # J2 (tiltMath pur ; device : plein écran, Wake Lock)
│   ├── hud/
│   │   ├── hud.js  hud.css  format.js (PUR)  credits.js  diag.js   # J1 (diag : #diag, ?bench)
│   │   ├── lightSpeed.js          # J1 : réglage « Vitesse de la lumière » (titre, pause)
│   │   ├── bubbles.js  announcer.js                                # J2 (affichage)
│   │   └── levelHud.js  levelFormat.js (PUR)  screens.js          # J3 : HUD de niveau, spectromètre, écrans
│   ├── game/
│   │   ├── settings.js            # J1 : réglage de c (saisie, ?c=, stockage aslower:v1:reglages)
│   │   ├── conditions.js  bubbles.js   # J2 : déclencheurs (sans eval), moteur « une seule fois »
│   │   └── states.js  level.js  rules.js  score.js  validate.js  bot.js  progress.js   # J3
│   ├── levels/                    # J3+
│   │   ├── index.js               # seul glob ./n[0-9][0-9]-*.json
│   │   └── n01-premier-jour.json … n06-pommier-langevin.json
│   └── styles/base.css
└── tests/
    ├── J1 : player  relativity  retarded  spectrum (LUT échantillonnée comme le GPU)
    │        render-math  layout  lod  culling  format  storage  purity  licence  check-dist  loop  settings
    ├── J2 : tiltMath  conditions
    ├── J3 : collisions  rules  levels (+ fixtures/levels-valid/n99-exemple.json, fixtures/levels-invalid/)
    │        score  states  progress  levelFormat  levelObjects  culling (cône apparent)
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
au rendu sans effets. Mesure `?bench` sur l'iPhone 14 Pro Max de l'auteur (Safari, DPR 2, profil normal), **à c = 100 m/s, avant la décision 10** (reproductible avec `?c=100&bench`) :
avenue 59 i/s, image p95 17 ms (max 68 ms), 39 appels, 21,7 k triangles ; quartier 59 i/s, p95 17 ms
(max 34 ms), 211 appels, 110 k triangles ; CPU du rendu ≤ 2 ms au p95. Commandes tactiles et virage validés
par l'auteur. Reste à mesurer : un GSM Android moyen (J2).
Un seul jalon à valider. Chaque étape est publiée sur Pages et jouable sur le GSM.

| Étape | Contenu |
|---|---|
| **J1a** | Outillage, CI (tests → build → check-dist → Pages), notices, Crédits, README. `physics/` complet (constants, relativity, player, spectrum, retarded) avec ses tests. Scène avenue **non relativiste** chargée depuis `avenue-test.json` (cityMesher, LOD par distance). Clavier et tactile (mode glisser) ; paysage strictement imposé (panneau « Tourne ton GSM »). HUD minimal : deux horloges et leur écart, phrase γ, jauge. |
| **J1b** | Aberration et retard dans le vertex shader. Vision classique (k). `#diag` et `?bench`. **Première mesure sur le GSM.** `#diag` affiche : temps d'image p50 et p95, temps CPU de `render()`, appels de dessin et triangles (`renderer.info`), durée de la première image, présence de `KHR_parallel_shader_compile`, `gl.RENDERER`, DPR atteint, et un interrupteur de la passe ciel/sol. |
| **J1c** | LUT Doppler par fragment, projecteur, tone mapping. Lampadaires corps noir, panneaux IR/UV. |
| **J1d** | Passe ciel/sol/brouillard, mesurée par différence avec J1b ; leviers si nécessaire. Scène `quartier-test` (demi-côté = visibilité + 12 m arrondi aux 80 m supérieurs, pour contenir tout le disque de visibilité : ≈ 1,3 × 1,3 km à c ≥ 50, 0,8 × 0,8 km à c = 30, 0,64 × 0,64 km à c = 10) pour mesurer les appels de dessin, et super-chunks ou `BatchedMesh` si besoin. |

**Scène de test** : avenue droite de **4·L** (1 200 m à c = 30, 4 km à c = 100), bordée de bâtiments aux couleurs de l'arc-en-ciel (≈ 6 par îlot de 80 m : environ 80 à c = 30, 280 à c = 100). Il faut 1,5·c²/a = 0,75·L pour atteindre γ ≈ 2,5 (β = 0,917 : 27,5 m/s à c = 30), autant pour freiner, et il reste 2,5·L de marge (225 + 225 + 750 m à c = 30 ; avec a = c/10, jusqu'à la décision 11 : 1,5·L, soit 450 + 450 + 300 m). Îlots, rues transversales et lampadaires (tous les 40 m) gardent leur espacement en mètres ; la place, la butée et les panneaux IR/UV sont placés en L. Au bout, une place avec une butée douce (pas de collision avant J3). Pas de batterie ni de délai.

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
   - lampe à 640 nm : spectrum.js la classe « verte » exactement quand λ₀/D ∈ [510 ; 562] nm, D étant calculé indépendamment dans le test (soit β ∈ [0,129 ; 0,223], v ∈ [3,9 ; 6,7] m/s à c = 30 et [12,9 ; 22,3] m/s à c = 100 ; tolérance de ±3 nm sur les bornes) ;
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

**Statut (2026-10-11) : intégré, à valider sur l'iPhone 14 Pro Max** (et un Android moyen si possible).
Tests Vitest verts (modules purs : `tiltMath`, `conditions`, `bubbles`, `adaptiveDpr` ; faux capteur pour `tilt` ;
réglages, appareil, manifeste) ; parcours Playwright sur Chromium (SwiftShader, GSM simulé 932×430) : volant dans le bon
sens (θ diminue en penchant à droite, écran à 90°), repli annoncé sur refus et sans capteur, bulles qui
apparaissent puis ne reviennent qu'après « Revoir les bulles », menu pause, `?bench` identique au J1 (mêmes images et
même état final).

Ce qui a été fait :
- **Inclinaison** (`input/tilt.js`, `input/tiltMath.js`) branchée : la permission est demandée en toute première
  ligne du clic « Jouer » (puis le plein écran, puis le chargement), et au choix « Inclinaison » du réglage
  Direction (écran titre et menu pause : c'est aussi un geste). Préférence mémorisée dans `aslower:v1:commandes`
  (défaut : inclinaison sur écran tactile) ; un repli automatique ne la change pas. Calibrage d'≈ 0,5 s quand le
  capteur répond en jeu (message « Tiens ton GSM comme un volant… ») ; « Recentrer le volant » au menu pause.
  Repli en glisser annoncé (aria-live) et affiché : « Inclinaison refusée… iOS ne repose la question qu'après un
  rechargement » ou « Pas de capteur d'inclinaison… » ; « Réessayer l'inclinaison » dans le réglage Direction.
  En mode inclinaison : pas de zone volant, frein 88×88 px en bas à gauche. `controls.read().lastSource` choisit la
  variante clavier / inclinaison / glisser des textes. Panneau `?debug`.
- **Bulles** (`game/bubbles.js`, `game/conditions.js`, `hud/bubbles.js`, `hud/announcer.js`) branchées : horloge
  réelle de jeu arrêtée en pause, variables calculées à chaque image (commande après la butée douce, butée,
  façade dans l'axe à 5 Hz sur les emprises exposées par `scene.js`), « Revoir les bulles » au menu pause, file
  vidée à chaque nouvelle partie (vues gardées).
- **Menu pause complet** : Reprendre, Recentrer le volant (inclinaison active), Direction (écran tactile),
  Changer c, Revoir les bulles, Recommencer, Crédits ; cibles de 48 px, tenu dans 430 px de haut ; clavier
  (Tab, Entrée, Échap ou P) avec focus visible. Le panneau « Tourne ton GSM » reste strict (Reprendre refusé en
  portrait).
- **Appareil** : plein écran au clic « Jouer » et « Reprendre » sur écran tactile quand l'API existe (Android ;
  rien sur iPhone, sans erreur), puis verrouillage du paysage tenté ; Wake Lock en jeu, rendu en pause, repris
  au retour ; manifeste (`display: fullscreen`, paysage, icônes 180/192/512 et maskable générées depuis le favicon)
  et balises iOS ; sur iPhone, une ligne discrète de l'écran titre propose « Sur l'écran d'accueil ».
- **DPR adaptatif** (`render/adaptiveDpr.js`, règle du §4) : −0,25 si l'intervalle moyen des 90 dernières images
  dépasse 18,5 ms (plancher 1, 0,75 en lite), +0,25 jusqu'au DPR du profil si ≥ 98 % des images ≤ 17,5 ms
  pendant 10 s et CPU (step + render) ≤ 8 ms pour 95 % d'entre elles, jamais dans les 30 s qui suivent une baisse ;
  coupé par `?bench` et `?dpr=` ; DPR courant dans `#diag`. Appliqué à l'image suivante, avant le rendu.
- **Accessibilité** : annonceur aria-live (bulles, replis, calibrage), `prefers-reduced-motion` respecté (bulles
  sans animation, vision classique instantanée), focus visible partout, libellés aria des boutons icônes.

Reste à faire ou à mesurer :
- sur l'iPhone : signe du volant dans les deux paysages, dialogue de permission au clic « Jouer », refus puis
  rechargement, calibrage, frein en bas à gauche avec le pouce, ajout à l'écran d'accueil (plein écran, icône),
  Wake Lock (iOS 16.4+), lisibilité des bulles au soleil, réglage des seuils (zone morte 3°, saturation 25°) ;
- `?bench` sur un Android moyen (matrice d'appareils) ;
- profils mid/full (seul le DPR adaptatif est livré ; pas de mesure GPU par `EXT_disjoint_timer_query_webgl2`).

### J3 : moteur de niveaux et niveaux 1 à 3

**Statut (2026-10-11) : partie 2 intégrée, à valider sur l'iPhone 14 Pro Max** (voir plus bas) ;
**partie 1 livrée (moteur pur et testé)** — schéma `coursier-niveau/1` et validateur
(`game/validate.js`, fixtures invalides), collisions (`physics/collisions.js`), marche arrière (`player.js`),
partie et règles (`game/level.js`, `game/rules.js` : livraisons, « pas avant », retards, portes à lampe par la
teinte perçue, reprises, batterie), étoiles (`game/score.js`), machine à états (`game/states.js`), progression
par c (`game/progress.js`), bot et calibrage (`game/bot.js`, `scripts/calibrate.mjs`), glob des niveaux
(`src/levels/index.js`) et niveau d'exemple `tests/fixtures/levels-valid/n99-exemple.json`. Reste (partie 2) :
niveaux 1 à 3, rendu des portes, lampes et zones, écrans (sélection, briefing, décompte, bilan, échec),
branchement dans main.js, spectromètre, culling par cône apparent.

**Partie 2 (niveaux 1 à 3, rendu, écrans)** :
- **Niveaux** `src/levels/n01-premier-jour.json`, `n02-grand-boulevard.json`, `n03-porte-verte.json`
  (distances en L, scènes paramétriques à l'échelle humaine, briefing, bulles propres, indices
  gradués avec aides, parcours de référence et naïf). Valides à c = 10, 30 et 100 ; référence
  ★★★ sans aucun choc, naïf < 3 pour les trois c (`tests/levels.test.js`). Seuils fixés par
  `npm run calibrate` (batterieMin ≈ (τmax − 1,15·τ_ref)/τmax, tVilleMax ≈ 1,12·t_ref, sur le
  c le plus défavorable), recalibrés après la décision 11 (a = c/5). Chiffres du pilote à c = 30
  (τ / t / batterie restante) :

  | Niveau | τmax | délais (t ville) | étoiles (batterieMin / tVilleMax) | référence | naïf |
  |---|---|---|---|---|---|
  | N1 | 150 s | — | 0,7 / 50 s | 27,1 / 29,6 s / 81 % ★★★ | β 0,1 : 109 / 110 s / 27 % ★ |
  | N2 | 100 s | 45 s ; pas avant 90 s, délai 115 s | 0,3 / 115 s | 59,9 / 90,5 s / 40 % ★★★ | direct puis attente : 80 / 91 s / 20 % ★★ |
  | N3 | 120 s | 60 s ; 150 s | 0,5 / 65 s | 39,4 / 41,9 s / 67 % ★★★ | fonce à β 0,6 : chocs à répétition, batterie vide |

  À c = 10 (les îlots de 80 m pèsent plus en L : niveaux plus longs) : 38 / 42, 57 / 91 et
  52 / 55 s ; à c = 100 : 24 / 26, 61 / 91 et 34 / 36 s. Pilote (`game/bot.js`) amélioré pour
  ces niveaux : anticipation du freinage sur plusieurs points, volant « poursuite pure » (tour
  de place à β = 0,85), point frôlé compté comme atteint.
- **Rendu** (`render/levelObjects.js`, `shaders/lamp.*.glsl`, même pipeline : aberration, Doppler,
  retard) : zones (anneau au sol et balise corps noir), clients (silhouettes, présence VUE à t_e),
  portes (battants coulissants, état VU à t_e), lampes à raie dont la couleur est calculée sur le
  CPU par la même chaîne que la règle (`perceivedLamp`) et passée en uniforme : la couleur
  affichée et la règle coïncident (testé).
- **Écrans et HUD** (`hud/screens.js`, `hud/levelHud.js`, `hud/levelFormat.js` pur et testé) :
  menu (Jouer, Conduite libre, c, Direction), sélection (étoiles par c, verrous, option
  Spectromètre), briefing, décompte 3-2-1 (calibrage de l'inclinaison), HUD de niveau (batterie
  = τ restant, colis, prochain délai ou « pas avant » à l'heure de la ville, flèche vers la
  direction APPARENTE du prochain arrêt et distance), bilan (étoiles expliquées, τ/t, ligne
  « à 0,2 c, … ≈ … s de batterie », records), échec (raison, indice gradué, « Passer » après
  4 échecs), pause (Recommencer, Quitter le niveau), spectromètre (« vert ✓ 533 nm »).
  Progression sauvegardée par c. `?autopilote` pour les tests (sans effet sinon).
- **Vérifié** (Playwright, Chromium SwiftShader, 932 × 430 tactile, c = 30) : parcours menu →
  sélection → briefing → décompte → N1 jusqu'au bilan ★★★ (mêmes horloges que le pilote en
  Node), progression après rechargement, N3 (lampe rouge à l'arrêt, verte à la bonne vitesse,
  porte qui s'ouvre, infrarouge vu vert, bilan), N3 « foncer » (lampe noire, choc, reprise,
  batterie vide, indice), zéro erreur console.
- **Reste à faire ou à mesurer** : sur l'iPhone, lisibilité du HUD de niveau et des écrans
  (encoche, soleil), calibrage pendant le décompte, taille apparente des lampes et des balises,
  performance avec les objets de niveau ; culling par cône apparent (toujours la coupe à la
  distance de visibilité).

**Partie 1 (moteur)** :
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
| Appels de dessin en quartier (98 à 294 chunks visibles à 600 m, c ≥ 50 ; ≈ 2,8 fois moins à c = 30) | Mesure en J1d ; super-chunks ou BatchedMesh ; brouillard plus court en lite |
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

Réponses aux neuf questions du plan, puis les décisions 10 et 11 (même jour). Elles priment sur toute version antérieure de ce document, qui a été mis à jour en conséquence.

1. **Conduite : arcade**, plutôt que l'adhérence honnête à a d'abord proposée. La route fournit la force latérale, hors du budget du moteur : a (= c/10 depuis la décision 10, c/5 depuis la décision 11) ne vaut que pour la poussée et le frein. Le virage fait tourner u à |u| constant, dθ/dτ = −steer·TURN_RATE ; à l'arrêt, le cap pivote à PIVOT_RATE. Plus de cercle d'adhérence, plus de rail d'exception au niveau 6. L'échelle reste celle du §1.1 : c²/a pour atteindre γ = 2, autant pour freiner (150 m à c = 30 depuis la décision 11 ; §1.1, §3, §6).
2. **Dilemme des horloges : choix délégué** (« je te laisse choisir la meilleure option »). Retenu : les fenêtres « pas avant », qui font du paradoxe des jumeaux la solution (§1.2). Le moteur qui consomme (optimum vers β = 0,5) n'est pas retenu : il brouillerait la règle simple « batterie = τ ».
3. **Couleurs : le modèle le plus fidèle à la physique**, plutôt que la fidélité stricte à OpenRelativity (illisible au-delà d'environ β = 0,5). Réflectance × soleil à 5 800 K, bases infrarouge et ultraviolette, fonctions colorimétriques de Wyman et al. ; effet projecteur physique par défaut, `BEAM_EXPONENT = 4`, borné par `BEAM_MAX` (= 8⁴, D⁴ exact jusqu'à D = 8), avec adaptation de l'exposition de l'œil (§4). Le modèle d'OpenRelativity reste un préréglage de comparaison.
4. **Orientation : paysage strictement imposé** sur appareil tactile : panneau « Tourne ton GSM » sans bouton « Jouer quand même », dès le J1 (§5).
5. **Licence : MIT pour le code, CC BY 4.0 pour les contenus**, plutôt que MIT pour tout : `LICENSE` et `LICENSE-CONTENT.md` (§7).
6. **Délais : un retard coûte seulement l'étoile « Ponctuel »**, au lieu de faire échouer le niveau. L'échec ne vient que de la batterie vide et du flash (§6) ; règles livrées au J3, flash avec le niveau 5.
7. **Appareil de test : iPhone 14 Pro Max** (Safari iOS, DPR 3, `requestAnimationFrame` limité à 60 Hz par défaut). C'est l'appareil des mesures de performance du J1 (§4, §9).
8. **GitHub Pages : source « GitHub Actions »**, confirmée. Publication par `.github/workflows/deploy.yml` sur <https://hugohismans.github.io/aSlower/>.
9. **Niveau 4 : interprétation confirmée.** « Il semble ouvert » se lit « il semble praticable » (pont baissé).
10. **2026-10-11 : c = 30 m/s, a = 3 m/s² par défaut, puis c réglable par le joueur** : entier de 10 à 100 m/s, 30 par défaut, a = c/10. Le rapport c/a = 10 s est fixe (même rythme de jeu pour tout c) ; l'unité de longueur L = c²/a = 10·c m suit le réglage (300 m par défaut au lieu de 1 000 m). Toute la partie lit ses constantes dans `physicsFor(c)` : physique injectée (`createPlayer({physics})`, c en paramètre de `relativity.js` et `retarded.js`), scènes développées pour L (longueurs de jeu en L, échelle humaine en mètres), visibilité clamp(1,2·L ; 300 ; 600) m, butée, `?bench`, HUD (mur à c, décimales, « c = 30 m/s ») ; le rendu ne dépend que de β. Réglage sur l'écran titre (préréglages 10 / 30 / 50 / 100) et au menu pause (« Changer c », qui recommence la partie), mémorisé (`aslower:v1:reglages`), `?c=n` prioritaire. TURN_RATE (1,0 rad/s), PIVOT_RATE, sous-pas (1/60 s, 1 m), pas des LOD, hauteur de l'œil, tailles des bâtiments et largeurs des rues ne changent pas. Les tests obligatoires du cahier des charges restent exécutés avec c = 100, a = 10 injectés ; ils tournent aussi à c = 30 et c = 10. Les niveaux (J3+) seront écrits en L et en β, et calibrés par le bot pour plusieurs c (au moins 10, 30 et 100).
11. **2026-10-11 : accélération plus franche, a = c/5** (0,76·c en 5 s au lieu de 10 s) ; l'unité de longueur des niveaux reste L = 10·c m ; pas d'effet de champ de vision artificiel (il fausserait l'aberration réelle) ; seuils d'étoiles recalibrés. Dans `constants.js` : `ACCEL_TIME = 5` (c/a, s) et `LENGTH_TIME = 10` (L/c, s), d'où c²/a = 5·c m = L/2 : les distances d'arrêt et l'horizon de Rindler sont divisés par 2, les rayons de virage (TURN_RATE) ne changent pas. Les tests obligatoires du cahier des charges restent exécutés avec c = 100, a = 10 injectés.

## 12. Glossaire FR → EN

Le jeu, les données JSON et la documentation sont en français ; les identifiants du code sont en anglais. Les clés JSON restent françaises et sans accents (`depart`, `rues`, `batiments`, `lampadaires`, `visibilite`…).

| Français (jeu, docs) | Code |
|---|---|
| horloge de la ville, temps de la ville t | `t` |
| ta montre, batterie, temps propre τ | `tau` |
| écart t − τ | gap (`formatGap`) |
| vitesse propre u = γv | `ux`, `uy` |
| rapidité φ, plafond de rapidité | `rapidity`, `phiMax` |
| vitesse de la lumière (réglage), unité de longueur L = 10·c | `c` (`physicsFor`, `C_DEFAULT`), `lengthUnit` |
| réglages (stockage) | settings (`game/settings.js`, clé `reglages`) |
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
| retrait, « pas avant », porte à lampe, teinte perçue, reprise (J3) | pickup, not-before (`pasAvant`), door (`portes`), `perceivedLamp`, `applyReprise` |
| choc, étourdissement, marche arrière (J3) | collision (`stepWithCollisions`), stun (`stunFor`), reverse (`REVERSE_DELAY`) |
| partie, règles, bilan, progression, pilote de référence (J3) | level state (`createLevel`, `advance`), rules (`update`), score, progress, bot (`runBot`) |
| bulle (J2), carnet de physique (J5) | bubble, notebook |
