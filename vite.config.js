// Configuration Vite : site statique publié sur GitHub Pages sous /aSlower/ (la casse compte).
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/aSlower/',
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
    // Texte complet des licences des dépendances (three.js : MIT), publié avec le jeu.
    license: { fileName: 'licences/npm-dependencies.txt' },
    rolldownOptions: {
      output: {
        // Garde les commentaires /*! … */ : en-têtes d'attribution OpenRelativity (licence MIT).
        comments: { legal: true },
        // three dans son propre fichier, gardé en cache d'un déploiement à l'autre.
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  server: { host: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
