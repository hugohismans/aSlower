# Coursier de la lumière lente

Livre des colis dans une ville où la lumière ne va qu'à **30 m/s** (≈ 108 km/h) — ou à la
vitesse que tu choisis, de 10 à 100 m/s.

Jeu web en 3D (navigateur, ordinateur et GSM) qui fait vivre la relativité restreinte au
volant d'un véhicule de livraison. Il est inspiré de *A Slower Speed of Light* (MIT Game
Lab) et adapte une partie d'[OpenRelativity](https://github.com/MITGameLab/OpenRelativity).

**Jouer : <https://hugohismans.github.io/aSlower/>**

## Le concept

Dans la ville, la lumière va à c = 30 m/s (≈ 108 km/h) et ton moteur pousse à 3 m/s².
L'échelle naturelle du jeu est donc de quelques centaines de mètres (c²/a = 300 m) et la
dizaine de secondes (c/a = 10 s).

**La vitesse de la lumière est un réglage** : sur l'écran titre (ou au menu pause,
« Changer c », qui recommence la partie), choisis un entier de 10 à 100 m/s (préréglages
10, 30, 50 et 100). L'accélération suit, a = c/10 : le rythme du jeu (c/a = 10 s) ne change
pas, seules les distances changent (c²/a = 10·c mètres : 100 m à c = 10, 1 km à c = 100).
Plus c est bas, plus les effets arrivent tôt. Le réglage est mémorisé dans le navigateur.

- **Deux horloges.** « Ta montre » mesure ton temps propre τ : c'est ta batterie.
  « L'horloge de la ville » mesure le temps t de la ville : c'est celui des délais.
  Quand tu roules vite, la ville vieillit plus vite que toi (Δt = γ·Δτ) et l'écart
  entre les deux horloges se creuse.
- **Le mur de la lumière.** À poussée constante, la vitesse approche c sans jamais
  l'atteindre ; c'est ta rapidité qui augmente régulièrement.
