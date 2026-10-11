// Chunk « rel_facade » (shader de fragments des surfaces) : façades procédurales.
//
// Le motif ne fait que CHOISIR les réflectances (r, g, b, ir, uv) du fragment, AVANT le
// brouillard et le Doppler : M(D) est linéaire, le résultat est exact. Les matériaux (verre,
// pierre, ardoise, fer forgé, porte, volets, enseignes) sont les constantes FAC_<NOM> (r, g, b
// linéaire) et FAC_<NOM>_IU (ir, uv), générées depuis src/data/palette.json au chargement
// (render/facades.js, facadeGlslConstants) et placées avant ce texte. La couleur de base du
// mur (palette du bâtiment) reste celle de l'enduit ou de la brique.
//
// Entrées (render/cityMesher.js, attribut aFacade = (style codé, u, z, W)) :
//   fac = (style codé, W), lu en flat (exact) ; uz = (u, z), interpolés.
//   style codé = style + code/2^16, code = 32·round(H/0,25) + graine (facades.encodeFacade).
// Styles : 1 haussmannien, 2 coloré (Italie, Provence), 3 brique (Europe du Nord),
// 4 boutiques ; 0 : pas de motif (toits, décor, murs mitoyens, objets des niveaux).
//
// Mise en page (mètres) : travées de pas p régulier, en nombre entier, centrées sur le mur
// (marges aux angles : jamais de fenêtre coupée par un angle) ; rez-de-chaussée de hauteur h0,
// puis nf étages de hauteur fh = (haut − h0)/nf, alignés sur la hauteur réelle du toit H (rien
// au-dessus du toit) ; bâtiment bas (< 6 m) : un seul niveau. Pas, hauteurs et largeurs
// varient avec la graine du bâtiment ; volets ouverts ou fermés, reflets des vitres et couleurs
// d'enseigne avec un hachage de (bâtiment, travée, étage).
//
// Anticrénelage : chaque motif est un créneau (périodique ou non) FILTRÉ ANALYTIQUEMENT par une
// boîte de la taille du pixel (fwidth(u), fwidth(z)) : intégrale exacte du créneau sur
// l'empreinte, si bien qu'au loin (ou comprimé par l'aberration) le motif se fond dans sa
// moyenne pondérée, sans scintillement ni moiré. Les variations par fenêtre (volets fermés,
// reflets, enseignes) se fondent dans leur espérance dès qu'une fenêtre tient dans un pixel.
// Coût : sans boucle ni texture ; quelques dizaines de floor/fract/clamp par fragment.
//
// FACADES (define du matériau) : 0 = motifs coupés (?facades=0), 1 = simplifiés (profil
// « lite » : ni volets, ni balcons, ni joints, ni croisillons, ni lettres d'enseigne),
// 2 = complets.

#ifndef FACADES
#define FACADES 2
#endif

// Largeur du filtre, en empreintes de pixel (fwidth) : un peu plus d'un pixel, pour que les
// motifs fins (joints, barreaux) ne laissent aucun moiré résiduel.
const float FAC_BLUR = 1.3;

// Intégrale, de 0 à x, du créneau de période 1 qui vaut 1 sur [a, b] (0 <= a <= b <= 1).
float facStepInt(float x, float a, float b) {
  return floor(x) * (b - a) + clamp(fract(x), a, b) - a;
}

// Moyenne, sur la boîte [x - w/2, x + w/2], du créneau de période 1 allumé sur [a, b],
// restreint aux périodes [0, n) (n = 0 : rien). x, w en périodes.
float facGrid(float x, float a, float b, float n, float w) {
  float h = 0.5 * w;
  return (facStepInt(clamp(x + h, 0.0, n), a, b) - facStepInt(clamp(x - h, 0.0, n), a, b)) / w;
}

// Moyenne, sur la boîte [x - w/2, x + w/2], de l'indicatrice de [a, b] (vide si b <= a).
float facBand(float x, float a, float b, float w) {
  float h = 0.5 * w;
  float hi = max(a, b);
  return (clamp(x + h, a, hi) - clamp(x - h, a, hi)) / w;
}

// Hachage sans sinus (stable en float32) : [0, 1).
float facHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Couche de matériau (m, mi) de couverture k sur les réflectances (c, ci).
void facMix(inout vec3 c, inout vec2 ci, vec3 m, vec2 mi, float k) {
  c = mix(c, m, k);
  ci = mix(ci, mi, k);
}

