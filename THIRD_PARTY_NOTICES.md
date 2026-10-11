# Avis de tiers

« Coursier de la lumière lente » (https://github.com/hugohismans/aSlower) est un projet
indépendant de Hugo Hismans. Il n'est ni affilié au MIT (Massachusetts Institute of
Technology) ni au MIT Game Lab, ni approuvé par eux. Aucune ressource du jeu
« A Slower Speed of Light » (modèles, textures, sons, musiques, niveaux, images, textes)
n'est reprise.

Le code du projet est sous licence MIT (fichier LICENSE) et ses contenus sous licence
CC BY 4.0 (fichier LICENSE-CONTENT.md). Ce fichier liste les œuvres de tiers utilisées,
avec le texte intégral de leur licence. Les textes de licence sont reproduits tels quels,
en anglais : une traduction n'aurait pas de valeur juridique.

Les outils de développement (Vite, Vitest…) ne sont pas distribués avec le jeu.

## 1. OpenRelativity (MIT Game Lab)

- Dépôt : https://github.com/MITGameLab/OpenRelativity
- Version utilisée : commit 35b806a1224ff96047c1ce3c907e7c68bb9e540e (2020-12-10)
- Licence : MIT — Copyright (c) 2013 Massachusetts Institute of Technology
- OpenRelativity est le moteur relativiste issu du jeu « A Slower Speed of Light »
  (MIT Game Lab, 2012). Ses auteurs remercient Gerd Kortemeyer et le MIT Game Lab ;
  nous les remercions à notre tour.
- Copie du texte de licence servie avec le jeu : licences/openrelativity-MIT.txt

Texte intégral de la licence (fichier MITLicense.md du dépôt, reproduit sans modification) :

```text
The MIT License (MIT)
Copyright (c) 2013 Massachusetts Institute of Technology

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Résumé en français (sans valeur juridique) : utilisation, copie, modification et
redistribution libres, à condition de joindre l'avis de copyright et ce texte à toute
copie ou partie substantielle ; aucune garantie.

### Fichiers dérivés d'OpenRelativity

Ce tableau est la liste de référence (vérifiée par tests/licence.test.js). Chaque fichier
listé commence par un commentaire d'en-tête qui cite OpenRelativity, le commit, les lignes
d'origine, l'avis de copyright du MIT et l'identifiant SPDX de la licence ; le build garde
ce commentaire dans les fichiers publiés.

Sources : `*.cs` dans `Assets/OpenRelativity/Scripts/`, `*.shader` dans
`Assets/OpenRelativity/Shaders/`. Nature : « Adapté » = formules ou code portés et
réécrits ; « Inspiré » = idée ou logique reprise, code écrit à neuf.

| fichier | source:lignes | nature |
|---|---|---|
| `src/physics/relativity.js` | `MovementScripts.cs:164-183 ; relativity.shader:122-224` | Adapté |
| `src/physics/player.js` | `GameState.cs:220-246 ; MovementScripts.cs:114-183` | Inspiré |
| `src/physics/spectrum.js` | `relativity.shader:27-47, 243-327, 356-371` | Adapté |
| `src/physics/retarded.js` | `RelativisticObject.cs:316-328 ; relativity.shader:176-182` | Adapté |
| `src/render/shaders/rel_vertex.glsl` | `relativity.shader:83-239` | Adapté |
| `src/render/shaders/rel_doppler.glsl` | `relativity.shader:299-379` | Adapté |
| `src/render/shaders/environment.frag.glsl` | `skybox.shader` | Inspiré |
| `src/render/subdivide.js` | `ObjectMeshDensity.cs` | Inspiré |

Principales modifications (c) 2026 Hugo Hismans :

- `relativity.js` : addition relativiste des vitesses, aberration et facteur Doppler
  réécrits sous forme vectorielle, sans rotation de repère ni acos ; vitesse propre u = γv.
- `player.js` : temps de la ville et déplacement intégrés par un segment hyperbolique
  exact, conduite « arcade » propre au jeu.
- `spectrum.js` : le modèle de couleur du jeu (réflectance × soleil, bases infrarouge et
  ultraviolette) est propre au jeu ; seul le préréglage de comparaison reprend les trois
  raies d'OpenRelativity.
- `retarded.js` : solution quadratique du temps retardé comme point de départ d'une
  méthode de Newton sécurisée par bissection.
- `rel_vertex.glsl` : rotation, temps d'émission et transformation de Lorentz du shader
  Cg réduits, pour le décor immobile, à une aberration vectorielle fermée en GLSL qui
  conserve la distance réelle.
- `rel_doppler.glsl` : facteur Doppler par fragment ; les trois raies gaussiennes sont
  remplacées par des intégrales spectrales précalculées (table), un gamut qui garde la
  teinte et un effet projecteur en D⁴.
- `environment.frag.glsl` : passe plein écran (ciel, sol, brouillard) avec aberration
  inverse exacte.
- `subdivide.js` : découpage des faces à pas maximal, pour que l'aberration courbe les
  droites sans fissures.

## 2. three.js

- Site : https://threejs.org — dépôt : https://github.com/mrdoob/three.js
- Version utilisée : 0.186.1 (paquet npm `three`), distribuée avec le jeu
- Licence : MIT — Copyright © 2010-2026 three.js authors
- Copie du texte de licence servie avec le jeu (générée au build) :
  licences/npm-dependencies.txt

Texte intégral de la licence (fichier LICENSE du paquet, reproduit sans modification) :

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## 3. Fonctions colorimétriques de Wyman, Sloan et Shirley (2013)

Les fonctions colorimétriques CIE 1931 utilisées par `src/physics/spectrum.js`
(`cmfWyman`) sont calculées avec les approximations analytiques publiées dans :

> Chris Wyman, Peter-Pike Sloan et Peter Shirley, « Simple Analytic Approximations to
> the CIE XYZ Color Matching Functions », *Journal of Computer Graphics Techniques*
> (JCGT), vol. 2, n° 2, p. 1-11, 2013. https://jcgt.org/published/0002/02/01/

Seules les formules et les coefficients publiés dans l'article sont repris, réécrits
en JavaScript ; aucun code n'est copié.
