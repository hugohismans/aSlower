# Coursier de la lumière lente

Livre des colis dans une ville où la lumière ne va qu'à **100 m/s**.

Jeu web en 3D (navigateur, ordinateur et GSM) qui fait vivre la relativité restreinte au
volant d'un véhicule de livraison. Il est inspiré de *A Slower Speed of Light* (MIT Game
Lab) et adapte une partie d'[OpenRelativity](https://github.com/MITGameLab/OpenRelativity).

**Jouer : <https://hugohismans.github.io/aSlower/>**

## Le concept

Dans la ville, la lumière va à c = 100 m/s et ton moteur pousse à 10 m/s². L'échelle
naturelle du jeu est donc le kilomètre (c²/a = 1 000 m) et la dizaine de secondes
(c/a = 10 s).

- **Deux horloges.** « Ta montre » mesure ton temps propre τ : c'est ta batterie.
  « L'horloge de la ville » mesure le temps t de la ville : c'est celui des délais.
  Quand tu roules vite, la ville vieillit plus vite que toi (Δt = γ·Δτ) et l'écart
  entre les deux horloges se creuse.
- **Le mur de la lumière.** À poussée constante, la vitesse approche 100 m/s sans jamais
  l'atteindre ; c'est ta rapidité qui augmente régulièrement.