// Ombre (moulure, dalle de balcon) : réflectances multipliées par 1 - k·force.
void facShadow(inout vec3 c, inout vec2 ci, float k, float strength) {
  float f = 1.0 - strength * k;
  c *= f;
  ci *= f;
}

// Garde-corps en fer forgé : couverture de fer sur une hauteur de 1 m à partir de zl = 0
// (lisses haute et basse, barreaux de pas 0,13 m, frise centrale plus dense).
float facRailing(float zl, float u, float wz, float wu) {
  float rails = facBand(zl, 0.9, 1.0, wz) + facBand(zl, 0.04, 0.11, wz);
  float body = facBand(zl, 0.0, 1.0, wz);
  float bars = facGrid(u / 0.13, 0.0, 0.3, 1.0e5, wu / 0.13);
  float frieze = facBand(zl, 0.38, 0.6, wz) * facGrid(u / 0.26, 0.1, 0.55, 1.0e5, wu / 0.26);
  return clamp(rails + body * (1.0 - (1.0 - bars) * (1.0 - frieze)), 0.0, 1.0);
}

// Réflectances (rgb, iu = (ir, uv)) du mur après motif de façade. fac = (style codé, W),
// uz = (u, z) en mètres.
void relFacade(inout vec3 rgb, inout vec2 iu, highp vec2 fac, highp vec2 uz) {
#if FACADES > 0
  highp float u = uz.x;
  highp float z = uz.y;
  // Empreinte du pixel en mètres, calculée avant tout branchement.
  float wu = max(fwidth(u), 1.0e-4) * FAC_BLUR;
  float wz = max(fwidth(z), 1.0e-4) * FAC_BLUR;
  float style = floor(fac.x);
  if (style < 0.5) return;

  // --- Décodage : hauteur du toit H, graine, longueur du mur W.
  float code = floor((fac.x - style) * 65536.0 + 0.5);
  float hq = floor(code / 32.0);
  float seed = code - 32.0 * hq;
  float H = 0.25 * hq;
  float W = fac.y;
  vec3 rnd = fract(vec3(0.7548777, 0.5698403, 0.3263763) * (seed + 1.0) + vec3(0.13, 0.41, 0.77));
  bool hauss = style == 1.0;
  bool colore = style == 2.0;
  bool brique = style == 3.0;
  bool shops = style == 4.0;

  // --- Paramètres du style (m) : rez-de-chaussée, étage, pas des travées, fenêtre,
  // encadrement (côtés, bas, haut), attique au-dessus de la corniche, marge aux angles.
  float rdc, fhT, pitch, ww, wh, sill, frS, frB, frT, attic, margin;
  if (hauss) {
    rdc = 4.0 + 0.5 * rnd.x; fhT = 3.05 + 0.35 * rnd.y; pitch = 3.2 + 0.5 * rnd.z;
    ww = 1.05 + 0.15 * rnd.y; wh = 1.9; sill = 0.45; frS = 0.16; frB = 0.12; frT = 0.4;
    attic = 0.0; margin = 1.0;
  } else if (colore) {
    rdc = 3.3 + 0.4 * rnd.x; fhT = 2.9 + 0.3 * rnd.y; pitch = 2.9 + 0.6 * rnd.z;
    ww = 0.95 + 0.1 * rnd.x; wh = 1.45; sill = 0.9; frS = 0.12; frB = 0.0; frT = 0.12;
    attic = 0.6; margin = 0.9;
  } else if (brique) {
    rdc = 3.2 + 0.3 * rnd.x; fhT = 2.85 + 0.3 * rnd.y; pitch = 2.6 + 0.6 * rnd.z;
    ww = 1.0 + 0.15 * rnd.z; wh = 1.6; sill = 0.85; frS = 0.1; frB = 0.1; frT = 0.28;
    attic = 0.5; margin = 0.9;
  } else {
    rdc = 4.1 + 0.4 * rnd.x; fhT = 3.0 + 0.3 * rnd.y; pitch = 3.0 + 0.5 * rnd.z;
    ww = 1.0 + 0.1 * rnd.y; wh = 1.65; sill = 0.7; frS = 0.14; frB = 0.1; frT = 0.3;
    attic = 0.6; margin = 0.9;
  }

  // --- Étages : alignés sur le toit réel ; un seul niveau si le bâtiment est bas.
  float top = H - attic;
  float h0 = rdc;
  float nf = max(floor((top - h0) / fhT + 0.5), 0.0);
  if (H < 6.0 || top - h0 < 2.5) { nf = 0.0; h0 = top; }
  float fh = nf > 0.0 ? (top - h0) / nf : 1.0;
  bool mansard = hauss && nf >= 2.0;
  float nReg = mansard ? nf - 1.0 : nf;      // étages courants
  float zm = h0 + nReg * fh;                 // pied de la mansarde (ou haut du dernier étage)
  float zc = mansard ? zm : top;             // corniche

  // --- Travées : nombre entier, pas régulier, centrées sur le mur.
  float avail = W - 2.0 * margin;
  float n = avail >= ww + 0.4 ? max(floor(avail / pitch + 0.5), 1.0) : 0.0;
  float p = n > 0.0 ? avail / n : 1.0;
  float s = (u - margin) / p;                // abscisse en travées
  float ws = wu / p;
  float hw = 0.5 * ww / p;                   // demi-largeur de fenêtre (travées)
  float t = (z - h0) / fh;                   // hauteur en étages au-dessus du rez-de-chaussée
  float wt = wz / fh;
  float bay = clamp(floor(s), 0.0, max(n - 1.0, 0.0));
  float lvl = floor(t);
  // 1 quand une fenêtre tient dans un pixel : variations par fenêtre fondues dans leur moyenne.
  float farK = smoothstep(0.25, 0.7, max(ws, wt));
  vec3 base = rgb;
  vec2 baseIu = iu;

  // --- Brique : joints de mortier (assises de 7,5 cm, briques de 23,5 cm décalées), teinte
  // des briques, pierres d'angle alternées.
#if FACADES > 1
  if (brique) {
    float course = floor(z / 0.075);
    float fadeC = smoothstep(0.3, 0.8, wz / 0.075);
    float off = mix(0.5 * mod(course, 2.0), 0.25, fadeC);
    float hz = facGrid(z / 0.075, 0.0, 0.16, 1.0e5, wz / 0.075);
    float vz = facGrid(u / 0.235 + off, 0.0, 0.05, 1.0e5, wu / 0.235);
    float mortar = 1.0 - (1.0 - hz) * (1.0 - vz);
    float tint = mix(0.88 + 0.24 * facHash(vec2(floor(u / 0.235 + off), course) + seed), 1.0,
                     smoothstep(0.3, 0.8, max(wu / 0.235, wz / 0.075)));
    rgb *= tint;
    iu *= tint;
    facMix(rgb, iu, mix(FAC_PIERRE, base, 0.25), mix(FAC_PIERRE_IU, baseIu, 0.25), 0.45 * mortar);
  }
#endif
  if (brique) {
    float q = floor(z / 0.32);
    float qw = mix(mix(0.3, 0.55, 1.0 - mod(q, 2.0)), 0.425, smoothstep(0.3, 0.8, wz / 0.32));
    float quoin = (facBand(u, -1.0, qw, wu) + facBand(u, W - qw, W + 1.0, wu)) * facBand(z, 0.0, zc, wz);
    facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, quoin);
  }
  // Coloré : soubassement plus sombre.
  if (colore) facShadow(rgb, iu, facBand(z, -1.0, 0.65, wz), 0.18);

  // Gardes en z (support du filtre [z - wz/2, z + wz/2]) : chaque section n'est calculée que
  // là où ses motifs ont un support ; le résultat est identique (créneaux nuls ailleurs).
  float zlo = z - 0.5 * wz;
  float zhi = z + 0.5 * wz;

  // --- Fenêtres des étages courants : encadrement, vitre (reflet du ciel plus clair en haut).
  float colW = facGrid(s, 0.5 - hw, 0.5 + hw, n, ws);
  float fs = frS / p;
  vec3 frameRgb = colore ? mix(base, FAC_PIERRE, 0.5) : FAC_PIERRE;
  vec2 frameIu = colore ? mix(baseIu, FAC_PIERRE_IU, 0.5) : FAC_PIERRE_IU;
  float rowW = 0.0;
  float win = 0.0;
  if (zhi > h0 && zlo < zm) {
    rowW = facGrid(t, sill / fh, (sill + wh) / fh, nReg, wt);
    win = colW * rowW;
    float frame = facGrid(s, 0.5 - hw - fs, 0.5 + hw + fs, n, ws)
                * facGrid(t, (sill - frB) / fh, (sill + wh + frT) / fh, nReg, wt);
    facMix(rgb, iu, frameRgb, frameIu, frame);
    if (colore) {
      // Appuis clairs, un peu plus larges que la fenêtre.
      float ap = facGrid(s, 0.5 - hw - 0.1 / p, 0.5 + hw + 0.1 / p, n, ws)
               * facGrid(t, (sill - 0.1) / fh, sill / fh, nReg, wt);
      facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, ap);
    }
    float g = mix(clamp((fract(t) * fh - sill) / wh, 0.0, 1.0), 0.5, farK);
    float shine = mix(0.8 + 0.4 * facHash(vec2(bay, lvl) + seed * vec2(7.0, 13.0)), 1.0, farK);
    float glassK = (0.7 + 0.6 * g) * shine;
    facMix(rgb, iu, FAC_VERRE * glassK, FAC_VERRE_IU * glassK, win);
