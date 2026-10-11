/**
 * Panneau « Réglages » de l'accueil, dans un <dialog> modal (index.html, #settings) : vitesse
 * de la lumière (hud/lightSpeed.js), Direction (hud/direction.js, écran tactile), aides
 * (spectromètre, revoir les bulles) et rappel des commandes. Les réglages eux-mêmes sont
 * créés et branchés par main.js ; ce module ouvre et ferme le dialogue (Échap, bouton
 * « Fermer », clic sur le fond) et affiche une ligne d'état (role="status").
 * Styles : src/styles/base.css (.sheet, .settings).
 */

/**
 * @param {HTMLDialogElement} dialog
 * @param {{onClose?: () => void}} [options]
 * @returns {{open(): void, close(): void, setStatus(text: string): void, readonly isOpen: boolean}}
 */
export function createSettingsPanel(dialog, { onClose = () => {} } = {}) {
  const status = /** @type {HTMLElement | null} */ (dialog.querySelector('[role="status"]'));

  function open() {
    if (status) status.textContent = '';
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    /** @type {HTMLElement | null} */ (dialog.querySelector('.btn-close'))?.focus({ preventScroll: true });
  }

  function close() {
    if (!dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      onClose();
    }
  }

  dialog.addEventListener('close', () => onClose());
  // Un clic sur le fond (hors du contenu, qui remplit toute la boîte) ferme le dialogue.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  return {
    open,
    close,
    setStatus(text) {
      if (status) status.textContent = text;
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
