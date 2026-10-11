// Calibrage des étoiles (jalon 3) : joue chaque niveau avec le pilote de référence
// (src/game/bot.js, vraie physique et vraies règles) pour plusieurs valeurs de c, puis AFFICHE
// des seuils suggérés (rien n'est écrit) :
//   batterieMin ≈ (τmax − 1,15·τ_ref)/τmax, arrondi aux 0,05 inférieurs ;
//   tVilleMax ≈ 1,12·t_ref, arrondi aux 5 s supérieures ;
// avec τ_ref et t_ref les plus défavorables sur les c essayés. Le parcours « naïf », s'il
// existe, doit faire moins de 3 étoiles avec les seuils actuels.
//
//   npm run calibrate                     tous les niveaux de src/levels/
//   npm run calibrate -- chemin/nNN.json  un fichier (par exemple une fixture)
//   npm run calibrate -- --c=10,30,100    valeurs de c (défaut : 10, 30, 100)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBot } from '../src/game/bot.js';
import { validateLevel } from '../src/game/validate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const palette = readJson(join(ROOT, 'src/data/palette.json'));

const args = process.argv.slice(2);
const cArg = args.find((a) => a.startsWith('--c='));
const speeds = cArg ? cArg.slice(4).split(',').map(Number) : [10, 30, 100];
let files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  const dir = join(ROOT, 'src/levels');
  files = readdirSync(dir)
    .filter((f) => /^n\d{2}-.*\.json$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}
if (files.length === 0) {
  console.log('Aucun niveau dans src/levels/ (nNN-nom.json).');
  process.exit(0);
}

const fmt = (x, d = 1) => x.toFixed(d).replace('.', ',');
let failures = 0;
for (const file of files) {
  const json = readJson(file);
  const name = file.replace(/^.*[\\/]/, '');
  console.log(`\n${name} — « ${json.titre} »`);
  const { errors, warnings } = validateLevel(json, { fileName: name, palette });
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length) {
    for (const e of errors) console.log(`  ✗ ${e}`);
    failures += 1;
    continue;
  }
  if (!json.parcours?.reference) {
    console.log('  (pas de parcours de référence : rien à calibrer)');
    continue;
  }
  let worstTau = 0;
  let worstT = 0;
  for (const c of speeds) {
    for (const route of ['reference', 'naif']) {
      if (!json.parcours[route]) continue;
      const r = runBot(json, { c, palette, route });
      const s = r.score;
      const line = `  c = ${String(c).padStart(3)} m/s  ${route.padEnd(9)} ${r.status.padEnd(8)} ${'★'.repeat(s.etoiles).padEnd(3, '·')}  τ ${fmt(s.econome.tauFin)} s  t ${fmt(s.ponctuel.tFin)} s  batterie ${Math.floor(s.econome.batterieRestante * 100)} %`;
      console.log(line + (s.messages.length ? `  — ${s.messages.join(' ')}` : ''));
      if (route === 'reference') {
        if (r.status !== 'reussite') failures += 1;
        worstTau = Math.max(worstTau, s.econome.tauFin);
        worstT = Math.max(worstT, s.ponctuel.tFin);
      }
    }
  }
  const tauMax = json.batterie.tauMax;
  const batterieMin = Math.max(0, Math.floor(((tauMax - 1.15 * worstTau) / tauMax) * 20) / 20);
  const tVilleMax = Math.ceil((1.12 * worstT) / 5) * 5;
  console.log(`  actuels   : batterieMin ${json.etoiles.batterieMin}, tVilleMax ${json.etoiles.tVilleMax} s`);
  console.log(`  suggérés  : batterieMin ${batterieMin}, tVilleMax ${tVilleMax} s  (τ_ref ≤ ${fmt(worstTau)} s, t_ref ≤ ${fmt(worstT)} s)`);
}
process.exit(failures ? 1 : 0);