#if FACADES > 1
    if (brique) {
      // Croisillons blancs.
      float mull = facGrid(s, 0.5 - 0.03 / p, 0.5 + 0.03 / p, n, ws) * rowW
                 + colW * facGrid(t, (sill + 0.65 * wh - 0.03) / fh, (sill + 0.65 * wh + 0.03) / fh, nReg, wt);
      facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, clamp(mull, 0.0, 1.0));
    }
#endif
  }

  // --- Rez-de-chaussée (z < h0).
  float door = -10.0;                        // travée de la porte (aucune si < 2 travées)
  if (n >= 2.0) door = floor(rnd.x * n);
  float doorBay = facBand(s, door, door + 1.0, ws);
  float rowR = 0.0;
  float rdcWin = 0.0;
  if (zlo < h0 && (hauss || shops)) {
    // Vitrines ; haussmannien : refends, porte cochère ; boutiques : devantures colorées.
#if FACADES > 1
    if (hauss) facShadow(rgb, iu, facGrid(z / 0.5, 0.0, 0.07, floor((h0 - 0.35) / 0.5), wz / 0.5), 0.3);
#endif
    // Vitrines hautes entre des trumeaux, dans un mince cadre sombre.
    float vh = hauss ? 0.33 : 0.38;
    float colV = facGrid(s, 0.5 - vh, 0.5 + vh, n, ws);
    if (hauss) colV *= 1.0 - doorBay;
    float vit = colV * facBand(z, 0.5, h0 - 0.95, wz);
    float front = facGrid(s, 0.47 - vh, 0.53 + vh, n, ws) * facBand(z, 0.4, h0 - 0.85, wz);
    if (hauss) front *= 1.0 - doorBay;
    vec3 shopRgb = FAC_FER;
    vec2 shopIu = FAC_FER_IU;
    if (shops) {
      // Devanture et enseigne de la couleur de la boutique (une boutique = deux travées).
      float pick = facHash(vec2(floor(s * 0.5), 31.0) + seed);
      vec3 meanRgb = (FAC_ENSEIGNE_BORDEAUX + FAC_ENSEIGNE_VERTE + FAC_ENSEIGNE_BLEUE) / 3.0;
      vec2 meanIu = (FAC_ENSEIGNE_BORDEAUX_IU + FAC_ENSEIGNE_VERTE_IU + FAC_ENSEIGNE_BLEUE_IU) / 3.0;
      shopRgb = pick < 0.34 ? FAC_ENSEIGNE_BORDEAUX : pick < 0.67 ? FAC_ENSEIGNE_VERTE : FAC_ENSEIGNE_BLEUE;
      shopIu = pick < 0.34 ? FAC_ENSEIGNE_BORDEAUX_IU : pick < 0.67 ? FAC_ENSEIGNE_VERTE_IU : FAC_ENSEIGNE_BLEUE_IU;
      float farShop = smoothstep(0.12, 0.35, ws);
      shopRgb = mix(shopRgb, meanRgb, farShop);
      shopIu = mix(shopIu, meanIu, farShop);
      front = facBand(u, margin - 0.15, W - margin + 0.15, wu) * facBand(z, 0.0, h0 - 0.3, wz);
    }
    facMix(rgb, iu, shopRgb, shopIu, front);
    float gR = mix(clamp((z - 0.45) / max(h0 - 1.5, 0.5), 0.0, 1.0), 0.5, farK);
    facMix(rgb, iu, FAC_VERRE * (0.7 + 0.6 * gR), FAC_VERRE_IU * (0.7 + 0.6 * gR), vit);
#if FACADES > 1
    // Traverse d'imposte des vitrines.
    facMix(rgb, iu, shopRgb, shopIu, colV * facBand(z, h0 - 1.75, h0 - 1.65, wz));
    if (shops) {
      // Lettres claires au milieu de l'enseigne de chaque boutique.
      float mid = facGrid(s * 0.5, 0.2, 0.8, floor(n * 0.5 + 0.5), ws * 0.5);
      float letters = facGrid(u / 0.3, 0.2, 0.75, 1.0e5, wu / 0.3) * facBand(z, h0 - 0.85, h0 - 0.55, wz) * mid;
      facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, 0.85 * letters);
    }
