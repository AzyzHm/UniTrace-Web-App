/**
 * FICHIER : models/declarations/declaration-search-indexes.js
 *
 * RÔLE
 *   Liste des 4 index MongoDB ajoutés pour la recherche. Un index fonctionne comme l'index d'un
 *   livre : MongoDB retrouve les documents sans lire toute la collection (indispensable avec
 *   10 000 déclarations ou plus).
 *
 * POURQUOI UN FICHIER À PART
 *   La liste est définie une seule fois et lue à deux endroits. Le modèle et le script de
 *   migration ne peuvent donc jamais se contredire.
 *
 * UTILISÉ PAR
 *   - models/declarations/declaration.model.js (enregistre les index pour une base neuve)
 *   - scripts/add-search-indexes.js (crée les index sur une base déjà existante)
 *
 * UTILISE
 *   Rien (données pures).
 *
 * À FAIRE RELIRE
 *   Le modèle Declaration appartient au Binôme 1 : ces index sont à valider avec lui.
 */
export const SEARCH_INDEXES = Object.freeze([
  {
    // 1. Recherche par mots (paramètre q). Langue française : "sacs" retrouve "sac".
    //    Un mot du titre compte 3 fois plus qu'un mot de la description (tri par pertinence).
    key: { title: 'text', description: 'text' },
    options: {
      name: 'search_text_idx',
      default_language: 'french',
      weights: { title: 3, description: 1 },
    },
  },
  {
    // 2. Filtre par couleur (attributes.color), combiné avec type, statut et date.
    key: { 'attributes.color': 1, type: 1, status: 1, date: -1 },
    options: { name: 'search_color_idx' },
  },
  {
    // 3. Filtre par lieu (location), combiné avec type, statut et date.
    key: { location: 1, type: 1, status: 1, date: -1 },
    options: { name: 'search_location_idx' },
  },
  {
    // 4. Filtre par statut et tri par date (cas le plus fréquent, et vue admin).
    key: { status: 1, date: -1 },
    options: { name: 'search_status_date_idx' },
  },
]);
