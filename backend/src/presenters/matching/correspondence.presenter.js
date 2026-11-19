import { toPublicDeclarationResponse } from '../declarations/declaration.presenter.js';

// An explicit whitelist, like your other presenters. Owner ids of both declarations and every
// vector stay server side. contact is filled only once both sides accepted.
export function toCorrespondenceResponse({ correspondence: c, side, contact = null, history }) {
  const body = {
    id: String(c._id),
    status: c.status,
    confidence: c.confidence,
    globalScore: c.globalScore,
    scores: {
      description: c.descriptionScore,
      location: c.locationScore,
      date: c.dateScore,
      image: c.imageScore ?? null,
      attributes: c.attributesScore ?? null,
    },
    explanation: c.explanation,
    mySide: side,
    myReaction: side ? c.reactions[side] : undefined,
    lost: toPublicDeclarationResponse(c.lost),
    found: toPublicDeclarationResponse(c.found),
    contact,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
  if (history) body.history = history.map((h) => ({ type: h.type, data: h.data, at: h.createdAt }));
  return body;
}

export function toNotificationResponse(n) {
  return {
    id: String(n._id),
    type: n.type,
    message: n.message,
    correspondenceId: n.correspondence ? String(n.correspondence) : null,
    read: n.read,
    createdAt: n.createdAt,
  };
}