- **Ce que tu vois** est calculé, pas truqué : la ville se resserre devant toi
  (aberration), ses couleurs glissent vers le bleu devant et vers le rouge derrière
  (effet Doppler, l'infrarouge devient visible), elle s'illumine devant toi (effet
  projecteur), et tu la vois avec le retard de la lumière.
- **Vision classique.** Un bouton (ou la touche C) montre la même ville sans aucun effet
  relativiste, pour comparer.

## État du projet

**Jalon 1 en cours** : socle physique et rendu. Sont prévus dans ce jalon :

- la physique exacte et testée (horloges, poussée, frein, virage, plafond de vitesse) ;
- le rendu relativiste (aberration, Doppler, effet projecteur, ciel et brouillard) ;
- un HUD minimal (les deux horloges et leur écart, une phrase sur γ, la jauge de vitesse) ;
- les commandes au clavier et au toucher, et deux scènes de test (une avenue droite de
  4 km et un quartier d'environ 1,3 × 1,3 km).

Pas encore de colis, de délais ni de batterie limitée : ils arrivent avec les niveaux.
Feuille de route complète dans [`docs/conception.md`](docs/conception.md) (§ 9) :
gyroscope et bulles d'aide (J2), niveaux 1 à 3 (J3), lumière retardée et objets mobiles
(J4), horizon de Rindler et paradoxe des jumeaux (J5).

## Commandes

### Clavier

Les touches sont lues par leur position physique : elles sont au même endroit sur un
clavier AZERTY et sur un clavier QWERTY.

| Action | AZERTY | QWERTY |
|---|---|---|
| Accélérer | ↑ ou Z | ↑ ou W |
| Tourner | ← → ou Q D | ← → ou A D |
| Freiner | Espace, ↓ ou S | Espace, ↓ ou S |
| Vision classique (maintenir) | C ou Maj | C ou Shift |
| Pause | Échap ou P | Esc ou P |

### Tactile (GSM, tablette)

- **Maintiens la moitié droite** de l'écran pour accélérer.
- **Pédale de frein** en bas de la moitié droite (le frein l'emporte sur l'accélérateur).
- **Glisse le pouce dans la moitié gauche** pour tourner : le volant naît là où tu poses
  le doigt.
- **Bouton 👁** à mi-hauteur à gauche : vision classique, tant que tu le maintiens.

**Le paysage est obligatoire** sur un appareil tactile : en portrait, le panneau « Tourne
ton GSM » masque le jeu. Il faut le champ de vision horizontal de 90° du paysage pour voir
la ville se resserrer devant soi.

Quand tu lâches tout, le véhicule garde sa vitesse (pas de frottement) : pour s'arrêter,
il faut freiner, et cela prend de la place (543 m depuis 76 m/s). Le frein arrête
exactement, sans marche arrière.

Appareil de test de l'auteur : iPhone 14 Pro Max (Safari iOS). Il faut un navigateur
récent avec WebGL 2 (Safari iOS 15.4 ou plus, Chrome, Firefox, Edge).

## Développement

Prérequis : [Node.js](https://nodejs.org) 22.12 ou plus récent, ou 24 (version du fichier
`.nvmrc`), et npm.

```sh
npm ci            # installe les versions exactes de package-lock.json
npm run dev       # serveur de développement : http://localhost:5173/aSlower/
npm run dev:gsm   # idem, ouvert au réseau local (pour essayer sur un GSM du même Wi-Fi)
npm test          # tests Vitest : physique, couleurs, rendu, formats, stockage, pureté, licences
npm run build     # construit le site dans dist/, puis vérifie les licences (scripts/check-dist.mjs)
npm run preview   # sert dist/ : http://localhost:4173/aSlower/
```

Paramètres d'URL (combinables, par exemple `?scene=quartier-test&bench&dpr=1`) :

| Paramètre | Effet |
|---|---|
| `?scene=avenue-test` ou `?scene=quartier-test` | scène de développement à charger (`src/data/scenes/`) ; `avenue-test` par défaut |
| `?diag` | panneau de diagnostic : images par seconde, temps d'image p50 et p95, temps CPU du rendu, appels de dessin, triangles, durée de la première image, GPU, DPR. La touche E (ou la case du panneau) coupe et rétablit la passe ciel/sol, pour mesurer son coût |
| `?bench` | parcours de mesure automatique et déterministe (aucune entrée, pas fixe de 1/60 s par image), avec le panneau de diagnostic. Sur `avenue-test` : poussée pleine jusqu'à γ ≈ 2,5, puis freinage jusqu'à l'arrêt. Sur `quartier-test` : caméra scriptée le long d'une rue, β imposé de 0 à 0,92. À la fin, le panneau affiche p50/p95 des temps d'image, le CPU du rendu, les appels de dessin et triangles maximaux ; le résultat complet est dans `window.__benchResult` (et la console). Ajouter `&sansciel` mesure le même parcours sans la passe ciel/sol (coût de la passe par différence) |
| `?dpr=1.5` | impose le rapport de pixels (de 0,25 à 4) ; sinon min(devicePixelRatio, 2), plafonné à 2,2 millions de pixels |

**Publication** : chaque push sur `main` lance le workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) : `npm ci`, `npm test`,
`npm run build` (qui vérifie les licences dans `dist/`), puis publication sur GitHub Pages
(réglage du dépôt : Settings → Pages → Source « GitHub Actions »). Les dépendances sont
épinglées à la version exacte ; Dependabot propose leurs mises à jour chaque mois, avec
14 jours de recul.

**Conventions** : identifiants en anglais ; commentaires, documentation et textes du jeu
en français ; données JSON en français sans accents ; types en JSDoc (`checkJs`). Le
contrat entre modules (signatures, repères, imports permis) est dans
[`docs/interfaces.md`](docs/interfaces.md) ; les règles d'imports sont vérifiées par
`tests/purity.test.js`.

## Organisation du code

```
index.html              page unique : canvas, HUD, commandes, écrans, <dialog> Crédits
src/
  main.js  loop.js      démarrage (écran titre, panneau « Tourne ton GSM ») et boucle d'images
  storage.js            seul accès à localStorage/sessionStorage (clés « aslower:v1: »)
  physics/              PUR (ni DOM ni three) : constantes, relativité, véhicule,
                        couleurs (spectrum.js), temps retardé
  render/               Three.js : renderer, caméra, uniformes partagés, matériaux,
                        LUT Doppler, maillage de la ville, LOD, culling, shaders GLSL
  input/                clavier et tactile → {thrust, brake, steer, classic, pause}
  hud/                  horloges, jauge, diagnostic (?diag), Crédits
  data/                 palette et scènes de test (JSON)
  styles/               feuilles de style
tests/                  tests Vitest (Node, sans navigateur)
scripts/check-dist.mjs  vérifie les licences dans dist/ après le build
public/                 favicon et textes de licence servis avec le jeu
docs/                   conception (plan, décisions, glossaire) et contrat d'interfaces
```

## Physique et rendu, en bref

- **Physique exacte.** L'état du véhicule est sa position, sa vitesse propre u = γv et
  ses deux horloges, en double précision. Sous poussée constante, chaque pas suit la
  solution exacte (mouvement hyperbolique) : le résultat ne dépend pas du nombre d'images
  par seconde. Test de référence : 10 s de poussée depuis l'arrêt donnent
  v = 100·tanh 1 = 76,159 m/s, t = 10·sinh 1 = 11,752 s et x = 1 000·(cosh 1 − 1) =
  543,081 m.
- **Conduite « arcade ».** La route fournit la force latérale, hors du budget du moteur :
  tourner fait pivoter la vitesse sans la changer. La rapidité est plafonnée (φ ≤ 3,
  soit 99,5 m/s et γ ≈ 10).
- **Aberration par sommet.** Chaque sommet est vu dans sa direction apparente
  n′ = (n + (γ²/(γ+1)·(β·n) + γ)·β)/D, avec D = γ(1 + β·n), à sa distance réelle. Les
  façades sont subdivisées pour que les droites puissent se courber.
- **Couleurs par pixel.** Chaque surface a cinq canaux de réflectance (rouge, vert, bleu,
  infrarouge, ultraviolet) éclairés par un soleil à 5 800 K ; une table précalculée à
  partir des fonctions colorimétriques de Wyman et al. donne la couleur vue pour chaque
  facteur Doppler D. S'y ajoutent l'effet projecteur en D⁴ (borné) et une compression qui
  garde la teinte.
- **Ciel, sol et brouillard** : une passe plein écran avec l'aberration inverse exacte.

Détails et justifications : [`docs/conception.md`](docs/conception.md).

## Crédits

- Inspiré de *A Slower Speed of Light* (MIT Game Lab, 2012).
- Shaders relativistes et logique de mouvement adaptés d'**OpenRelativity** (MIT Game
  Lab), <https://github.com/MITGameLab/OpenRelativity>, sous licence MIT,
  Copyright (c) 2013 Massachusetts Institute of Technology. La liste des fichiers dérivés
  est dans [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- Merci à **Gerd Kortemeyer** et au MIT Game Lab, que les auteurs d'OpenRelativity
  remercient pour leur contribution et leur enseignement.
- Rendu 3D : **three.js** (<https://threejs.org>), licence MIT.
- Couleurs : C. Wyman, P.-P. Sloan et P. Shirley, « Simple Analytic Approximations to the
  CIE XYZ Color Matching Functions », *Journal of Computer Graphics Techniques*, vol. 2,
  n° 2, 2013.

Projet indépendant, non affilié au MIT ni au MIT Game Lab, ni approuvé par eux. Aucune
ressource du jeu *A Slower Speed of Light* n'est reprise.

## Licences

- **Code** : licence MIT, Copyright (c) 2026 Hugo Hismans — voir [`LICENSE`](LICENSE).
- **Contenus** (données JSON, niveaux, textes du jeu, documentation) : licence
  Creative Commons Attribution 4.0 International (CC BY 4.0) — voir
  [`LICENSE-CONTENT.md`](LICENSE-CONTENT.md).
- **Œuvres de tiers** (OpenRelativity, three.js) : textes intégraux de leurs licences et
  liste des fichiers dérivés dans [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Le
  site publié sert aussi `licences/openrelativity-MIT.txt` et
  `licences/npm-dependencies.txt`.
