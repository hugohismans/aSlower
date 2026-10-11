/**
 * Écran « Crédits » dans un <dialog> (obligation de la licence MIT d'OpenRelativity
 * dès la première publication).
 *
 * Le texte de THIRD_PARTY_NOTICES.md (textes MIT intégraux et liste des fichiers
 * dérivés) est chargé à la première ouverture par un import dynamique `?raw`
 * (fichier à part dans le build) et affiché tel quel en texte préformaté.
 * Les copies servies avec le jeu sont liées via import.meta.env.BASE_URL
 * (« /aSlower/ » sur GitHub Pages).
 */

/** Balisage du dialogue (aucune donnée extérieure n'y est injectée en HTML). */
function template(base) {
  return `
  <div class="sheet-body credits-body">
    <header class="sheet-head">
      <h2 id="credits-title">Crédits</h2>
      <form method="dialog">
        <button type="submit" class="btn btn-close" autofocus>Fermer</button>
      </form>
    </header>
    <p class="credits-lead"><strong>Le Coursier relativiste</strong>, un jeu de Hugo Hismans.
      Code sous licence MIT&#8239;; contenus (données JSON, textes) sous licence CC&nbsp;BY&nbsp;4.0.</p>

    <h3>Inspiration et code adapté</h3>
    <ul>
      <li>Inspiré de <cite>A Slower Speed of Light</cite> (MIT Game Lab, 2012).</li>
      <li>Shaders relativistes et logique de mouvement adaptés
        d'<a href="https://github.com/MITGameLab/OpenRelativity" target="_blank" rel="noopener">OpenRelativity</a>
        (MIT Game Lab), sous licence MIT&nbsp;: Copyright (c) 2013 Massachusetts Institute of Technology.</li>
      <li>Merci à Gerd Kortemeyer et au MIT Game Lab pour OpenRelativity.</li>
      <li>Couleurs&nbsp;: C. Wyman, P.-P. Sloan et P. Shirley, «&nbsp;Simple Analytic Approximations
        to the CIE XYZ Color Matching Functions&nbsp;», <cite>Journal of Computer Graphics
        Techniques</cite>, vol.&nbsp;2, n°&nbsp;2, 2013.</li>
      <li>Rendu 3D&nbsp;: <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (licence MIT).</li>
    </ul>
    <p class="credits-note">Projet indépendant, non affilié au MIT ni approuvé par lui.
      Aucune ressource du jeu d'origine n'est utilisée.</p>

    <h3>Licences</h3>
    <ul>
      <li><a href="${base}licences/openrelativity-MIT.txt" target="_blank" rel="noopener">Licence MIT d'OpenRelativity (texte intégral)</a></li>
      <li><a href="${base}licences/npm-dependencies.txt" target="_blank" rel="noopener">Licences des dépendances npm (three.js)</a></li>
      <li><a href="https://github.com/hugohismans/aSlower" target="_blank" rel="noopener">Code source du jeu</a></li>
    </ul>

    <h3>Avis de tiers (THIRD_PARTY_NOTICES.md)</h3>
    <pre class="credits-notices" tabindex="0"></pre>
  </div>`;
}

/**
 * @param {HTMLDialogElement} dialogElement <dialog id="credits"> de index.html
 * @returns {{open(): void, close(): void}}
 */
export function createCredits(dialogElement) {
  dialogElement.classList.add('sheet', 'credits');
  dialogElement.setAttribute('aria-labelledby', 'credits-title');
  dialogElement.innerHTML = template(import.meta.env.BASE_URL);
  const notices = /** @type {HTMLElement} */ (dialogElement.querySelector('.credits-notices'));
  let loading = null;

  /** Charge les notices une seule fois (nouvel essai à l'ouverture suivante en cas d'échec). */
  function loadNotices() {
    if (loading) return loading;
    notices.textContent = 'Chargement…';
    loading = import('../../THIRD_PARTY_NOTICES.md?raw')
      .then((module) => {
        notices.textContent = module.default;
      })
      .catch(() => {
        loading = null;
        notices.textContent =
          'Impossible de charger les avis de licence (hors ligne\u00a0?). Les textes complets sont aussi accessibles par les liens «\u00a0Licences\u00a0» ci-dessus.';
      });
    return loading;
  }

  function open() {
    if (!dialogElement.open) {
      if (typeof dialogElement.showModal === 'function') dialogElement.showModal();
      else dialogElement.setAttribute('open', ''); // très vieux navigateurs
    }
    loadNotices();
  }

  function close() {
    if (!dialogElement.open) return;
    if (typeof dialogElement.close === 'function') dialogElement.close();
    else dialogElement.removeAttribute('open');
  }

  // Un clic sur le fond (hors du contenu, qui remplit toute la boîte) ferme le dialogue.
  dialogElement.addEventListener('click', (event) => {
    if (event.target === dialogElement) close();
  });

  return { open, close };
}
