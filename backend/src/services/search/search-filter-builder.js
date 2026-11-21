import { CATEGORIES } from '../../constants/declarations/categories.js';
import { DECLARATION_STATUSES } from '../../constants/declarations/declaration-status.js';

// Catégories dont la photo est cachée au public (aujourd'hui : student_card_id).
// Le filtre "photo" doit suivre ce que l'utilisateur peut voir : sinon hasPhoto=true révélerait
// qu'une carte étudiante a une photo.
const SENSITIVE_CATEGORY_KEYS = Object.freeze(
  Object.entries(CATEGORIES)
    .filter(([, category]) => category.sensitive === true)
    .map(([key]) => key),
);

// Pour chaque lettre, la liste de ses variantes accentuées (minuscules ET majuscules).
// Écrit en dur dans les deux casses car l'option "insensible à la casse" de MongoDB n'est pas
// fiable pour les lettres accentuées.
const ACCENT_CLASSES = Object.freeze({
  a: 'aàáâãäåAÀÁÂÃÄÅ',
  c: 'cçCÇ',
  e: 'eèéêëEÈÉÊË',
  i: 'iìíîïIÌÍÎÏ',
  n: 'nñNÑ',
  o: 'oòóôõöOÒÓÔÕÖ',
  u: 'uùúûüUÙÚÛÜ',
  y: 'yýÿYÝŸ',
});

// Caractères qui ont un sens spécial dans une expression régulière.
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\\-/]/;

// ---------------------------------------------------------------------------------------------
// buildAccentInsensitiveRegex : "bibliotheque" et "Bibliothèque" donnent des motifs équivalents.
//   1) normalize('NFD') sépare chaque lettre de son accent ("è" devient "e" + accent)
//   2) replace(/\p{M}/gu, '') supprime les accents, toLowerCase met en minuscules
//   3) chaque lettre est remplacée par une classe [eèéêë...] qui accepte toutes ses variantes
//   4) chaque caractère spécial est échappé UN PAR UN : l'utilisateur ne peut jamais injecter de
//      motif regex (ni de motif lent à évaluer)
// ---------------------------------------------------------------------------------------------
export function buildAccentInsensitiveRegex(value) {
  const base = value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  return [...base]
    .map((char) => {
      if (ACCENT_CLASSES[char]) return `[${ACCENT_CLASSES[char]}]`;
      return REGEX_SPECIAL.test(char) ? `\\${char}` : char;
    })
    .join('');
}

// ---------------------------------------------------------------------------------------------
// buildSearchFilter : construit le filtre. Chaque critère absent (null) est simplement ignoré.
// ---------------------------------------------------------------------------------------------
export function buildSearchFilter({
  statuses,
  type = null,
  category = null,
  location = null,
  // 'exact' : égalité stricte du texte stocké (rapide, utilise l'index).
  // 'loose' : sans casse ni accents, et le texte peut n'être qu'une PARTIE du lieu.
  // Le service essaie d'abord 'exact', puis 'loose' si rien n'est trouvé.
  locationMode = 'exact',
  color = null,
  dateFrom = null,
  dateTo = null,
  hasPhoto = null,
  q = null,
}) {
  // Base : le statut doit être dans la liste demandée (ou la liste par défaut).
  const filter = { status: { $in: statuses } };

  // Les suppressions "douces" (deletedAt rempli) sont exclues, SAUF si un admin demande
  // explicitement le statut "deleted".
  if (!statuses.includes(DECLARATION_STATUSES.DELETED)) filter.deletedAt = null;

  // Filtres simples : chacun ajoute une condition. MongoDB combine les conditions d'un même
  // objet avec ET, d'où le "AND entre tous les filtres".
  if (type) filter.type = type;
  if (category) filter.category = category;

  // Lieu : exact ou souple (voir locationMode).
  if (location) {
    filter.location =
      locationMode === 'loose'
        ? { $regex: buildAccentInsensitiveRegex(location), $options: 'i' }
        : location;
  }

  // Couleur : stockée dans la Map "attributes" du modèle, donc la clé 'attributes.color'.
  if (color) filter['attributes.color'] = color;

  // Dates : $gte = "supérieur ou égal", $lte = "inférieur ou égal".
  // On n'ajoute que les bornes données : une seule borne suffit.
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = dateFrom;
    if (dateTo) filter.date.$lte = dateTo;
  }

  // Photo : on suit ce que l'utilisateur peut voir (voir SENSITIVE_CATEGORY_KEYS).
  //   Avec photo : une photo existe ET la catégorie n'est pas sensible.
  //   Sans photo : pas de photo OU catégorie sensible (dont la photo est de toute façon cachée).
  // $and évite d'écraser un éventuel filtre "category" déjà posé.
  if (hasPhoto === true) {
    filter.$and = [{ picture: { $ne: null } }, { category: { $nin: SENSITIVE_CATEGORY_KEYS } }];
  } else if (hasPhoto === false) {
    filter.$and = [{ $or: [{ picture: null }, { category: { $in: SENSITIVE_CATEGORY_KEYS } }] }];
  }

  // Texte : utilise l'index texte français. MongoDB exige que $text soit au premier niveau du
  // filtre (d'où cette place). Il calcule aussi un score de pertinence pour le tri "relevance".
  if (q) filter.$text = { $search: q };

  return filter;
}
