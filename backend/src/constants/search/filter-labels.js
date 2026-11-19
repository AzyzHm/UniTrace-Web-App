/**
 * FICHIER : constants/search/filter-labels.js
 *
 * RÔLE
 *   Dictionnaire français des listes déroulantes du formulaire de recherche.
 *   Dans la base on stocke des clés techniques (ex. "phone", "pending") ; l'étudiant, lui, doit
 *   lire "Téléphone", "En attente". Ce fichier fait la traduction clé -> libellé.
 *
 * POURQUOI ICI
 *   Le front ne contient aucun libellé en dur : il les reçoit via GET /api/v1/search/filters.
 *   Changer un libellé se fait donc à un seul endroit.
 *
 * UTILISÉ PAR
 *   - services/search/search.service.js (méthode buildFilters)
 *   - tests/unit/search/filter-labels.test.js (vérifie qu'aucune clé n'est oubliée)
 *
 * UTILISE
 *   Rien (fichier de données pur).
 *
 * ATTENTION
 *   Si on ajoute une catégorie ou un statut dans constants/declarations/, il faut ajouter son
 *   libellé ici, sinon le test filter-labels.test.js échoue (c'est voulu, pour ne pas afficher
 *   "undefined" dans une liste déroulante).
 */

// Types de déclaration : clé stockée en base -> libellé affiché.
export const TYPE_LABELS = Object.freeze({
  lost: 'Perdu',
  found: 'Trouvé',
});

// Les 14 catégories d'objets (mêmes clés que CATEGORY_KEYS dans constants/declarations/categories.js).
export const CATEGORY_LABELS = Object.freeze({
  phone: 'Téléphone',
  laptop_tablet: 'Ordinateur / tablette',
  earbuds_headphones: 'Écouteurs / casque',
  charger_cable: 'Chargeur / câble',
  book_notebook: 'Livre / cahier',
  student_card_id: "Carte étudiante / pièce d'identité",
  wallet_bag: 'Portefeuille / sac',
  keys: 'Clés',
  calculator_stationery: 'Calculatrice / fournitures',
  usb_storage: 'Clé USB / stockage',
  glasses: 'Lunettes',
  clothing: 'Vêtement',
  water_bottle_lunchbox: 'Gourde / boîte repas',
  other: 'Autre',
});

// Les 6 statuts. hidden et deleted ne sont proposés qu'aux admins (voir search.service.js).
export const STATUS_LABELS = Object.freeze({
  pending: 'En attente',
  matched: 'Correspondance trouvée',
  resolved: 'Résolu',
  expired: 'Expiré',
  hidden: 'Masqué',
  deleted: 'Supprimé',
});

// Filtre "photo" : la clé est un vrai booléen (true/false), pas du texte.
export const HAS_PHOTO_OPTIONS = Object.freeze([
  Object.freeze({ key: true, label: 'Avec photo' }),
  Object.freeze({ key: false, label: 'Sans photo' }),
]);
