/**
 * FICHIER : models/search/saved-search.model.js
 *
 * RÔLE
 *   Le "plan" d'une recherche sauvegardée dans MongoDB (collection savedsearches). Une
 *   recherche sauvegardée = un propriétaire + un nom facultatif + les critères à surveiller.
 *   Elle sert à alerter l'utilisateur quand une NOUVELLE déclaration correspond à ces critères.
 *
 *   Aucune déclaration n'est copiée ici : on ne garde que les critères (la "question"), jamais
 *   les résultats (la "réponse"), qui changent tout le temps.
 *
 * UTILISÉ PAR
 *   - repositories/search/saved-search.repository.js
 *
 * UTILISE
 *   - constants/declarations/* (mêmes listes de types et de catégories que le modèle Declaration,
 *     donc toujours synchronisées), constants/declarations/declaration-limits.js
 *   - constants/search/saved-search-options.js
 */
import mongoose from 'mongoose';
import { CATEGORY_KEYS } from '../../constants/declarations/categories.js';
import { DECLARATION_LIMITS as LIMITS } from '../../constants/declarations/declaration-limits.js';
import { DECLARATION_TYPE_VALUES } from '../../constants/declarations/declaration-types.js';
import { SAVED_SEARCH_NAME_MAX } from '../../constants/search/saved-search-options.js';

// Sous-document des critères. _id:false : il n'a pas besoin de son propre identifiant.
// Tous les champs sont facultatifs ; "au moins un" est exigé par le validator Joi.
const criteriaSchema = new mongoose.Schema(
  {
    q: { type: String, trim: true },
    type: { type: String, enum: DECLARATION_TYPE_VALUES },
    category: { type: String, enum: CATEGORY_KEYS },
    location: { type: String, trim: true, maxlength: LIMITS.LOCATION_MAX },
    color: { type: String, trim: true, maxlength: LIMITS.ATTRIBUTE_VALUE_MAX },
    dateFrom: { type: Date },
    dateTo: { type: Date },
    hasPhoto: { type: Boolean },
  },
  { _id: false },
);

const savedSearchSchema = new mongoose.Schema(
  {
    // À qui appartient l'alerte. Chaque lecture et chaque suppression filtre sur ce champ : un
    // utilisateur ne peut jamais voir ni effacer l'alerte d'un autre.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, trim: true, maxlength: SAVED_SEARCH_NAME_MAX, default: null },
    criteria: { type: criteriaSchema, required: true },
  },
  // timestamps : createdAt et updatedAt ajoutés automatiquement.
  { timestamps: true },
);

// Sert aux deux requêtes de l'API : lister mes alertes (plus récentes d'abord) et les compter.
savedSearchSchema.index({ owner: 1, createdAt: -1 });

export const SavedSearch = mongoose.model('SavedSearch', savedSearchSchema);