#endif
    if (hauss) {
      // Porte cochère (bois peint) dans un encadrement de pierre.
      float hd = min(1.3, 0.42 * p) / p;
      float dc = door + 0.5;
      float dFrame = facBand(s, dc - hd - 0.25 / p, dc + hd + 0.25 / p, ws) * facBand(z, 0.0, h0 - 0.35, wz);
      float dLeaf = facBand(s, dc - hd, dc + hd, ws) * facBand(z, 0.0, h0 - 0.6, wz);
      facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, dFrame);
      facMix(rgb, iu, FAC_PORTE, FAC_PORTE_IU, dLeaf);
#if FACADES > 1
      facShadow(rgb, iu, dLeaf * facBand(s, dc - 0.03 / p, dc + 0.03 / p, ws), 0.5);
#endif
    }
  } else if (zlo < h0) {
    // Coloré, brique : fenêtres du rez-de-chaussée et une porte.
    rowR = facBand(z, 0.9, min(0.9 + wh, h0 - 0.4), wz) * (1.0 - doorBay);
    rdcWin = colW * rowR;
    float rFrame = facGrid(s, 0.5 - hw - fs, 0.5 + hw + fs, n, ws)
                 * facBand(z, 0.9 - frB, min(0.9 + wh + frT, h0 - 0.3), wz) * (1.0 - doorBay);
    facMix(rgb, iu, frameRgb, frameIu, rFrame);
    facMix(rgb, iu, FAC_VERRE, FAC_VERRE_IU, rdcWin);
    float hd = 0.55 / p;
    float dc = door + 0.5;
    float dFrame = facBand(s, dc - hd - fs, dc + hd + fs, ws) * facBand(z, 0.0, 2.35 + frT, wz);
    float dLeaf = facBand(s, dc - hd, dc + hd, ws) * facBand(z, 0.0, 2.35, wz);
    facMix(rgb, iu, frameRgb, frameIu, dFrame);
    facMix(rgb, iu, FAC_PORTE, FAC_PORTE_IU, dLeaf);
  }