- **Ce que tu vois** est calculé, pas truqué : la ville se resserre devant toi
  (aberration), ses couleurs glissent vers le bleu devant et vers le rouge derrière
  (effet Doppler, l'infrarouge devient visible), elle s'illumine devant toi (effet
  projecteur), et tu la vois avec le retard de la lumière.
- **Vision classique.** Un bouton (ou la touche C) montre la même ville sans aucun effet
  relativiste, pour comparer.

## État du projet

**Jalon 1 terminé** (socle physique et rendu) : physique exacte et testée, rendu relativiste
(aberration, Doppler, effet projecteur, ciel et brouillard), HUD (les deux horloges et leur
écart, une phrase sur γ, la jauge de vitesse), deux scènes de test dont les longueurs suivent
c²/a (une avenue droite de 4·c²/a, soit 1 200 m à c = 30 m/s, et un quartier qui contient tout
le disque de visibilité, 0,8 × 0,8 km à c = 30 m/s).

**Jalon 2 intégré** (contrôles mobiles et pédagogie, à valider sur le GSM) : direction par
inclinaison du GSM, bulles d'aide « une seule fois », menu pause complet, plein écran et écran
maintenu allumé, application installable (écran d'accueil), DPR adaptatif, annonces pour
lecteurs d'écran.

Pas encore de colis, de délais ni de batterie limitée : ils arrivent avec les niveaux.
Feuille de route complète dans [`docs/conception.md`](docs/conception.md) (§ 9) :
niveaux 1 à 3 (J3), lumière retardée et objets mobiles (J4), horizon de Rindler et paradoxe
des jumeaux (J5).

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

Deux façons de tourner, au choix sur l'écran titre et au menu pause (« Direction ») ; le
choix est mémorisé. Par défaut, l'inclinaison.

- **Inclinaison** : tiens le GSM en paysage comme un volant et penche-le pour tourner. Au
  départ, un court message « Tiens ton GSM comme un volant… » : la position tenue devient
  « tout droit » (calibrage d'une demi-seconde) ; le menu pause propose « Recentrer le volant ».
  Sur iPhone, Safari demande l'autorisation d'accéder au mouvement au moment où tu touches
  « Jouer ». Si tu refuses, ou sans capteur, le jeu passe tout seul en mode glisser et le dit
  (iOS ne repose la question qu'après un rechargement de la page) ; « Réessayer
  l'inclinaison » est alors proposé dans le réglage Direction. Le **frein** est en bas à gauche.
- **Glisser** : glisse le pouce dans la moitié gauche pour tourner (le volant naît là où tu
  poses le doigt) ; la **pédale de frein** est en bas de la moitié droite, et tu peux y glisser
  le pouce depuis l'accélérateur : il freine tant qu'il est sur la pédale.
- Dans les deux modes : **maintiens la moitié droite** pour accélérer (le frein l'emporte) ;
  **bouton 👁** à mi-hauteur à gauche : vision classique, tant que tu le maintiens.

**Plein écran** : sur Android, le jeu passe en plein écran quand tu touches « Jouer ». Sur
iPhone, Safari ne le permet pas aux pages : ajoute le jeu à l'écran d'accueil (Partager, puis
« Sur l'écran d'accueil ») pour l'ouvrir en plein écran, comme une application. Pendant la
partie, l'écran reste allumé (sauf en pause).

**Menu pause** (Échap ou P au clavier, ou quand tu quittes l'onglet) : Reprendre, Recentrer le
volant (inclinaison), Direction, Changer c (nouvelle partie), Revoir les bulles (les bulles
d'aide, montrées une seule fois, reviendront), Recommencer, Crédits. Les deux horloges
s'arrêtent.

**Bulles d'aide** : en jouant, de courtes bulles expliquent ce que tu vois (horloges, effet
Doppler, vision classique, inertie…), une à la fois et une seule fois ; touche une bulle pour
la fermer. Elles sont aussi annoncées aux lecteurs d'écran.

**Le paysage est obligatoire** sur un appareil tactile : en portrait, le panneau « Tourne
ton GSM » masque le jeu. Il faut le champ de vision horizontal de 90° du paysage pour voir
la ville se resserrer devant soi. Sur une tablette déjà en paysage dont la fenêtre du jeu
est plus haute que large (écran partagé, Slide Over), le panneau demande d'agrandir la
fenêtre. Le zoom par pincement est désactivé (il rendait le jeu injouable sur iOS).

Quand tu lâches tout, le véhicule garde sa vitesse (pas de frottement) : pour s'arrêter,
il faut freiner, et cela prend de la place : (c²/a)(γ − 1), soit 163 m depuis 22,8 m/s
(76 % de c) à c = 30 m/s. Le frein arrête exactement, sans marche arrière.

Appareil de test de l'auteur : iPhone 14 Pro Max (Safari iOS). Il faut un navigateur
récent avec WebGL 2 (Safari iOS 15.4 ou plus, Chrome, Firefox, Edge).

## Développement

Prérequis : [Node.js](https://nodejs.org) 22 (22.12 ou plus), 24 (version de `.nvmrc`,
utilisée par la CI) ou 26 et plus, avec npm. Les versions impaires 23 et 25 sont refusées
(`engine-strict`).

```sh
npm ci            # installe les versions exactes de package-lock.json
npm run dev       # serveur de développement : http://localhost:5173/aSlower/
npm run dev:gsm   # idem, ouvert au réseau local (pour essayer sur un GSM du même Wi-Fi)
npm test          # tests Vitest : physique, couleurs, rendu, formats, stockage, pureté, licences
npm run build     # construit le site dans dist/, puis vérifie les licences (scripts/check-dist.mjs)
npm run preview   # sert dist/ : http://localhost:4173/aSlower/
```

Paramètres d'URL (combinables, par exemple `?scene=quartier-test&bench&c=30&dpr=1`) :

| Paramètre | Effet |
|---|---|
| `?c=30` | vitesse de la lumière de la partie, entier de 10 à 100 m/s (a = c/10). Prioritaire sur le réglage de l'écran titre et jamais mémorisée ; hors plage, ramenée dans la plage ; non entière, ignorée (avec un message). Exemple : `?c=100&bench` reproduit les mesures du jalon 1 |
| `?scene=avenue-test` ou `?scene=quartier-test` | scène de développement à charger (`src/data/scenes/`) ; `avenue-test` par défaut |
| `?diag` | panneau de diagnostic : images par seconde, temps d'image p50 et p95, temps CPU du rendu, appels de dessin, triangles, durée de la première image, GPU, DPR. La touche E (ou la case du panneau) coupe et rétablit la passe ciel/sol, pour mesurer son coût |
| `?bench` | parcours de mesure automatique et déterministe (aucune entrée, pas fixe de 1/60 s par image), avec le panneau de diagnostic. Sur `avenue-test` : poussée pleine jusqu'à γ ≈ 2,5, puis freinage jusqu'à l'arrêt. Sur `quartier-test` : caméra scriptée le long d'une rue, β imposé de 0 à 0,92. À la fin, le panneau affiche p50/p95 des temps d'image, le CPU du rendu, les appels de dessin et triangles maximaux ; le résultat complet est dans `window.__benchResult` (et la console). Ajouter `&sansciel` mesure le même parcours sans la passe ciel/sol (coût de la passe par différence) |
| `?dpr=1.5` | impose le rapport de pixels (de 0,25 à 4) ; sinon min(devicePixelRatio, 2), plafonné à 2,2 millions de pixels, puis ajusté en jeu par le DPR adaptatif (baisse de 0,25 quand le jeu rame, jusqu'à 1 ; remontée quand il est fluide depuis 10 s). `?dpr=` et `?bench` coupent le DPR adaptatif |
| `?debug` | panneau de l'inclinaison (angles α, β, γ du capteur, angle de l'écran, angle de volant, neutre calibré, volant), pour vérifier les signes sur un vrai GSM |
| `?qualite=normale` | oublie un plantage mémorisé et quitte le profil « lite » (DPR 0,75, sans anticrénelage) |

**Publication** : chaque push sur `main` lance le workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) : `npm ci`, `npm test`,
`npm run build` (qui vérifie les licences dans `dist/`), puis publication sur GitHub Pages
(réglage du dépôt : Settings → Pages → Source « GitHub Actions »). Les dépendances sont
épinglées à la version exacte ; Dependabot propose leurs mises à jour chaque mois, avec
14 jours de recul. Chaque pull request (celles de Dependabot comprises) passe par
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) : `npm ci`, `npm test`,
`npm run build`, sans publication. Réglage du dépôt conseillé : rendre ce contrôle
(« Tests / test ») obligatoire sur `main` (Settings → Branches → règle de protection).

**Conventions** : identifiants en anglais ; commentaires, documentation et textes du jeu
en français ; données JSON en français sans accents ; types en JSDoc (`checkJs` sur `src/`,
vérifiables avec `npx -p typescript tsc --noEmit -p jsconfig.json`, en option). Le
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
  input/                clavier, tactile, inclinaison → {thrust, brake, steer, classic, pause} ;
                        plein écran et écran allumé
  game/                 réglages (c, direction), conditions et bulles d'aide (purs)
  hud/                  horloges, jauge, bulles, annonces, réglages, diagnostic (?diag, ?debug), Crédits
  data/                 palette, bulles d'aide et scènes de test (JSON)
  styles/               feuilles de style
tests/                  tests Vitest (Node, sans navigateur)
scripts/check-dist.mjs  vérifie les licences dans dist/ après le build
scripts/generate-icons.mjs  génère les icônes PNG depuis le favicon (Playwright global)
public/                 favicon, manifeste, icônes et textes de licence servis avec le jeu
docs/                   conception (plan, décisions, glossaire) et contrat d'interfaces
```

## Physique et rendu, en bref

- **Physique exacte.** L'état du véhicule est sa position, sa vitesse propre u = γv et
  ses deux horloges, en double précision. Sous poussée constante, chaque pas suit la
  solution exacte (mouvement hyperbolique) : le résultat ne dépend pas du nombre d'images
  par seconde (en virage avec poussée, à moins d'un millimètre près). Test de référence
  (cahier des charges, exécuté avec c = 100 m/s et a = 10 m/s² injectées) : 10 s de
  poussée depuis l'arrêt donnent v = 100·tanh 1 = 76,159 m/s, t = 10·sinh 1 = 11,752 s et
  x = 1 000·(cosh 1 − 1) = 543,081 m ; à c = 30 m/s (défaut) : 22,848 m/s, 11,752 s et
  162,924 m.
- **Conduite « arcade ».** La route fournit la force latérale, hors du budget du moteur :
  tourner fait pivoter la vitesse sans la changer. La rapidité est plafonnée (φ ≤ 3,
  soit 99,5 % de c — 29,85 m/s à c = 30 — et γ ≈ 10).
- **Aberration par sommet.** Chaque sommet est vu dans sa direction apparente
  n′ = (n + (γ²/(γ+1)·(β·n) + γ)·β)/D, avec D = γ(1 + β·n), à sa distance réelle. Les
  façades sont subdivisées pour que les droites puissent se courber.
- **Couleurs par pixel.** Chaque surface a cinq canaux de réflectance (rouge, vert, bleu,
  infrarouge, ultraviolet) éclairés par un soleil à 5 800 K ; une table précalculée à
  partir des fonctions colorimétriques de Wyman et al. donne la couleur vue pour chaque
  facteur Doppler D. S'y ajoutent l'effet projecteur en D⁴ (exact jusqu'à D = 8), une
  adaptation de l'exposition, comme celle de l'œil, et une compression qui garde la teinte.
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
