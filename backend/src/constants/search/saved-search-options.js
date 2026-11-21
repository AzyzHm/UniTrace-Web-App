// Au-delà, POST /search/saved répond 409 SAVED_SEARCH_LIMIT. Évite qu'un compte remplisse la base
// (et que chaque nouvelle déclaration soit comparée à des milliers d'alertes).
export const MAX_SAVED_SEARCHES_PER_USER = 20;

// Le nom est facultatif : c'est juste une étiquette pour retrouver l'alerte dans la liste.
export const SAVED_SEARCH_NAME_MAX = 60;

// Les critères qu'une alerte peut contenir. Volontairement absents : status (une nouvelle
// déclaration est toujours "pending"), sort, page et limit (ils décrivent l'AFFICHAGE d'une
// recherche, pas ce que l'on veut surveiller).
export const SAVED_SEARCH_CRITERIA = Object.freeze([
  'q',
  'type',
  'category',
  'location',
  'color',
  'dateFrom',
  'dateTo',
  'hasPhoto',
]);