#if FACADES > 1
  // --- Coloré : volets (vert sauge ou gris-bleu), à persiennes ; ouverts de part et d'autre de
  // la fenêtre, ou fermés devant (environ 1 sur 4).
  if (colore && rowW + rowR > 0.0) {
    vec3 volet = rnd.y < 0.5 ? FAC_VOLET_SAUGE : FAC_VOLET_GRIS;
    vec2 voletIu = rnd.y < 0.5 ? FAC_VOLET_SAUGE_IU : FAC_VOLET_GRIS_IU;
    float slat = 1.0 - 0.3 * facGrid(z / 0.07, 0.0, 0.35, 1.0e5, wz / 0.07);
    float closed = mix(step(facHash(vec2(bay, lvl) + seed * vec2(3.0, 5.0)), 0.25), 0.25, farK);
    float flank = (facGrid(s, 0.5 - 2.0 * hw, 0.5 + 2.0 * hw, n, ws) - colW) * (rowW + rowR);
    facMix(rgb, iu, volet * slat, voletIu * slat, flank * (1.0 - closed) + (win + rdcWin) * closed);
  }

  // --- Garde-corps devant les fenêtres (haussmannien hors balcons, boutiques) ; balcons
  // filants au 2e et au dernier étage courant (haussmannien) avec leur dalle et son ombre.
  if ((hauss || shops) && zhi > h0 && zlo < zm) {
    float k1 = (hauss && nReg >= 2.0) ? 1.0 : -10.0;
    float k2 = (hauss && nReg >= 3.0) ? nReg - 1.0 : -10.0;
    float z1 = h0 + k1 * fh;
    float z2 = h0 + k2 * fh;
    float balFloors = facBand(z, z1, z1 + fh, wz) + facBand(z, z2, z2 + fh, wz);
    float iron = 0.0;
    if ((zhi > z1 - 0.42 && zlo < z1 + 1.0) || (zhi > z2 - 0.42 && zlo < z2 + 1.0)) {
      float span = facBand(u, margin - 0.35, W - margin + 0.35, wu);
      float slab = facBand(z, z1 - 0.16, z1 + 0.02, wz) + facBand(z, z2 - 0.16, z2 + 0.02, wz);
      float under = facBand(z, z1 - 0.42, z1 - 0.16, wz) + facBand(z, z2 - 0.42, z2 - 0.16, wz);
      facShadow(rgb, iu, span * under, 0.3);
      facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, span * slab);
      iron = span * (facRailing(z - z1, u, wz, wu) + facRailing(z - z2, u, wz, wu));
    }
    // Garde-corps de 0,6 m devant chaque fenêtre (créneaux périodiques en étages).
    float rowBody = facGrid(t, sill / fh, (sill + 0.6) / fh, nReg, wt);
    float rowRail = facGrid(t, (sill + 0.53) / fh, (sill + 0.6) / fh, nReg, wt);
    float bars = facGrid(u / 0.13, 0.0, 0.3, 1.0e5, wu / 0.13);
    iron += facGrid(s, 0.5 - hw - 0.05 / p, 0.5 + hw + 0.05 / p, n, ws) * (1.0 - balFloors)
          * (rowRail + (rowBody - rowRail) * bars);
    facMix(rgb, iu, FAC_FER, FAC_FER_IU, clamp(iron, 0.0, 1.0));
  }
