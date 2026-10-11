/**
 * Niveaux du jeu (jalon 3) : SEUL glob des fichiers `src/levels/nNN-nom.json`
 * (schéma « coursier-niveau/1 », src/game/validate.js). Chargés d'avance (eager) : quelques
 * kilo-octets chacun. Module de données : aucun import de code ; la validation
 * (game/validate.js) et la création des parties (game/level.js) se font dans main.js.
 */

/** @type {Record<string, any>} chemin → contenu JSON */
const modules = import.meta.glob('./n[0-9][0-9]-*.json', { eager: true, import: 'default' });

/** Id d'un niveau d'après son chemin : « ./n01-premier-jour.json » → « n01-premier-jour ». */
export function levelIdFromPath(path) {
  return path.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
}

/**
 * Niveaux trouvés, triés par nom de fichier (donc par numéro) : [{id, fileName, json}].
 * L'id vient du nom de fichier ; validateLevel vérifie qu'il est égal à json.id.
 * @type {ReadonlyArray<{id: string, fileName: string, json: any}>}
 */
export const LEVEL_FILES = Object.freeze(
  Object.keys(modules)
    .sort()
    .map((path) => Object.freeze({ id: levelIdFromPath(path), fileName: path.replace(/^.*[\\/]/, ''), json: modules[path] })),
);

/** Ids des niveaux, dans l'ordre. */
export const LEVEL_IDS = Object.freeze(LEVEL_FILES.map((l) => l.id));

/**
 * Contenu JSON d'un niveau, ou null.
 * @param {string} id
 */
export function levelJson(id) {
  return LEVEL_FILES.find((l) => l.id === id)?.json ?? null;
}
