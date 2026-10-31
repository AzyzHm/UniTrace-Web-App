import { CATEGORIES } from '../../constants/declarations/categories.js';
import { PICTURE_URL_BASE } from '../../constants/declarations/picture.js';

// Clients get the URL of the controlled picture route, never the stored filename.
function toPictureUrl(declaration) {
  if (!declaration.picture) return null;
  // Lean results (the list page) are plain objects, so they have no id virtual.
  const id = declaration.id ?? String(declaration._id);
  return `${PICTURE_URL_BASE}/${id}/picture`;
}

// A document holds the attributes as a Map, a lean result as a plain object.
function toPlainAttributes(attributes) {
  if (!attributes) return {};
  return attributes instanceof Map ? Object.fromEntries(attributes) : { ...attributes };
}

// The full view, the only one that includes privateInfo.
export function toOwnerDeclarationResponse(declaration) {
  return {
    id: declaration.id ?? String(declaration._id),
    title: declaration.title,
    type: declaration.type,
    description: declaration.description,
    category: declaration.category,
    attributes: toPlainAttributes(declaration.attributes),
    privateInfo: declaration.privateInfo ?? null,
    picture: toPictureUrl(declaration),
    status: declaration.status,
    date: declaration.date,
    location: declaration.location,
    createdAt: declaration.createdAt,
    updatedAt: declaration.updatedAt,
  };
}

// The view for other users: no privateInfo, no owner, no updatedAt.
export function toPublicDeclarationResponse(declaration) {
  // A sensitive category (a student card) never shows its picture to other users. The owner
  // still sees it through the owner view.
  const isSensitive = CATEGORIES[declaration.category]?.sensitive === true;

  return {
    id: declaration.id ?? String(declaration._id),
    title: declaration.title,
    type: declaration.type,
    description: declaration.description,
    category: declaration.category,
    attributes: toPlainAttributes(declaration.attributes),
    picture: isSensitive ? null : toPictureUrl(declaration),
    status: declaration.status,
    date: declaration.date,
    location: declaration.location,
    createdAt: declaration.createdAt,
  };
}

// A light shape for the owner's list: no description, attributes or privateInfo, which keeps
// pages small.
export function toDeclarationSummary(declaration) {
  return {
    id: declaration.id ?? String(declaration._id),
    title: declaration.title,
    type: declaration.type,
    category: declaration.category,
    picture: toPictureUrl(declaration),
    status: declaration.status,
    date: declaration.date,
    location: declaration.location,
    createdAt: declaration.createdAt,
    updatedAt: declaration.updatedAt,
  };
}