#endif

  // --- Bandeau au-dessus du rez-de-chaussée, corniche et son ombre, couronnement.
  if (nf > 0.0) {
    float bandH = hauss ? 0.35 : 0.22;
    facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, facBand(z, h0 - bandH, h0 + 0.06, wz));
  }
  facShadow(rgb, iu, facBand(z, zc - 0.5, zc - 0.28, wz), 0.28);
  facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, facBand(z, zc - 0.28, zc + 0.1, wz));
  if (!mansard) facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, facBand(z, H - 0.12, H + 1.0, wz));

  // --- Mansarde d'ardoise (haussmannien) et ses lucarnes.
  if (mansard && zhi > zm) {
    float slate = facBand(z, zm + 0.1, H + 1.0, wz);
    vec3 sl = FAC_ARDOISE;
    vec2 slIu = FAC_ARDOISE_IU;
#if FACADES > 1
    float rows = 1.0 - 0.12 * facGrid(z / 0.22, 0.0, 0.2, 1.0e5, wz / 0.22);
    sl *= rows;
    slIu *= rows;
#endif
    facMix(rgb, iu, sl, slIu, slate);
    float dh = 0.45 / p;
    float dTop = min(zm + 2.25, H - 0.15);
    float dFrame = facGrid(s, 0.5 - dh - 0.18 / p, 0.5 + dh + 0.18 / p, n, ws) * facBand(z, zm + 0.45, dTop, wz);
    float dGlass = facGrid(s, 0.5 - dh, 0.5 + dh, n, ws) * facBand(z, zm + 0.6, dTop - 0.3, wz);
    facMix(rgb, iu, FAC_PIERRE, FAC_PIERRE_IU, dFrame);
    float gD = mix(clamp((z - zm - 0.6) / 1.35, 0.0, 1.0), 0.5, farK);
    facMix(rgb, iu, FAC_VERRE * (0.7 + 0.6 * gD), FAC_VERRE_IU * (0.7 + 0.6 * gD), dGlass);
  }
#endif
}
